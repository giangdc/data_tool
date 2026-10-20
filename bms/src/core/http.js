// HTTP client gọn cho các service FTMS: gắn Bearer token, bóc lớp {data, success, errors}.
export class ApiError extends Error {
  constructor(message, { status, method, path, body, baseUrl } = {}) {
    super(message);
    this.status = status;
    this.baseUrl = baseUrl; // phân biệt lỗi của BMS / SM (vd 401 -> đăng nhập lại đúng hệ thống)
    this.method = method;
    this.path = path;
    this.body = body;
  }
}

export class ApiClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  async request(method, path, { query, body } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    // FormData (upload file) -> để fetch tự đặt multipart boundary
    const isForm = body instanceof FormData;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        'Accept-Language': 'vi',
        ...(body !== undefined && !isForm && { 'Content-Type': 'application/json' }),
      },
      body: body === undefined || isForm ? body : JSON.stringify(body),
    });

    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok || json?.success === false) {
      const msg =
        json?.errors?.map((e) => e?.message).filter(Boolean).join('; ') ||
        json?.error?.message ||
        text.slice(0, 300) ||
        res.statusText;
      throw new ApiError(`${method} ${path} -> ${res.status}: ${msg}`, { status: res.status, method, path, body: json ?? text, baseUrl: this.baseUrl });
    }
    return json && 'data' in json ? json.data : json;
  }

  get(path, query) {
    return this.request('GET', path, { query });
  }

  post(path, body) {
    return this.request('POST', path, { body });
  }

  put(path, body) {
    return this.request('PUT', path, { body });
  }
}
