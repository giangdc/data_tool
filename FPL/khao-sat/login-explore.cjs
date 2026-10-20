const { chromium } = require('/home/giangdc2/AI/playwright-ts/node_modules/playwright');
const fs = require('fs');
const SENS = /token|auth|secret|key|sign|cookie|session|otp|pass|hash|checksum|phone|email|mobile|client_id/i;
function shape(v, d = 0) {
  if (v === null || typeof v !== 'object') return typeof v === 'string' && v.length > 100 ? v.slice(0, 100) + '…' : v;
  if (d > 4) return Array.isArray(v) ? `[array ${v.length}]` : '{…}';
  if (Array.isArray(v)) return v.length ? [shape(v[0], d + 1), `…len=${v.length}`] : [];
  const o = {}; for (const [k, x] of Object.entries(v)) o[k] = SENS.test(k) ? '***' : shape(x, d + 1); return o;
}
const out = []; const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
(async () => {
  const base = '/home/giangdc2/.cache/ms-playwright/chromium-1234/';
  const exe = base + fs.readdirSync(base).find(d => fs.existsSync(base + d + '/chrome')) + '/chrome';
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('response', async (r) => {
    const req = r.request(); if (!['xhr', 'fetch'].includes(req.resourceType())) return;
    const u = new URL(r.url()); if (!/fptplay/.test(u.hostname) || /config|layout|navigation|triggered|setting|images/.test(u.pathname)) return;
    let body = ''; const pd = req.postData() || '';
    try { const j = JSON.parse(pd || '{}'); body = Array.isArray(j) ? `(encrypted array len=${j.length})` : Object.keys(j).join(','); } catch { body = `(non-json len=${pd.length})`; }
    let res; try { res = shape(await r.json()); } catch { res = '(non-json)'; }
    log(`\n### ${req.method()} ${u.pathname} -> ${r.status()}`);
    if (req.method() !== 'GET') log('req body keys:', body);
    log('res:', JSON.stringify(res).slice(0, 1500));
  });
  await page.goto(process.argv[2], { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  if (await page.getByText('Dữ liệu & Quyền riêng tư').first().isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Tiếp tục' }).last().click(); await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: __dirname + '/03-login.png' });
  const phone = page.locator('input[type="tel"], input[placeholder*="điện thoại"], input[name*="phone"]').first();
  await phone.fill(process.argv[3]);
  // tick các checkbox điều khoản nếu có
  for (const cb of await page.locator('input[type="checkbox"]').all()) { if (!(await cb.isChecked().catch(() => true))) await cb.check({ force: true }).catch(() => {}); }
  await page.screenshot({ path: __dirname + '/04-login-filled.png' });
  await page.getByRole('button', { name: 'Tiếp tục' }).last().click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: __dirname + '/05-otp.png' });
  fs.writeFileSync(__dirname + '/05-otp.txt', (await page.innerText('body')).slice(0, 3000));
  const inputs = await page.locator('input').evaluateAll(els => els.filter(e => e.offsetParent).map(e => ({ type: e.type, name: e.name, id: e.id, ph: e.placeholder, maxlen: e.maxLength, filled: e.value.length })));
  log('\nINPUTS', JSON.stringify(inputs));
  fs.writeFileSync(__dirname + '/login.log', out.join('\n'));
  await browser.close();
})();
