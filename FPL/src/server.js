#!/usr/bin/env node
// Giao diện web chạy trên máy: npm run ui -> http://localhost:3002
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { config, ROOT_DIR, saveDefaults, defaultOtp } from './core/env.js';
import { log } from './core/logger.js';
import { OrderService } from './fpl/orders.js';
import { session, forget, normalizePhone } from './fpl/auth.js';
import { cardStatus } from './fpl/payment.js';

const PORT = Number(process.env.UI_PORT) || 3002;
// Chỉ nghe trên máy này (tool không có đăng nhập, ai vào được trang là mua gói bằng tài khoản test được)
const HOST = '127.0.0.1';
const PAGE = path.join(ROOT_DIR, 'public', 'index.html');

const orders = new OrderService();
const stepLog = (prefix) => (t) => log.info(`${prefix} · ${t}`);

const routes = {
  'GET /api/config': async () => ({ env: config.name, webUrl: config.webUrl, defaults: config.defaults, cards: cardStatus(), otp: !!defaultOtp() }),

  // Đặt mặc định mới cho SĐT / link gói (lưu output/settings.json)
  'POST /api/settings/defaults': async ({ body }) => {
    if (body.phone) body.phone = normalizePhone(body.phone);
    return saveDefaults(body);
  },

  // Đăng nhập (OTP mặc định) / kiểm tra tài khoản; force = đăng nhập lại; logout = bỏ token đã lưu
  'POST /api/session': async ({ body }) => {
    if (body.logout) return forget(body.phone), { ok: true };
    const s = await session(body.phone, { force: body.force, otp: body.otp, onStep: stepLog(body.phone) });
    return { ...s.user, fresh: s.fresh };
  },

  // Link gói + SĐT -> tài khoản, kỳ hạn, PTTT
  'POST /api/prepare': async ({ body }) => orders.prepare({ ...body, onStep: stepLog(body.phone) }),

  'POST /api/coupon': async ({ body }) => orders.checkCoupon(body),

  // Tạo 1 giao dịch
  'POST /api/orders': async ({ body }) => {
    const r = await orders.create(body);
    log.ok(`${r.summary.code} | ${r.summary.planName} · ${r.summary.offerLabel} | ${r.summary.paymentName} | ${r.summary.statusLabel}`);
    return r;
  },

  // Tự thanh toán bằng thẻ test (mở Chrome trên máy, ~20-60s)
  'POST /api/orders/pay': async ({ body }) => {
    const r = await orders.pay(body.code, { onStep: stepLog(body.code) });
    (r.result === 'success' ? log.ok : log.error)(`${r.code} | tự thanh toán ${r.paymentCode} (thẻ ${r.card}): ${r.result} – ${r.message}`);
    return r;
  },

  'POST /api/orders/status': async ({ body }) => orders.statuses(body.codes || []),
  'POST /api/orders/detail': async ({ body }) => orders.detail(String(body.code || '').trim()),
  'GET /api/history': async () => orders.history(),
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
    if (req.method === 'GET' && url.pathname === '/icon.svg') {
      return send(res, 200, await readFile(path.join(ROOT_DIR, 'assets', 'icon.svg'), 'utf8'), 'image/svg+xml');
    }
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { error: 'Không tìm thấy' });
    const body = req.method === 'POST' ? await readBody(req) : {};
    send(res, 200, await handler({ body, query: url.searchParams }));
  } catch (err) {
    log.error(err.message);
    send(res, err.status >= 400 && err.status < 500 ? err.status : 500, { error: err.message, code: err.code });
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
  log.ok(`FPT Play Order Tool (${config.name}) đang chạy: ${target}  — Ctrl+C để dừng`);
  const p = config.proxy;
  log.info(p ? `Gọi API FPT Play qua proxy ${new URL(p.url).host} – ${p.source}` : 'Gọi API FPT Play trực tiếp (không proxy)');
  if (!defaultOtp()) log.warn('Chưa có FPL_OTP trong .env – không đăng nhập được');
  if (!process.argv.includes('--no-open')) openBrowser(target);
});
