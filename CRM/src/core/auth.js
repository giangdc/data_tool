// Đăng nhập CRM bằng tài khoản + mật khẩu (tenant FTEL) qua API, không cần trình duyệt.
// Token cache theo user trong .cache/ (quyền 600), hết hạn thì refresh, refresh lỗi thì login lại.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { config, toEmail, CACHE_DIR } from './env.js';
import { ApiClient, ApiError } from './http.js';

const EXPIRY_MARGIN_MS = 3 * 60 * 1000;
// Token không giải mã được hạn (không phải JWT) -> coi như sống 50 phút
const FALLBACK_TTL_MS = 50 * 60 * 1000;
const AUTH_PATH = '/administration-service/api/auth';

export function decodeJwt(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// Lỗi do người dùng nhập (sai tk/mk...) -> báo ngắn gọn
export class LoginError extends Error {
  status = 400;
}

function expiresAt(tokens) {
  const exp = decodeJwt(tokens.accessToken)?.exp;
  return exp ? exp * 1000 : tokens.savedAt + FALLBACK_TTL_MS;
}

function cacheFile(email) {
  return path.join(CACHE_DIR, `token-${config.name}-${email.replace(/[^a-z0-9._-]/gi, '_')}.json`);
}

function readCache(email) {
  try {
    return JSON.parse(readFileSync(cacheFile(email), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(email, tokens) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const data = { email, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, savedAt: Date.now() };
  writeFileSync(cacheFile(email), JSON.stringify(data), { mode: 0o600 });
  return data;
}

const anon = () => new ApiClient(config.apiUrl, { tenant: config.tenant });

async function loginWithPassword(email) {
  if (!config.password) throw new LoginError('Chưa cấu hình mật khẩu (CRM_PASSWORD trong .env) – nhập trên giao diện hoặc sửa .env');
  try {
    const res = await anon().post(AUTH_PATH, { userName: email, password: config.password, tenant: config.tenant, remember: false });
    if (!res?.accessToken) throw new Error('API đăng nhập không trả về accessToken');
    return res;
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw new LoginError(`Đăng nhập ${email} thất bại: ${err.message}`);
    throw err;
  }
}

async function refresh(tokens) {
  return anon().post(`${AUTH_PATH}/refresh`, { refreshToken: tokens.refreshToken ?? '', accessToken: tokens.accessToken ?? '' });
}

/**
 * Phiên đăng nhập của 1 user: token() luôn trả access token còn hạn (tự refresh / login lại).
 * force = bỏ cache, đăng nhập lại bằng mật khẩu.
 */
export async function openSession(username, { force = false } = {}) {
  const email = toEmail(username);
  let tokens = force ? null : readCache(email);
  if (!tokens) tokens = writeCache(email, await loginWithPassword(email));

  const session = {
    email,
    async token() {
      if (expiresAt(tokens) - Date.now() > EXPIRY_MARGIN_MS) return tokens.accessToken;
      try {
        tokens = writeCache(email, await refresh(tokens));
      } catch {
        tokens = writeCache(email, await loginWithPassword(email));
      }
      return tokens.accessToken;
    },
    /** Gọi khi API trả 401: bỏ token cũ, đăng nhập lại bằng mật khẩu. */
    async relogin() {
      tokens = writeCache(email, await loginWithPassword(email));
    },
    claims: () => decodeJwt(tokens.accessToken) || {},
  };
  session.api = new ApiClient(config.apiUrl, { token: () => session.token(), tenant: config.tenant });
  // Kiểm tra token (cache cũ có thể đã bị thu hồi) + lấy tên hiển thị
  try {
    session.profile = await session.api.get('/administration-service/api/accounts/my-profile');
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) throw err;
    await session.relogin();
    session.profile = await session.api.get('/administration-service/api/accounts/my-profile');
  }
  return session;
}

/** Chạy fn(api), gặp 401 thì đăng nhập lại 1 lần rồi chạy lại. */
export async function withRelogin(session, fn) {
  try {
    return await fn(session.api);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) throw err;
    await session.relogin();
    return fn(session.api);
  }
}

export const hasCachedLogin = (username) => existsSync(cacheFile(toEmail(username)));
