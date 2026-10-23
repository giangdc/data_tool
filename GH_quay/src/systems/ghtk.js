// GHTK lab (staging): Thông tin tài khoản -> Cấu hình API -> Webhook -> Test: giả lập GHTK đổi trạng thái vận đơn,
// GHTK gọi webhook của FPT (apis-stag.fpt.vn/.../ghtk-receive-data) -> Fox ERP cập nhật trạng thái giao hàng.
import { config } from '../core/env.js';
import { pageFor, ensureLoggedIn, waitUntil, sleep } from '../core/browser.js';

// Mã trạng thái trong popup Test webhook của GHTK lab
export const GHTK_STATUSES = {
  '-1': 'Hủy đơn hàng',
  1: 'Chưa tiếp nhận',
  2: 'Đã tiếp nhận',
  3: 'Đã lấy hàng/Đã nhập kho',
  4: 'Đã điều phối giao hàng/Đang giao hàng',
  5: 'Đã giao hàng/Chưa đối soát',
  6: 'Đã đối soát',
  7: 'Không lấy được hàng',
  8: 'Hoãn lấy hàng',
  9: 'Không giao được hàng',
};

const isLoginPage = (url) => /\/dang-nhap/i.test(url);

async function autoLogin(page) {
  if (!config.ghtkUser || !config.ghtkPassword) return false;
  await page.getByPlaceholder(/Email hoặc số điện thoại/i).fill(config.ghtkUser);
  await page.getByPlaceholder(/Mật khẩu/i).fill(config.ghtkPassword);
  await page.getByRole('button', { name: /^Đăng nhập$/ }).click();
  return true;
}

/** Gửi trạng thái giả lập cho 1 hoặc nhiều mã vận đơn (cách nhau dấu phẩy). */
export async function pushStatus(trackingCodes, status, onLog) {
  const label = GHTK_STATUSES[status];
  if (!label) throw new Error(`Trạng thái GHTK "${status}" không hợp lệ. Có: ${Object.keys(GHTK_STATUSES).join(', ')}`);
  const url = config.ghtkUrl + config.ghtkApiConfigPath;
  const page = await pageFor((u) => u.startsWith(config.ghtkUrl), url);
  if (!page.url().startsWith(url)) await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ensureLoggedIn(page, { system: 'GHTK lab', isLoginPage, autoLogin, onLog });
  if (!page.url().startsWith(url)) await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Bảng webhook: chọn dòng có URL đích của FPT rồi bấm Test
  const row = page.locator('tr').filter({ hasText: config.ghtkWebhookMatch }).first();
  await row.waitFor({ timeout: 30000 }).catch(() => {
    throw new Error(`Tài khoản GHTK chưa cấu hình webhook tới "${config.ghtkWebhookMatch}" (Cấu hình API → Webhook)`);
  });
  await row.getByText('Test', { exact: true }).click();

  const dialog = page.locator('[role="dialog"]:visible, .nft-modal:visible').filter({ hasText: 'Cập nhật trạng thái đơn hàng' }).first();
  await dialog.waitFor({ timeout: 15000 });
  await dialog.getByPlaceholder(/mã đơn hàng/i).fill(trackingCodes);
  await dialog.locator('[class*="select-selector"]').first().click();
  const option = page.locator(`[class*="select-item-option"][title="${status} - ${label}"]`).first();
  await option.waitFor({ timeout: 10000 });
  await option.click();
  await sleep(500);
  await dialog.getByRole('button', { name: 'Xác nhận' }).click();

  // Thông báo nằm trong khung position:fixed (offsetParent luôn null) -> xét theo getClientRects.
  // Thông báo chỉ hiện ~3s: không bắt được nhưng popup đã đóng thì coi như đã gửi (bước sau kiểm tra lại trên Fox ERP).
  const result = await waitUntil(async () => {
    const msg = await page.evaluate(() => [...document.querySelectorAll('[class*="message-notice"], [class*="notification-notice"], [class*="message"] [class*="content"]')]
      .filter((e) => e.getClientRects().length).map((e) => e.innerText.trim()).filter(Boolean).join(' | '));
    if (msg) return msg;
    return (await dialog.isVisible()) ? null : 'đã gửi';
  }, { timeout: 20000, interval: 200, message: 'Bấm Xác nhận nhưng popup GHTK không đóng' });
  if (result !== 'đã gửi' && !/thành công/i.test(result)) throw new Error(`GHTK báo: ${result}`);
  onLog(`GHTK: ${trackingCodes} → ${status} - ${label} (${result})`);
  return `${status} - ${label}`;
}
