import { login } from '../src/core/sp.js';
import fs from 'node:fs';
const r = await login();
const d = r.sp.data;
if (d?.Data?.Result) {
  const res = d.Data.Result;
  console.log('✅ ĐĂNG NHẬP SALE PLATFORM OK. Các khóa token nhận được:', Object.keys(res).join(', '));
  fs.writeFileSync(new URL('../.cache/sp-token.json', import.meta.url), JSON.stringify(res), { mode: 0o600 });
} else {
  console.log('Chưa được:', JSON.stringify(d?.Message || d).slice(0, 400));
}
