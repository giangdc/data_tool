// Đăng nhập FPT Play bằng SĐT + OTP (dev có OTP mặc định FPL_OTP), cache access_token theo SĐT trong .cache/ (không log token).
// Luồng (khảo sát 19/10): account/otp/validate_user {type: login_fpl, mode: interactive} -> verify_token
//   -> account/otp/send {type_otp: login_fpl, method_otp: zns} -> account/otp/verify {otp_code} -> verify_token mới
//   -> account/user/login {verify_token, push_reg_id: ""} -> access_token
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, config, defaultOtp } from '../core/env.js';
import { FplClient, ApiError } from '../core/http.js';

const TOKEN_TTL = 12 * 3600_000; // dùng lại token tối đa 12h, sau đó kiểm tra lại bằng user/info
const fileOf = (phone) => path.join(CACHE_DIR, `token-${config.name}-${phone}.json`);

function readCache(phone) {
  try {
    return JSON.parse(readFileSync(fileOf(phone), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(phone, data) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(fileOf(phone), JSON.stringify(data));
  chmodSync(fileOf(phone), 0o600);
}

/** device id cố định cho 1 SĐT (X-Did) – đổi device liên tục có thể bị hỏi OTP "thiết bị mới" */
function deviceId(phone) {
  return readCache(phone)?.did || randomUUID().replace(/-/g, '').slice(0, 16);
}

export function normalizePhone(phone) {
  const p = String(phone || '').replace(/\D/g, '').replace(/^84/, '0');
  if (!/^0\d{9}$/.test(p)) throw Object.assign(new Error('Số điện thoại cần 10 số, bắt đầu bằng 0'), { status: 400 });
  return p;
}

const pending = new Map(); // phone -> Promise (không đăng nhập song song cùng 1 SĐT)

/**
 * Client đã đăng nhập cho SĐT (dùng token cache nếu còn hạn, hết hạn/401 thì đăng nhập lại bằng OTP).
 * -> { client, user: {userId, phoneMask, benefit?}, fresh }
 */
export function session(phone, { otp, force = false, onStep = () => {} } = {}) {
  phone = normalizePhone(phone);
  if (!pending.has(phone)) pending.set(phone, doSession(phone, { otp, force, onStep }).finally(() => pending.delete(phone)));
  return pending.get(phone);
}

async function doSession(phone, { otp, force, onStep }) {
  const did = deviceId(phone);
  const cached = !force && readCache(phone);
  if (cached?.token) {
    const client = new FplClient(config, { did, token: cached.token });
    if (Date.now() - cached.at < TOKEN_TTL) return { client, user: cached.user, fresh: false };
    try {
      const user = toUser(await client.get('account/user/info'));
      writeCache(phone, { ...cached, user, at: Date.now() });
      return { client, user, fresh: false };
    } catch (err) {
      if (err.status !== 401) throw err;
    }
  }
  return login(phone, { did, otp, onStep });
}

async function login(phone, { did, otp, onStep }) {
  const code = otp || defaultOtp();
  if (!code) throw Object.assign(new Error('Chưa có OTP: điền FPL_OTP (OTP mặc định môi trường dev) trong .env'), { status: 400 });
  const c = new FplClient(config, { did });
  const base = { phone, client_id: config.clientId };

  onStep('Đăng nhập: kiểm tra SĐT');
  const v = (await c.post('account/otp/validate_user', { ...base, type: 'login_fpl', mode: 'interactive' })).data || {};
  if (v.login_type && v.login_type !== 'otp') throw new ApiError(`SĐT này đăng nhập bằng "${v.login_type}" – tool mới hỗ trợ OTP`, { status: 422 });
  if (String(v.is_queue) === '1') throw new ApiError('Hệ thống đang xếp hàng đăng nhập (login queue) – thử lại sau', { status: 503 });

  onStep('Đăng nhập: gửi OTP');
  await c.post('account/otp/send', { ...base, type_otp: 'login_fpl', verify_token: v.verify_token, method_otp: 'zns' });

  onStep('Đăng nhập: xác thực OTP');
  const ver = await c.post('account/otp/verify', { ...base, type_otp: 'login_fpl', otp_code: code, method_otp: 'zns' }).catch((err) => {
    // OTP mặc định dev chỉ áp dụng cho SĐT test đã cấu hình (vd 0964633310), số khác sẽ báo sai OTP
    throw Object.assign(err, { message: `OTP mặc định không dùng được cho SĐT ${phone} (chỉ SĐT test được cấu hình OTP mặc định, hoặc FPL_OTP sai) – ${err.message}` });
  });

  const lg = (await c.post('account/user/login', { ...base, push_reg_id: '', verify_token: ver.data?.verify_token })).data || {};
  if (!lg.access_token) throw new ApiError('Đăng nhập không trả access_token', { status: 502 });
  const client = c.withToken(lg.access_token);
  const user = toUser(await client.get('account/user/info'));
  writeCache(phone, { did, token: lg.access_token, user, at: Date.now() });
  onStep(`Đăng nhập thành công (${user.phoneMask})`);
  return { client, user, fresh: true };
}

const toUser = (u) => ({ userId: u.user_id_str || String(u.user_id || ''), phoneMask: u.panel_title_info || u.user_full_name || '', accountType: u.account_type || '' });

/** Bỏ token cache (đăng xuất phía tool) */
export function forget(phone) {
  phone = normalizePhone(phone);
  if (existsSync(fileOf(phone))) writeCache(phone, { did: deviceId(phone) });
}
