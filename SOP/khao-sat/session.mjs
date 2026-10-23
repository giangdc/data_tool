// Mở Chrome với profile riêng (.cache/browser-profile) và bảo đảm đã đăng nhập SOP.
// Có SOP_USER/SOP_PASSWORD trong .env -> tự điền; không có -> chờ người dùng tự đăng nhập trong cửa sổ.
// Không in tài khoản / mật khẩu / cookie.
import { chromium } from 'playwright-core';
import path from 'node:path';
import { config, CACHE_DIR } from '../src/core/env.js';

export async function openSop({ headless = false, waitMin = 10 } = {}) {
  const ctx = await chromium.launchPersistentContext(path.join(CACHE_DIR, 'browser-profile'), {
    channel: 'chrome', headless, viewport: { width: 1440, height: 860 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(config.sopUrl + '/quan-ly-khach-hang/khach-hang/danh-sach', { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForTimeout(3000);
  if (page.url().includes('/user/login')) {
    // Luôn dùng trang đăng nhập tài khoản + mật khẩu (basic-auth), không dùng trang SSO mặc định
    if (!page.url().includes('basic-auth')) await page.goto(config.sopUrl + config.sopLoginPath, { waitUntil: 'networkidle' });
    if (config.sopUser && config.sopPassword) {
      await page.fill('#basic_username', config.sopUser);
      await page.fill('#basic_password', config.sopPassword);
      await page.click('button[type=submit]');
    } else {
      console.log(`>>> Chưa có tài khoản trong .env – hãy tự đăng nhập trong cửa sổ Chrome (trang basic-auth, chờ tối đa ${waitMin} phút, đừng đóng cửa sổ)`);
    }
    await page.waitForURL((u) => !u.pathname.startsWith('/user/login'), { timeout: waitMin * 60000 });
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  console.log('Đã đăng nhập SOP:', page.url().split('?')[0]);
  return { ctx, page };
}
