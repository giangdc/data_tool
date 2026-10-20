// Đăng nhập SSO (CAS) bằng tài khoản + OTP qua Playwright, lấy access token của BMS / SM.
// Token được cache theo user (và theo hệ thống) trong .cache/ và dùng lại tới khi gần hết hạn.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { config, toEmail, CACHE_DIR, OUTPUT_DIR } from './env.js';
import { log } from './logger.js';

const EXPIRY_MARGIN_MS = 3 * 60 * 1000;

export function decodeJwt(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// Hệ thống đăng nhập qua cùng SSO: mở startUrl -> CAS -> quay về app -> app ghi token vào cookie
const APPS = {
  bms: {
    label: 'BMS',
    cacheTag: '', // tên file cache cũ của BMS giữ nguyên
    startUrl: () => `${config.ssoLoginUrl}?service=${encodeURIComponent(config.bmsWebUrl)}`,
    cookie: () => config.bmsTokenCookie,
    cookieUrl: () => config.bmsWebUrl,
  },
  // SM (Service Management – tool LeasedLine): trang /auth tự chuyển sang SSO rồi về /sm/v2
  sm: {
    label: 'SM',
    cacheTag: 'sm-',
    startUrl: () => `${config.smWebUrl}auth`,
    cookie: () => config.smTokenCookie,
    cookieUrl: () => config.smWebUrl,
  },
};

function cacheFile(email, app = APPS.bms) {
  return path.join(CACHE_DIR, `token-${app.cacheTag}${config.name}-${email.replace(/[^a-z0-9._-]/gi, '_')}.json`);
}

function storageStateFile(email) {
  return path.join(CACHE_DIR, `sso-${config.name}-${email.replace(/[^a-z0-9._-]/gi, '_')}.json`);
}

function readCachedToken(email, app) {
  const file = cacheFile(email, app);
  if (!existsSync(file)) return null;
  try {
    const { token } = JSON.parse(readFileSync(file, 'utf8'));
    const exp = decodeJwt(token)?.exp;
    if (exp && exp * 1000 - Date.now() > EXPIRY_MARGIN_MS) return token;
  } catch {
    // cache hỏng -> login lại
  }
  return null;
}

// Ưu tiên trình duyệt có sẵn trên máy (không phải tải Chromium); BROWSER=chrome|msedge|chromium để ép
async function launchBrowser() {
  const order = config.browser === 'auto' ? ['chrome', 'msedge', 'chromium'] : [config.browser];
  const errors = [];
  for (const channel of order) {
    try {
      return await chromium.launch({ headless: config.headless, ...(channel !== 'chromium' && { channel }) });
    } catch (err) {
      errors.push(`${channel}: ${err.message.split('\n')[0]}`);
    }
  }
  throw new Error(`Không mở được trình duyệt. Cài Google Chrome hoặc Microsoft Edge.\n   ${errors.join('\n   ')}`);
}

// Lỗi do người dùng nhập (tk sai, OTP sai...) -> báo ngắn gọn, không cần ảnh chụp
export class LoginError extends Error {
  status = 400;
}

// Thông báo lỗi của trang SSO (vd "Tài khoản đăng nhập không chính xác. Vui lòng thử lại!")
const SSO_ERROR = 'label.error-mess, .error-mess';

/** Chờ bước tiếp theo xảy ra; nếu trang SSO hiện thông báo lỗi trước thì ném LoginError. */
async function waitOrSsoError(page, nextStep, prefix) {
  const errorMsg = page.locator(SSO_ERROR).locator('visible=true').filter({ hasText: /\S/ }).first();
  const result = await Promise.race([
    nextStep.then((value) => ({ value })),
    errorMsg.waitFor({ timeout: 30000 }).then(async () => ({ error: (await errorMsg.innerText()).trim() })),
  ]);
  if (result.error) throw new LoginError(`${prefix}: ${result.error}`);
  return result.value;
}

async function loginWithBrowser(email, app = APPS.bms) {
  if (!config.otp) throw new Error('Chưa cấu hình FTMS_OTP trong file .env');
  mkdirSync(CACHE_DIR, { recursive: true });

  const browser = await launchBrowser();
  const stateFile = storageStateFile(email);
  const context = await browser.newContext(existsSync(stateFile) ? { storageState: stateFile } : {});
  const page = await context.newPage();

  // storageState cũ có thể còn cookie token đã hết hạn -> xóa, và chỉ nhận token còn hạn
  await context.clearCookies({ name: app.cookie() });
  const findToken = async () => {
    const value = (await context.cookies(app.cookieUrl())).find((ck) => ck.name === app.cookie())?.value;
    const exp = value && decodeJwt(decodeURIComponent(value))?.exp;
    return exp && exp * 1000 > Date.now() ? value : undefined;
  };
  const waitToken = async (timeout) => {
    for (const end = Date.now() + timeout; Date.now() < end; await page.waitForTimeout(500)) {
      const token = await findToken();
      if (token) return token;
    }
    return undefined;
  };

  try {
    await page.goto(app.startUrl());

    // Phiên SSO cũ còn hiệu lực -> CAS tự redirect về app (có token), không cần nhập lại
    const otpOption = page.getByText('Sử dụng mật khẩu một lần (OTP)');
    const landed = await Promise.race([
      waitToken(15000).then((t) => (t ? 'app' : new Promise(() => {}))),
      otpOption.waitFor({ timeout: 15000 }).then(() => 'login'),
    ]);

    if (landed === 'login') {
      log.step(`Đăng nhập SSO bằng OTP cho ${email}`);
      await otpOption.click();
      await page.locator('#username').fill(email);
      await page.getByRole('button', { name: /tiếp theo/i }).click();

      const otpInput = page
        .locator('input[type="password"], input[name*="otp" i], input[id*="otp" i], input[name="password"]')
        .locator('visible=true')
        .first();
      await waitOrSsoError(page, otpInput.waitFor({ timeout: 20000 }), `Đăng nhập ${email} thất bại`);
      await otpInput.fill(config.otp);
      await otpInput.press('Enter');
      await waitOrSsoError(
        page,
        page.waitForURL((url) => !url.pathname.startsWith('/id/'), { timeout: 30000, waitUntil: 'commit' }),
        'OTP bị từ chối (kiểm tra OTP trong .env hoặc bấm "Đổi OTP")',
      );
    }

    // App đổi ticket CAS lấy token rồi ghi vào cookie
    const token = await waitToken(20000);
    if (!token) throw new Error(`Đã về ${app.label} nhưng không thấy cookie token`);

    await context.storageState({ path: stateFile });
    return decodeURIComponent(token);
  } catch (err) {
    if (err instanceof LoginError) throw err;
    mkdirSync(path.join(OUTPUT_DIR, 'debug'), { recursive: true });
    const shot = path.join(OUTPUT_DIR, 'debug', `login-fail-${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true, timeout: 5000 }).catch(() => {});
    const pageMsg = await page
      .locator('.alert, .error, .text-danger, [class*="error" i]')
      .allInnerTexts()
      .catch(() => []);
    throw new Error(
      `Đăng nhập thất bại: ${err.message}` +
        (pageMsg.filter(Boolean).length ? `\n   Thông báo trên trang: ${pageMsg.filter(Boolean).join(' | ')}` : '') +
        `\n   Ảnh chụp: ${shot}`,
    );
  } finally {
    await browser.close();
  }
}

async function getToken(app, username, { force = false } = {}) {
  const email = toEmail(username);
  if (!force) {
    const cached = readCachedToken(email, app);
    if (cached) return cached;
  }
  const token = await loginWithBrowser(email, app);
  writeFileSync(cacheFile(email, app), JSON.stringify({ email, token, savedAt: new Date().toISOString() }), { mode: 0o600 });
  const claims = decodeJwt(token) || {};
  log.ok(`Đăng nhập ${app.label} thành công: ${claims.FullName || claims.Username || email} (${claims.UserName || ''})`);
  return token;
}

/** Trả về access token BMS cho user (dùng cache nếu còn hạn). */
export function getBmsToken(username, opts) {
  return getToken(APPS.bms, username, opts);
}

/** Token SM (tool LeasedLine – khảo sát, cước), dùng chung phiên SSO với BMS. */
export function getSmToken(username, opts) {
  return getToken(APPS.sm, username, opts);
}
