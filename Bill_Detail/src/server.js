#!/usr/bin/env node
// Giao diện web chạy trên máy: npm run ui -> http://localhost:3003
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { config, ROOT_DIR, saveEnvValue } from './core/env.js';
import { login, logout, hasSession, sessionInfo, readCredentials } from './core/auth.js';
import { log } from './core/logger.js';
import { findContracts, listBills, billDetail } from './inside/bills.js';

const PORT = Number(process.env.UI_PORT) || 3003;
const HOST = '127.0.0.1';
const PAGE = path.join(ROOT_DIR, 'public', 'index.html');

// Cache danh sách hóa đơn (LoadReport "toàn bộ" chậm ~15s) – bấm "Tải lại" để bỏ qua
const BILL_CACHE_TTL_MS = 10 * 60 * 1000;
const billCache = new Map();

const routes = {
  'GET /api/config': async () => ({
    env: config.name,
    insideUrl: config.insideUrl,
    loggedIn: hasSession(),
    session: sessionInfo(),
    // Chỉ báo có/không + tên tài khoản, không trả mật khẩu
    ...(({ user, password, otp }) => ({ account: user, credentialsConfigured: Boolean(user && password), otpConfigured: Boolean(otp) }))(readCredentials()),
  }),

  // Lưu tài khoản vào .env của máy này rồi đăng nhập luôn. Mật khẩu / OTP để trống = giữ giá trị đang lưu
  'POST /api/settings': async ({ body }) => {
    const user = String(body.user ?? '').trim();
    const password = String(body.password ?? '');
    const otp = String(body.otp ?? '').trim();
    if (!/^\S{2,100}$/.test(user)) throw Object.assign(new Error('Tài khoản không hợp lệ'), { status: 400 });
    if (password.length > 100 || /[\r\n]/.test(password)) throw Object.assign(new Error('Mật khẩu không hợp lệ'), { status: 400 });
    if (!password && !readCredentials().password) throw Object.assign(new Error('Nhập mật khẩu'), { status: 400 });
    if (otp && !/^\S{4,20}$/.test(otp)) throw Object.assign(new Error('OTP không hợp lệ'), { status: 400 });
    saveEnvValue('INSIDE_USER', user);
    if (password) saveEnvValue('INSIDE_PASSWORD', password);
    if (otp) saveEnvValue('INSIDE_OTP', otp);
    logout();
    billCache.clear();
    await login();
    return { loggedIn: true, session: sessionInfo(), account: user };
  },

  'POST /api/login': async () => {
    await login();
    return { loggedIn: true, session: sessionInfo() };
  },

  'POST /api/logout': async () => {
    logout();
    billCache.clear();
    return { loggedIn: false };
  },

  'GET /api/contracts': async ({ query }) => findContracts(query.get('q')),

  'GET /api/bills': async ({ query }) => {
    const objId = query.get('objId');
    const year = Number(query.get('year')) || 0;
    const month = Number(query.get('month')) || 0;
    const key = `${objId}|${year}|${month}`;
    const hit = billCache.get(key);
    if (hit && query.get('refresh') !== '1' && Date.now() - hit.at < BILL_CACHE_TTL_MS) {
      return { ...hit.result, cached: true };
    }
    const started = Date.now();
    const rows = await listBills(objId, { year, month });
    const result = { rows, ms: Date.now() - started, fetchedAt: new Date().toISOString() };
    billCache.set(key, { at: Date.now(), result });
    return result;
  },
};

// Trang chi tiết hóa đơn: HTML partial của inside (đã bỏ script) bọc thêm CSS cơ bản thay cho bootstrap của trang gốc
const DETAIL_CSS = `
  body { margin: 0; padding: 12px 16px; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1d2433; background: #fff; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 14px; }
  td, th { border: 1px solid #d5dae3; padding: 4px 6px; vertical-align: top; }
  .d-none { display: none !important; }
  .text-center { text-align: center; } .text-right { text-align: right; } .text-left { text-align: left; }
  .text-danger { color: #c0392b; } .font-weight-bold, .fw-bold { font-weight: 700; }
  .h4 { font-size: 1.15rem; } .mt-5 { margin-top: 2.5rem; }
  .row { display: flex; flex-wrap: wrap; } .mt-3 { margin-top: 1rem; } .m-0 { margin: 0; }
  [class*="col-"] { box-sizing: border-box; min-width: 0; padding: 0 6px; }
  ${Array.from({ length: 12 }, (_, i) => `.col-${i + 1} { flex: 0 0 ${(((i + 1) / 12) * 100).toFixed(4)}%; max-width: ${(((i + 1) / 12) * 100).toFixed(4)}%; }`).join(' ')}
  .driver { border-top: 1px solid #e3e7ef; margin: 10px 0; }
  /* "Kính gửi", "Địa chỉ" có 2 bản: cus-1 cho màn rộng, cus-2 cho màn hẹp */
  .col-8-cus-2 { display: none; }
  @media (max-width: 900px) { .col-8-cus-1 { display: none; } .col-8-cus-2 { display: block; } }
  .form-control { width: 100%; box-sizing: border-box; }
  .table-striped tbody tr:nth-of-type(odd) { background: #f6f8fb; }
  img { max-width: 100%; }
`;
function detailPage(title, body) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><style>${DETAIL_CSS}</style></head><body>${body}</body></html>`;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function serveDetail(res, query) {
  const input = Object.fromEntries(['BillNumber', 'ObjID', 'Month', 'Year'].map((k) => [k, query.get(k) ?? '']));
  const title = `HĐ ${input.BillNumber}`;
  let status = 200;
  let body;
  try {
    body = (await billDetail(input)).html;
  } catch (err) {
    log.error(err.message);
    status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
    body = `<p class="text-danger"><b>Không tải được chi tiết hóa đơn:</b> ${escapeHtml(err.message)}</p>`;
  }
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    // Nội dung lấy từ inside -> không cho chạy script nào
    'Content-Security-Policy': "script-src 'none'; object-src 'none'; base-uri 'none'",
  });
  res.end(detailPage(escapeHtml(title), body));
}

// Chỉ nhận JSON: trang web lạ không gửi được application/json sang localhost (bị CORS chặn) -> không đổi được tài khoản
async function readBody(req) {
  if (req.method !== 'POST') return {};
  if (!String(req.headers['content-type']).startsWith('application/json')) return {};
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw Object.assign(new Error('Request quá lớn'), { status: 413 });
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
    if (req.method === 'GET' && url.pathname === '/detail') return await serveDetail(res, url.searchParams);
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { error: 'Không tìm thấy' });
    send(res, 200, await handler({ body: await readBody(req), query: url.searchParams }));
  } catch (err) {
    log.error(err.message);
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
  log.ok(`Bill Detail Tool (${config.name}) đang chạy: ${target}  — Ctrl+C để dừng`);
  const { user, password } = readCredentials();
  if (!user || !password) log.warn('Chưa điền INSIDE_USER / INSIDE_PASSWORD trong .env — tool sẽ không đăng nhập được inside');
  if (!process.argv.includes('--no-open')) openBrowser(target);
});
