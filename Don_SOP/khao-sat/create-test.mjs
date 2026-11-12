import { createQuote } from '../src/app/order.js';
const r = await createQuote({ phone: '0868650892', name: 'QC test', addressNo: '1283' });
console.log('KẾT QUẢ:', JSON.stringify(r, null, 2));
