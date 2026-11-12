// Client SPF Web Admin (ASP.NET MVC): đăng nhập bằng Access Token -> cookie phiên; API = POST form-urlencoded (jQuery ajax).
// Token + cookie chỉ ở .cache/session.json (không commit, không log).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, config } from './env.js';

const SESSION_FILE = path.join(CACHE_DIR, 'session.json');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

// API chỉ đọc: SPF lỗi 5xx (hay gặp "Timeout expired" của SQL ở lần tra đầu) thì tự gọi lại.
// KHÔNG thêm API ghi (RetryOrderECPlatform, ConnectOrderEcom, PushCustomTask…) vào đây – gọi lại có thể tạo trùng.
const READ_ONLY = /^\/(Ecomercial\/(OrderECPlatform|GetOrderDetailByEcom)|MasterData\/|Order\/QueueTracking|queue\/GetListTaskByActionCode)/i;
const RETRY_5XX = 2;

export class ApiError extends Error {
  constructor(message, status = 422, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

export class SpfClient {
  #cookies = new Map();
  #token = '';
  loginAt = null;

  constructor() {
    try {
      const s = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
      this.#cookies = new Map(Object.entries(s.cookies || {}));
      this.#token = s.token || '';
      this.loginAt = s.loginAt || null;
    } catch {
      // chưa có phiên
    }
    if (!this.#token && process.env.SPF_ACCESS_TOKEN) this.#token = process.env.SPF_ACCESS_TOKEN.trim();
  }

  get hasToken() {
    return Boolean(this.#token);
  }
  get hasSession() {
    return this.#cookies.size > 0;
  }

  #save() {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(SESSION_FILE, JSON.stringify({ token: this.#token, cookies: Object.fromEntries(this.#cookies), loginAt: this.loginAt }), { mode: 0o600 });
  }

  #url(p) {
    return config.baseUrl + config.basePath + p;
  }

  async #fetch(p, { method = 'GET', form, ajax = false } = {}) {
    const headers = { 'user-agent': UA, accept: ajax ? '*/*' : 'text/html,*/*' };
    if (this.#cookies.size) headers.cookie = [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (ajax) {
      headers['x-requested-with'] = 'XMLHttpRequest';
      headers.referer = this.#url('/Ecomercial/OrderECPlatform');
    }
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      body = new URLSearchParams(Object.entries(form).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v == null ? '' : String(v)])).toString();
    }
    let res;
    try {
      res = await fetch(this.#url(p), { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(60000) });
    } catch (e) {
      throw new ApiError(`Không kết nối được ${config.baseUrl} (${e.cause?.code || e.message})`, 502);
    }
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a)) || value === '';
      if (expired) this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
    return res;
  }

  /** Đăng nhập bằng Access Token (form /Account/Login). token rỗng = dùng token đã lưu. */
  async login(token) {
    if (token) this.#token = String(token).trim();
    if (!this.#token) throw new ApiError('Chưa có Access Token – nhập token để đăng nhập SPF Web Admin', 401, { code: 'NO_TOKEN' });
    this.#cookies.clear();
    const page = await (await this.#fetch('/Account/Login')).text();
    const csrf = page.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1];
    if (!csrf) throw new ApiError('Không đọc được trang đăng nhập SPF Web Admin', 502);
    const res = await this.#fetch('/Account/Login', { method: 'POST', form: { AccessToken: this.#token, __RequestVerificationToken: csrf } });
    const loc = res.headers.get('location') || '';
    if (res.status === 302 && !/Account\/Login/i.test(loc)) {
      this.loginAt = new Date().toISOString();
      this.#save();
      return { ok: true, loginAt: this.loginAt };
    }
    const html = res.status === 200 ? await res.text() : '';
    const msg = html.match(/validation-summary-errors[\s\S]*?<li>([^<]+)<\/li>/)?.[1]?.trim()
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
    // Token sai / hết hạn: bỏ luôn để không tự đăng nhập lại bằng token hỏng
    this.#cookies.clear();
    this.#token = '';
    this.loginAt = null;
    this.#save();
    throw new ApiError(`Đăng nhập thất bại: ${msg || 'Access Token không hợp lệ hoặc đã hết hạn'}`, 401, { code: 'LOGIN_FAILED' });
  }

  logout() {
    this.#cookies.clear();
    this.#token = '';
    this.loginAt = null;
    this.#save();
  }

  /** Gọi API của web-admin. Hết phiên -> tự đăng nhập lại 1 lần bằng token đã lưu. */
  async request(p, { method = 'POST', form, raw = false } = {}, retried = false) {
    if (!this.hasSession) await this.login();
    let res = await this.#fetch(p, { method, form, ajax: true });
    for (let i = 1; i <= RETRY_5XX && res.status >= 500 && READ_ONLY.test(p); i++) {
      await res.text().catch(() => {});
      await new Promise((r) => setTimeout(r, 1500 * i));
      res = await this.#fetch(p, { method, form, ajax: true });
    }
    const loc = res.headers.get('location') || '';
    const expired = (res.status === 302 && /Account\/Login/i.test(loc)) || res.status === 401;
    if (expired) {
      this.#cookies.clear();
      if (retried || !this.#token) throw new ApiError('Phiên SPF Web Admin đã hết hạn – nhập lại Access Token', 401, { code: 'SESSION_EXPIRED' });
      try {
        await this.login();
      } catch (e) {
        throw new ApiError(`Phiên SPF Web Admin đã hết hạn và đăng nhập lại không được (${e.message}) – nhập Access Token mới`, 401, { code: 'SESSION_EXPIRED' });
      }
      return this.request(p, { method, form, raw }, true);
    }
    const text = await res.text();
    if (res.status >= 400) {
      // Kèm lý do SPF trả về (JSON message hoặc <title> trang lỗi ASP.NET) để biết nguyên nhân
      let why = '';
      try {
        const j = JSON.parse(text);
        why = j?.message?.message || j?.message || j?.Message || '';
      } catch {
        why = text.match(/<title>([^<]*)<\/title>/i)?.[1] || text.replace(/<[^>]+>/g, ' ');
      }
      why = String(why).replace(/\s+/g, ' ').trim().slice(0, 200);
      const tried = res.status >= 500 && READ_ONLY.test(p) ? ` (đã tự thử lại ${RETRY_5XX} lần)` : '';
      throw new ApiError(`SPF ${p} lỗi HTTP ${res.status}${why ? `: ${why}` : ''}${tried} – hệ thống SPF stag đang chậm, thử lại sau ít phút`, 502);
    }
    if (raw) return text;
    if (/<form[^>]+Account\/Login/i.test(text)) {
      this.#cookies.clear();
      if (!retried && this.#token) return this.request(p, { method, form, raw }, true);
      throw new ApiError('Phiên SPF Web Admin đã hết hạn – nhập lại Access Token', 401, { code: 'SESSION_EXPIRED' });
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(`SPF ${p} trả về dữ liệu không phải JSON`, 502);
    }
    // Dạng {code, isSuccess, message:{message}, data} – lỗi nghiệp vụ vẫn HTTP 200
    if (data && typeof data === 'object' && 'isSuccess' in data && !data.isSuccess) {
      throw new ApiError(data.message?.message || `SPF ${p} báo lỗi (code ${data.code})`, 422, { code: data.code });
    }
    return data;
  }
}

export const spf = new SpfClient();
export const sessionExists = () => existsSync(SESSION_FILE);
