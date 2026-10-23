// Tool SCM (ASP.NET MVC + jQuery EasyUI). Các combo/grid của EasyUI điều khiển qua API jQuery trên trang
// ($('#id').combogrid(...)), còn bấm nút/gõ phím thì qua Playwright để trang chạy đúng sự kiện của nó.
import { config } from '../core/env.js';
import { pageFor, ensureLoggedIn, waitUntil, sleep } from '../core/browser.js';

const isLoginPage = (url) => /\/Account\/Login/i.test(url);

async function autoLogin(page) {
  if (!config.scmUser || !config.scmPassword) return false;
  await page.fill('#txtUserName', config.scmUser);
  await page.fill('#txtPassWord', config.scmPassword);
  await page.locator('input[type="submit"]').first().click();
  return true;
}

async function openScm(path, onLog) {
  const url = config.scmUrl + path;
  const page = await pageFor((u) => u.startsWith(config.scmUrl), url);
  if (!page.url().startsWith(url)) await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ensureLoggedIn(page, { system: 'SCM', isLoginPage, autoLogin, onLog });
  if (!page.url().startsWith(config.scmUrl + path.replace(/\d+$/, ''))) await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.jQuery && document.readyState === 'complete', null, { timeout: 30000 });
  await sleep(1500);
  return page;
}

/** Chờ trang hết lớp phủ đang tải (blockUI, mask của lưới EasyUI). */
async function waitUnblocked(page, timeout = 60000) {
  await sleep(500);
  await waitUntil(() => page.evaluate(() => !$('.blockUI.blockOverlay:visible, .datagrid-mask:visible, .window-mask:visible').filter(
    // window-mask của popup đang mở là bình thường – chỉ tính khi không có popup nào
    (_, e) => !e.classList.contains('window-mask') || !$('.window:visible').length,
  ).length), { timeout, message: 'SCM tải quá lâu' });
}

/** Hộp thông báo EasyUI ($.messager) đang mở. */
const messagerText = (page) => page.evaluate(() => [...document.querySelectorAll('.messager-window')]
  .filter((e) => getComputedStyle(e).display !== 'none')
  .map((e) => e.innerText.replace(/\s+/g, ' ').trim()).join(' | '));

async function closeMessager(page) {
  await page.locator('.messager-window:visible a.l-btn').filter({ hasText: /Ok|Đóng|Close/i }).first().click().catch(() => {});
  await sleep(500);
}

/** Thông báo dạng toast góc trên ("Thực hiện thành công", "Vui lòng chờ...") */
const toastText = (page) => page.evaluate(() => [...document.querySelectorAll('body *')]
  .filter((e) => e.children.length === 0 && e.offsetParent !== null && /thành công|thất bại|lỗi/i.test(e.textContent))
  .map((e) => e.textContent.trim()).join(' | '));

/** Mở panel combogrid (bấm vào ô) để trang nạp dữ liệu, chờ có dòng. */
async function openCombo(page, id) {
  await page.locator(`#${id} + .textbox input.textbox-text`).click();
  await waitUntil(() => page.evaluate((id) => $(`#${id}`).combogrid('grid').datagrid('getRows').length > 0, id), {
    timeout: 20000, message: `Danh sách ${id} không có dữ liệu`,
  });
}

/** Chọn dòng combogrid có textField đúng bằng text (danh sách ngắn, không cần tìm). */
async function pickComboText(page, id, text) {
  await openCombo(page, id);
  const ok = await page.evaluate(([id, text]) => {
    const el = $(`#${id}`);
    const o = el.combogrid('options');
    const g = el.combogrid('grid');
    const i = g.datagrid('getRows').findIndex((r) => String(r[o.textField]).trim() === text);
    if (i < 0) return false;
    g.datagrid('selectRow', i);
    el.combogrid('hidePanel');
    return true;
  }, [id, text]);
  if (!ok) throw new Error(`Không có lựa chọn "${text}" (${id})`);
  await sleep(800);
}

/** Chọn kho trong combogrid kho (hàng chục nghìn kho, phân trang): lọc theo cột Tên kho rồi chọn dòng khớp. */
async function pickStock(page, id, { name, insideCode }) {
  await openCombo(page, id);
  const filter = page.locator('.combo-panel:visible .datagrid-filter-row input[name="STOCK_NAME"]').first();
  await filter.fill(name);
  await filter.press('Enter');
  const picked = await waitUntil(() => page.evaluate(([id, name, inside]) => {
    const el = $(`#${id}`);
    const g = el.combogrid('grid');
    const rows = g.datagrid('getRows');
    const i = rows.findIndex((r) => (inside ? String(r.STOCK_INSIDE).toLowerCase() === inside.toLowerCase() : r.STOCK_NAME === name));
    if (i < 0) return null;
    g.datagrid('selectRow', i);
    el.combogrid('hidePanel');
    return `${rows[i].STOCK_NAME} (${rows[i].STOCK_CODE})`;
  }, [id, name, insideCode]), { timeout: 20000, message: `Không tìm thấy kho "${name}" trong SCM` });
  await sleep(800);
  return picked;
}

// ---------------------------------------------------------------- Xác nhận tạm ứng từ Inside

/** Mở màn Xác nhận tạm ứng, lọc theo kho Inside + Bảo hành v2, mở chi tiết phiếu tạm ứng. Trả id grid chi tiết. */
async function openAdvance(page, advanceCode) {
  await pickStock(page, 'cbbStockInside', { name: config.scmStockName, insideCode: config.erpStock });
  await page.locator('#ckbWarrantyV2').setChecked(config.scmWarrantyV2);
  await page.click('#btnSearchNew');
  await waitUnblocked(page);
  await waitUntil(() => page.evaluate(() => $('#dgInsideTickets').datagrid('getRows').length > 0), {
    timeout: 30000, message: 'Danh sách phiếu tạm ứng không tải được (không có phiếu nào chờ xác nhận?)',
  });
  // Danh sách có thể được nạp lại thêm 1 lần sau khi tìm (dòng đang mở rộng bị đóng, id chi tiết đổi) -> thử lại
  for (let attempt = 1; ; attempt++) {
    await sleep(1500);
    await waitUnblocked(page);
    const subgrid = await page.evaluate((code) => {
      const g = $('#dgInsideTickets');
      const rows = g.datagrid('getRows');
      const i = rows.findIndex((r) => r.RequireId === code);
      if (i < 0) return 'NOT_FOUND';
      // "subgrid" là id dạng chuỗi trước khi mở rộng; mở rộng rồi thì trang thay bằng phần tử DOM
      const sg = rows[i].subgrid;
      const id = typeof sg === 'string' ? sg : $(sg).attr('id');
      g.datagrid('expandRow', i);
      return id;
    }, advanceCode);
    if (subgrid === 'NOT_FOUND') {
      throw new Error(`Không thấy phiếu tạm ứng ${advanceCode} trong danh sách chờ xác nhận (kho ${config.erpStock}) – đã xác nhận rồi?`);
    }
    // Mở rộng dòng -> trang tải chi tiết (che blockUI) rồi vẽ nút
    await waitUnblocked(page);
    const ok = await page.locator(`#${subgrid}-btn-scan-mac`).waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
    if (ok) return subgrid;
    if (attempt >= 3) throw new Error(`Không mở được chi tiết phiếu tạm ứng ${advanceCode}`);
  }
}

/** Đọc 2 lưới trong popup "NHẬP MAC": chủng loại (cần MAC) và danh sách MAC đã nhập. */
function readMacPopup(page) {
  return page.evaluate(() => {
    const win = [...document.querySelectorAll('.window')].find((w) => w.offsetParent !== null && w.querySelector('#btn_add'));
    if (!win) return null;
    // #trackTable: chủng loại cần MAC (Description, Quantity = SL đề nghị, realQuantity = SL thực xuất)
    // #dgMACofInside: MAC đã nhập (DESCRIPTION, MAC)
    return {
      categories: $('#trackTable').datagrid('getRows').map((r) => ({
        name: String(r.Description).trim(), want: Number(r.Quantity) || 0, got: Number(r.realQuantity) || 0,
      })),
      macs: $('#dgMACofInside').datagrid('getRows').map((r) => ({ name: String(r.DESCRIPTION).trim(), mac: String(r.MAC).trim() })),
    };
  });
}

async function openMacPopup(page, subgrid) {
  await waitUnblocked(page);
  await page.locator(`#${subgrid}-btn-scan-mac`).click();
  return waitUntil(async () => {
    const p = await readMacPopup(page);
    return p && p.categories.length ? p : null;
  }, { timeout: 20000, message: 'Không mở được popup Nhập MAC' });
}

const macWindow = (page) => page.locator('.window:visible', { has: page.locator('#btn_add') });

/** Đọc các chủng loại phải nhập MAC của phiếu tạm ứng (không thay đổi gì). */
export async function readMacCategories(advanceCode, onLog) {
  const page = await openScm(config.scmAdvancePath, onLog);
  const subgrid = await openAdvance(page, advanceCode);
  const popup = await openMacPopup(page, subgrid);
  await macWindow(page).locator('a.l-btn').filter({ hasText: /^\s*Đóng\s*$/ }).click();
  return popup.categories.map((c) => ({ ...c, need: Math.max(c.want - c.got, 0) }));
}

/** Bước 6: nhập MAC vào phiếu tạm ứng -> Lưu -> Xác nhận V2. */
export async function confirmAdvance(advanceCode, macs, onLog) {
  const page = await openScm(config.scmAdvancePath, onLog);
  const subgrid = await openAdvance(page, advanceCode);
  let popup = await openMacPopup(page, subgrid);
  const win = macWindow(page);
  const existing = new Set(popup.macs.map((m) => m.mac.toUpperCase()));

  for (const mac of macs.filter((m) => !existing.has(m.toUpperCase()))) {
    await win.locator('textarea:visible').first().fill(mac);
    await page.click('#btn_add');
    await sleep(1500);
    const msg = await messagerText(page);
    if (msg) {
      await closeMessager(page);
      if (!/đã tồn tại trong phiếu/i.test(msg)) throw new Error(`Nhập MAC ${mac} lỗi: ${msg}`);
    }
  }
  popup = await readMacPopup(page);
  const missing = popup.categories.filter((c) => c.got < c.want);
  if (missing.length) {
    throw new Error(`Còn chủng loại thiếu MAC: ${missing.map((c) => `${c.name} ${c.got}/${c.want}`).join(', ')}`);
  }
  onLog(`Nhập MAC: ${popup.macs.map((m) => `${m.name} = ${m.mac}`).join('; ')}`);

  await page.click('#btn_save');
  await waitUntil(async () => !(await win.isVisible()) || (await messagerText(page)), {
    timeout: 30000, message: 'Lưu MAC quá lâu',
  });
  const saveMsg = await messagerText(page);
  if (saveMsg) {
    await closeMessager(page);
    throw new Error(`Lưu MAC lỗi: ${saveMsg}`);
  }
  if (await win.isVisible()) await win.locator('a.l-btn').filter({ hasText: /^\s*Đóng\s*$/ }).click();
  await waitUnblocked(page); // lưới chi tiết tải lại sau khi lưu

  await page.locator(`#${subgrid}-confirm-V2`).click();
  await sleep(3000);
  const confirmMsg = await messagerText(page);
  if (confirmMsg) {
    // Hộp hỏi xác nhận -> đồng ý; thông báo lỗi -> báo lại
    if (/có chắc|xác nhận\?|đồng ý/i.test(confirmMsg)) await closeMessager(page);
    else { await closeMessager(page); throw new Error(`Xác nhận tạm ứng lỗi: ${confirmMsg}`); }
  }
  // Xác nhận xong phiếu biến khỏi danh sách chờ (trang không hiện thông báo)
  await waitUntil(() => page.evaluate((code) => !$('.datagrid-mask:visible').length
    && !$('#dgInsideTickets').datagrid('getRows').some((r) => r.RequireId === code), advanceCode), {
    timeout: 60000, message: `Bấm Xác nhận V2 nhưng phiếu ${advanceCode} vẫn còn trong danh sách chờ`,
  });
  onLog(`Xác nhận tạm ứng ${advanceCode}`);
}

// ---------------------------------------------------------------- Tạo phiếu nhập kho

/** Mã phiếu nhập trên danh sách (lọc theo kho) – để lấy mã phiếu vừa tạo. */
async function listImportCodes(page) {
  await page.evaluate(() => $('#cboStock').combogrid('clear'));
  await pickStock(page, 'cboStock', { name: config.scmStockName });
  await page.click('#btnSearch');
  await waitUnblocked(page);
  return page.evaluate(() => {
    const el = [...document.querySelectorAll('.datagrid-f')].find((e) => {
      try { return $(e).datagrid('getColumnFields').includes('INVOICE_CODE') && !$(e).closest('.window').length; } catch { return false; }
    });
    return el ? $(el).datagrid('getRows').map((r) => r.INVOICE_CODE) : [];
  });
}

/** Dòng vật tư đang ở chế độ sửa (sau mỗi lần Lưu dòng, trang tự chèn 1 dòng trống ở đầu). */
const editingRow = (page) => page.evaluate(() => {
  const g = $('#dg1');
  return g.datagrid('getRows').findIndex((_, i) => g.datagrid('getEditors', i).length > 0);
});

async function setItemCode(page, row, { code, name }) {
  const inputId = await page.evaluate((i) => {
    const t = $($('#dg1').datagrid('getEditor', { index: i, field: 'ITEM_CODE' }).target);
    t.combogrid('showPanel');
    return t.next().find('input.textbox-text').attr('id');
  }, row);
  await page.focus(`#${inputId}`);
  await page.keyboard.type(code || name, { delay: 40 });
  const picked = await waitUntil(() => page.evaluate(([i, code, name]) => {
    const t = $($('#dg1').datagrid('getEditor', { index: i, field: 'ITEM_CODE' }).target);
    const g = t.combogrid('grid');
    const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
    const k = g.datagrid('getRows').findIndex((r) => (code ? r.ITEM_CODE === code : norm(r.ITEM_NAME) === norm(name)));
    if (k < 0) return null;
    const r = g.datagrid('getRows')[k];
    g.datagrid('selectRow', k);
    t.combogrid('hidePanel');
    return `${r.ITEM_CODE} – ${r.ITEM_NAME}`;
  }, [row, code, name]), { timeout: 20000, message: `Không tìm thấy mã hàng cho "${name}"${code ? ` (${code})` : ''} – khai báo ITEM_CODES trong .env` });
  await sleep(1500);
  return picked;
}

/** Nhập MAC cho 1 dòng vật tư. MAC bị SCM báo trùng/đã tồn tại -> thay bằng newMac() (sửa luôn item.macs). */
async function addRowMacs(page, row, item, newMac) {
  await page.locator(`tr.datagrid-row[datagrid-row-index="${row}"] td[field="MAC_SERI"] a[onclick^="showMacSeri"]`).first().click();
  const win = page.locator('.window:visible', { has: page.locator('.panel-title', { hasText: 'QUẢN LÝ THEO MAC' }) }).last();
  await win.waitFor({ timeout: 15000 });
  for (let k = 0; k < item.macs.length; k++) {
    for (let attempt = 1; ; attempt++) {
      await win.locator('textarea:visible').first().fill(item.macs[k]);
      await win.locator('a.l-btn').filter({ hasText: /^\s*Thêm\s*$/ }).first().click();
      await sleep(1500);
      const msg = await messagerText(page);
      if (!msg) break;
      await closeMessager(page);
      if (!/tồn tại|trùng|đã có|exist/i.test(msg) || !newMac || attempt >= 3) throw new Error(`MAC ${item.macs[k]}: ${msg}`);
      item.macs[k] = newMac();
    }
  }
  await win.locator('a.l-btn').filter({ hasText: /^\s*Lưu\s*$/ }).first().click();
  await sleep(1500);
  const msg = await messagerText(page);
  if (msg) { await closeMessager(page); throw new Error(`Lưu MAC lỗi: ${msg}`); }
}

/**
 * Bước 5: tạo phiếu nhập kho (Nhập khác, kho test, Hàng mới) cho các vật tư cần MAC, mỗi vật tư kèm danh sách MAC.
 * items: [{ name, code?, macs: [] }]. Trả mã phiếu nhập.
 */
export async function createImport(items, onLog, newMac) {
  const page = await openScm(config.scmImportPath, onLog);
  const before = new Set(await listImportCodes(page));

  await page.locator('a').filter({ hasText: /^\s*Thêm mới\s*$/ }).first().click();
  const win = page.locator('.window:visible', { has: page.locator('#dg1') }).first();
  await win.waitFor({ timeout: 20000 });
  await sleep(1500);

  await pickComboText(page, 'cboTranType_form', config.scmImportType);
  await pickStock(page, 'cboToStock', { name: config.scmStockName });
  // Đổi kho -> hỏi "thông tin hàng hóa sẽ bị xóa hết" (danh sách đang trống) -> Ok
  if (await messagerText(page)) await closeMessager(page);
  await pickComboText(page, 'cboToZone', config.scmGoodsState);

  await win.locator('a').filter({ hasText: 'Thêm dòng' }).first().click();
  for (const item of items) {
    const row = await waitUntil(async () => { const i = await editingRow(page); return i >= 0 ? i + 1 : 0; }, {
      timeout: 15000, message: 'Không có dòng vật tư để nhập',
    }) - 1;
    const picked = await setItemCode(page, row, item);
    await addRowMacs(page, row, item, newMac);
    await page.locator(`tr.datagrid-row[datagrid-row-index="${row}"] td[field="ACTION"] a[onclick^="saverow"]`).first().click();
    await sleep(2500);
    const msg = await messagerText(page);
    if (msg) { await closeMessager(page); throw new Error(`Lưu dòng ${picked} lỗi: ${msg}`); }
    onLog(`Phiếu nhập: ${picked} – MAC ${item.macs.join(', ')}`);
  }
  // Bỏ dòng trống còn lại (trang tự chèn sau mỗi lần lưu dòng)
  const leftover = await editingRow(page);
  if (leftover >= 0) {
    await page.locator(`tr.datagrid-row[datagrid-row-index="${leftover}"] td[field="ACTION"] a[onclick^="cancelrow"]`).first().click();
    await sleep(800);
  }

  await win.locator('a.l-btn:visible').filter({ hasText: /^\s*Tạo\s*$/ }).click();
  await waitUntil(async () => !(await win.isVisible()) || (await messagerText(page)), { timeout: 60000, message: 'Tạo phiếu nhập quá lâu' });
  const msg = await messagerText(page);
  if (msg && (await win.isVisible())) {
    await closeMessager(page);
    throw new Error(`Tạo phiếu nhập lỗi: ${msg}`);
  }
  const toast = await toastText(page);
  const after = await listImportCodes(page);
  const code = after.find((c) => !before.has(c));
  if (!code) throw new Error(`Đã bấm Tạo (${toast || 'không có thông báo'}) nhưng không thấy phiếu nhập mới trong kho ${config.scmStockName}`);
  return code;
}
