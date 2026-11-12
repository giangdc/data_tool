// Đổi token SOP -> sc_sdk_token (in cấu trúc, ẩn giá trị)
import fs from 'node:fs';
const sess = JSON.parse(fs.readFileSync(new URL('../.cache/session.json', import.meta.url), 'utf8')).data;
const shape = (v, d = 0) => v === null ? 'null' : Array.isArray(v) ? `[${v.length}:${v.length ? shape(v[0], d + 1) : ''}]`
  : typeof v === 'object' ? (d > 3 ? '{…}' : `{${Object.entries(v).map(([k, x]) => `${k}:${shape(x, d + 1)}`).join(', ')}}`)
  : typeof v === 'string' ? (v.length > 30 ? `str(${v.length})` : JSON.stringify(v)) : String(v);
const url = 'https://gateway-sop-stg.fpt.vn/auth-service/api/auth-service/sdk/refresh-access-key-desktop';
for (const method of ['GET', 'POST']) {
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${sess.access_token}`, 'content-type': 'application/json', origin: 'https://portal-sop-stg.fpt.vn' }, body: method === 'POST' ? '{}' : undefined });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t.slice(0, 150); }
  console.log(method, r.status, typeof b === 'string' ? b : shape(b));
  if (r.ok && b?.data?.sc_sdk_token || b?.sc_sdk_token) { fs.writeFileSync(new URL('../.cache/sdk.json', import.meta.url), t, { mode: 0o600 }); break; }
}
