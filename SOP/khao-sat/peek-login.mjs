// Xem cấu trúc trang đăng nhập SOP (không cần tài khoản)
import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1366, height: 800 } });
await p.goto('https://portal-sop-stg.fpt.vn/user/login/basic-auth', { waitUntil: 'networkidle', timeout: 60000 });
console.log('url:', p.url().split('?')[0], '| title:', await p.title());
for (const el of await p.locator('input, button').all()) {
  console.log(await el.evaluate((e) => `${e.tagName} type=${e.type} name=${e.name} id=${e.id} ph=${e.placeholder || ''} text=${(e.innerText || '').trim().slice(0, 40)}`));
}
await p.screenshot({ path: 'khao-sat/screens/01-login.png' });
await b.close();
