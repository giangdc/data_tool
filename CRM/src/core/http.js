// HTTP client gọn cho API CRM: gắn Bearer token + X-Tenant, bóc lớp {data, status, error, statusCode, message}.
export class ApiError extends Error {
  constructor(message, { status, method, path, body } = {}) {
    super(message);
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
  }
}

export class ApiClient {
  /** token: hàm trả về access token hiện tại (để tự đổi token khi refresh) hoặc chuỗi. */
  constructor(baseUrl, { token, tenant } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.tenant = tenant;
  }

  async request(method, path, { query, body, timeoutMs = 60_000 } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    const token = typeof this.token === 'function' ? await this.token() : this.token;
    // FormData (multipart) -> để fetch tự đặt boundary
    const isForm = body instanceof FormData;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ...(token && { Authorization: `Bearer ${token}` }),
          ...(this.tenant && { 'X-Tenant': this.tenant }),
          Accept: 'application/json',
          'Accept-Language': 'vi',
          ...(body !== undefined && !isForm && { 'Content-Type': 'application/json' }),
        },
        body: body === undefined || isForm ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? `quá ${Math.round(timeoutMs / 1000)}s không phản hồi` : err.cause?.message || err.message;
      throw new ApiError(`${method} ${path}: ${reason}`, { status: 0, method, path });
    }

    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    // Lỗi nghiệp vụ CRM: HTTP 400 + {status: "NOTOK", error: {message}}
    if (!res.ok || json?.status === 'NOTOK') {
      const msg = json?.error?.message || json?.message || text.slice(0, 300) || res.statusText;
      throw new ApiError(msg, { status: res.status, method, path, body: json ?? text });
    }
    return json && typeof json === 'object' && 'data' in json ? json.data : json;
  }

  get(path, query, opts) {
    return this.request('GET', path, { query, ...opts });
  }

  post(path, body, opts) {
    return this.request('POST', path, { body, ...opts });
  }

  put(path, body, opts) {
    return this.request('PUT', path, { body, ...opts });
  }
}
