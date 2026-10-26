// Đăng nhập inside bằng tài khoản + mật khẩu (form cũ của login-stag.fpt.net, không qua IAM), thuần HTTP:
//   1) POST {loginUrl}/Login  {UserName, Password, OTP, IAM:false, urlReturn} -> {status:1, token}
//   2) GET  {mvcUrl}{entryPath}?Token=<token>  -> mvc.inside trả cookie phiên
// Tài khoản đọc từ .env (đọc lại mỗi lần đăng nhập, sửa .env không cần khởi động lại).
// Cookie lưu trong .cache/ (quyền 600), không in ra màn hình.
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { config, CACHE_DIR, ROOT_DIR } from './env.js';
import { log } from './logger.js';

const SESSION_FILE = path.join(CACHE_DIR, `inside-session-${config.name}.json`);
const TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 10;

// Chưa đăng nhập / sai tài khoản / phiên hết hạn -> giao diện hiện thông báo + nút "Đăng nhập"
export class AuthError extends Error {
  status = 401;
}

// Thông báo lỗi giống trang login-stag
const LOGIN_ERRORS = {
  'Invalid user credentials': 'Tài khoản hoặc mật khẩu không chính xác',
  'Account is not fully set up': 'Tài khoản cần đổi mật khẩu mới trước khi đăng nhập',
  'Account disabled': 'Tài khoản đã bị khóa, liên hệ admin',
};

/** Tài khoản trong .env (đọc lại file mỗi lần gọi). */
export function readCredentials() {
  const file = path.join(ROOT_DIR, '.env');
  const env = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  const pick = (k) => (env[k] ?? process.env[k] ?? '').trim();
  return { user: pick('INSIDE_USER'), password: env.INSIDE_PASSWORD ?? process.env.INSIDE_PASSWORD ?? '', otp: pick('INSIDE_OTP') };
}

function readSession() {
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** Header Cookie cho mvc.inside (null nếu chưa đăng nhập). */
export function cookieHeader() {
  const s = readSession();
  if (!s?.cookies?.length) return null;
  return s.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export const hasSession = () => Boolean(readSession()?.cookies?.length);
export const sessionInfo = () => {
  const s = readSession();
  return s ? { savedAt: s.savedAt, user: s.user } : null;
};

export function logout() {
  rmSync(SESSION_FILE, { force: true });
}

async function fetchWithTimeout(url, opts) {
  try {
    return await fetch(url, { redirect: 'manual', ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `quá ${TIMEOUT_MS / 1000}s không phản hồi` : err.cause?.message || err.message;
    throw new Error(`Không kết nối được ${new URL(url).host}: ${reason}`);
  }
}

// Gom Set-Cookie (chỉ name=value) vào jar
function collectCookies(jar, res) {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

const jarHeader = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function loginWithPassword() {
  const { user, password, otp } = readCredentials();
  if (!user || !password) {
    throw new AuthError('Chưa điền INSIDE_USER / INSIDE_PASSWORD trong file .env của tool');
  }

  // B1: lấy token từ login-stag
  const urlReturn = config.mvcUrl + config.entryPath.split('?')[0];
  const res = await fetchWithTimeout(`${config.loginUrl}/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
    body: new URLSearchParams({ UserName: user, Password: password, OTP: otp, Token: '', IAM: 'false', urlReturn }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Đăng nhập thất bại: login-stag trả HTTP ${res.status}, không phải JSON`);
  }
  if (data.status !== 1 || !data.token) {
    const reason = LOGIN_ERRORS[data.errDescription] || data.errDescription || 'Thông tin tài khoản không chính xác';
    throw new AuthError(`Đăng nhập ${user} thất bại: ${reason}`);
  }

  // B2: mang token sang mvc.inside để nhận cookie phiên, đi theo redirect trong host mvc.inside
  const appHost = new URL(config.mvcUrl).host;
  const jar = new Map();
  let url = new URL(config.mvcUrl + config.entryPath);
  url.searchParams.set('Token', data.token);
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const r = await fetchWithTimeout(url, { headers: jar.size ? { Cookie: jarHeader(jar) } : {} });
    collectCookies(jar, r);
    await r.arrayBuffer();
    if (r.status < 300 || r.status >= 400) {
      if (!r.ok) throw new Error(`Đăng nhập thất bại: mvc.inside trả HTTP ${r.status}`);
      break;
    }
    url = new URL(r.headers.get('location'), url);
    if (url.host !== appHost) throw new AuthError('Đăng nhập thất bại: mvc.inside không nhận token, bị chuyển về trang đăng nhập');
  }
  if (!jar.size) throw new Error('Đăng nhập xong nhưng mvc.inside không trả cookie phiên');

  mkdirSync(CACHE_DIR, { recursive: true });
  const cookies = [...jar].map(([name, value]) => ({ name, value }));
  writeFileSync(SESSION_FILE, JSON.stringify({ savedAt: new Date().toISOString(), user, cookies }), { mode: 0o600 });
  return user;
}

// Nhiều request cùng gặp phiên hết hạn -> chỉ đăng nhập 1 lần
let pending = null;

/** Đăng nhập bằng tài khoản trong .env, lưu cookie phiên mvc.inside. */
export function login() {
  pending ??= loginWithPassword()
    .then((user) => log.ok(`Đăng nhập inside thành công: ${user}`))
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Phiên mvc.inside hết hạn -> đăng nhập lại bằng tài khoản trong .env. */
export const refreshSilently = login;
