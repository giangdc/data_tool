import { login } from '../src/core/sp.js';
const shape = (v, d = 0) => v === null ? 'null' : Array.isArray(v) ? `[${v.length}]`
  : typeof v === 'object' ? (d > 3 ? '{…}' : `{${Object.entries(v).map(([k, x]) => `${k}:${shape(x, d + 1)}`).join(', ')}}`)
  : typeof v === 'string' ? (v.length > 30 ? `str(${v.length})` : JSON.stringify(v)) : String(v);
const r = await login();
console.log('SP token:', r.sp.status, shape(r.sp.data));
if (r.sp.data?.Data?.Result || r.sp.data?.Result) (await import('node:fs')).writeFileSync(new URL('../.cache/sp-token.json', import.meta.url), JSON.stringify(r.sp.data), { mode: 0o600 });
