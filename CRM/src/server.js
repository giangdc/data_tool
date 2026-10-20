#!/usr/bin/env node
// Giao diện web chạy trên máy: npm run ui -> http://localhost:3002
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { config, ROOT_DIR, saveEnvValue } from './core/env.js';
import { openSession, withRelogin } from './core/auth.js';
import { log } from './core/logger.js';
import { saveRecord, readRecords } from './core/store.js';
import {
  loadTemplate, describeTemplate, resolveOpportunityId, createOpportunity, toOpportunityRecord, OPPORTUNITY_CSV_COLUMNS,
} from './crm/opportunity.js';
import { createQuote, selectVersion, checkQuoteItems, toQuoteRecord, QUOTE_CSV_COLUMNS } from './crm/quote.js';
import { getFlowState, waitUntilOrderable } from './crm/flow.js';
import { createOrder, toOrderRecord, ORDER_CSV_COLUMNS } from './crm/order.js';

const PORT = Number(process.env.UI_PORT) || 3002;
const HOST = '127.0.0.1';
const PAGE = path.join(ROOT_DIR, 'public', 'index.html');

// Phiên đăng nhập theo tài khoản + template cơ hội mẫu đã tải
const sessions = new Map();
const templates = new Map();

async function connect(username, force = false) {
  const key = username.trim().toLowerCase();
  if (!force && sessions.has(key)) return sessions.get(key);
  const s = await openSession(username, { force });
  sessions.set(key, s);
  return s;
}

const withSession = async (username, fn) => withRelogin(await connect(username), fn);

function requireUser(user) {
  if (!user?.trim()) throw Object.assign(new Error('Chưa nhập tài khoản đăng nhập'), { status: 400 });
  return user.trim();
}

async function getTemplate(api, sample, reload = false) {
  const key = String(sample || config.sampleOpportunity).trim();
  if (!reload && templates.has(key)) return templates.get(key);
  const tpl = await loadTemplate(api, key);
  templates.set(key, tpl);
  return tpl;
}

const oppIdOf = (api, opp) => resolveOpportunityId(api, opp);

const routes = {
  'GET /api/config': async () => ({
    env: config.name,
    webUrl: config.webUrl,
    defaultUser: config.defaultUser,
    emailDomain: config.emailDomain,
    prefix: config.dataPrefix,
    sample: config.sampleOpportunity,
    orderWaitMinutes: config.orderWaitMinutes,
    passwordConfigured: Boolean(config.password),
  }),

  // Lưu mật khẩu mặc định vào .env (lần đầu dùng trên máy mới)
  'POST /api/settings': async ({ body }) => {
    const password = String(body.password ?? '');
    if (password.length < 4 || password.length > 100) throw Object.assign(new Error('Mật khẩu không hợp lệ'), { status: 400 });
    saveEnvValue('CRM_PASSWORD', password);
    config.password = password;
    sessions.clear();
    return { passwordConfigured: true };
  },

  'POST /api/login': async ({ body }) => {
    const user = requireUser(body.user);
    const s = await connect(user, Boolean(body.force));
    const p = s.profile || {};
    return { user, email: s.email, fullName: p.fullName ?? p.name ?? p.displayName, department: p.organization?.displayName ?? p.departmentName };
  },

  // Tải cơ hội mẫu (sản phẩm, AM, người duyệt, dòng báo giá) để xem trước
  'GET /api/template': async ({ query }) =>
    withSession(requireUser(query.get('user')), async (api) =>
      describeTemplate(await getTemplate(api, query.get('sample'), query.get('reload') === '1'))),

  // Tạo 1 cơ hội / request -> giao diện gọi lặp để hiện tiến độ
  'POST /api/opportunities': async ({ body }) => {
    const user = requireUser(body.user);
    return withSession(user, async (api) => {
      const tpl = await getTemplate(api, body.sample);
      const result = await createOpportunity(api, tpl, { prefix: config.dataPrefix });
      const record = toOpportunityRecord({ env: config.name, user, tpl, result });
      saveRecord('opportunities', record, OPPORTUNITY_CSV_COLUMNS);
      log.ok(`${result.code} | ${record.summary.name} | mẫu ${tpl.sample.code}`);
      return { ...record.summary, state: { oppId: result.id, code: result.code, step: 'quote', label: 'Chưa có báo giá' } };
    });
  },

  'POST /api/quotes': async ({ body }) => {
    const user = requireUser(body.user);
    return withSession(user, async (api) => {
      const tpl = await getTemplate(api, body.sample);
      const warn = checkQuoteItems(tpl.quote.items);
      if (warn) log.warn(warn);
      const oppId = await oppIdOf(api, body.opp);
      const result = await createQuote(api, oppId, tpl, { prefix: config.dataPrefix });
      const state = await getFlowState(api, oppId);
      if (!result.existed) saveRecord('quotes', toQuoteRecord({ env: config.name, user, oppCode: state.code, result }), QUOTE_CSV_COLUMNS);
      log.ok(`${state.code}: ${result.existed ? 'đã có' : 'tạo'} báo giá ${result.code}`);
      return { state, quoteCode: result.code, existed: Boolean(result.existed) };
    });
  },

  'POST /api/quotes/select': async ({ body }) => {
    const user = requireUser(body.user);
    return withSession(user, async (api) => {
      const oppId = await oppIdOf(api, body.opp);
      const r = await selectVersion(api, oppId);
      const state = await getFlowState(api, oppId);
      log.ok(`${state.code}: ${r.already ? 'đã đánh dấu' : 'đánh dấu'} ${r.quote.code} ${r.version.name} – ${state.label}`);
      return { state, version: r.version.name, already: r.already };
    });
  },

  // Chờ chính sách ban hành tối đa `seconds` giây / request -> giao diện gọi lặp, hiện thời gian chờ
  'POST /api/quotes/wait': async ({ body }) => {
    const user = requireUser(body.user);
    const seconds = Math.min(60, Math.max(5, Number(body.seconds) || 45));
    return withSession(user, async (api) =>
      waitUntilOrderable(api, await oppIdOf(api, body.opp), { timeoutMs: seconds * 1000, intervalMs: 10_000 }));
  },

  'POST /api/orders': async ({ body }) => {
    const user = requireUser(body.user);
    return withSession(user, async (api) => {
      const oppId = await oppIdOf(api, body.opp);
      const result = await createOrder(api, oppId, { prefix: config.dataPrefix });
      if (!result.existed) saveRecord('orders', toOrderRecord({ env: config.name, user, result }), ORDER_CSV_COLUMNS);
      log.ok(`${result.state.code}: ${result.existed ? 'đã có' : 'tạo'} đơn hàng ${result.state.order?.code ?? result.orderId}`);
      return { state: result.state, existed: Boolean(result.existed), orderStatus: result.orderStatus, steps: result.steps, customer: result.customer };
    });
  },

  // Trạng thái luồng của nhiều cơ hội (cột Trạng thái + nút bước kế tiếp ở bảng kết quả)
  'POST /api/status': async ({ body }) => {
    const user = requireUser(body.user);
    const opps = [...new Set((body.opps || []).filter(Boolean))].slice(0, 200);
    return withSession(user, async (api) => {
      const out = [];
      for (let i = 0; i < opps.length; i += 5) {
        out.push(...(await Promise.all(opps.slice(i, i + 5).map((opp) =>
          getFlowState(api, opp).catch((err) => {
            if (err.status === 401) throw err;
            return { oppId: opp, error: err.message };
          }),
        ))));
      }
      return out;
    });
  },

  'GET /api/history': async () => readRecords('opportunities').map((r) => r.summary),
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
    // Lỗi nghiệp vụ CRM (400/403/404…) trả nguyên mã để giao diện hiện thông báo
    send(res, err.status && err.status >= 400 && err.status < 500 ? err.status : 500, { error: err.message });
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
  log.ok(`CRM Data Tool (${config.name}) đang chạy: ${target}  — Ctrl+C để dừng`);
  if (!config.password) log.warn('Chưa cấu hình CRM_PASSWORD trong .env — nhập trên giao diện lần đầu');
  if (!process.argv.includes('--no-open')) openBrowser(target);
});
