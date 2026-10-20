#!/usr/bin/env node
// Giao diện web chạy trên máy: npm run ui -> http://localhost:3000
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { config, ROOT_DIR, OUTPUT_DIR, saveEnvValue } from './core/env.js';
import { getBmsToken, getSmToken, decodeJwt } from './core/auth.js';
import { ApiClient, ApiError } from './core/http.js';
import { log } from './core/logger.js';
import { saveRecord } from './core/store.js';
import { BmsMasterData } from './bms/masterData.js';
import { createOpportunity, toOpportunityRecord } from './bms/opportunity.js';
import { getApprovalState, approveOpportunity } from './bms/approval.js';
import {
  getContractState, createContractRequest, toContractRecord, CONTRACT_CSV_COLUMNS,
  approveContractRequest, toContractApprovalRecord, CONTRACT_APPROVAL_CSV_COLUMNS,
} from './bms/contract.js';
import { getSurveyState, createSurvey, toSurveyRecord, SURVEY_CSV_COLUMNS } from './bms/survey.js';

const PORT = Number(process.env.UI_PORT) || 3000;
// Mặc định chỉ nghe trên máy này. Chạy trên server dùng chung: UI_HOST=0.0.0.0 + UI_AUTH=user:pass
const HOST = process.env.UI_HOST || '127.0.0.1';
const SERVER_MODE = !['127.0.0.1', 'localhost', '::1'].includes(HOST);
const UI_AUTH = process.env.UI_AUTH || '';
const PAGE = path.join(ROOT_DIR, 'public', 'index.html');

if (SERVER_MODE && !/^[^:]+:.{8,}$/.test(UI_AUTH)) {
  console.error(`UI_HOST=${HOST} mở tool ra mạng -> bắt buộc đặt UI_AUTH=<tên>:<mật khẩu ≥ 8 ký tự> trong .env`);
  process.exit(1);
}

// Basic auth cho chế độ server (so sánh hằng thời gian)
function authorized(req) {
  if (!UI_AUTH) return true;
  const [scheme, value] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !value) return false;
  const got = Buffer.from(Buffer.from(value, 'base64').toString('utf8'));
  const want = Buffer.from(UI_AUTH);
  return got.length === want.length && timingSafeEqual(got, want);
}

// Phiên BMS theo tài khoản
const sessions = new Map();

async function connect(username, force = false) {
  const key = username.trim().toLowerCase();
  if (!force && sessions.has(key)) {
    const s = sessions.get(key);
    if ((s.claims.exp ?? 0) * 1000 - Date.now() > 60_000) return s;
  }
  const token = await getBmsToken(username, { force });
  const api = new ApiClient(config.bmsApiUrl, token);
  // SM (tool LeasedLine) chỉ đăng nhập khi cần (khảo sát, khai cước); token SM cache riêng trong .cache/
  const getSm = async (smForce = false) => new ApiClient(config.smApiUrl, await getSmToken(username, { force: smForce }));
  const s = { api, master: new BmsMasterData(api), claims: decodeJwt(token) || {}, getSm };
  sessions.set(key, s);
  return s;
}

// Gọi API BMS/SM, tự đăng nhập lại 1 lần (đúng hệ thống bị 401) nếu token hết hạn
async function withSession(username, fn) {
  try {
    return await fn(await connect(username));
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) throw err;
    if (err.baseUrl === config.smApiUrl) {
      const s = await connect(username);
      await s.getSm(true);
      return fn(s);
    }
    return fn(await connect(username, true));
  }
}

function requireUser(user) {
  if (!user?.trim()) throw Object.assign(new Error('Chưa nhập tài khoản đăng nhập'), { status: 400 });
  return user.trim();
}

const routes = {
  'GET /api/config': async () => ({
    env: config.name,
    defaultUser: config.defaultUser,
    defaultAm: config.defaultAm,
    prefix: config.dataPrefix,
    emailDomain: config.emailDomain,
    otpConfigured: Boolean(config.otp),
    settingsLocked: SERVER_MODE,
  }),

  // Lưu OTP mặc định vào .env (lần đầu dùng trên máy mới)
  // Chế độ server: OTP chỉ sửa trong .env trên server, không cho đổi qua web
  'POST /api/settings': async ({ body }) => {
    if (SERVER_MODE) throw Object.assign(new Error('Tool đang chạy trên server: OTP do quản trị cấu hình trong .env'), { status: 403 });
    const otp = String(body.otp ?? '').trim();
    if (!/^\S{4,20}$/.test(otp)) throw Object.assign(new Error('OTP không hợp lệ'), { status: 400 });
    saveEnvValue('FTMS_OTP', otp);
    config.otp = otp;
    sessions.clear();
    return { otpConfigured: true };
  },

  'POST /api/login': async ({ body }) => {
    const user = requireUser(body.user);
    const { claims } = await connect(user, Boolean(body.force));
    return { user, userName: claims.UserName, fullName: claims.FullName, department: claims.DepartmentName };
  },

  'GET /api/services': async ({ query }) =>
    withSession(requireUser(query.get('user')), async ({ master }) =>
      Promise.all(
        (await master.serviceGroups()).map(async (g) => ({
          id: g.id,
          name: g.serviceGroupName,
          types: (await master.serviceTypes(g.id)).map((t) => ({ id: t.id, name: t.serviceTypeName.trim() })),
        })),
      ),
    ),

  'GET /api/sales': async ({ query }) =>
    withSession(requireUser(query.get('user')), async ({ master }) =>
      (await master.salesForPicker()).map((s) => ({ userName: s.userName, fullName: s.fullName, department: s.departmentCode })),
    ),

  // TPP đánh giá / BGĐ phê duyệt hợp lệ theo AM
  'GET /api/approvers': async ({ query }) =>
    withSession(requireUser(query.get('user')), async ({ master }) => {
      const { sale, tpp, bgd } = await master.approvers(query.get('am') || config.defaultAm);
      const brief = (u) => ({ userName: u.userName, fullName: u.fullName, position: u.positionName });
      return { am: brief(sale), tpp: tpp.map(brief), bgd: bgd.map(brief) };
    }),

  // Tạo 1 cơ hội / request -> giao diện gọi lặp để hiện tiến độ từng cái
  'POST /api/opportunities': async ({ body }) => {
    const user = requireUser(body.user);
    const am = (body.am || config.defaultAm).trim();
    return withSession(user, async ({ api, master }) => {
      const { group, type } = await master.resolveService(body.groupId, body.typeId);
      const { code, payload } = await createOpportunity(api, master, {
        group, type, am, tpp: body.tpp, bgd: body.bgd, prefix: config.dataPrefix,
      });
      const record = toOpportunityRecord({ env: config.name, user, group, type, code, payload });
      saveRecord('opportunities', record);
      log.ok(`${code} | ${group.serviceGroupName} / ${type.serviceTypeName.trim()} | ${payload.customer.fullName}`);
      return record.summary;
    });
  },

  // Trạng thái duyệt của nhiều cơ hội (cho cột Trạng thái ở bảng kết quả)
  'POST /api/opportunities/status': async ({ body }) => {
    const user = requireUser(body.user);
    const codes = [...new Set((body.codes || []).filter(Boolean))].slice(0, 200);
    return withSession(user, async ({ api }) => {
      const out = [];
      for (let i = 0; i < codes.length; i += 5) {
        out.push(...(await Promise.all(codes.slice(i, i + 5).map((code) =>
          getApprovalState(api, code).then(async (st) => {
            // Cơ hội đã duyệt -> kèm trạng thái YC HĐ (để hiện nút Tạo HĐ); chưa có YC HĐ -> kèm trạng thái
            // khảo sát (dịch vụ LeasedLine phải khảo sát trước -> nút Tạo KS)
            if (st.approved) st.contract = await getContractState(api, code).catch((err) => ({ error: err.message }));
            if (st.contract && !st.contract.requested && !st.contract.error) {
              st.survey = await getSurveyState(api, code).catch((err) => ({ error: err.message }));
            }
            return st;
          }).catch((err) => {
            if (err instanceof ApiError && err.status === 401) throw err;
            return { code, error: err.message };
          }),
        ))));
      }
      return out;
    });
  },

  // Duyệt 1 cơ hội bằng tài khoản đang đăng nhập
  'POST /api/approve': async ({ body }) => {
    const user = requireUser(body.user);
    return withSession(user, async ({ api }) => {
      const result = await approveOpportunity(api, body.code);
      log.ok(`Duyệt ${result.code} bằng ${user}: ${result.steps.join(' → ')}`);
      return result;
    });
  },

  // Khảo sát dịch vụ (LeasedLine) của 1 cơ hội đến "Khảo sát thành công" bằng tài khoản đang đăng nhập
  'POST /api/surveys': async ({ body }) => {
    const user = requireUser(body.user);
    return withSession(user, async ({ api, getSm }) => {
      const result = await createSurvey(api, await getSm(), body.code, { user });
      saveRecord('surveys', toSurveyRecord({ env: config.name, user, result }), SURVEY_CSV_COLUMNS);
      log.ok(`Khảo sát ${result.code} bằng ${user}: ${result.steps.join(' → ')} | ${result.state.label}`);
      return result;
    });
  },

  // Tạo yêu cầu hợp đồng cho 1 cơ hội đã duyệt bằng tài khoản đang đăng nhập
  'POST /api/contracts': async ({ body }) => {
    const user = requireUser(body.user);
    return withSession(user, async ({ api, getSm }) => {
      const result = await createContractRequest(api, body.code, { getSm });
      saveRecord('contracts', toContractRecord({ env: config.name, user, result }), CONTRACT_CSV_COLUMNS);
      log.ok(`YC HĐ ${result.code} bằng ${user}: ${result.steps.join(' → ')} | ${result.state.label}`);
      const { payload, ...rest } = result;
      return rest;
    });
  },

  // BGĐ duyệt YC HĐ của 1 cơ hội bằng tài khoản đang đăng nhập
  'POST /api/contracts/approve': async ({ body }) => {
    const user = requireUser(body.user);
    return withSession(user, async ({ api }) => {
      const result = await approveContractRequest(api, body.code);
      saveRecord('contract-approvals', toContractApprovalRecord({ env: config.name, user, result }), CONTRACT_APPROVAL_CSV_COLUMNS);
      log.ok(`Duyệt YC HĐ ${result.code} bằng ${user}: ${result.state.label} ${result.state.contractNo ?? ''}`);
      return result;
    });
  },

  'GET /api/history': async () => {
    const file = path.join(OUTPUT_DIR, 'opportunities.jsonl');
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-200)
      .reverse()
      .map((line) => {
        try {
          return JSON.parse(line).summary;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  },
};

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw Object.assign(new Error('Request quá lớn'), { status: 413 });
  }
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="FTMS Data Tool", charset="UTF-8"' });
    return res.end('Cần đăng nhập');
  }
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, await readFile(PAGE, 'utf8'), 'text/html; charset=utf-8');
    }
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { error: 'Không tìm thấy' });
    const body = req.method === 'POST' ? await readBody(req) : {};
    send(res, 200, await handler({ body, query: url.searchParams }));
  } catch (err) {
    log.error(err.message);
    send(res, err.status && err.status < 500 ? err.status : 500, { error: err.message });
  }
});

function openBrowser(target) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]]
    : process.platform === 'darwin' ? ['open', [target]]
    : ['xdg-open', [target]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

server.listen(PORT, HOST, () => {
  const target = `http://localhost:${PORT}`;
  log.ok(`FTMS Data Tool (${config.name}) đang chạy: http://${HOST}:${PORT}${SERVER_MODE ? ' [chế độ server, có basic auth]' : ''}  — Ctrl+C để dừng`);
  if (!config.otp) log.warn('Chưa cấu hình FTMS_OTP trong .env — sẽ không đăng nhập được');
  if (!SERVER_MODE && !process.argv.includes('--no-open')) openBrowser(target);
});
