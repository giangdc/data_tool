// Trình duyệt dùng chung cho cả luồng: 1 profile cố định trong .cache/ để giữ phiên đăng nhập Fox ERP / SCM / GHTK.
// Luôn hiện cửa sổ (headed): lần đầu (hoặc khi phiên hết hạn) người dùng có thể tự đăng nhập ngay trong cửa sổ đó.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { config, CACHE_DIR, OUTPUT_DIR } from './env.js';

const PROFILE_DIR = path.join(CACHE_DIR, 'browser-profile');

let contextPromise = null;
let external = null;

// Ưu tiên trình duyệt có sẵn trên máy (không phải tải Chromium); BROWSER=chrome|msedge|chromium để ép
async function launch() {
  // CDP_URL: gắn vào Chrome đang mở sẵn (chạy với --remote-debugging-port), dùng luôn phiên đăng nhập của nó
  if (config.cdpUrl) {
    external = await chromium.connectOverCDP(config.cdpUrl);
    return external.contexts()[0] || external.newContext();
  }
  mkdirSync(PROFILE_DIR, { recursive: true });
  const order = config.browser === 'auto' ? ['chrome', 'msedge', 'chromium'] : [config.browser];
  const errors = [];
  for (const channel of order) {
    try {
      return await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: false,
        viewport: null,
        args: ['--start-maximized'],
        ...(channel !== 'chromium' && { channel }),
      });
    } catch (err) {
      errors.push(`${channel}: ${err.message.split('\n')[0]}`);
    }
  }
  throw new Error(`Không mở được trình duyệt. Cài Google Chrome hoặc Microsoft Edge.\n   ${errors.join('\n   ')}`);
}

/** Context trình duyệt dùng chung (mở nếu chưa có / người dùng đã đóng cửa sổ). */
export function getContext() {
  if (!contextPromise) {
    contextPromise = launch().then((ctx) => {
      ctx.on('close', () => { contextPromise = null; });
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
  } else await ctx?.close().catch(() => {});
}

/**
 * Xoá phiên đăng nhập của các trang (đăng xuất phía trình duyệt): đóng tab của các trang đó, xoá cookie (cả cookie gắn ở
 * domain cha, vd .fpt.net) và localStorage/IndexedDB/cache của từng origin.
 */
export async function clearSiteData(urls) {
  const ctx = await getContext();
  const origins = [...new Set(urls.map((u) => new URL(u).origin))];
  const hosts = origins.map((o) => new URL(o).hostname);

  // Còn giữ 1 tab trống để cửa sổ trình duyệt không bị đóng theo
  if (!ctx.pages().some((p) => p.url() === 'about:blank')) await ctx.newPage();
  for (const p of ctx.pages()) {
    if (hosts.some((h) => p.url().startsWith('http') && new URL(p.url()).hostname === h)) await p.close().catch(() => {});
  }

  const domains = new Set(hosts.flatMap((h) => {
    const parts = h.split('.');
    return parts.slice(0, -1).map((_, i) => parts.slice(i).join('.'));
  }));
  const escape = (d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await ctx.clearCookies({ domain: new RegExp(`^\\.?(${[...domains].map(escape).join('|')})$`) });

  const page = ctx.pages().find((p) => p.url() === 'about:blank') || (await ctx.newPage());
  const cdp = await ctx.newCDPSession(page);
  for (const origin of origins) await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }).catch(() => {});
  await cdp.detach().catch(() => {});
}

/** Tìm tab đang mở khớp điều kiện, không có thì mở tab mới tới url. */
// Tab trống đang được pageFor() khác dùng (đăng nhập song song nhiều hệ thống) -> không lấy trùng
const claimed = new WeakSet();

export async function pageFor(match, url) {
  const ctx = await getContext();
  let page = ctx.pages().find((p) => match(p.url()));
  if (!page) {
    page = ctx.pages().find((p) => p.url() === 'about:blank' && !claimed.has(p)) || (await ctx.newPage());
    claimed.add(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' }).finally(() => claimed.delete(page));
  }
  await page.bringToFront();
  return page;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chờ tới khi fn() trả về giá trị truthy (poll), hết giờ thì ném lỗi với thông báo message. */
export async function waitUntil(fn, { timeout = 30000, interval = 500, message = 'Hết thời gian chờ' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn().catch(() => undefined);
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
 * - autoLogin(page): điền tài khoản đã lưu (nhập trên giao diện / .env), trả false nếu chưa có tài khoản
 * Không tự đăng nhập được thì chờ người dùng đăng nhập tay trong cửa sổ trình duyệt.
 */
export async function ensureLoggedIn(page, { system, isLoginPage, autoLogin, onLog }) {
  // Một số hệ thống chuyển hướng sang trang đăng nhập sau khi tải xong (SPA)
  await sleep(1500);
  if (!isLoginPage(page.url())) return;

  if (await autoLogin(page)) {
    onLog(`Đăng nhập ${system} bằng tài khoản đã lưu`);
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
