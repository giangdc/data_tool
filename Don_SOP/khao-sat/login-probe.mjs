// Thử đăng nhập Portal/App SOP bằng tài khoản trong .env – chỉ in status + cấu trúc response (ẩn giá trị)
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').map((l) => l.match(/^(\w+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const shape = (v, d = 0) => v === null ? 'null' : Array.isArray(v) ? `[${v.length ? shape(v[0], d + 1) : ''}]`
  : typeof v === 'object' ? (d > 3 ? '{…}' : `{${Object.entries(v).map(([k, x]) => `${k}:${shape(x, d + 1)}`).join(', ')}}`)
  : typeof v === 'string' ? (v.length > 30 ? `str(${v.length})` : JSON.stringify(v)) : String(v);
const res = await fetch('https://gateway-sop-stg.fpt.vn/auth-service/api/auth-service/sign-in/basic-auth', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://portal-sop-stg.fpt.vn' },
  body: JSON.stringify({ username: env.APP_USERNAME, password: env.APP_PASSWORD, remember: true }),
});
const text = await res.text();
let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
console.log('HTTP', res.status);
console.log(typeof body === 'string' ? body : shape(body));
if (process.argv[2] === '--save' && res.ok) fs.writeFileSync(new URL('../.cache/session.json', import.meta.url), text, { mode: 0o600 });
