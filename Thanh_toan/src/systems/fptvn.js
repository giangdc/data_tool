// staging.fpt.vn/pay – "Tra cứu dễ dàng - Thanh toán tiện lợi": tra HĐ → chọn khoản thu → chọn phương thức → Thanh toán.
// Không cần đăng nhập. Trang SPA, các nút là <button> nhận theo chữ.
import { config } from '../core/env.js';
import { getContext, waitUntil, sleep } from '../core/browser.js';

const SEARCH_BOX = 'input[placeholder="Nhập số hợp đồng cần tra cứu"]';
const NO_BILL = /chưa có ho[áa] đơn cần thanh toán/i;
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const text = (page) => page.locator('body').innerText().catch(() => '');
// Nút theo CHỮ hiển thị: tên accessibility của nút dính cả alt ảnh (vd "Phương thức khácshare icon") nên không dùng getByRole
const button = (page, re) => page.locator('button:visible').filter({ hasText: re }).first();

// Trang cổng thanh toán: Foxpay (thẻ quốc tế) hoặc Napas (thẻ nội địa)
const isGateway = (u) => u.host === config.gatewayHost || u.host === config.napasHost;

// Phương thức ở panel "Phương thức khác" -> chữ trên nút
export const METHODS = {
  intl: 'Thẻ Quốc Tế',
  domestic: 'Thẻ Nội địa',
};

/** Tab trang thanh toán (dùng lại tab cũ nếu có). */
export async function openPayPage(onLog) {
  const ctx = await getContext();
  const host = new URL(config.payUrl).host;
  let page = ctx.pages().find((p) => p.url().includes(host) || p.url().includes(config.gatewayHost));
  if (!page) page = ctx.pages().find((p) => p.url() === 'about:blank') || (await ctx.newPage());
  onLog(`[FPT.vn] Mở ${config.payUrl}`);
  await page.goto(config.payUrl, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await page.locator(SEARCH_BOX).waitFor({ state: 'visible', timeout: config.stepWaitMs });
  // Popup "Thông báo cập nhật giao diện mới"
  const close = button(page, /^\s*Đóng\s*$/);
  await close.waitFor({ state: 'visible', timeout: 4000 }).then(() => close.click(), () => {});
  return page;
}

/**
 * Tra HĐ, trả về danh sách khoản thu [{ index, title, period, amount }].
 * Mỗi thẻ khoản thu được gắn data-tt-bill để chọn lại sau.
 */
export async function searchContract(page, contract, onLog, { afterPay = false } = {}) {
  onLog(`[FPT.vn] Tra cứu HĐ ${contract}`);
  const box = page.locator(SEARCH_BOX);
  await box.fill(contract);
  await button(page, /^\s*Tìm kiếm\s*$/).click();
  await waitUntil(async () => {
    const t = await text(page);
    return t.includes('Kết quả tìm kiếm') && (NO_BILL.test(t) || /Khoan thu|Khoản thu/i.test(t) || /không tồn tại|không tìm thấy/i.test(t));
  }, { timeout: config.stepWaitMs, message: `Không có kết quả tra cứu HĐ ${contract}` });
  await sleep(800);
  const t = await text(page);
  if (NO_BILL.test(t)) return [];
  const err = t.match(/[^\n]*(không tồn tại|không tìm thấy)[^\n]*/i);
  if (err && !/Khoan thu|Khoản thu/i.test(t)) {
    // Sau khi thanh toán hết, trang có lúc báo "Không tìm thấy hợp đồng" thay vì "chưa có hoá đơn" -> coi là hết khoản thu
    if (afterPay) return [];
    throw new Error(`HĐ ${contract}: ${norm(err[0])}`);
  }

  return page.evaluate(() => {
    // Thẻ khoản thu = khối nhỏ nhất chứa dòng "Khoan thu …" và 1 nút chọn (ô tròn)
    const leaves = [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && /^Kho[aả]n thu/i.test(e.textContent.trim()));
    return leaves.map((leaf, index) => {
      let card = leaf.parentElement;
      while (card && !card.querySelector('button')) card = card.parentElement;
      card?.setAttribute('data-tt-bill', String(index));
      const lines = (card?.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
      return {
        index,
        title: lines[0] || '',
        period: leaf.textContent.trim(),
        amount: lines.find((l) => /^\d[\d.,]*\s*đ$/.test(l)) || '',
      };
    });
  });
}

/** Tích chọn các khoản thu, chờ nút "Thanh toán (n)" đúng số khoản. */
export async function selectBills(page, bills) {
  for (const b of bills) {
    await page.locator(`[data-tt-bill="${b.index}"] button`).last().click();
    await sleep(500);
  }
  const pay = button(page, new RegExp(`Thanh toán \\(${bills.length}\\)`));
  await pay.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
    throw new Error(`Chọn khoản thu chưa được (không thấy nút "Thanh toán (${bills.length})")`);
  });
  const total = (await text(page)).match(/Tổng cộng\s*\n*\s*([\d.,]+\s*đ)/);
  return total ? total[1].replace(/\s+/g, '') : '';
}

/**
 * Thanh toán (n) → màn "Thông tin thanh toán" → Phương thức khác → chọn phương thức → Thanh toán
 * → popup "Xác nhận số điện thoại" (nếu có) → sang cổng Foxpay.
 */
export async function checkout(page, { method, phone }, onLog) {
  await button(page, /Thanh toán \(\d+\)/).click();
  await page.waitForURL(/\/pay\/payment-info/, { timeout: config.stepWaitMs });
  await button(page, /^\s*Phương thức khác\s*$/).waitFor({ timeout: config.stepWaitMs });
  await sleep(1000);
  onLog(`[FPT.vn] Phương thức: ${METHODS[method]}`);
  await button(page, /^\s*Phương thức khác\s*$/).click();
  const option = button(page, new RegExp(`^\\s*${METHODS[method]}`));
  await option.waitFor({ state: 'visible', timeout: 15000 });
  await option.click();
  await waitUntil(async () => (await text(page)).includes(`Thanh toán bằng\n${METHODS[method]}`) || (await text(page)).includes(METHODS[method]),
    { timeout: 10000 });
  await sleep(800);
  await button(page, /^\s*Thanh toán\s*$/).click();

  // Popup "Xác nhận số điện thoại" của chủ thẻ (thẻ được lưu cho lần sau)
  const phoneBox = page.locator('input[name=phoneNumber]');
  const asked = await Promise.race([
    phoneBox.waitFor({ state: 'visible', timeout: config.stepWaitMs }).then(() => true),
    page.waitForURL(isGateway, { timeout: config.stepWaitMs }).then(() => false),
  ]).catch(() => null);
  if (asked) {
    onLog(`[FPT.vn] Xác nhận SĐT chủ thẻ ${phone}`);
    await phoneBox.fill(phone);
    await button(page, /^\s*Xác nhận\s*$/).click();
  }
  await page.waitForURL(isGateway, { timeout: config.stepWaitMs }).catch(async () => {
    throw new Error(`Không chuyển sang cổng thanh toán (${page.url()}): ${norm(await text(page)).slice(-200)}`);
  });
}

/**
 * Tra lại HĐ sau khi thanh toán (lần tìm thứ 2): không còn khoản thu = ĐÚNG. Hệ thống có thể gạch nợ chậm ->
 * tra lại tối đa `tries` lần, cách nhau `gapMs`.
 */
export async function remainingBills(contract, onLog, { tries = 3, gapMs = 15000 } = {}) {
  let bills = [];
  for (let i = 1; i <= tries; i++) {
    const page = await openPayPage(() => {});
    bills = await searchContract(page, contract, () => {}, { afterPay: true });
    onLog(`[FPT.vn] Tra lại HĐ ${contract} (lần ${i}): ${bills.length ? `còn ${bills.length} khoản – ${bills.map((b) => b.amount).join(', ')}` : 'không còn khoản thu cần thanh toán'}`);
    if (!bills.length || i === tries) break;
    await sleep(gapMs);
  }
  return bills;
}
