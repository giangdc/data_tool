import { session } from '../src/app/order.js';
const ctx = await session();
console.log('✅ Tool đăng nhập lại OK (profile desktop), instanceVer', ctx.instanceVer);
