import { login } from '../src/core/sp.js';
const r = await login();
const d = r.sp.data;
if (d?.Data?.Result?.AccessToken) console.log('✅ ĐĂNG NHẬP MOBILE OK — token nhận được');
else console.log('Chưa được:', JSON.stringify(d?.Message||d).slice(0,250));
