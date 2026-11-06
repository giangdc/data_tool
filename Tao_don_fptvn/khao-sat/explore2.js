// Explore checkout flow; logs API shape only (secrets masked)
const { chromium } = require('playwright');
const SENS = /token|auth|secret|key|sign|cookie|session|otp|pass|hash|checksum/i;
function shape(v, d = 0) {
  if (v === null || typeof v !== 'object') return v;
  if (d > 3) return Array.isArray(v) ? `[array ${v.length}]` : '{…}';
  if (Array.isArray(v)) return v.length ? [shape(v[0], d + 1), `…len=${v.length}`] : [];
  const o = {};
  for (const [k, x] of Object.entries(v)) {
    o[k] = SENS.test(k) ? '***' : (typeof x === 'string' && x.length > 80 ? x.slice(0, 80) + '…' : shape(x, d + 1));
  }
  return o;
}
(async () => {
  const url = process.argv[2];
  const province = process.argv[3] || 'Hà Nội';
  const browser = await chromium.launch({ headless: true, executablePath: require('fs').readdirSync(process.env.HOME+'/.cache/ms-playwright/chromium-1234').map(d=>process.env.HOME+'/.cache/ms-playwright/chromium-1234/'+d+'/chrome').find(p=>require('fs').existsSync(p)) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (!u.hostname.startsWith('apis')) return;
    const req = r.request();
    let body = '';
    try { body = Object.keys(JSON.parse(req.postData() || '{}')).join(','); } catch {}
    let res;
    try { res = shape(await r.json()); } catch { res = '(non-json)'; }
    console.log(`\n### ${req.method()} ${u.pathname} -> ${r.status()}`);
    console.log('req headers:', Object.keys(req.headers()).filter(h => !/^(sec-|accept|user-agent|referer|origin)/.test(h)).join(','));
    console.log('req body keys:', body);
    if (!/locations\/(wards|streets|buildings|provinces)/.test(u.pathname)) console.log('res:', JSON.stringify(res, null, 1).slice(0, 3000));
  });
  page.on('framenavigated', f => { if (f === page.mainFrame()) { const u=new URL(f.url()); console.log('\n>>> NAV', u.origin+u.pathname, 'params:', [...u.searchParams.keys()].join(',')); } });

  await page.goto(url, { waitUntil: 'networkidle' });
  const href = await page.locator('a:has-text("Đăng ký ngay")').first().getAttribute('href');
  console.log('register path:', new URL(href, url).pathname);
  await page.goto(new URL(href, url).href, { waitUntil: 'networkidle' });

  await page.getByPlaceholder('Nhập họ tên').fill('Test QC Auto');
  await page.getByPlaceholder('Nhập số điện thoại').fill('09'+String(Math.floor(Math.random()*1e8)).padStart(8,'0'));
  const pick = async (btnText, value) => {
    await page.getByRole('button', { name: btnText }).click();
    await page.getByPlaceholder('Nhập thông tin').last().fill(value);
    await page.waitForTimeout(800);
    await page.getByText(value, { exact: false }).last().click();
    await page.waitForTimeout(800);
  };
  await pick('Chọn tỉnh thành phố', province);
  await pick('Chọn phường/xã', process.argv[4] || 'Phường');
  await pick('Chọn tên đường', process.argv[5] || '');
  await page.getByPlaceholder('Nhập số nhà').fill('123');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: __dirname + '/step1.png', fullPage: true });
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: __dirname + '/step2.png', fullPage: true });
  const method = process.argv[6];
  if (method && page.url().includes('/payment')) {
    await page.getByRole('button', { name: 'Không, cảm ơn' }).click().catch(()=>{});
    const more = page.getByText('Xem thêm').last(); if (await more.isVisible().catch(()=>false)) await more.click();
    await page.waitForTimeout(1500);
    console.log('\nMETHODS:', (await page.locator('text=/Thẻ|Thanh toán tại|Chuyển khoản|Ví|QR|Trả góp|Foxpay|Momo|ZaloPay|VNPay/i').allInnerTexts()).join(' | '));
    await page.getByText(method, { exact: true }).first().click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: __dirname + '/step3.png', fullPage: true });
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(2000);
    const btn = page.getByRole('button', { name: /^Thanh toán$/ }).last();
    await btn.waitFor(); await page.waitForFunction(b => !b.disabled, await btn.elementHandle());
    await btn.click();
    await page.waitForURL(u => !u.toString().includes('/payment'), { timeout: 40000 }).catch(e => console.log('no nav after pay'));
    await page.waitForTimeout(5000);
    await page.screenshot({ path: __dirname + '/step4.png', fullPage: true });
  }
  console.log('\nFINAL URL', page.url().split('?')[0]);
  console.log((await page.locator('body').innerText()).slice(0, 1500));
  await browser.close();
})();
