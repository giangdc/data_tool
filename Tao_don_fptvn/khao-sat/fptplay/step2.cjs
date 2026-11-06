const { chromium } = require('/home/giangdc2/AI/playwright-ts/node_modules/playwright');
const fs = require('fs');
(async () => {
  const base = '/home/giangdc2/.cache/ms-playwright/chromium-1234/';
  const exe = base + fs.readdirSync(base).find(d => fs.existsSync(base + d + '/chrome')) + '/chrome';
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const scripts = new Set();
  page.on('response', r => { if (r.request().resourceType() === 'script' && r.url().includes('fptplay')) scripts.add(r.url()); });
  await page.goto(process.argv[2], { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Hủy / Đóng' }).click().catch(e => console.log('no cancel', e.message));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: __dirname + '/02-sau-dong.png', fullPage: true });
  fs.writeFileSync(__dirname + '/02-sau-dong.txt', await page.innerText('body'));
  fs.writeFileSync(__dirname + '/scripts.txt', [...scripts].join('\n'));
  console.log('url', page.url());
  await browser.close();
})();
