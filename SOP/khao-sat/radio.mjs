// Khảo sát: bấm loại con trong hộp Đối tượng KH (cùng nhóm Cá nhân) – sau khi bấm có gì.
import { portalPage, openCustomer, openNewSale, chooseAddress, choosePackage } from '../src/sop/order.js';
import { quoteGroups } from '../src/sop/customer.js';
import { nodes, shooter, sleep, findNode } from '../src/sop/flutter.js';
import { closeBrowser } from '../src/core/browser.js';
const shot = shooter('ks-radio');
const dump = async (app) => (await nodes(app)).map((n) => `${n.role}|${n.label.slice(0, 50)}|${n.x},${n.y},h${n.h}`).join(' ;; ');
const page = await portalPage(true);
try {
  await openCustomer(page, '0833329408', console.log);
  const app = await openNewSale(page, shot, console.log);
  const packages = await chooseAddress(app, '123, Trương Định, Phường Bến Thành, Hồ Chí Minh', '10.7733664, 106.6944494', shot, console.log);
  await choosePackage(app, packages, 'GigaF1', 1, console.log);
  await sleep(8000);
  const g = (await quoteGroups(app))[0];
  await app.mouse.click(g.x, g.y); await sleep(2000);
  console.log('DIALOG:', await dump(app));
  const r = (await nodes(app)).find((n) => n.role === 'radio' && /Học sinh/.test(n.label));
  console.log('radio', r); await app.mouse.click(r.x + r.w / 2 - 17, r.y); await sleep(3000);
  await shot(app, 'sau-bam-radio');
  console.log('AFTER CLICK:', await dump(app)); console.log('FIELD', (await quoteGroups(app)).map((x) => x.label));
  await app.setViewportSize({ width: 1440, height: 1100 }); await sleep(1500);
  await shot(app, 'cao-1100');
  console.log('TALL:', await dump(app));
} catch (e) { console.log('ERR', e.message); }
await closeBrowser();
