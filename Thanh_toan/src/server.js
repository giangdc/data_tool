#!/usr/bin/env node
// Giao diện web chạy trên máy: npm run ui -> http://localhost:3006
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { config, ROOT_DIR } from './core/env.js';
import { log } from './core/logger.js';
import { saveRun, recentRuns } from './core/store.js';
import { getContext, closeBrowser, isBrowserOpen } from './core/browser.js';
import { runFlow, parseContracts, METHODS } from './flow.js';

const PORT = Number(process.env.UI_PORT) || 3006;
const HOST = '127.0.0.1';
const PAGE = path.join(ROOT_DIR, 'public', 'index.html');
const MAX_BODY = 64 * 1024;

// Chỉ 1 việc chạy tại một thời điểm (cùng 1 cửa sổ trình duyệt)
let job = null;
let jobSeq = 0;

function startJob(kind, input, work) {
  if (job?.running) throw Object.assign(new Error('Đang có lượt chạy khác, chờ xong rồi chạy tiếp'), { status: 409 });
  const current = { id: ++jobSeq, kind, input, running: true, logs: [], result: null, error: null, startedAt: Date.now() };
  job = current;
  const onLog = (msg) => {
    current.logs.push({ at: Date.now(), msg });
    log.step(msg);
  };
  const onState = (state) => { current.result = state; };
  work(onLog, onState)
    .then((result) => { current.result = result; })
    .catch((err) => {
      log.error(err.message);
      current.error = err.message;
      if (err.record) current.result = err.record;
    })
    .finally(() => {
      current.running = false;
      current.finishedAt = Date.now();
    });
  return { id: current.id };
}

const routes = {
  'GET /api/config': async () => ({
    env: config.name,
    payUrl: config.payUrl,
    browserOpen: isBrowserOpen(),
    methods: METHODS,
    // Không trả CVV/OTP về giao diện: để trống = dùng giá trị trong .env
    defaults: {
      method: 'intl',
      phone: config.phone,
      cards: Object.fromEntries(Object.entries(config.cards).map(([k, c]) => [k, { number: c.number, name: c.name, date: c.date }])),
    },
  }),

  'POST /api/run': async ({ body }) => {
    const contracts = parseContracts(body.contracts);
    if (!contracts.length) throw Object.assign(new Error('Chưa nhập số hợp đồng'), { status: 400 });
    if (body.method && !METHODS[body.method]) throw Object.assign(new Error('Phương thức không hỗ trợ'), { status: 400 });
    const card = { number: body.cardNumber, name: body.cardName, date: body.cardDate, cvv: body.cardCvv, otp: body.cardOtp };
    // input lưu trong job (hiện trên giao diện) KHÔNG chứa thông tin thẻ
    const input = { contracts, method: body.method, phone: body.phone };
    return startJob('flow', input, (onLog, onState) => runFlow({ ...input, card }, onLog, onState, (r) => saveRun(r)));
  },

  'GET /api/job': async () => job && { ...job, elapsedMs: (job.finishedAt || Date.now()) - job.startedAt },

  'GET /api/runs': async () => recentRuns(30),

  // Mở cửa sổ trình duyệt của tool tới trang thanh toán
  'POST /api/browser/open': async () => {
    const ctx = await getContext();
    const page = await ctx.newPage();
    await page.goto(config.payUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.bringToFront();
    return { browserOpen: true };
  },

  'POST /api/browser/close': async () => {
    if (job?.running) throw Object.assign(new Error('Đang chạy, không đóng trình duyệt được'), { status: 409 });
    await closeBrowser();
    return { browserOpen: false };
  },
};

async function readBody(req) {
  if (req.method !== 'POST') return {};
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw Object.assign(new Error('Dữ liệu gửi lên quá lớn'), { status: 413 });
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error('Dữ liệu gửi lên không hợp lệ'), { status: 400 });
  }
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
    send(res, 200, await handler({ query: url.searchParams, body: await readBody(req) }));
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
  log.ok(`Thanh toán Tool (${config.name}) đang chạy: ${target}  — Ctrl+C để dừng`);
  if (!process.argv.includes('--no-open')) openBrowser(target);
});

// Tắt server thì đóng luôn cửa sổ trình duyệt của tool
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => closeBrowser().finally(() => process.exit(0)));
}
