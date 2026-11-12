// Mở Chrome (hiện cửa sổ) đã đăng nhập, ghi TOÀN BỘ request sapi.fpt.vn khi tạo đơn.
// Ghi full body+response vào khao-sat/capture/order-flow.jsonl để dựng src/app/order.js.
import pkg from '/home/user/Desktop/Tool/SOP/node_modules/playwright-core/index.js';
const { chromium } = pkg;
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').map((l) => l.match(/^(\w+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const OUT = new URL('capture/order-flow.jsonl', import.meta.url);
fs.writeFileSync(OUT, '');

const ctx = await chromium.launchPersistentContext('/home/user/Desktop/Tool/SOP/.cache/browser-profile', {
  headless: false, channel: 'chrome', viewport: null, args: ['--window-size=1500,950'] });
const page = ctx.pages()[0] || await ctx.newPage();

let n = 0;
const rec = async (r) => {
  const q = r.request();
  const url = r.url();
  if (!/sapi\.fpt\.vn\/saleplatform/.test(url)) return;
  if (/authentication\/token/.test(url)) return; // token đã biết
  let body = null, res = null;
  try { body = JSON.parse(q.postData() || 'null'); } catch { body = q.postData() || null; }
  try { res = JSON.parse((await r.text()) || 'null'); } catch {}
  const path = url.replace(/^https:\/\/[^/]+\/saleplatform-api-staging\//, '').split('?')[0];
  const line = { i: ++n, t: new Date().toISOString().slice(11, 19), method: q.method(), path, status: r.status(), body, res };
  fs.appendFileSync(OUT, JSON.stringify(line) + '\n');
  process.stdout.write(`#${n} ${q.method()} ${r.status()} ${path}\n`);
};
ctx.on('response', rec);

await page.goto('https://portal-sop-stg.fpt.vn/user/login/basic-auth', { waitUntil: 'domcontentloaded' });
if (page.url().includes('/user/login')) {
  await page.fill('#basic_username', env.APP_USERNAME).catch(() => {});
  await page.fill('#basic_password', env.APP_PASSWORD).catch(() => {});
  await page.getByRole('button', { name: /login/i }).click().catch(() => page.keyboard.press('Enter'));
  await page.waitForURL((u) => !u.pathname.startsWith('/user/login'), { timeout: 30000 }).catch(() => {});
}
console.log('>>> ĐÃ ĐĂNG NHẬP. Mời bạn tự tạo 1 đơn test trên trang. Mọi request đang được ghi.');
console.log('>>> Xong thì nhắn tôi "xong" để dừng ghi. (đừng đóng cửa sổ Chrome)');
await new Promise(() => {}); // chạy mãi tới khi bị kill
