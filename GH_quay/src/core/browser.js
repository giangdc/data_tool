// Trình duyệt dùng chung cho cả luồng, chạy kiểu ẩn danh: không lưu profile/cookie xuống đĩa,
// mỗi lần mở lại trình duyệt là phiên mới -> phải đăng nhập lại Fox ERP / SCM / GHTK.
// Luôn hiện cửa sổ (headed) để người dùng đăng nhập ngay trong cửa sổ đó.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { config, OUTPUT_DIR } from './env.js';

let contextPromise = null;
let external = null;
let owned = null;

// Ưu tiên trình duyệt có sẵn trên máy (không phải tải Chromium); BROWSER=chrome|msedge|chromium để ép
async function launch() {
  // CDP_URL: gắn vào Chrome đang mở sẵn (chạy với --remote-debugging-port), dùng luôn phiên đăng nhập của nó
  if (config.cdpUrl) {
    external = await chromium.connectOverCDP(config.cdpUrl);
    return external.contexts()[0] || external.newContext();
  }
  const order = config.browser === 'auto' ? ['chrome', 'msedge', 'chromium'] : [config.browser];
  const errors = [];
  for (const channel of order) {
    try {
      owned = await chromium.launch({
        headless: false,
        args: ['--start-maximized'],
        ...(channel !== 'chromium' && { channel }),
      });
      // Context mới = phiên ẩn danh, đóng là mất hết cookie/đăng nhập
      return await owned.newContext({ viewport: null });
    } catch (err) {
      errors.push(`${channel}: ${err.message.split('\n')[0]}`);
    }
  }
  throw new Error(`Không mở được trình duyệt. Cài Google Chrome hoặc Microsoft Edge.\n   ${errors.join('\n   ')}`);
}

// Người dùng bấm "Dừng": mọi chờ/sleep và lần mở trình duyệt sau đó ném lỗi -> luồng thoát ngay
const STOP_MESSAGE = 'Đã dừng theo yêu cầu';
let stopRequested = false;
export function requestStop() { stopRequested = true; }
export function clearStop() { stopRequested = false; }
export const isStopRequested = () => stopRequested;
function checkStop() {
  if (stopRequested) throw new Error(STOP_MESSAGE);
}

/** Context trình duyệt dùng chung (mở nếu chưa có / người dùng đã đóng cửa sổ). */
export function getContext() {
  if (stopRequested) return Promise.reject(new Error(STOP_MESSAGE));
  if (!contextPromise) {
    contextPromise = launch().then((ctx) => {
      const reset = () => { contextPromise = null; };
      ctx.on('close', reset);
      owned?.on('disconnected', reset);
      // Người dùng đóng hết tab -> bỏ phiên, lần sau mở lại là phiên mới (phải đăng nhập lại)
      if (owned) ctx.on('page', (p) => p.on('close', () => { if (!ctx.pages().length) closeBrowser(); }));
      return ctx;
    });
    contextPromise.catch(() => { contextPromise = null; });
  }
  return contextPromise;
}

export const isBrowserOpen = () => Boolean(contextPromise);

export async function closeBrowser() {
  if (!contextPromise) return;
  const ctx = await contextPromise.catch(() => null);
  contextPromise = null;
  // Trình duyệt gắn qua CDP không phải của tool -> chỉ ngắt kết nối, không đóng
  if (external) {
    await external.close().catch(() => {});
    external = null;
  } else {
    await ctx?.close().catch(() => {});
    await owned?.close().catch(() => {});
  }
  owned = null;
}

/** Tìm tab đang mở khớp điều kiện, không có thì mở tab mới tới url. */
export async function pageFor(match, url) {
  const ctx = await getContext();
  let page = ctx.pages().find((p) => match(p.url()));
  if (!page) {
    page = ctx.pages().find((p) => p.url() === 'about:blank') || (await ctx.newPage());
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
  await page.bringToFront();
  return page;
}

export async function sleep(ms) {
  checkStop();
  await new Promise((r) => setTimeout(r, ms));
  checkStop();
}

/** Chờ tới khi fn() trả về giá trị truthy (poll), hết giờ thì ném lỗi với thông báo message. */
export async function waitUntil(fn, { timeout = 30000, interval = 500, message = 'Hết thời gian chờ' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    checkStop();
    const value = await fn().catch(() => undefined);
    checkStop();
    if (value) return value;
    if (Date.now() > end) throw new Error(message);
    await sleep(interval);
  }
}

/** Chụp màn hình lỗi để tra cứu sau. */
export async function debugShot(page, name) {
  if (!page || page.isClosed()) return null;
  mkdirSync(path.join(OUTPUT_DIR, 'debug'), { recursive: true });
  const file = path.join(OUTPUT_DIR, 'debug', `${name}-${Date.now()}.png`);
  await page.screenshot({ path: file, timeout: 5000 }).catch(() => {});
  return file;
}

/**
 * Đảm bảo trang đã đăng nhập.
 * - isLoginPage(url): đang ở màn đăng nhập?
 * - autoLogin(page): điền tài khoản trong .env (nếu có cấu hình), trả false nếu không có tài khoản
 * Không tự đăng nhập được thì chờ người dùng đăng nhập tay trong cửa sổ trình duyệt.
 */
export async function ensureLoggedIn(page, { system, isLoginPage, autoLogin, onLog }) {
  // Một số hệ thống chuyển hướng sang trang đăng nhập sau khi tải xong (SPA)
  await sleep(1500);
  if (!isLoginPage(page.url())) return;

  if (await autoLogin(page)) {
    onLog(`Đăng nhập ${system} bằng tài khoản trong .env`);
    const ok = await waitUntil(async () => !isLoginPage(page.url()), { timeout: 30000 }).catch(() => false);
    if (ok) return;
    onLog(`⚠ Tự đăng nhập ${system} chưa thành công (sai mật khẩu / cần OTP?) – hãy đăng nhập tay trong cửa sổ trình duyệt`);
  } else {
    onLog(`⏳ Chưa đăng nhập ${system}: hãy đăng nhập trong cửa sổ trình duyệt (tool tự chạy tiếp khi xong)`);
  }
  await page.bringToFront();
  await waitUntil(async () => !isLoginPage(page.url()), {
    timeout: config.loginWaitMs,
    interval: 1000,
    message: `Quá ${config.loginWaitMs / 60000} phút chưa đăng nhập ${system}`,
  });
  onLog(`Đã đăng nhập ${system}`);
  await sleep(2000);
}
