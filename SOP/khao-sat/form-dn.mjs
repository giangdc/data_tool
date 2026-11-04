// Khảo sát form KH Doanh nghiệp: ô chữ + hộp chọn ngày (KHÔNG tạo báo giá).
import { writeFileSync } from 'node:fs';
import { portalPage, openCustomer, openNewSale, chooseAddress, choosePackage } from '../src/sop/order.js';
import { nodes, formFields, shooter, sleep, findNode, typeInto } from '../src/sop/flutter.js';
import { closeBrowser } from '../src/core/browser.js';
const shot = shooter('ks-fdn');
const dump = (l) => l.map((n) => `${n.role}|${n.label.slice(0, 80)}|${n.x},${n.y}`);
const out = {};
const page = await portalPage(true);
try {
  await openCustomer(page, '0833329408', console.log);
  const app = await openNewSale(page, shot, console.log);
  const packages = await chooseAddress(app, '123, Trương Định, Phường Bến Thành, Hồ Chí Minh', '10.7733664, 106.6944494', shot, console.log);
  await choosePackage(app, packages, 'GigaF1', 1, console.log);
  await sleep(6000);
  await app.mouse.click(720, 293); await sleep(2000);
  const h = await findNode(app, /^Tổ chức\/Hộ kinh doanh$/); await app.mouse.click(h.x, h.y); await sleep(3000);
  const upd = await findNode(app, /Cập nhật$/); await app.mouse.click(upd.x, upd.y); await sleep(3500);
  const f = await formFields(app);
  console.log('fields', f.map((x) => `${x.name.split('\n')[0]}@${x.y}`).join(' ;; '));
  const name = f.find((x) => /^Tên Tổ chức/.test(x.name));
  console.log('type name', await typeInto(app, name.x, name.y, 'Cong ty TNHH Test QC'));
  // Ngày cấp
  const d = await findNode(app, /^Chọn ngày cấp$/);
  await app.mouse.click(d.x, d.y); await sleep(2500);
  await shot(app, 'picker-ngay-cap');
  out.picker = dump(await nodes(app));
  out.pickerFields = await formFields(app);
  console.log('PICKER', out.picker.join('\n  '));
  console.log('PICKER FIELDS', JSON.stringify(out.pickerFields));
} catch (e) { console.log('ERR', e.message); }
writeFileSync('output/debug/ks-fdn.json', JSON.stringify(out, null, 1));
await closeBrowser();
