// node khao-sat/explore.mjs [path] [shot-name] – mở trang, in text + API gọi (chỉ method/url/status), chụp ảnh
import { openSop } from './session.mjs';
const [target = '/quan-ly-khach-hang/khach-hang/danh-sach', name = '02-khach-hang'] = process.argv.slice(2);
const { ctx, page } = await openSop({ headless: process.env.HEADLESS !== '0' });
const apis = [];
page.on('response', (r) => { const t = r.request().resourceType(); if (t === 'xhr' || t === 'fetch') apis.push(`${r.request().method()} ${r.status()} ${r.url().split('?')[0]}`); });
await page.goto('https://portal-sop-stg.fpt.vn' + target, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
console.log('URL:', page.url().split('?')[0]);
console.log((await page.locator('body').innerText()).replace(/\n{2,}/g, '\n').slice(0, 3500));
console.log('--- API:'); console.log([...new Set(apis)].join('\n'));
await page.screenshot({ path: `khao-sat/screens/${name}.png`, fullPage: true });
await ctx.close();
