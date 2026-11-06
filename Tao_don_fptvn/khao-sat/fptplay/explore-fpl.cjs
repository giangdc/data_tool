// Khảo sát luồng đăng ký gói FPT Play (dev). Chỉ log URL/method/status/KEY body + shape response (mask key nhạy cảm)
const { chromium } = require('/home/giangdc2/AI/playwright-ts/node_modules/playwright');
const fs = require('fs');
const SENS = /token|auth|secret|key|sign|cookie|session|otp|pass|hash|checksum|phone|email|mobile/i;
function shape(v, d = 0) {
  if (v === null || typeof v !== 'object') return typeof v === 'string' && v.length > 80 ? v.slice(0, 80) + '…' : v;
  if (d > 4) return Array.isArray(v) ? `[array ${v.length}]` : '{…}';
  if (Array.isArray(v)) return v.length ? [shape(v[0], d + 1), `…len=${v.length}`] : [];
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = SENS.test(k) ? '***' : shape(x, d + 1);
  return o;
}
const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
(async () => {
  const exe = '/home/giangdc2/.cache/ms-playwright/chromium-1234/' + fs.readdirSync('/home/giangdc2/.cache/ms-playwright/chromium-1234').find(d => fs.existsSync(`/home/giangdc2/.cache/ms-playwright/chromium-1234/${d}/chrome`)) + '/chrome';
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('response', async (r) => {
    const req = r.request();
    if (!['xhr', 'fetch'].includes(req.resourceType())) return;
    const u = new URL(r.url());
    if (/google|facebook|analytics|doubleclick|sentry|clarity|tiktok|gtm|hotjar/.test(u.hostname)) return;
    let body = '';
    try { body = Object.keys(JSON.parse(req.postData() || '{}')).join(','); } catch { body = '(non-json)'; }
    let res; try { res = shape(await r.json()); } catch { res = '(non-json)'; }
    log(`\n### ${req.method()} ${u.host}${u.pathname} -> ${r.status()} | query keys: ${[...u.searchParams.keys()].join(',')}`);
    log('req headers:', Object.keys(req.headers()).filter(h => !/^(sec-|accept|user-agent|referer|origin)/.test(h)).join(','));
    if (req.method() !== 'GET') log('req body keys:', body);
    log('res:', JSON.stringify(res).slice(0, 2500));
  });
  page.on('framenavigated', f => { if (f === page.mainFrame()) { const u = new URL(f.url()); log('\n>>> NAV', u.origin + u.pathname, 'params:', [...u.searchParams.keys()].join(',')); } });
  await page.goto(process.argv[2], { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: __dirname + '/01-goi.png', fullPage: true });
  fs.writeFileSync(__dirname + '/01-goi.txt', await page.innerText('body'));
  fs.writeFileSync(__dirname + '/explore.log', out.join('\n'));
  await browser.close();
})();
