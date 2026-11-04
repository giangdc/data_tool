#!/usr/bin/env node
// Giao diện web chạy trên máy: npm run ui -> http://localhost:3006
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { config, ROOT_DIR, saveDefaults, sharedCardsFrom } from './core/env.js';
import { log } from './core/logger.js';
import { BillPayService, normContract } from './pay/billpay.js';
import { cardStatus, CARD_METHODS } from './pay/payment.js';

const PORT = Number(process.env.UI_PORT) || 3006;
// Chỉ nghe trên máy này (tool không có đăng nhập)
const HOST = '127.0.0.1';
const PAGE = path.join(ROOT_DIR, 'public', 'index.html');

const svc = new BillPayService();

const routes = {
  'GET /api/config': async () => ({
    env: config.name, payUrl: config.payUrl, defaults: config.defaults, cards: cardStatus(), sharedCardsFrom,
  }),

  // Đặt mặc định số HĐ / PTTT (lưu output/settings.json)
  'POST /api/settings/defaults': async ({ body }) => {
    if (body.paymentMethod && !CARD_METHODS.includes(String(body.paymentMethod).toUpperCase())) {
      throw Object.assign(new Error('PTTT mặc định chỉ là INTERNATIONAL hoặc DOMESTIC'), { status: 400 });
    }
    return saveDefaults({ ...body, contractNo: body.contractNo && normContract(body.contractNo) });
  },

  // Số HĐ -> thông tin HĐ + danh sách khoản thu
  'POST /api/lookup': async ({ body }) => svc.lookup(body.contractNo),

  // Khoản thu đã chọn -> PTTT
  'POST /api/methods': async ({ body }) => svc.methods(body.contractNo, body.billIds),

  // Tạo giao dịch + tự thanh toán thẻ test (mở Chrome trên máy, ~30-90s)
  'POST /api/pay': async ({ body }) => {
    const r = await svc.pay({ ...body, onStep: (t) => log.info(`${normContract(body.contractNo)} · ${t}`) });
    const s = r.summary;
    (s.result === 'success' ? log.ok : log.error)(`${s.contractNo} | ${s.paymentCode} | ${s.paymentName} ${s.amountText} (thẻ ${s.card}): ${s.statusLabel} – ${s.message}`);
    return r;
  },

  'POST /api/status': async ({ body }) => svc.statuses(body.codes || []),
  'GET /api/history': async () => svc.history(),
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
  log.ok(`FPT.vn Bill Pay Tool (${config.name}) đang chạy: ${target}  — Ctrl+C để dừng`);
  const p = config.proxy;
  log.info(p ? `Gọi API Hi FPT qua proxy ${new URL(p.url).host} – ${p.source}` : 'Gọi API Hi FPT trực tiếp (không proxy)');
  if (sharedCardsFrom) log.info(`Thẻ test lấy từ ${sharedCardsFrom}`);
  if (!process.argv.includes('--no-open')) openBrowser(target);
});
