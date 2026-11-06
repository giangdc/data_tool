const { chromium } = require('/home/giangdc2/AI/playwright-ts/node_modules/playwright');
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('/home/giangdc2/AI_2/Tool/FPL/.env', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]));
const SENS = /token|auth|secret|sign|cookie|session|otp_code|pass|hash|checksum|phone|email|mobile|client_id|card|key_display/i;
function shape(v, d = 0) {
  if (v === null || typeof v !== 'object') return typeof v === 'string' && v.length > 100 ? v.slice(0, 100) + '…' : v;
  if (d > 5) return Array.isArray(v) ? `[array ${v.length}]` : '{…}';
  if (Array.isArray(v)) return v.length ? [shape(v[0], d + 1), `…len=${v.length}`] : [];
  const o = {}; for (const [k, x] of Object.entries(v)) o[k] = SENS.test(k) ? '***' : shape(x, d + 1); return o;
}
const out = []; const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
(async () => {
  const base = '/home/giangdc2/.cache/ms-playwright/chromium-1234/';
  const exe = base + fs.readdirSync(base).find(d => fs.existsSync(base + d + '/chrome')) + '/chrome';
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('response', async (r) => {
    const req = r.request(); if (!['xhr', 'fetch'].includes(req.resourceType())) return;
    const u = new URL(r.url()); if (!/fptplay/.test(u.hostname) || /config|layout|navigation|triggered|setting|images|animations|\.json$/.test(u.pathname)) return;
    let body = ''; const pd = req.postData() || '';
    try { const j = JSON.parse(pd || '{}'); body = Array.isArray(j) ? `(encrypted len=${j.length})` : JSON.stringify(shape(j)); } catch { body = `(non-json len=${pd.length})`; }
    let res; try { res = shape(await r.json()); } catch { res = '(non-json)'; }
    log(`\n### ${req.method()} ${u.pathname} -> ${r.status()} q=${[...u.searchParams.keys()].filter(k => !/^(st|e|device|drm|version)$/.test(k)).map(k => k + '=' + (SENS.test(k) ? '***' : u.searchParams.get(k))).join('&')}`);
    if (req.method() !== 'GET') log('req:', body);
    log('res:', JSON.stringify(res).slice(0, +(process.env.MAX || 6000)));
  });
  page.on('framenavigated', f => { if (f === page.mainFrame()) log('\n>>> NAV', new URL(f.url()).pathname); });
  await page.goto(process.argv[2], { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  if (await page.getByText('Dữ liệu & Quyền riêng tư').first().isVisible().catch(() => false)) { await page.getByRole('button', { name: 'Tiếp tục' }).last().click(); await page.waitForTimeout(1500); }
  await page.locator('input[type="tel"], input[placeholder*="điện thoại"]').first().fill(env.FPL_PHONE);
  for (const cb of await page.locator('input[type="checkbox"]').all()) if (!(await cb.isChecked().catch(() => true))) await cb.check({ force: true }).catch(() => {});
  await page.getByRole('button', { name: 'Tiếp tục' }).last().click(); await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /Nhận mã OTP/ }).first().click(); await page.waitForTimeout(3000);
  await page.screenshot({ path: __dirname + '/06-otp-input.png' });
  const otpInputs = page.locator('input:visible');
  const n = await otpInputs.count(); log('\nOTP inputs visible:', n);
  if (n === 1) await otpInputs.first().fill(env.FPL_OTP); else { await otpInputs.first().click(); await page.keyboard.type(env.FPL_OTP, { delay: 80 }); }
  await page.waitForTimeout(2000);
  const btn = page.getByRole('button', { name: /Xác nhận|Tiếp tục|Đăng nhập/ }).last();
  if (await btn.isVisible().catch(() => false) && await btn.isEnabled().catch(() => false)) await btn.click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: __dirname + '/07-sau-login.png', fullPage: true });
  fs.writeFileSync(__dirname + '/07-sau-login.txt', (await page.innerText('body')).slice(0, 6000));
  const cc = page.getByText('Thẻ tín dụng').first(); await cc.click().catch(()=>{}); await page.waitForTimeout(2000);
  await page.screenshot({ path: __dirname + '/08-chon-the.png', fullPage: true });
  await page.getByRole('button', { name: /^Thanh toán$/ }).first().click().catch(e=>log('no pay btn', e.message)); await page.waitForTimeout(10000);
  log('URL after pay', new URL(page.url()).host + new URL(page.url()).pathname);
  await page.screenshot({ path: __dirname + '/09-sau-thanh-toan.png', fullPage: true });
  await ctx.storageState({ path: '/home/giangdc2/AI_2/Tool/FPL/.cache-sso-fpl.json' });
  fs.writeFileSync(__dirname + '/login-full.log', out.join('\n'));
  await browser.close();
})();
