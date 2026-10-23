// Fox ERP – app Vendor (Quản lý NCU), màn "Giao hàng, triển khai NCU" → tab "Quản lý phiếu giao hàng".
// Blazor Server + MudBlazor, không có REST API -> điều khiển UI. Danh sách tải rất chậm (1-2 phút) và không tự làm mới
// đúng lúc -> mọi thao tác đều đọc lại trạng thái phiếu trong danh sách trước/sau khi làm (chạy lại an toàn).
import { config } from '../core/env.js';
import { getContext, ensureLoggedIn, waitUntil, sleep } from '../core/browser.js';

const LIST_TAB = 'Quản lý phiếu giao hàng';
const OTHER_TAB = 'Quản lý đơn đặt hàng';
const MENU = 'Giao hàng, triển khai NCU';
const APP_TILE = 'Quản lý NCU';

// Tình trạng giao hàng của phiếu (cột "Tình trạng giao hàng")
export const STATUSES = {
  pending: 'Chưa giao hàng',
  shipping: 'Đang giao hàng',
  done: 'Đã hoàn tất',
  cancelled: 'Đã huỷ',
};
const ORDER = [STATUSES.pending, STATUSES.shipping, STATUSES.done];

const isLoginPage = (url) => /\/realms\/|\/login|iam[-.]/i.test(url) && !url.startsWith(config.erpUrl + '/vendor');

async function autoLogin(page) {
  if (!config.erpUser || !config.erpPassword) return false;
  await page.locator('#username, input[name="username"]').first().fill(config.erpUser);
  await page.locator('#password, input[name="password"]').first().fill(config.erpPassword);
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click();
  return true;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const tab = (page, name) => page.locator('.mud-tab').filter({ hasText: new RegExp(`^\\s*${escapeRe(name)}\\s*$`) }).first();
const rows = (page) => page.locator('.mud-tabs-panels tbody tr:visible');
const dialog = (page, title) => page.locator('.mud-dialog').filter({ hasText: title }).last();

/** "1-10 of 435" của bảng đang hiện ("1-0 of 0" = rỗng / chưa tải xong). */
async function listRange(page) {
  const text = await page.locator('.mud-tabs-panels .mud-table-pagination:visible').first().innerText().catch(() => '');
  const m = text.match(/(\d+)-(\d+) of (\d+)/);
  return m ? { from: +m[1], to: +m[2], total: +m[3] } : null;
}

/** Mở (hoặc dùng lại) tab app Vendor ở màn Giao hàng, triển khai NCU. */
export async function openDeliveryPage(onLog) {
  const ctx = await getContext();
  let page = ctx.pages().find((p) => p.url().startsWith(config.erpUrl + config.vendorPath));
  if (!page) {
    // App Vendor cần SessionCode do portal cấp -> đi từ trang chủ portal, bấm ô ứng dụng "Quản lý NCU"
    page = ctx.pages().find((p) => p.url() === 'about:blank') || (await ctx.newPage());
    onLog('[Fox ERP] Mở portal');
    await page.goto(config.erpUrl + '/', { waitUntil: 'domcontentloaded' });
    await ensureLoggedIn(page, { system: 'Fox ERP', isLoginPage, autoLogin, onLog });
    const tile = page.getByText(APP_TILE, { exact: true }).first();
    await tile.waitFor({ state: 'visible', timeout: 90000 });
    onLog(`[Fox ERP] Mở ứng dụng ${APP_TILE}`);
    await tile.click();
    await waitUntil(async () => page.url().includes(config.vendorPath), { timeout: 60000, message: `Không mở được ứng dụng ${APP_TILE}` });
  }
  await page.bringToFront();
  await ensureLoggedIn(page, { system: 'Fox ERP', isLoginPage, autoLogin, onLog });

  // Bấm menu đôi khi chỉ đổi URL mà nội dung không đổi -> tải lại trang
  for (let attempt = 1; ; attempt++) {
    if (!(await tab(page, LIST_TAB).isVisible().catch(() => false))) {
      const menu = page.getByText(MENU, { exact: true }).first();
      await menu.waitFor({ state: 'visible', timeout: 90000 });
      if (!page.url().includes(config.deliveryPath)) await menu.click();
      else if (attempt > 1) await page.reload({ waitUntil: 'domcontentloaded' });
    }
    const ok = await waitUntil(() => tab(page, LIST_TAB).isVisible(), { timeout: 30000, interval: 1000 }).catch(() => false);
    if (ok) break;
    if (attempt >= 3) throw new Error(`Không mở được màn "${MENU}"`);
    onLog('[Fox ERP] Màn chưa tải xong – tải lại trang');
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  return page;
}

/**
 * Mở tab Quản lý phiếu giao hàng và chờ danh sách có dữ liệu. Danh sách hay đứng ở "1-0 of 0":
 * chuyển sang tab khác rồi quay lại thì hệ thống mới tải.
 */
export async function openList(page, onLog, { refresh = false } = {}) {
  const end = Date.now() + config.listWaitMs;
  if (refresh) {
    await tab(page, OTHER_TAB).click();
    await sleep(3000);
  }
  await tab(page, LIST_TAB).click();
  onLog('[Fox ERP] Chờ tải danh sách phiếu giao hàng (hệ thống chậm, có thể 1-2 phút)');
  let toggledAt = Date.now();
  for (;;) {
    const r = await listRange(page);
    if (r?.total > 0 && (await rows(page).count()) > 0) return r;
    if (Date.now() > end) throw new Error(`Quá ${config.listWaitMs / 1000}s danh sách phiếu giao hàng vẫn trống`);
    if (Date.now() - toggledAt > 60000) {
      await tab(page, OTHER_TAB).click();
      await sleep(3000);
      await tab(page, LIST_TAB).click();
      toggledAt = Date.now();
    }
    await sleep(2000);
  }
}

/** Đổi số dòng / trang (10, 25, 50, 100) để tìm phiếu ít phải lật trang. */
async function setRowsPerPage(page, n = 100) {
  const select = page.locator('.mud-tabs-panels .mud-table-pagination .mud-select:visible').first();
  if (!(await select.count())) return;
  if (norm(await select.innerText()) === String(n)) return;
  await select.click();
  const item = page.locator('.mud-popover-open .mud-list-item').filter({ hasText: new RegExp(`^\\s*${n}\\s*$`) }).first();
  await item.click({ timeout: 10000 });
  await waitUntil(async () => (await listRange(page))?.to > 10 || (await listRange(page))?.total <= 10, { timeout: 120000, interval: 1000 })
    .catch(() => {});
}

/** Đọc 1 dòng theo tiêu đề cột. */
async function readRow(row) {
  return row.evaluate((tr) => {
    const heads = [...tr.closest('table').querySelectorAll('thead th')].map((th) => th.innerText.trim());
    const cells = [...tr.querySelectorAll('td')];
    const get = (h) => (cells[heads.indexOf(h)]?.innerText || '').replace(/\s+/g, ' ').trim();
    const button = cells[heads.indexOf('Giao hàng')]?.querySelector('button');
    return {
      supplier: get('Nhà Cung Ứng'),
      orderCode: get('Mã đơn hàng FTEL').split(' ')[0],
      childCode: get('Mã đơn hàng con'),
      poCode: get('Mã PO NCU'),
      pghCode: get('Mã PGH'),
      customer: get('Thông tin KH'),
      createdAt: get('Ngày tạo'),
      status: get('Tình trạng giao hàng'),
      creator: get('Acc tạo'),
      canUpdate: Boolean(button && !button.disabled),
    };
  });
}

/**
 * Các dòng của mã (mã đơn hàng FTEL / mã PGH / mã PO) trên trang danh sách hiện tại.
 * So theo từng từ trong từng ô (hasText của Playwright so trên textContent dính liền các ô) để SGK29694605 không khớp
 * nhầm mã con SGK29694605_CAS.
 */
async function matchRows(page, code) {
  const all = rows(page);
  const idx = await all.evaluateAll((trs, c) => trs.flatMap((tr, i) => (
    [...tr.querySelectorAll('td')].some((td) => td.innerText.split(/\s+/).includes(c)) ? [i] : []
  )), code);
  return idx.map((i) => all.nth(i));
}

/** Tìm phiếu giao hàng theo mã, lật tối đa MAX_PAGES trang (100 dòng/trang, phiếu mới ở đầu). */
export async function findTicket(page, code, onLog) {
  await setRowsPerPage(page, 100);
  for (let p = 1; p <= config.maxPages; p++) {
    const found = await matchRows(page, code);
    if (found.length > 1) {
      const list = await Promise.all(found.map(readRow));
      throw new Error(`Mã ${code} khớp ${found.length} phiếu (${list.map((r) => r.pghCode).join(', ')}) – nhập Mã PGH để chọn đúng phiếu`);
    }
    if (found.length === 1) return { row: found[0], info: await readRow(found[0]) };
    const next = page.locator('.mud-tabs-panels .mud-table-pagination:visible button[aria-label="Next page"]').first();
    if (!(await next.count()) || (await next.isDisabled())) break;
    onLog(`[Fox ERP] Chưa thấy ${code} ở trang ${p} – sang trang sau`);
    const before = await listRange(page);
    await next.click();
    await waitUntil(async () => (await listRange(page))?.from !== before?.from, { timeout: 120000, interval: 1000 });
  }
  throw new Error(`Không tìm thấy phiếu giao hàng của ${code} trong ${config.maxPages} trang đầu (tab ${LIST_TAB})`);
}

/** Chọn giá trị trong mud-select của popup, chờ giá trị hiện lên. */
async function chooseOption(page, select, text) {
  await select.click();
  const item = page.locator('.mud-popover-open .mud-list-item').filter({ hasText: new RegExp(`^\\s*${escapeRe(text)}\\s*$`) }).first();
  if (!(await item.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false))) {
    const opts = await page.locator('.mud-popover-open .mud-list-item').allInnerTexts();
    throw new Error(`Không có lựa chọn "${text}" (có: ${opts.map(norm).join(', ') || 'trống'})`);
  }
  await item.click();
  await waitUntil(async () => norm(await select.innerText()).includes(text), { timeout: 10000, message: `Chưa chọn được "${text}"` });
}

/** Mở popup "Cập nhật tình trạng phiếu giao hàng" (dấu tích xanh cột Giao hàng). */
async function openUpdateDialog(page, row) {
  const button = row.locator('td').last().locator('button');
  if (await button.isDisabled()) throw new Error('Nút cập nhật (dấu tích) đang khoá – phiếu không cho cập nhật tiếp');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const d = dialog(page, 'Cập nhật tình trạng phiếu giao hàng');
  await d.waitFor({ state: 'visible', timeout: 60000 });
  await sleep(1500);
  return d;
}

async function closeDialog(d) {
  if (await d.isVisible().catch(() => false)) await d.getByRole('button', { name: /Đóng/ }).click().catch(() => {});
}

/** Chờ thông báo snackbar (vd "Cập nhật thành công"), trả về nội dung. */
async function waitSnackbar(page, timeout) {
  return waitUntil(async () => norm((await page.locator('.mud-snackbar').allInnerTexts()).join(' | ')), { timeout, interval: 300 })
    .catch(() => '');
}

/**
 * Chưa giao hàng -> Đang giao hàng: popup cập nhật -> Xác nhận -> popup "Xác nhận giao hàng" (hoá đơn) -> Xác nhận.
 * Trả về false nếu hệ thống bỏ qua cú bấm (popup đóng, không mở popup hoá đơn) để gọi lại.
 */
async function toShipping(page, row, invoice, onLog) {
  const d1 = await openUpdateDialog(page, row);
  await chooseOption(page, d1.locator('.mud-select').last(), STATUSES.shipping);
  await sleep(config.confirmDelayMs);
  await d1.getByRole('button', { name: /Xác nhận/ }).click();

  const d2 = dialog(page, 'Xác nhận giao hàng');
  if (!(await d2.waitFor({ state: 'visible', timeout: 30000 }).then(() => true, () => false))) {
    await closeDialog(d1);
    return false;
  }
  await sleep(1500);
  onLog(`[Fox ERP] Điền hoá đơn: NCU ${invoice.ncu}, ngày ${invoice.date || 'mặc định'}, tệp ${invoice.fileName}`);
  const ncu = d2.locator('input[placeholder="Nhập Hóa đơn NCU"]');
  await ncu.fill(invoice.ncu);
  await ncu.press('Tab');
  if (invoice.date) {
    const date = d2.locator('xpath=.//*[contains(normalize-space(.), "Ngày HD NCU")]/following::input[1]').first();
    if ((await date.inputValue()) !== invoice.date) {
      await date.fill(invoice.date);
      await date.press('Enter');
    }
  }
  await d2.locator('input[type=file]').setInputFiles(invoice.file);
  await waitUntil(() => d2.locator('.mud-chip').count(), { timeout: 30000, message: 'Đính kèm hoá đơn điện tử chưa thành công' });
  if (invoice.ftel) {
    const ftel = d2.locator('xpath=.//*[normalize-space(text())="Hóa đơn FTEL"]/following::input[1]').first();
    await ftel.fill(invoice.ftel);
    await ftel.press('Tab');
  }
  await chooseOption(page, d2.locator('.mud-select').last(), STATUSES.shipping);
  await sleep(config.confirmDelayMs);
  await d2.getByRole('button', { name: /Xác nhận/ }).click();

  const msg = await waitSnackbar(page, 60000);
  if (/thành công/i.test(msg)) {
    onLog(`[Fox ERP] ${msg}`);
    return true;
  }
  const still = await d2.isVisible().catch(() => false);
  const detail = still ? norm(await d2.innerText()).slice(-300) : '';
  if (still) await closeDialog(d2);
  throw new Error(`Xác nhận giao hàng không thành công${msg ? `: ${msg}` : ''}${detail ? ` (popup: …${detail})` : ''}`);
}

/** Đang giao hàng -> Đã hoàn tất: popup cập nhật -> Xác nhận (không có popup hoá đơn, thường không có thông báo). */
async function toDone(page, row, onLog) {
  const d1 = await openUpdateDialog(page, row);
  await chooseOption(page, d1.locator('.mud-select').last(), STATUSES.done);
  await sleep(config.confirmDelayMs);
  await d1.getByRole('button', { name: /Xác nhận/ }).click();
  const msg = await waitSnackbar(page, 8000);
  if (msg) onLog(`[Fox ERP] ${msg}`);
  if (msg && !/thành công/i.test(msg)) throw new Error(`Cập nhật Đã hoàn tất không thành công: ${msg}`);
  await waitUntil(async () => !(await d1.isVisible()), { timeout: 30000 }).catch(() => closeDialog(d1));
  return true;
}

/** Chờ tình trạng phiếu trong danh sách đổi sang `expected` (danh sách không tự làm mới -> lật tab để tải lại). */
async function waitStatus(page, code, expected, onLog, timeout = 90000) {
  const end = Date.now() + timeout;
  for (let round = 0; ; round++) {
    if (round > 0) await openList(page, () => {}, { refresh: true }).catch(() => {});
    const roundEnd = Math.min(end, Date.now() + 25000);
    while (Date.now() < roundEnd) {
      const [row] = await matchRows(page, code);
      if (row) {
        const info = await readRow(row);
        if (info.status === expected) return info;
      }
      await sleep(3000);
    }
    if (Date.now() >= end) {
      const { info } = await findTicket(page, code, onLog).catch(() => ({ info: null }));
      return info;
    }
  }
}

/**
 * Đưa phiếu tới tình trạng `target` (shipping | done), đi lần lượt Chưa giao hàng -> Đang giao hàng -> Đã hoàn tất.
 * Mỗi bước: thao tác -> đọc lại danh sách; chưa đổi (hệ thống bỏ qua cú bấm) thì làm lại, tối đa 3 lần.
 */
export async function advanceTicket(page, code, { target, invoice }, onLog, onInfo = () => {}) {
  const goal = STATUSES[target];
  let { row, info } = await findTicket(page, code, onLog);
  onInfo(info);
  onLog(`[Fox ERP] Phiếu ${info.pghCode} – ${info.supplier} – PO ${info.poCode} – ${info.status}`);
  if (info.status === STATUSES.cancelled) throw new Error(`Phiếu ${info.pghCode} đã huỷ`);
  if (!ORDER.includes(info.status)) throw new Error(`Tình trạng "${info.status}" chưa hỗ trợ`);

  if (ORDER.indexOf(info.status) >= ORDER.indexOf(goal)) onLog(`[Fox ERP] Phiếu đã ở "${info.status}" – không cần làm gì`);
  while (ORDER.indexOf(info.status) < ORDER.indexOf(goal)) {
    const next = ORDER[ORDER.indexOf(info.status) + 1];
    for (let attempt = 1; ; attempt++) {
      onLog(`[Fox ERP] ${info.status} → ${next}${attempt > 1 ? ` (lần ${attempt})` : ''}`);
      const sent = next === STATUSES.shipping ? await toShipping(page, row, invoice, onLog) : await toDone(page, row, onLog);
      if (!sent) onLog('⚠ Hệ thống bỏ qua cú bấm Xác nhận (không mở popup hoá đơn)');
      let now = await waitStatus(page, code, next, onLog);
      // Đã báo "Cập nhật thành công" thì KHÔNG bấm lại (tránh gửi hoá đơn 2 lần) – chỉ chờ danh sách cập nhật
      if (sent && next === STATUSES.shipping && now?.status !== next) {
        onLog('[Fox ERP] Đã cập nhật thành công – chờ danh sách hiển thị trạng thái mới');
        now = await waitStatus(page, code, next, onLog, config.listWaitMs);
        if (now?.status !== next) throw new Error(`Hệ thống báo cập nhật thành công nhưng danh sách vẫn "${now?.status}" – kiểm tra lại phiếu ${info.pghCode}`);
      }
      if (now) { info = now; onInfo(info); }
      if (info.status === next) {
        onLog(`[Fox ERP] ✔ ${info.pghCode}: ${next}`);
        break;
      }
      if (attempt >= 3) throw new Error(`Sau ${attempt} lần bấm, phiếu ${info.pghCode} vẫn "${info.status}" (chưa sang "${next}")`);
      ({ row, info } = await findTicket(page, code, onLog));
      if (info.status === next) break;
    }
    ({ row, info } = await findTicket(page, code, onLog));
  }
  return info;
}
