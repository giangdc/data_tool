import { createQuoteWithContract } from '../src/app/order.js';
try {
  const r = await createQuoteWithContract({ name: 'QC test', phone: '0868650892', addressNo: '77', package: 'Giga' });
  console.log('OK:', JSON.stringify(r, null, 2));
} catch (e) { console.log('LỖI' + (e.pickAnotherPackage ? ' (chọn gói khác)' : '') + ':', e.message); }
