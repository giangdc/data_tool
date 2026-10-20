// HTTP client cho API FPT Play (api-staging.fptplay.net): ký URL (st/e), gắn X-Did + Bearer token, bóc lỗi nghiệp vụ.
// Hỗ trợ đi qua proxy HTTP (CONNECT tunnel) – fetch của Node không tự dùng proxy hệ thống như Chrome.
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { createHash } from 'node:crypto';

export class ApiError extends Error {
  constructor(message, { status, code, method, path, body } = {}) {
    super(message);
    this.status = status;
    this.code = code; // mã lỗi nghiệp vụ (error_code / msg_code)
    this.method = method;
    this.path = path;
    this.body = body;
  }
}

/** host có nằm trong danh sách bỏ qua proxy (NO_PROXY / ignore-hosts: "localhost", ".fpt.vn", "*.fpt.vn", "10.0.0.0/8"...) */
function bypassed(host, patterns = []) {
  return patterns.some((p) => {
    const s = p.trim().toLowerCase().replace(/^\*/, '');
    if (!s || s.includes('/')) return false;
    return s.startsWith('.') ? host.endsWith(s) || host === s.slice(1) : host === s;
  });
}

const PROXY_TIMEOUT = 20_000;

/** Gửi 1 request HTTPS qua proxy HTTP bằng CONNECT -> { ok, status, statusText, text } */
async function requestViaProxy(proxyUrl, url, { method, headers, body }) {
  const proxy = new URL(proxyUrl);
  const target = `${url.hostname}:${url.port || 443}`;
  const socket = await new Promise((resolve, reject) => {
    const req = http.request({
      host: proxy.hostname,
      port: proxy.port || 80,
      method: 'CONNECT',
      path: target,
      headers: {
        Host: target,
        ...(proxy.username && { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64') }),
      },
      timeout: PROXY_TIMEOUT,
    });
    req.on('connect', (res, sock) => {
      if (res.statusCode === 200) return resolve(sock);
      sock.destroy();
      reject(new Error(`Proxy ${proxy.host} từ chối kết nối tới ${target}: HTTP ${res.statusCode}`));
    });
    req.on('timeout', () => req.destroy(new Error(`Proxy ${proxy.host} không phản hồi`)));
    req.on('error', (err) => reject(new Error(`Không kết nối được proxy ${proxy.host}: ${err.message}`)));
    req.end();
  });

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body ?? '') },
      // Không truyền agent (kể cả false) để Node dùng createConnection = socket đã tunnel qua proxy
      createConnection: () => tls.connect({ socket, servername: url.hostname }),
      timeout: PROXY_TIMEOUT * 2,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, statusText: res.statusMessage, text }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`${url.host} không phản hồi (qua proxy ${proxy.host})`)));
    req.on('error', reject);
    req.end(body);
  });
}

const sign = (salt, e, path) => createHash('md5').update(salt + e + path).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

export class FplClient {
  /** env: config (apiUrl, signSalt, feVersion, paymentVersion, proxy); did: device id; token: access_token sau đăng nhập */
  constructor(env, { did, token } = {}) {
    this.env = env;
    this.did = did;
    this.token = token;
  }

  withToken(token) {
    return new FplClient(this.env, { did: this.did, token });
  }

  async #send(url, init) {
    const proxy = this.env.proxy;
    const viaProxy = proxy && !bypassed(url.hostname, proxy.bypass);
    try {
      if (viaProxy) return await requestViaProxy(proxy.url, url, init);
      const res = await fetch(url, init);
      return { ok: res.ok, status: res.status, statusText: res.statusText, text: await res.text() };
    } catch (err) {
      const cause = err.cause?.code || err.cause?.message || err.message;
      const hint = viaProxy ? '' : ' – máy dùng proxy công ty? đặt FPL_PROXY=http://proxy.fpt.vn:80 trong .env';
      throw new ApiError(`Không gọi được ${url.host} (${cause})${hint}`, { status: 502, method: init.method, path: url.pathname });
    }
  }

  /** path không có "/" đầu, vd "paymentgw/packages/detail". Trả JSON gốc (mỗi nhóm API một dạng) */
  async request(method, path, { params = {}, body, headers = {} } = {}) {
    const base = new URL(this.env.apiUrl);
    const prefix = base.pathname.replace(/\/?$/, '/'); // "/api/v7.1_w/"
    const e = Math.floor(Date.now() / 1000) + 3600;
    const url = new URL(base.origin + prefix + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
    url.searchParams.set('st', sign(this.env.signSalt, e, prefix + path));
    url.searchParams.set('e', e);
    url.searchParams.set('device', 'Chrome' + encodeURIComponent('(version:130.0.0.0)'));
    url.searchParams.set('drm', 1);
    url.searchParams.set('version', this.env.feVersion);
    if (/^(paymentgw|customergw)/.test(path)) url.searchParams.set('payment_version', this.env.paymentVersion);

    const res = await this.#send(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        Origin: this.env.webUrl,
        Referer: this.env.webUrl + '/',
        'X-Did': this.did,
        ...(this.token && { Authorization: `Bearer ${this.token}` }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let json;
    try {
      json = res.text ? JSON.parse(res.text) : null;
    } catch {
      json = null;
    }
    const failed = !res.ok
      || json?.msg_code === 'error'
      || (json && 'error_code' in json && String(json.error_code) !== '0' && 'status' in json && String(json.status) !== '1');
    if (failed) {
      const msg = json?.msg || json?.msg_content || json?.message || res.text?.slice(0, 300) || res.statusText;
      const code = json?.error_code ?? json?.msg_code ?? res.status;
      throw new ApiError(`${msg} [${code}]`, { status: res.ok ? 422 : res.status, code: String(code), method, path, body: json });
    }
    return json;
  }

  get(path, params, opts) { return this.request('GET', path, { ...opts, params }); }
  post(path, body = {}, opts) { return this.request('POST', path, { ...opts, body }); }
}
