// Khảo sát: thử thêm từng dịch vụ vào giỏ (KHÔNG tạo báo giá). node khao-sat/matrix.mjs <id,id|all> [internet]
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { SERVICES, addService } from '../src/sop/services.js';
import { codeCollector } from '../src/sop/order.js';
import { shooter, nodes } from '../src/sop/flutter.js';
const [ids = 'all'] = process.argv.slice(2);
const list = ids === 'all' ? SERVICES : SERVICES.filter((s) => ids.split(',').includes(s.id));
for (const s of list) {
  const fresh = () => execFileSync('node', ['khao-sat/fresh.mjs', process.env.PHONE || '0868650892'], { stdio: 'ignore' });
  try { fresh(); } catch { try { fresh(); } catch { console.log(`SKIP ${s.id}: không mở được đơn nháp`); continue; } }
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const app = b.contexts()[0].pages().find((p) => p.url().includes('/ban-hang/'));
  await app.bringToFront();
  const codes = codeCollector(app);
  const shot = shooter(`mx-${s.id}`);
  try {
    const r = await addService(app, s, {}, codes, shot, (m) => process.env.V && console.log(' ', m));
    console.log(`OK   ${s.id}: ${JSON.stringify(r.chosen)}`);
  } catch (e) { console.log(`FAIL ${s.id}: ${e.message.split('\n')[0]}`); await shot(app, 'fail'); }
  await b.close();
}
