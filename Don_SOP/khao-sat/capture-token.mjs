// Mở Chrome, đăng nhập Portal SOP, vào app Sale (Flutter), bắt body request authentication/token.
// In các trường của body (ẩn Token dài). Dùng playwright-core của ../SOP.
import pkg from '/home/user/Desktop/Tool/SOP/node_modules/playwright-core/index.js';
const { chromium } = pkg;
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').map((l) => l.match(/^(\w+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const mask = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) =>
  [k, typeof v === 'string' && v.length > 24 ? `str(${v.length})` : v]));

const browser = await chromium.launchPersistentContext('/home/user/Desktop/Tool/SOP/.cache/browser-profile', {
  headless: true, channel: 'chrome', args: ['--window-size=1440,900'], viewport: { width: 1440, height: 900 } });
const page = browser.pages()[0] || await browser.newPage();
const hits = [];
browser.on('request', (r) => {
  if (/authentication\/token/.test(r.url())) {
    let b = null; try { b = JSON.parse(r.postData() || 'null'); } catch {}
    hits.push({ url: r.url().replace(/^https:\/\/[^/]+/, ''), body: mask(b) });
  }
});

await page.goto('https://portal-sop-stg.fpt.vn/user/login/basic-auth', { waitUntil: 'domcontentloaded' });
if (page.url().includes('/user/login')) {
  await page.fill('#basic_username', env.APP_USERNAME);
  await page.fill('#basic_password', env.APP_PASSWORD);
  await page.getByRole('button', { name: /login/i }).click().catch(() => page.keyboard.press('Enter'));
  await page.waitForURL((u) => !u.pathname.startsWith('/user/login'), { timeout: 30000 }).catch(() => {});
}
console.log('Đã đăng nhập, URL:', page.url());
await page.goto('https://portal-sop-stg.fpt.vn/ban-hang/', { waitUntil: 'load' }).catch(() => {});
await page.waitForTimeout(12000);
console.log('Số request token bắt được:', hits.length);
for (const h of hits) console.log(JSON.stringify(h));
await browser.close();
