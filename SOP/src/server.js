#!/usr/bin/env node
// Giao diện web chạy trên máy: npm run ui -> http://localhost:3007
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { config, credentials, saveEnvValue, ROOT_DIR } from './core/env.js';
import { log } from './core/logger.js';
import { saveRun, recentRuns } from './core/store.js';
import { getContext, closeBrowser, isBrowserOpen, openPortal } from './core/browser.js';
import { createInternetOrder, COMBOS } from './sop/order.js';

const PORT = config.uiPort;
const HOST = '127.0.0.1';
const PAGE = path.join(ROOT_DIR, 'public', 'index.html');

// Chỉ 1 lượt chạy tại một thời điểm (cùng 1 cửa sổ trình duyệt)
let job = null;
let jobSeq = 0;

function startJob(input, work) {
  if (job?.running) throw Object.assign(new Error('Đang có lượt chạy khác, chờ xong rồi chạy tiếp'), { status: 409 });
  const current = { id: ++jobSeq, input, running: true, logs: [], result: null, error: null, authError: false, startedAt: Date.now() };
  job = current;
  const onLog = (msg) => {
    current.logs.push({ at: Date.now(), msg });
    log.step(msg);
  };
  work(onLog)
    .then((result) => { current.result = result; })
    .catch((err) => {
      log.error(err.message);
      current.error = err.message;
      current.authError = err.status === 401;
      if (err.record) current.result = err.record;
    })
    .finally(() => {
      current.running = false;
      current.finishedAt = Date.now();
    });
  return { id: current.id };
}

const routes = {
  'GET /api/config': async () => {
    const { user, password } = credentials();
    return {
      env: config.name,
      portalUrl: config.sopUrl,
      // Chỉ báo có/không + tên tài khoản, không trả mật khẩu
      account: user,
      credentialsConfigured: Boolean(user && password),
      browserOpen: isBrowserOpen(),
      defaults: config.defaults,
      combos: Object.keys(COMBOS),
    };
  },

  // Lưu tài khoản vào .env của máy này. Mật khẩu để trống = giữ mật khẩu đang lưu
  'POST /api/settings': async ({ body }) => {
    const user = String(body.user ?? '').trim();
    const password = String(body.password ?? '');
    if (!/^\S{2,100}$/.test(user)) throw Object.assign(new Error('Tài khoản không hợp lệ'), { status: 400 });
    if (password.length > 100 || /[\r\n]/.test(password)) throw Object.assign(new Error('Mật khẩu không hợp lệ'), { status: 400 });
    if (!password && !credentials().password) throw Object.assign(new Error('Nhập mật khẩu'), { status: 400 });
    saveEnvValue('SOP_USER', user);
    if (password) saveEnvValue('SOP_PASSWORD', password);
    // Tài khoản đổi -> bỏ phiên cũ trong cửa sổ trình duyệt bằng cách đăng xuất ở lượt chạy sau
    return { account: user, credentialsConfigured: true };
  },

  // Đăng nhập thử (mở portal, tự đăng nhập nếu cần)
  'POST /api/login': async () => {
    if (job?.running) throw Object.assign(new Error('Đang chạy, thử lại sau'), { status: 409 });
    const ctx = await getContext();
    const page = ctx.pages()[0] || (await ctx.newPage());
    await openPortal(page, `${config.sopUrl}/quan-ly-khach-hang/khach-hang/danh-sach`);
    return { ok: true, account: credentials().user };
  },

  // Đăng nhập lại: xoá cookie phiên của portal rồi đăng nhập bằng tài khoản đang lưu
  'POST /api/relogin': async () => {
    if (job?.running) throw Object.assign(new Error('Đang chạy, thử lại sau'), { status: 409 });
    const ctx = await getContext();
    await ctx.clearCookies();
    await ctx.pages()[0]?.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} }).catch(() => {});
    const page = ctx.pages()[0] || (await ctx.newPage());
    await openPortal(page, `${config.sopUrl}/quan-ly-khach-hang/khach-hang/danh-sach`);
    return { ok: true, account: credentials().user };
  },

  'POST /api/run': async ({ body }) => startJob(body, async (onLog) => {
    try {
      const record = await createInternetOrder(body, onLog);
      saveRun(record);
      return record;
    } catch (err) {
      if (err.record) saveRun(err.record);
      throw err;
    }
  }),

  'GET /api/job': async () => job && { ...job, elapsedMs: (job.finishedAt || Date.now()) - job.startedAt },

  'GET /api/runs': async () => recentRuns(30),

  'POST /api/browser/close': async () => {
    if (job?.running) throw Object.assign(new Error('Đang chạy, không đóng trình duyệt được'), { status: 409 });
    await closeBrowser();
    return { browserOpen: false };
  },
};

// Chỉ nhận JSON: trang web lạ không gửi được application/json sang localhost (bị CORS chặn)
async function readBody(req) {
  if (req.method !== 'POST') return {};
  if (!String(req.headers['content-type']).startsWith('application/json')) {
    throw Object.assign(new Error('Chỉ nhận dữ liệu JSON'), { status: 415 });
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw Object.assign(new Error('Request quá lớn'), { status: 413 });
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
  log.ok(`SOP Order Tool (${config.name}) đang chạy: ${target}  — Ctrl+C để dừng`);
  if (!credentials().user) log.warn('Chưa có tài khoản Portal SOP — nhập trên giao diện lần đầu');
  if (!process.argv.includes('--no-open')) openBrowser(target);
});

// Tắt server thì đóng luôn cửa sổ trình duyệt của tool
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => closeBrowser().finally(() => process.exit(0)));
}
