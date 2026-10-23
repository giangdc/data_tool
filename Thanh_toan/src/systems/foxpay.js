// Cổng thanh toán Foxpay (paygateway-stag.fpt.vn): form thẻ quốc tế → 3DS Cardinal (OTP) → trang kết quả;
// thẻ nội địa → form Napas → OTP → trang kết quả.
import { config } from '../core/env.js';
import { waitUntil, sleep } from '../core/browser.js';

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const field = (text, label) => (text.match(new RegExp(`${label}\\s*\\n+\\s*([^\\n]+)`)) || [])[1]?.trim() || '';
export const maskCard = (n) => `${String(n).replace(/\D/g, '').slice(0, 6)}******${String(n).replace(/\D/g, '').slice(-4)}`;

// Form thẻ quốc tế Foxpay: id và name khác nhau (vd id=card-name, name=cardName) -> nhận cả hai
const CARD = {
  number: '#card-number',
  name: '#card-name, input[name=cardName]',
  expiry: '#expiration-date, input[name=cardExpirationDate]',
  cvv: '#cvv-number, input[name=cardCvv]',
};

// Napas có phần tử trùng id (1 hiện, 1 ẩn) -> luôn lấy phần tử đang hiện
const visible = (page, selector) => page.locator(selector).locator('visible=true').first();

/** Ô có input mask -> gõ từng ký tự như người dùng. */
async function type(page, selector, value) {
  const box = visible(page, selector);
  await box.click();
  await box.fill('');
  await box.pressSequentially(value, { delay: 50 });
}

/** Khung 3DS: url của iframe có lúc rỗng -> tìm theo ô nhập mã. */
async function challengeFrame(page) {
  for (const f of page.frames()) {
    if (await f.locator('input[name=challengeDataEntry]').count().catch(() => 0)) return f;
  }
  return null;
}

/**
 * Nhập thẻ quốc tế, xác thực 3DS, đọc kết quả.
 * Trả về { gatewayOrder, amount, status, success, message }.
 */
export async function payByCard(page, card, onLog) {
  await visible(page, CARD.number).waitFor({ state: 'visible', timeout: config.stepWaitMs });
  const info = await page.locator('body').innerText();
  const gatewayOrder = field(info, 'Mã đơn hàng');
  // "Tổng tiền thanh toán" (số cổng thu) có thể khác "Số tiền giao dịch" (số của hoá đơn) -> ghi lại để đối chiếu
  const charged = field(info, 'Tổng tiền thanh toán');
  const txAmount = field(info, 'Số tiền giao dịch');
  onLog(`[Foxpay] Đơn ${gatewayOrder} – thu ${charged}${txAmount && txAmount !== charged ? ` (số tiền giao dịch ${txAmount})` : ''} – thẻ quốc tế ${maskCard(card.number)}`);

  await type(page, CARD.number, card.number.replace(/\D/g, ''));
  await type(page, CARD.name, card.name);
  await type(page, CARD.expiry, card.date.replace(/\D/g, ''));
  await type(page, CARD.cvv, card.cvv);
  await sleep(800);
  const errors = (await page.locator('.error:visible, .invalid-feedback:visible').allInnerTexts()).map(norm).filter(Boolean);
  if (errors.length) throw new Error(`Thông tin thẻ không hợp lệ: ${errors.join('; ')}`);
  await visible(page, '#checkout-btn').click();

  // 3DS: popup "Purchase Authentication" (có thể bỏ qua nếu thẻ không yêu cầu)
  const next = await waitUntil(async () => {
    if (/\/result\//.test(page.url())) return 'result';
    if (await challengeFrame(page)) return 'otp';
    const err = (await page.locator('.error:visible, .alert-danger:visible, .swal2-popup:visible').allInnerTexts().catch(() => [])).map(norm).filter(Boolean);
    if (err.length) throw new Error(`Cổng thanh toán báo lỗi: ${err.join('; ')}`);
    return null;
  }, { timeout: 90000, interval: 1000, message: 'Không thấy bước xác thực 3DS / kết quả thanh toán' });
  if (next === 'otp') {
    const f = await challengeFrame(page);
    onLog('[Foxpay] Xác thực 3DS: nhập OTP');
    await f.locator('input[name=challengeDataEntry]').fill(card.otp);
    await f.locator('input[type=submit], button[type=submit]').first().click();
  }

  return { charged, txAmount, ...(await readResult(page, gatewayOrder)) };
}

/** Chờ trang kết quả của cổng thanh toán và đọc trạng thái. */
async function readResult(page, gatewayOrder) {
  await page.waitForURL(/\/result\//, { timeout: 120000 }).catch(() => {
    throw new Error(`Không về trang kết quả thanh toán (${page.url()})`);
  });
  await waitUntil(async () => /Trạng thái/.test(await page.locator('body').innerText()), { timeout: 30000 }).catch(() => {});
  const result = await page.locator('body').innerText();
  const status = field(result, 'Trạng thái');
  const headline = (result.match(/Thanh toán[^\n!]*!/) || [])[0] || '';
  return {
    gatewayOrder: field(result, 'Mã đơn hàng') || gatewayOrder,
    amount: field(result, 'Số tiền thanh toán'),
    status: status || headline,
    success: /thành công/i.test(status || headline),
    message: norm(result.slice(result.indexOf('Gateway') + 7, result.indexOf('Mã đơn hàng'))).slice(0, 200),
  };
}

/** Ô nhập đầu tiên (trong trang hoặc iframe) có nhãn/placeholder/name khớp `re`. */
async function inputBy(page, re) {
  for (const f of page.frames()) {
    const idx = await f.locator('input:visible').evaluateAll((xs, src) => {
      const r = new RegExp(src, 'i');
      return xs.findIndex((x) => {
        const label = x.labels?.[0]?.innerText || x.closest('div')?.parentElement?.querySelector('label')?.innerText || '';
        return r.test([x.placeholder, x.name, x.id, x.getAttribute('aria-label'), label].join(' '));
      });
    }, re.source).catch(() => -1);
    if (idx >= 0) return f.locator('input:visible').nth(idx);
  }
  return null;
}

/**
 * Thẻ nội địa: trang Napas (dps-staging.napas.com.vn) – #napasCardNo, #napasNameOnCard, #napasIssueDate (MMYY)
 * → Tiếp tục (#napasProcessBtn1) → #napasOtpCode → Tiếp tục (#napasProcessBtn2).
 * Napas chuyển thẳng về staging.fpt.vn/web/pay/payment-result?paymentCode=… (không dừng ở trang kết quả Foxpay)
 * -> success = null: flow kết luận bằng cách tra lại HĐ.
 */
export async function payByDomesticCard(page, card, onLog) {
  await visible(page, '#napasCardNo').waitFor({ state: 'visible', timeout: config.stepWaitMs });
  const info = await page.locator('body').innerText();
  // "Mô tả đơn hàng" = mã đơn Foxpay (dòng đầu) + số HĐ
  const gatewayOrder = field(info, 'Mô tả đơn hàng') || field(info, 'Order description');
  onLog(`[Napas] Đơn ${gatewayOrder} – ${field(info, 'Số tiền') || field(info, 'Amount')} – thẻ nội địa ${maskCard(card.number)}`);
  await type(page, '#napasCardNo', card.number.replace(/\D/g, ''));
  await type(page, '#napasNameOnCard', card.name);
  await type(page, '#napasIssueDate', card.date.replace(/\D/g, ''));
  await sleep(800);
  await visible(page, '#napasProcessBtn1').click();

  const otp = visible(page, '#napasOtpCode');
  await waitUntil(async () => {
    if (await otp.isVisible()) return true;
    const err = (await page.locator('[id*=rror]:visible, .error:visible, .alert-danger:visible').allInnerTexts().catch(() => [])).map(norm).filter(Boolean);
    if (err.length) throw new Error(`Napas báo lỗi: ${err.join('; ')}`);
    return false;
  }, { timeout: config.stepWaitMs, interval: 1000, message: 'Napas không chuyển sang bước nhập OTP (kiểm tra thông tin thẻ)' });
  onLog('[Napas] Nhập OTP');
  await otp.fill(card.otp);
  await sleep(500);
  await visible(page, '#napasProcessBtn2').click();

  await page.waitForURL((u) => u.host !== config.napasHost, { timeout: 120000 }).catch(async () => {
    const t = norm(await page.locator('body').innerText().catch(() => ''));
    throw new Error(`Napas chưa trả kết quả: ${t.slice(0, 200)}`);
  });
  if (/\/result\//.test(page.url())) return readResult(page, gatewayOrder);
  return { gatewayOrder, amount: field(info, 'Số tiền'), status: '', success: null, message: '' };
}

/** Sau trang kết quả, cổng tự quay về staging.fpt.vn …payment-result?paymentCode=… – đọc paymentCode (nếu kịp). */
export async function waitReturn(page, timeout = 25000) {
  await page.waitForURL((u) => u.host !== config.gatewayHost && u.host !== config.napasHost, { timeout }).catch(() => {});
  return new URL(page.url()).searchParams.get('paymentCode') || '';
}
