// Xem cấu trúc trang đăng nhập basic-auth (chỉ thẻ/thuộc tính, KHÔNG đọc giá trị ô nhập)
import { getContext, closeBrowser } from '../src/core/browser.js';
import { config } from '../src/core/env.js';
const ctx = await getContext({ headless: true });
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto(config.sopUrl + config.sopLoginPath, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
console.log(page.url().replace(/\?.*/, ''));
console.log(await page.evaluate(() => [...document.querySelectorAll('form, input, button')].map((e) => {
  const a = [...e.attributes].filter((x) => x.name !== 'value' && x.name !== 'style').map((x) => `${x.name}="${x.value.slice(0, 60)}"`).join(' ');
  return `<${e.tagName.toLowerCase()} ${a}>${e.tagName === 'BUTTON' ? e.innerText : ''}`;
}).join('\n')));
await closeBrowser();
