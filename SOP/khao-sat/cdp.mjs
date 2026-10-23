// Điều khiển Chrome đang chạy (khởi bằng khao-sat/start-chrome.sh). node khao-sat/cdp.mjs '<js thân hàm async (page)>' [shot]
import { chromium } from 'playwright-core';
const [code, shot] = process.argv.slice(2);
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = b.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('/ban-hang/')) || ctx.pages().filter((p) => p.url().includes('portal-sop')).pop() || ctx.pages()[0];
await page.bringToFront();
const mask = (s) => String(s).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]+/g, '[email]');
const text = async (n = 4000) => console.log(mask((await page.locator('body').innerText()).replace(/\s*\n\s*/g, '\n')).slice(0, n));
// Flutter web: bật semantics rồi đọc/bấm theo nhãn
const semOn = () => page.evaluate(() => document.querySelector('flt-semantics-placeholder')?.click());
const nodes = async () => { await semOn(); await page.waitForTimeout(300); return page.evaluate(() => [...document.querySelectorAll('flt-semantics')].map((e) => {
  const r = e.getBoundingClientRect(); const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
  return { role: e.getAttribute('role') || '', label: (e.getAttribute('aria-label') || own || '').replace(/\n/g, ' / '), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), input: !!e.querySelector(':scope > input, :scope > textarea') };
}).filter((n) => (n.label || n.input || n.role === 'button') && n.w > 0)); };
const sem = async (filter) => { for (const n of await nodes()) if (!filter || filter.test(n.label)) console.log(`[${n.role}${n.input ? ' input' : ''}] ${n.label.slice(0, 90)} @${n.x},${n.y} ${n.w}x${n.h}`); };
const tap = async (re, idx = 0) => { const n = (await nodes()).filter((n) => re.test(n.label))[idx]; if (!n) throw new Error('không thấy ' + re); await page.mouse.click(n.x, n.y); await page.waitForTimeout(1200); return n; };
try {
  const fn = new Function('page', 'text', 'console', 'sem', 'tap', 'nodes', `return (async () => { ${code} })()`);
  await fn(page, text, console, sem, tap, nodes);
} catch (e) { console.log('ERR', e.message.split('\n')[0]); }
console.log('URL:', page.url().split('?')[0]);
if (shot) await page.screenshot({ path: `khao-sat/screens/${shot}.png` });
await b.close().catch(() => {}); // chỉ ngắt kết nối CDP, Chrome vẫn chạy
