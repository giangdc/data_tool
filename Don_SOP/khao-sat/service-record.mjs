// Mở Chrome (hiện cửa sổ) đã đăng nhập Portal SOP, vào trang tạo đơn, ghi TOÀN BỘ request Sale Platform
// vào khao-sat/capture/<tên>.jsonl để dựng khuôn API cho nhóm dịch vụ khác Internet.
// Điều khiển qua http://127.0.0.1:3099: /shot (ảnh), /click?x=&y=, /type?t=, /key?k=, /mark?m= (ghi mốc), /goto?u=
// Dùng: node khao-sat/service-record.mjs <tên-file>
import pkg from '/home/user/Desktop/Tool/SOP/node_modules/playwright-core/index.js';
const { chromium } = pkg;
import fs from 'node:fs';
import http from 'node:http';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').map((l) => l.match(/^(\w+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const name = process.argv[2] || 'service-flow';
const OUT = new URL(`capture/${name}.jsonl`, import.meta.url);
fs.writeFileSync(OUT, '');

const ctx = await chromium.launchPersistentContext('/home/user/Desktop/Tool/SOP/.cache/browser-profile', {
  headless: false, channel: 'chrome', viewport: { width: 1440, height: 900 }, args: ['--window-size=1460,1000'] });
const page = ctx.pages()[0] || await ctx.newPage();
let n = 0;
ctx.on('response', async (r) => {
  const q = r.request(), url = r.url();
  if (!/sapi\.fpt\.vn\/saleplatform/.test(url) || /authentication\/token/.test(url)) return;
  let body = null, res = null;
  try { body = JSON.parse(q.postData() || 'null'); } catch { body = q.postData() || null; }
  try { res = JSON.parse((await r.text()) || 'null'); } catch {}
  const path = url.replace(/^https:\/\/[^/]+\/saleplatform-api-staging\//, '').split('?')[0];
  fs.appendFileSync(OUT, JSON.stringify({ i: ++n, t: new Date().toISOString().slice(11, 19), method: q.method(), path, status: r.status(), body, res }) + '\n');
  process.stdout.write(`#${n} ${q.method()} ${r.status()} ${path}\n`);
});

await page.goto('https://portal-sop-stg.fpt.vn/user/login/basic-auth', { waitUntil: 'domcontentloaded' });
if (page.url().includes('/user/login')) {
  await page.fill('#basic_username', env.APP_USERNAME).catch(() => {});
  await page.fill('#basic_password', env.APP_PASSWORD).catch(() => {});
  await page.getByRole('button', { name: /login/i }).click().catch(() => page.keyboard.press('Enter'));
  await page.waitForURL((u) => !u.pathname.startsWith('/user/login'), { timeout: 30000 }).catch(() => {});
}
await page.goto('https://portal-sop-stg.fpt.vn/ban-hang/order/create', { waitUntil: 'load' }).catch(() => {});
console.log('>>> READY', page.url());

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.searchParams;
  try {
    const pg = ctx.pages().at(-1);
    if (u.pathname === '/shot') { const b = await pg.screenshot(); res.writeHead(200, { 'content-type': 'image/png' }); return res.end(b); }
    if (u.pathname === '/click') await pg.mouse.click(Number(p.get('x')), Number(p.get('y')));
    if (u.pathname === '/type') await pg.keyboard.type(p.get('t') || '', { delay: 40 });
    if (u.pathname === '/key') await pg.keyboard.press(p.get('k'));
    if (u.pathname === '/scroll') await pg.mouse.wheel(0, Number(p.get('dy') || 400));
    if (u.pathname === '/goto') await pg.goto(p.get('u'), { waitUntil: 'load' });
    if (u.pathname === '/mark') { fs.appendFileSync(OUT, JSON.stringify({ mark: p.get('m'), i: n }) + '\n'); }
    res.end('ok ' + pg.url());
  } catch (e) { res.end('ERR ' + e.message); }
}).listen(3099, '127.0.0.1');
await new Promise(() => {});
