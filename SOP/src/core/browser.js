// Trình duyệt dùng chung: 1 profile cố định trong .cache/ để giữ phiên đăng nhập Portal SOP.
// Viewport CỐ ĐỊNH 1440x813: màn tạo đơn là app Flutter vẽ trên canvas, tool bấm theo toạ độ đã khảo sát.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { config, credentials, CACHE_DIR } from './env.js';

const PROFILE_DIR = path.join(CACHE_DIR, 'browser-profile');
export const VIEWPORT = { width: 1440, height: 813 };

// Thiếu tài khoản / sai mật khẩu -> giao diện hiện form tài khoản
export class AuthError extends Error {
  status = 401;
}

let contextPromise = null;
let contextHeadless = null;

async function launch(headless) {
  mkdirSync(PROFILE_DIR, { recursive: true });
  const order = config.browser === 'auto' ? ['chrome', 'msedge', 'chromium'] : [config.browser];
  const errors = [];
  for (const channel of order) {
    try {
      return await chromium.launchPersistentContext(PROFILE_DIR, {
        headless,
        viewport: VIEWPORT,
        ...(channel !== 'chromium' && { channel }),
      });
    } catch (err) {
      errors.push(`${channel}: ${err.message.split('\n')[0]}`);
    }
  }
  throw new Error(`Không mở được trình duyệt (profile đang bị Chrome khác dùng?). Cài Google Chrome hoặc Microsoft Edge.\n   ${errors.join('\n   ')}`);
}

/**
 * Context trình duyệt dùng chung (mở nếu chưa có / người dùng đã đóng cửa sổ).
 * headless: true = chạy ngầm, false = hiện cửa sổ Chrome; bỏ trống = giữ chế độ đang mở (chưa mở thì theo .env).
 * Đổi chế độ thì đóng trình duyệt cũ rồi mở lại (cùng profile nên vẫn giữ phiên đăng nhập).
 */
export async function getContext({ headless } = {}) {
  const want = typeof headless === 'boolean' ? headless : (contextPromise ? contextHeadless : config.headless);
  if (contextPromise && contextHeadless !== want) await closeBrowser();
  if (!contextPromise) {
    contextHeadless = want;
    const current = launch(want).then((ctx) => {
      ctx.on('close', () => { if (contextPromise === current) contextPromise = null; });
      return ctx;
    });
    contextPromise = current;
    current.catch(() => { if (contextPromise === current) contextPromise = null; });
  }
  return contextPromise;
}

export const isBrowserOpen = () => Boolean(contextPromise);
/** Chế độ của trình duyệt đang mở: true = chạy ngầm, false = có cửa sổ, null = chưa mở. */
export const browserHeadless = () => (contextPromise ? contextHeadless : null);

export async function closeBrowser() {
  if (!contextPromise) return;
  const ctx = await contextPromise.catch(() => null);
  contextPromise = null;
  await ctx?.close().catch(() => {});
}

/**
 * Mở url trong portal, đăng nhập bằng tài khoản trong .env nếu bị đá về trang login.
 * Luôn dùng trang basic-auth (tài khoản + mật khẩu), không dùng trang đăng nhập mặc định.
 */
/** Sau khi mở trang: chờ tới khi bị đá về login HOẶC trang đã có bảng dữ liệu (tối đa 2,5s, thay cho chờ cố định). */
async function settle(page) {
  await Promise.race([
    page.waitForURL((u) => u.pathname.startsWith('/user/login'), { timeout: 2500 }),
    page.locator('.ant-table-tbody tr').first().waitFor({ timeout: 2500 }),
  ]).catch(() => {});
}

export async function openPortal(page, url, onLog = () => {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(page);
  if (!page.url().includes('/user/login')) return;

  const { user, password } = credentials();
  if (!user || !password) throw new AuthError('Chưa có tài khoản Portal SOP – nhập Tài khoản / Mật khẩu trên giao diện');
  onLog(`Đăng nhập Portal SOP bằng tài khoản ${user}`);
  await page.goto(config.sopUrl + config.sopLoginPath, { waitUntil: 'domcontentloaded' });
  await page.fill('#basic_username', user);
  await page.fill('#basic_password', password);
  // Nút đăng nhập: trước là button[type=submit], từ 11/2026 portal để type="Login" -> tìm theo chữ, không thấy thì Enter
  const submit = page.locator('#basic button[type=submit], #basic button').filter({ hasText: /login|đăng nhập/i }).first();
  if (await submit.count()) await submit.click();
  else await page.press('#basic_password', 'Enter');
  try {
    await page.waitForURL((u) => !u.pathname.startsWith('/user/login'), { timeout: 30000 });
  } catch {
    const msg = await page.locator('.ant-message, .ant-form-item-explain-error, .ant-alert').allInnerTexts().catch(() => []);
    throw new AuthError(`Đăng nhập ${user} thất bại${msg.length ? ': ' + msg.join(' | ') : ' (kiểm tra tài khoản / mật khẩu)'}`);
  }
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await settle(page);
}
