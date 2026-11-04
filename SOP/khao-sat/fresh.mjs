// Khảo sát: mở 1 đơn nháp mới tới màn Combo (có địa chỉ), giữ tab cho cdp.mjs làm tiếp. Chạy khi start-chrome.sh đang chạy.
import { chromium } from 'playwright-core';
import { chooseAddress } from '../src/sop/order.js';
import { nodes, shooter } from '../src/sop/flutter.js';
const phone = process.argv[2] || '0964633310';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = b.contexts()[0];
const [page, ...rest] = ctx.pages();
for (const p of rest) await p.close().catch(() => {});
await page.setViewportSize({ width: 1440, height: 813 });
await page.goto('https://portal-sop-stg.fpt.vn/quan-ly-khach-hang/khach-hang/danh-sach', { waitUntil: 'domcontentloaded' });
await sleep(3000);
await page.getByText(/^Tất cả/).first().click().catch(() => {});
await sleep(2500);
const row = () => page.locator('.ant-table-tbody tr', { hasText: phone }).first();
await row().waitFor({ timeout: 15000 });
const name = (await row().locator('td').nth(1).innerText()).split('\n')[0].trim();
await row().getByText(name, { exact: true }).first().click();
await page.waitForURL(/chi-tiet/, { timeout: 20000 });
await sleep(3000);
await page.getByText('Đơn hàng', { exact: true }).first().click();
await sleep(2000);
await page.getByRole('button', { name: 'Thêm đơn hàng' }).click();
await sleep(1500);
const [app] = await Promise.all([ctx.waitForEvent('page', { timeout: 30000 }), page.getByText('Bán mới', { exact: true }).click()]);
await app.setViewportSize({ width: 1440, height: 813 });
for (const end = Date.now() + 90000; Date.now() < end; await sleep(1000)) {
  const list = await nodes(app);
  if (list.some((n) => /^Internet$/.test(n.label))) break;
  const no = list.find((n) => n.role === 'button' && /^Không$/.test(n.label));
  if (no) { await app.mouse.click(no.x, no.y); await sleep(3000); }
}
if (process.argv[3] !== 'noaddr') console.log('goi', (await chooseAddress(app, '123, Trương Định, Phường Bến Thành, Hồ Chí Minh', '10.7733664, 106.6944494', shooter('ks'), console.log)).length);
await b.close();
