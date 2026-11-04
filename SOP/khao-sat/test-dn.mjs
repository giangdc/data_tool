// Thử chọn đối tượng + điền form doanh nghiệp tới Xác nhận & Lưu (KHÔNG tạo báo giá).
import { portalPage, openCustomer, openNewSale, chooseAddress, choosePackage } from '../src/sop/order.js';
import { chooseCustomerType, fillOrgCustomer, randomTaxCode, quoteGroups } from '../src/sop/customer.js';
import { nodes, shooter, sleep } from '../src/sop/flutter.js';
import { closeBrowser } from '../src/core/browser.js';
const type = process.argv[2] || 'Doanh nghiệp';
const shot = shooter('ks-tdn');
const page = await portalPage(true);
let app;
try {
  await openCustomer(page, '0833329408', console.log);
  app = await openNewSale(page, shot, console.log);
  const packages = await chooseAddress(app, '123, Trương Định, Phường Bến Thành, Hồ Chí Minh', '10.7733664, 106.6944494', shot, console.log);
  await choosePackage(app, packages, 'GigaF1', 1, console.log);
  await sleep(6000);
  console.log('chosen', await chooseCustomerType(app, type, console.log));
  if (process.argv[3] !== 'noform') {
    await fillOrgCustomer(app, { company: 'Cong ty TNHH QC Test', taxCode: randomTaxCode(), issuePlace: 'So KH va DT TP HCM', gpkdAddress: '123 Truong Dinh, Phuong Ben Thanh, Ho Chi Minh', orgPhone: '0833329408', contactPhone: '0833329408', email: '', representative: 'test' }, shot, console.log);
    await shot(app, 'sau-luu');
    console.log('groups', (await quoteGroups(app)).map((g) => `${g.label}@${g.y}`));
    console.log((await nodes(app)).map((n) => `${n.role}|${n.label.slice(0, 60)}|${n.y}`).join(' ;; '));
  }
} catch (e) {
  console.log('ERR', e.message);
  if (app) { await shot(app, 'loi'); console.log((await nodes(app)).map((n) => `${n.role}|${n.label.slice(0, 60)}|${n.y}`).join(' ;; ')); }
}
await closeBrowser();
