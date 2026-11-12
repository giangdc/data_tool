// Thử phát lại chuỗi FPT Play bắt từ Portal: get-price-quotation -> order/validate (KH lấy từ khuôn Internet).
import fs from 'node:fs';
import { session } from '../src/app/order.js';
const L = fs.readFileSync(new URL('capture/portal-services.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.path);
const last = (p) => [...L].reverse().find((x) => x.path.endsWith(p));
const T = JSON.parse(fs.readFileSync(new URL('../config/order-template.json', import.meta.url), 'utf8'));
const ctx = await session();
const v = ctx.instanceVer, P = (p) => `gateway/sale/${v}/api/${p}`;
const R = (r) => r.data?.Data?.Result;
const price = await ctx.api(P('order-info/get-price-quotation'), last('get-price-quotation').body);
const pr = R(price); console.log('price key', pr?.Key, JSON.stringify(price.data?.Message));
const PH = process.argv[2] || '0775335608';
const val = JSON.parse(JSON.stringify(last('order/validate').body).replaceAll('0868650892', PH));
val.CustomerInfo = { ...val.CustomerInfo, ...T.orderValidate.CustomerInfo, PhoneSMS: PH };
val.PolicyKey = pr.Key; val.Confirm = 1;
const r = await ctx.api(P('order/validate'), val);
console.log(JSON.stringify(r.data?.Message), JSON.stringify(R(r))?.slice(0, 600));
const vk = R(r)?.ValidateKey;
if (vk && process.argv.includes('--create')) {
  const upd = { ...val, CustomerInfoDuplicate: null, Confirm: 1, ValidateKey: vk };
  const u = await ctx.api(P('order/update'), upd);
  console.log('update', JSON.stringify(u.data?.Message), JSON.stringify(R(u))?.slice(0, 300));
  const id = R(u)?.OrderId;
  if (id) { const q = await ctx.api(P('quotation/detail'), { OrderId: id }); console.log('quote', R(q)?.Quotation?.URL); }
}
