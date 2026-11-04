// HTTP client cho API Hi FPT (trang staging.fpt.vn/pay): POST JSON, bóc lớp {statusCode, message, data} (statusCode 0 = thành công).
// Hỗ trợ đi qua proxy HTTP (CONNECT tunnel) – fetch của Node không tự dùng proxy hệ thống như Chrome. Phần proxy copy từ Tao_DH.
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

export class ApiError extends Error {
  constructor(message, { status, code, method, path, body } = {}) {
    super(message);
    this.status = status;
    this.code = code; // statusCode nghiệp vụ của Hi API (khác 0)
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

export class HiClient {
  /** proxy: { url, bypass[] } | null (config.proxy) */
  constructor(baseUrl, proxy = null) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.proxy = proxy;
  }

  async #send(url, init) {
    const viaProxy = this.proxy && !bypassed(url.hostname, this.proxy.bypass);
    try {
      if (viaProxy) return await requestViaProxy(this.proxy.url, url, init);
      const res = await fetch(url, init);
      return { ok: res.ok, status: res.status, statusText: res.statusText, text: await res.text() };
    } catch (err) {
      const cause = err.cause?.code || err.cause?.message || err.message;
      const hint = viaProxy ? '' : ' – máy dùng proxy công ty? đặt BILLPAY_PROXY=http://proxy.fpt.vn:80 trong .env';
      throw new ApiError(`Không gọi được ${url.host} (${cause})${hint}`, { status: 502, method: init.method, path: url.pathname });
    }
  }

  /** POST JSON -> data. Lỗi HTTP hoặc statusCode != 0 -> ApiError (lỗi nghiệp vụ = 422) */
  async post(path, body = {}) {
    const url = new URL(this.baseUrl + path);
    const res = await this.#send(url, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let json;
    try {
      json = res.text ? JSON.parse(res.text) : null;
    } catch {
      json = null;
    }
    if (!res.ok || !json || json.statusCode !== 0) {
      const msg = json?.message || json?.title || res.text.slice(0, 300) || res.statusText;
      throw new ApiError(`${msg}${json?.statusCode !== undefined ? ` [${json.statusCode}]` : ''}`, {
        status: res.ok ? 422 : res.status, code: json?.statusCode, method: 'POST', path, body: json ?? res.text,
      });
    }
    return json.data;
  }
}
