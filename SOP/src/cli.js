#!/usr/bin/env node
// Dòng lệnh: npm run order -- --phone 0964633310 [--address "..."] [--coords "lat, lng"] [--combo GigaF1] [--index 1]
//                           [--payment Napas] [--no-contract] [--show]
//         đối tượng KH:     --customer-type "Doanh nghiệp" [--company "..."] [--tax-code 0312345678] [--representative "..."]
//                           [--org-phone 09..] [--contact-phone 09..] [--email ...] [--issue-place "..."] [--gpkd-address "..."]
//         dịch vụ khác:     --service fpt-play-sa [--field "Gói dịch vụ=Gói Premium"] [--with-internet] (--services: xem id)
//         nhiều dịch vụ:    --service fpt-play --service fpt-camera --service hyperfast --with-internet [--field "fpt-camera:Số lượng=2"]
import { parseArgs } from 'node:util';
import { config } from './core/env.js';
import { log } from './core/logger.js';
import { saveRun, savePackages } from './core/store.js';
import { closeBrowser } from './core/browser.js';
import { createOrder } from './sop/order.js';
import { SERVICES } from './sop/services.js';
import { CUSTOMER_TYPES } from './sop/customer.js';

const { values: a } = parseArgs({
  options: {
    phone: { type: 'string', short: 'p' },
    address: { type: 'string', short: 'a' },
    coords: { type: 'string' },
    combo: { type: 'string', short: 'c' },
    index: { type: 'string', short: 'i' },
    payment: { type: 'string' },
    'no-contract': { type: 'boolean' },
    service: { type: 'string', short: 's', multiple: true },
    field: { type: 'string', multiple: true },
    'with-internet': { type: 'boolean' },
    services: { type: 'boolean' },
    'customer-type': { type: 'string', short: 't' },
    'customer-types': { type: 'boolean' },
    company: { type: 'string' },
    'tax-code': { type: 'string' },
    'issue-place': { type: 'string' },
    'gpkd-address': { type: 'string' },
    'org-phone': { type: 'string' },
    'contact-phone': { type: 'string' },
    email: { type: 'string' },
    representative: { type: 'string' },
    show: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (a.services) {
  for (const s of SERVICES) console.log(`${s.id.padEnd(16)} ${s.name.padEnd(24)} ${s.group}${s.note ? ' – ' + s.note : ''}`);
  process.exit(0);
}

if (a['customer-types']) {
  for (const t of CUSTOMER_TYPES) console.log(`${(t.label || t.name).padEnd(16)} = "${t.name}" trên portal (nhóm ${t.group})${t.default ? ' – mặc định' : ''}`);
  process.exit(0);
}

if (a.help || !(a.phone || config.defaults.phone)) {
  console.log(`Tạo đơn (+ hợp đồng) trên Portal SOP ${config.name}
  npm run order -- --phone <SĐT KH có sẵn> [--address "${config.defaults.address}"] [--coords "${config.defaults.coords}"]
                   [--combo ${config.defaults.combo}] [--index ${config.defaults.comboIndex}] [--payment ${config.defaults.payment}] [--no-contract]
                   [--show]   (hiện cửa sổ Chrome; mặc định ${config.headless ? 'chạy ngầm' : 'hiện cửa sổ'})
  --combo = nhóm gói (GigaF1, GigaF2, MetaF1, MetaF2, SkyF1, SkyF2, Combo khác…), --index = thứ tự gói trong nhóm
  --customer-type "Cá nhân" (mặc định) | "Doanh nghiệp" (xem --customer-types). Doanh nghiệp nhập thêm form: --company --tax-code --issue-place --gpkd-address --org-phone --contact-phone --email --representative
    (bỏ trống = dữ liệu test: MST ngẫu nhiên hợp lệ, SĐT = SĐT KH, địa chỉ GPKD = địa chỉ lắp, người đại diện = tên KH)
  --service <id> = dịch vụ khác (xem --services), lặp --service để mua nhiều dịch vụ trong 1 đơn
  --field "Tên ô=Giá trị" (lặp được, bỏ trống = dòng đầu; "<id>:Tên ô=Giá trị" = chỉ cho 1 dịch vụ), --with-internet = mua kèm combo`);
  process.exit(a.help ? 0 : 1);
}

/** --field "Tên ô=Giá trị" áp cho mọi dịch vụ; "<id>:Tên ô=Giá trị" chỉ cho dịch vụ <id>. */
function fieldsFor(id) {
  const out = {};
  for (const f of a.field || []) {
    const eq = f.indexOf('=');
    if (eq < 0) continue;
    let k = f.slice(0, eq).trim();
    const m = k.match(/^([a-z0-9-]+):(.+)$/);
    if (m) { if (m[1] !== id) continue; k = m[2].trim(); }
    out[k] = f.slice(eq + 1).trim();
  }
  return out;
}

try {
  const r = await createOrder({
    phone: a.phone, address: a.address, coords: a.coords, combo: a.combo, comboIndex: a.index, payment: a.payment,
    services: (a.service || []).map((id) => ({ id, fields: fieldsFor(id) })), withInternet: a['with-internet'],
    customerType: a['customer-type'],
    org: {
      company: a.company, taxCode: a['tax-code'], issuePlace: a['issue-place'], gpkdAddress: a['gpkd-address'],
      orgPhone: a['org-phone'], contactPhone: a['contact-phone'], email: a.email, representative: a.representative,
    },
    contract: !a['no-contract'], headless: a.show ? false : undefined,
  }, (m) => log.step(m), savePackages);
  saveRun(r);
  if (r.company) log.info(`Doanh nghiệp: ${r.company} · MST ${r.taxCode}`);
  log.ok(`Đối tượng: ${r.customerType} | Gói: ${r.packageName} | Mã đơn: ${r.orderCode || '?'} | Mã HĐ: ${r.contractCode || '-'} | Bookport: ${r.bookport || '-'}`);
  if (r.quoteLink) log.info(`Link báo giá: ${r.quoteLink}`);
} catch (err) {
  if (err.record) saveRun(err.record);
  log.error(err.message);
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
