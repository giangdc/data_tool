// Fox ERP – màn "Thông tin phiếu giao dịch thiết bị" (Blazor Server + Radzen). Không có REST API -> điều khiển UI.
// Mọi bước đều đọc trạng thái phiếu + "Lịch sử xử lý" trước, bước nào đã làm thì bỏ qua (chạy lại an toàn).
import { config } from '../core/env.js';
import { getContext, pageFor, ensureLoggedIn, waitUntil, sleep } from '../core/browser.js';

const SEARCH_URL = () => config.erpUrl + config.erpSearchPath;
const SEARCH_BOX = 'input[placeholder="Nhập số hợp đồng"]';
// Nút tròn số thứ tự phiếu ở thanh bên trái ("1 ✓", "2 !") – class đổi theo trạng thái chọn nên nhận theo hình dạng
const ticketButtons = (page) => page.locator('button.rz-button[style*="border-radius: 50%"]').filter({ hasText: /^\s*\d/ });
// Trạng thái phiếu đã kết thúc -> không chọn để chạy luồng
const FINAL_STATES = /thành công|hủy|huỷ|hoàn tất/i;

const isLoginPage = (url) => /\/realms\/|\/login|iam[-.]/i.test(url) && !url.startsWith(config.erpUrl + '/service');

async function autoLogin(page) {
  if (!config.erpUser || !config.erpPassword) return false;
  await page.locator('#username, input[name="username"]').first().fill(config.erpUser);
  await page.locator('#password, input[name="password"]').first().fill(config.erpPassword);
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click();
  return true;
}

const isBusy = (page) => page.getByText(/Đang tải dữ liệu|Mất kết nối máy chủ|Attempting to reconnect/i).locator('visible=true').count()
  .then((n) => n > 0);

/** Chờ Blazor xử lý xong: hết lớp "Đang tải dữ liệu...", không mất kết nối máy chủ. */
async function waitIdle(page, timeout = 60000) {
  await sleep(600);
  await waitUntil(async () => {
    const text = await page.locator('body').innerText();
    if (/no healthy upstream/i.test(text)) throw new Error('Fox ERP lỗi máy chủ ("no healthy upstream") – thử lại sau');
    return !(await isBusy(page));
  }, { timeout, message: 'Fox ERP xử lý quá lâu (vẫn "Đang tải dữ liệu...")' });
}

/**
 * Bấm nút thao tác rồi chờ xử lý xong. Lớp "Đang tải dữ liệu..." có thể hiện trễ sau cú bấm -> chờ nó hiện (tối đa 5s)
 * rồi mới chờ nó tắt. KHÔNG được tải lại trang khi đang xử lý: thao tác (vd tạo vận đơn GHTK) sẽ chạy dở.
 */
async function clickAndWait(page, scope, text, timeout = 60000) {
  await clickButton(scope, text);
  await waitUntil(() => isBusy(page), { timeout: 5000, interval: 200 }).catch(() => {});
  await waitIdle(page, timeout);
}

/** Hộp thoại "Thông báo!" của Radzen sau thao tác (vd kết quả tạo vận đơn): đọc nội dung rồi đóng. */
async function takeDialog(page, timeout = 5000) {
  const dialog = page.locator('.rz-dialog:visible').first();
  const text = await dialog.innerText({ timeout }).then((s) => s.replace(/\s+/g, ' ').trim(), () => '');
  if (text) {
    const close = dialog.locator('button').filter({ hasText: /^\s*(OK|Đồng ý|Đóng|close)\s*$/i }).first();
    if (await close.count()) await close.click().catch(() => {});
    else await page.keyboard.press('Escape');
    await sleep(500);
  }
  return text;
}

/** Đọc thông tin phiếu đang mở: các field theo nhãn, 3 thẻ trên cùng, lịch sử xử lý, nút thao tác. */
export async function readTicket(page) {
  const raw = await page.evaluate(() => {
    const fields = {};
    document.querySelectorAll('.rz-form-field label').forEach((l) => {
      const label = l.textContent.trim();
      const ff = l.closest('.rz-form-field');
      if (!label || label in fields) return;
      const dd = ff.querySelector('.rz-dropdown-label');
      const input = ff.querySelector('input:not([type=hidden]), textarea');
      fields[label] = (dd ? dd.textContent : input?.value ?? '').trim();
    });
    const cards = {};
    document.querySelectorAll('.rz-card span').forEach((s) => {
      const b = s.parentElement.querySelector('b');
      if (b) cards[s.textContent.trim()] = b.textContent.trim();
    });
    const buttons = [...document.querySelectorAll('button')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => b.innerText.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return { fields, cards, buttons, body: document.body.innerText };
  });
  const { fields, cards, body } = raw;
  const history = body.slice(body.indexOf('Lịch sử xử lý'));
  return {
    contract: fields['Hợp đồng'] || '',
    orderCode: fields['Mã đơn hàng'] || '',
    ticketStatus: fields['Trạng thái phiếu'] || '',
    deliveryCode: cards['Mã phiếu giao hàng'] || '',
    deliveryStatus: cards['Trạng thái giao hàng'] || '',
    carrier: fields['Đơn vị vận chuyển *'] || '',
    stock: fields['Kho xuất *'] || '',
    stockPhone: fields['Số điện thoại *'] || '',
    pickupAddress: fields['Địa chỉ lấy hàng *'] || '',
    trackingCode: fields['Mã vận đơn'] || (history.match(/Mã vận đơn:\s*([^\s,]+)/) || [])[1] || '',
    advanceCode: (history.match(/Đề nghị tạm ứng vật tư[\s\S]*?Mã phiếu:\s*(\S+)/) || [])[1] || '',
    // "Mã phiếu: PTUN… — Vật tư: FPT Camera Play 4 x1; Nguon … x1"
    advanceItems: ((history.match(/Đề nghị tạm ứng vật tư[\s\S]*?Vật tư:\s*([^\n]+)/) || [])[1] || '')
      .split(';').map((s) => s.trim().match(/^(.+?)\s+x(\d+)$/)).filter(Boolean)
      .map(([, name, qty]) => ({ name: name.trim(), qty: Number(qty) })),
    advanceConfirmed: /Xác nhận tạm ứng thành công/.test(history),
    buttons: raw.buttons,
    history,
  };
}

const hasButton = (t, text) => t.buttons.some((b) => b.endsWith(text));

async function clickButton(scope, text) {
  const btn = scope.locator('button:visible').filter({ hasText: text }).first();
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
}

/** Thông báo Radzen đang hiện (lỗi/thành công) – để báo lại cho người dùng. */
async function notifications(page) {
  return page.locator('.rz-notification-item:visible, .rz-growl-item:visible').allInnerTexts()
    .then((a) => a.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)).catch(() => []);
}

const formField = (page, labelRe) => page.locator('.rz-form-field', { has: page.locator('label', { hasText: labelRe }) }).first();

/** Bước 1: tìm HĐ -> mở tab phiếu (q1 là token mã hoá, không mở thẳng bằng số HĐ được). */
export async function openTicketPage(contract, onLog) {
  const page = await pageFor((u) => u.replace(/\/$/, '') === SEARCH_URL(), SEARCH_URL());
  await ensureLoggedIn(page, { system: 'Fox ERP', isLoginPage, autoLogin, onLog });
  if (page.url().replace(/\/$/, '') !== SEARCH_URL()) await page.goto(SEARCH_URL(), { waitUntil: 'domcontentloaded' });
  const box = page.locator(SEARCH_BOX);
  await box.waitFor({ timeout: 30000 });
  await sleep(1500); // chờ Blazor nối circuit, gõ sớm quá sẽ mất ký tự
  await box.fill(contract);
  await box.press('Tab');

  const popup = (await getContext()).waitForEvent('page', { timeout: 20000 }).catch(() => null);
  await page.locator(`${SEARCH_BOX} + button`).click();
  const ticket = await popup;
  if (!ticket) {
    const msg = (await notifications(page)).join(' | ');
    throw new Error(`Không mở được phiếu của HĐ ${contract}${msg ? `: ${msg}` : ' (sai số HĐ hoặc tài khoản không có quyền?)'}`);
  }
  await ticket.waitForLoadState('domcontentloaded');
  await ticket.bringToFront();
  await waitUntil(async () => (await ticketButtons(ticket).count()) > 0 || /Dữ liệu không đúng/.test(await ticket.locator('body').innerText()), {
    timeout: 40000, message: 'Trang phiếu không hiện danh sách phiếu',
  });
  if (!(await ticketButtons(ticket).count())) throw new Error(`HĐ ${contract}: ${await ticket.locator('body').innerText()}`.slice(0, 300));
  return ticket;
}

/**
 * Chọn phiếu ở thanh bên trái. Có deliveryCode -> đúng phiếu đó; không có -> phiếu đầu tiên chưa kết thúc.
 * Trả về thông tin phiếu đã chọn.
 */
export async function selectTicket(page, { deliveryCode, onLog }) {
  const buttons = ticketButtons(page);
  await buttons.first().waitFor({ timeout: 30000 });
  const total = await buttons.count();
  const seen = [];
  for (let i = 0; i < total; i++) {
    await buttons.nth(i).click();
    await waitIdle(page);
    const t = await waitUntil(async () => {
      const r = await readTicket(page);
      return r.deliveryCode && r.ticketStatus ? r : null;
    }, { timeout: 30000, message: 'Không đọc được thông tin phiếu' });
    seen.push(`${t.deliveryCode} (${t.ticketStatus})`);
    if (deliveryCode ? t.deliveryCode === deliveryCode : !FINAL_STATES.test(t.ticketStatus)) {
      if (total > 1) onLog?.(`Chọn phiếu ${i + 1}/${total}: ${t.deliveryCode}`);
      return t;
    }
  }
  throw new Error(deliveryCode
    ? `Không thấy phiếu ${deliveryCode} trên HĐ này`
    : `HĐ không còn phiếu nào chưa xử lý xong: ${seen.join(', ')}`);
}

/** Tải lại trang phiếu (Blazor không tự cập nhật dữ liệu đồng bộ từ SCM/GHTK) rồi mở lại đúng phiếu. */
export async function reloadTicket(page, deliveryCode) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitIdle(page);
  return selectTicket(page, { deliveryCode });
}

/** Bước 2: Nhận xử lý phiếu. */
export async function acceptTicket(page, onLog) {
  let t = await readTicket(page);
  if (!hasButton(t, 'Nhận xử lý phiếu')) return t;
  await clickAndWait(page, page, 'Nhận xử lý phiếu');
  t = await waitUntil(async () => {
    const r = await readTicket(page);
    return hasButton(r, 'Lưu phiếu') ? r : null;
  }, { timeout: 30000, message: 'Bấm "Nhận xử lý phiếu" nhưng phiếu chưa chuyển sang Đang xử lý' });
  onLog(`Nhận xử lý phiếu: ${t.ticketStatus}`);
  return t;
}

/** Bước 3: chọn kho xuất + điền SĐT kho (bắt buộc trước khi đề nghị xuất kho). */
export async function chooseStock(page, { stock, phone }, onLog) {
  let t = await readTicket(page);
  if (t.stock !== stock) {
    await formField(page, /^Kho xuất/).locator('.rz-dropdown').click();
    const filter = page.locator('.rz-dropdown-panel:visible input, .rz-popup:visible input').first();
    if (await filter.count()) await filter.fill(stock);
    else await page.keyboard.type(stock, { delay: 50 });
    const option = page.locator('.rz-dropdown-item:visible').filter({ hasText: new RegExp(`^\\s*${stock}\\s*$`) }).first();
    await option.waitFor({ timeout: 15000 }).catch(() => {
      throw new Error(`Không có kho "${stock}" trong danh sách kho xuất (tài khoản Fox ERP không có quyền kho này?)`);
    });
    await option.click();
    await waitIdle(page);
    t = await waitUntil(async () => {
      const r = await readTicket(page);
      return r.stock === stock && r.pickupAddress ? r : null;
    }, { timeout: 20000, message: `Chọn kho ${stock} nhưng chưa tự điền địa chỉ lấy hàng` });
    onLog(`Chọn kho xuất ${stock} – địa chỉ lấy hàng: ${t.pickupAddress}`);
  }
  if (!t.stockPhone && phone) {
    const input = formField(page, /^Số điện thoại \*/).locator('input');
    await input.fill(phone);
    await input.press('Tab');
    await waitIdle(page);
    t = await readTicket(page);
    onLog(`Điền SĐT kho: ${phone}`);
  }
  return t;
}

/** Bước 4: Đề nghị xuất kho giao hàng -> modal "PHIẾU TẠM ỨNG VẬT TƯ" -> Cập nhật. Trả mã phiếu tạm ứng. */
export async function requestAdvance(page, onLog) {
  const before = await readTicket(page);
  if (before.advanceCode) return before.advanceCode;

  await clickButton(page, 'Đề nghị xuất kho giao hàng');
  const dialog = page.locator('.rz-dialog:visible').filter({ hasText: 'PHIẾU TẠM ỨNG VẬT TƯ' }).first();
  await dialog.waitFor({ timeout: 30000 }).catch(async () => {
    const msg = (await notifications(page)).join(' | ');
    throw new Error(`Không mở được phiếu tạm ứng vật tư${msg ? `: ${msg}` : ''}`);
  });
  await waitIdle(page);
  const items = (await dialog.locator('tbody tr').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  onLog(`Phiếu tạm ứng vật tư: ${items.length} dòng vật tư`);

  await clickAndWait(page, dialog, 'Cập nhật', 90000);
  const code = await waitUntil(async () => {
    const text = await dialog.innerText();
    const m = text.match(/Mã phiếu:?\s*(\S+\d)/);
    if (m) return m[1];
    const msg = (await notifications(page)).join(' | ');
    if (/lỗi|không|thất bại/i.test(msg)) throw new Error(`Tạo phiếu tạm ứng lỗi: ${msg}`);
    return null;
  }, { timeout: 40000, message: 'Bấm "Cập nhật" nhưng không thấy mã phiếu tạm ứng' });
  await clickButton(dialog, 'Đóng').catch(() => {});
  await waitIdle(page);
  return code;
}

/** Chờ SCM xác nhận tạm ứng đồng bộ về phiếu (Lịch sử: "Xác nhận tạm ứng thành công"). */
export async function waitAdvanceConfirmed(page, deliveryCode, onLog) {
  return waitUntil(async () => {
    const t = await reloadTicket(page, deliveryCode);
    if (t.advanceConfirmed) return t;
    onLog('…chờ SCM đồng bộ xác nhận tạm ứng về Fox ERP');
    await sleep(5000);
    return null;
  }, { timeout: config.syncWaitMs, interval: 0, message: `Quá ${config.syncWaitMs / 1000}s Fox ERP chưa nhận xác nhận tạm ứng từ SCM` });
}

/** Bước 7: chọn đơn vị vận chuyển -> Lưu phiếu -> Đóng hàng hoàn tất (tạo vận đơn). Trả mã vận đơn. */
export async function closeAndShip(page, { carrier, deliveryCode }, onLog) {
  let t = await readTicket(page);
  if (t.trackingCode) return t.trackingCode;

  if (t.carrier !== carrier) {
    await formField(page, /^Đơn vị vận chuyển/).locator('.rz-dropdown').click();
    const option = page.locator('.rz-dropdown-item:visible').filter({ hasText: carrier }).first();
    await option.waitFor({ timeout: 15000 }).catch(() => { throw new Error(`Không có đơn vị vận chuyển "${carrier}"`); });
    await option.click();
    await waitIdle(page);
    onLog(`Chọn đơn vị vận chuyển: ${carrier}`);
  }
  await clickAndWait(page, page, 'Lưu phiếu');
  const saveMsg = await takeDialog(page, 1500);
  t = await readTicket(page);
  if (t.carrier !== carrier) {
    throw new Error(`Lưu phiếu chưa được: ${saveMsg || (await notifications(page)).join(' | ') || 'đơn vị vận chuyển chưa lưu'}`);
  }
  onLog('Lưu phiếu');

  // Đóng hàng = Fox ERP gọi GHTK tạo vận đơn (có thể mất vài chục giây). Phải chờ xong hẳn và đọc thông báo kết quả;
  // tải lại trang giữa chừng thì GHTK đã tạo đơn nhưng Fox ERP không lưu mã vận đơn (bấm lại sẽ bị "đã dùng mã … cho 1 đơn hàng khác").
  onLog('Đóng hàng hoàn tất – chờ Fox ERP tạo vận đơn GHTK');
  await clickAndWait(page, page, 'Đóng hàng hoàn tất', 180000);
  const message = (await takeDialog(page, 15000)) || (await notifications(page)).join(' | ');
  if (/thất bại|lỗi|không thành công/i.test(message)) throw new Error(message.replace(/^Thông báo!\s*/, ''));
  t = await readTicket(page);
  for (let i = 0; !t.trackingCode && i < 3; i++) {
    await sleep(3000);
    t = await reloadTicket(page, deliveryCode);
  }
  if (!t.trackingCode) throw new Error(`Đóng hàng hoàn tất chưa tạo được vận đơn${message ? `: ${message}` : ''}`);
  onLog(`Đóng hàng hoàn tất – ${message.replace(/^Thông báo!\s*/, '') || 'đã tạo vận đơn'}`);
  return t.trackingCode;
}
