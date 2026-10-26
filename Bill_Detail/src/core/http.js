// HTTP client cho mvc.inside.fpt.net: gắn cookie phiên (chưa có thì tự đăng nhập), phát hiện phiên hết hạn (302 về trang login),
// bóc lớp {data, msg} (data nhiều khi là chuỗi JSON lồng).
import { config } from './env.js';
import { AuthError, cookieHeader, login } from './auth.js';

export class ApiError extends Error {
  constructor(message, { status, path } = {}) {
    super(message);
    this.status = status;
    this.path = path;
  }
}

async function rawRequest(method, path, { query, form, timeoutMs = config.timeoutMs } = {}) {
  const cookie = cookieHeader();
  if (!cookie) throw new AuthError('Chưa đăng nhập inside');

  const url = new URL(config.mvcUrl + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      redirect: 'manual',
      headers: {
        Cookie: cookie,
        'X-Requested-With': 'XMLHttpRequest',
        ...(form && { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }),
      },
      body: form && new URLSearchParams(form),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `quá ${Math.round(timeoutMs / 1000)}s inside không phản hồi` : err.cause?.message || err.message;
    throw new ApiError(`${path}: ${reason}`, { status: 0, path });
  }
  // Hết phiên: inside chuyển hướng về login-stag.fpt.net
  if (res.status >= 300 && res.status < 400) throw new AuthError('Phiên đăng nhập inside đã hết hạn');
  const text = await res.text();
  if (!res.ok) throw new ApiError(`${path}: HTTP ${res.status} ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)}`, { status: res.status, path });
  return text;
}

/** Gọi API: chưa có phiên thì đăng nhập trước; gặp phiên hết hạn thì đăng nhập lại 1 lần rồi gọi lại. */
export async function request(method, path, opts) {
  if (!cookieHeader()) await login();
  try {
    return await rawRequest(method, path, opts);
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    await login();
    return rawRequest(method, path, opts);
  }
}

/** API trả {data, msg}: msg != success -> lỗi; data là chuỗi JSON thì parse thêm 1 lớp. */
export async function requestJson(method, path, opts) {
  const text = await request(method, path, opts);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError(`${path}: phản hồi không phải JSON (${text.slice(0, 120)})`, { path });
  }
  let { data } = json;
  if (json.msg && json.msg !== 'success') {
    // Lỗi SQL/hệ thống của inside nằm trong data – chỉ lấy dòng đầu
    throw new ApiError(`${path}: ${String(data ?? json.msg).split('\n')[0].slice(0, 300)}`, { path });
  }
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      // giữ nguyên chuỗi
    }
  }
  return data;
}
