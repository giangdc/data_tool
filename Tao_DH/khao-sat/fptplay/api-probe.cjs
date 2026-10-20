// Gọi thử API FPT Play (chưa đăng nhập). Hằng ký URL lấy từ bundle FE công khai (đọc từ file, không in ra)
const crypto = require('crypto'); const fs = require('fs');
const app = fs.readdirSync(__dirname + '/bundle').find(f => f.startsWith('c__app'));
const SALT = fs.readFileSync(__dirname + '/bundle/' + app, 'utf8').match(/"\.concat\("([A-Za-z0-9]{20,})"\)\+[a-zA-Z]+\+[a-zA-Z]+\+[a-zA-Z]+/)[1];
const HOST = 'https://api-staging.fptplay.net', VER = 'v7.1_w';
const SENS = /token|auth|secret|key|sign|cookie|session|otp|pass|hash|checksum|phone|email|mobile|client_id/i;
function shape(v, d = 0) {
  if (v === null || typeof v !== 'object') return typeof v === 'string' && v.length > 100 ? v.slice(0, 100) + '…' : v;
  if (d > 5) return Array.isArray(v) ? `[array ${v.length}]` : '{…}';
  if (Array.isArray(v)) return v.length ? [shape(v[0], d + 1), `…len=${v.length}`] : [];
  const o = {}; for (const [k, x] of Object.entries(v)) o[k] = SENS.test(k) ? '***' : shape(x, d + 1); return o;
}
async function get(path, params = {}) {
  const e = Math.floor(Date.now() / 1000) + 3600, w = `/api/${VER}/`;
  const st = crypto.createHash('md5').update(SALT + e + w + path).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const q = new URLSearchParams({ ...params, st, e, device: 'Chrome' + encodeURIComponent('(version:130)'), drm: 1 });
  const r = await fetch(`${HOST}${w}${path}?${q}`, { headers: { 'x-did': 'probe' + Date.now() } });
  let j; try { j = await r.json(); } catch { j = '(non-json)'; }
  console.log(`\n### GET ${path} ${JSON.stringify(Object.keys(params))} -> ${r.status}\n` + JSON.stringify(shape(j), null, 1).slice(0, +process.env.MAX || 4000));
  return j;
}
module.exports = { get };
if (require.main === module) (async () => {
  for (const a of process.argv.slice(2)) { const [p, qs] = a.split('?'); await get(p, Object.fromEntries(new URLSearchParams(qs || ''))); }
})();
