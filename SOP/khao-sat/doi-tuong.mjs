// Khảo sát ô "Đối tượng khách hàng" + form KH doanh nghiệp trên màn báo giá (KHÔNG tạo báo giá).
// node khao-sat/doi-tuong.mjs [SĐT]
import { writeFileSync } from 'node:fs';
import { portalPage, openCustomer, openNewSale, chooseAddress, choosePackage } from '../src/sop/order.js';
import { nodes, formFields, shooter, sleep, findNode } from '../src/sop/flutter.js';
import { closeBrowser } from '../src/core/browser.js';
const phone = process.argv[2] || '0833329408';
const shot = shooter('ks-dt');
const out = { api: [] };
const page = await portalPage(true);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const dump = (l) => l.map((n) => `${n.role}|${n.label.slice(0, 80)}|${n.x},${n.y}`);
try {
  await openCustomer(page, phone, console.log);
  const app = await openNewSale(page, shot, console.log);
  app.on('response', async (r) => {
    if (!r.url().includes('sapi.fpt.vn')) return;
    const ep = r.url().split('?')[0].split('/api/').pop();
    let txt = ''; try { txt = await r.text(); } catch {}
    out.api.push({ ep, hit: /Doanh nghiệp|Cơ quan nhà nước|CusType|MST|TaxCode/i.test(txt) ? txt.slice(0, 4000) : '' });
  });
  const packages = await chooseAddress(app, '123, Trương Định, Phường Bến Thành, Hồ Chí Minh', '10.7733664, 106.6944494', shot, console.log);
  await choosePackage(app, packages, 'GigaF1', 1, console.log);
  await sleep(6000);
  out.groups = {};
  for (const g of ['Khách hàng đặc biệt', 'Thông tin mở rộng', 'Tổ chức/Hộ kinh doanh']) {
    await app.mouse.move(720, 400); await app.mouse.wheel(0, -3000); await sleep(800);
    await app.mouse.click(720, 293); await sleep(2000);
    const h = await findNode(app, new RegExp(`^${esc(g)}$`));
    if (!h) { console.log('no group', g); continue; }
    await app.mouse.click(h.x, h.y); await sleep(3000);
    const value = (await nodes(app)).find((n) => n.y > 270 && n.y < 320);
    await app.mouse.click(720, 293); await sleep(2000);
    await shot(app, `nhom-${g.split('/')[0]}`);
    out.groups[g] = { value: value?.label, list: dump(await nodes(app)) };
    console.log('==', g, '→', value?.label, '\n ', out.groups[g].list.join('\n  '));
    const x = (await nodes(app)).find((n) => n.role === 'button' && !n.label) ;
    await app.keyboard.press('Escape'); await sleep(1500);
    if ((await nodes(app)).some((n) => n.label === 'Đối tượng khách hàng' && n.role === 'group')) { await app.mouse.click(434, 115); await sleep(1500); }
  }
  await shot(app, 'chon-doanh-nghiep');
  console.log('man:', dump(await nodes(app)).join(' ;; '));
  const upd = await findNode(app, /Cập nhật$/);
  if (upd) {
    await app.mouse.click(upd.x, upd.y); await sleep(3500);
    await shot(app, 'form-kh-dn');
    out.form = dump(await nodes(app));
    out.fields = await formFields(app);
    console.log('FORM:', out.form.join('\n  '));
    console.log('FIELDS:', out.fields.map((f) => `${f.name}=${f.value}@${f.x},${f.y}`).join(' ;; '));
    for (let i = 0; i < 5; i++) {
      await app.mouse.move(720, 450); await app.mouse.wheel(0, 500); await sleep(1200);
      await shot(app, `form-kh-dn-cuon${i}`);
      const l = dump(await nodes(app)); out[`scroll${i}`] = l;
      console.log(`SCROLL${i}:`, l.join(' ;; '));
    }
  }
} catch (e) { console.log('ERR', e.message); }
writeFileSync('output/debug/ks-dt.json', JSON.stringify(out, null, 1));
await closeBrowser();
