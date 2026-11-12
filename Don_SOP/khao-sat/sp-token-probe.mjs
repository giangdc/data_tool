// sc_sdk_token -> token Sale Platform (grant one_time_password_2). In cấu trúc, ẩn giá trị.
import fs from 'node:fs';
const sdk = JSON.parse(fs.readFileSync(new URL('../.cache/sdk.json', import.meta.url), 'utf8')).data.sc_sdk_token;
const shape = (v, d = 0) => v === null ? 'null' : Array.isArray(v) ? `[${v.length}:${v.length ? shape(v[0], d + 1) : ''}]`
  : typeof v === 'object' ? (d > 3 ? '{…}' : `{${Object.entries(v).map(([k, x]) => `${k}:${shape(x, d + 1)}`).join(', ')}}`)
  : typeof v === 'string' ? (v.length > 30 ? `str(${v.length})` : JSON.stringify(v)) : String(v);
const body = { GrantType: 'one_time_password_2', Token: sdk, RedirectUrl: '', AccountName: '', Password: '', Platform: 'Web', Device: 'Desktop', ClientApp: '', OldVersion: '', CurrentVersion: '', Bundle: '', PsId: '' };
const r = await fetch('https://sapi.fpt.vn/saleplatform-gateway-api-staging/gateway/auth/api/v3/authentication/token', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://portal-sop-stg.fpt.vn' }, body: JSON.stringify(body) });
const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t.slice(0, 200); }
console.log(r.status, typeof b === 'string' ? b : shape(b));
if (r.ok && b?.Result) fs.writeFileSync(new URL('../.cache/sp-token.json', import.meta.url), t, { mode: 0o600 });
