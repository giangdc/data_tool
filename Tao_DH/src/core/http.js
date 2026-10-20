// HTTP client cho API ECP (checkout fpt.vn): gắn client-id + x-checkout-token, bóc lớp {success, data, error}.
// Hỗ trợ đi qua proxy HTTP (CONNECT tunnel) – fetch của Node không tự dùng proxy hệ thống như Chrome.
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

export class ApiError extends Error {
  constructor(message, { status, code, method, path, body } = {}) {
    super(message);
    this.status = status;
    this.code = code; // mã lỗi nghiệp vụ ECP, vd CHECKOUT_PACKAGE_NOT_AVAILABLE
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

export class EcpClient {
  /** proxy: { url, bypass[] } | null (config.proxy) */
  constructor(baseUrl, clientId, checkoutToken, proxy = null) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.clientId = clientId;
    this.checkoutToken = checkoutToken; // token của 1 checkout (trả về khi tạo checkout)
    this.proxy = proxy;
  }

  /** Client mới dùng token của 1 checkout */
  withToken(token) {
    return new EcpClient(this.baseUrl, this.clientId, token, this.proxy);
  }

  async #send(url, init) {
    const viaProxy = this.proxy && !bypassed(url.hostname, this.proxy.bypass);
    try {
      if (viaProxy) return await requestViaProxy(this.proxy.url, url, init);
      const res = await fetch(url, init);
      return { ok: res.ok, status: res.status, statusText: res.statusText, text: await res.text() };
    } catch (err) {
      const cause = err.cause?.code || err.cause?.message || err.message;
      const hint = viaProxy ? '' : ' – máy dùng proxy công ty? đặt ECP_PROXY=http://proxy.fpt.vn:80 trong .env';
      throw new ApiError(`Không gọi được ${url.host} (${cause})${hint}`, { status: 502, method: init.method, path: url.pathname });
    }
  }

  async post(path, body = {}) {
    const url = new URL(this.baseUrl + path);
    const res = await this.#send(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'client-id': this.clientId,
        ...(this.checkoutToken && { 'x-checkout-token': this.checkoutToken }),
      },
      body: JSON.stringify(body),
    });

    const { text } = res;
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok || json?.success === false) {
      const e = json?.error;
      const detail = e?.details?.map((d) => d?.message).filter(Boolean).join('; ');
      const msg = e ? `${e.message || e.code}${detail && detail !== e.message ? ` (${detail})` : ''} [${e.code}]` : text.slice(0, 300) || res.statusText;
      // ECP trả lỗi nghiệp vụ kèm HTTP 200 ({success:false}) -> 422 để server/UI không coi là thành công
      throw new ApiError(msg, { status: res.ok ? 422 : res.status, code: e?.code, method: 'POST', path, body: json ?? text });
    }
    return json && 'data' in json ? json.data : json;
  }
}
