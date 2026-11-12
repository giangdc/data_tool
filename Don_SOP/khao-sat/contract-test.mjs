import { createContract } from '../src/app/order.js';
const r = await createContract(3679385);
console.log('KẾT QUẢ HỢP ĐỒNG:', JSON.stringify(r, null, 2));
