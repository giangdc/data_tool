// Tiện ích điều khiển app Flutter web (Sale Platform): DOM không có chữ, chỉ có canvas.
// - Bấm theo toạ độ (viewport cố định 1440x813, xem core/browser.js)
// - Đọc nhãn qua cây semantics (flt-semantics) – bật bằng cách click flt-semantics-placeholder
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR } from '../core/env.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bật semantics (1 lần / trang) rồi trả về các node có nhãn: {role, label, x, y, w, h}. */
export async function nodes(page) {
  const enabled = await page.evaluate(() => {
    const ph = document.querySelector('flt-semantics-placeholder');
    ph?.click();
    // Lớp semantics chỉ để ĐỌC: cho click xuyên xuống canvas (nếu không, vài nút như "Xác nhận" địa chỉ không ăn)
    if (!document.getElementById('sop-tool-sem-css')) {
      const st = document.createElement('style');
      st.id = 'sop-tool-sem-css';
      st.textContent = 'flt-semantics-host, flt-semantics { pointer-events: none !important; }';
      document.head.appendChild(st);
    }
    return Boolean(ph);
  }).catch(() => false);
  // Vừa bấm placeholder = semantics mới bật, cây chưa dựng xong -> chờ 1 nhịp; đã bật rồi thì đọc ngay
  if (enabled) await sleep(300);
  return page.evaluate(() => [...document.querySelectorAll('flt-semantics')].map((e) => {
    const r = e.getBoundingClientRect();
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    return {
      role: e.getAttribute('role') || '',
      label: (e.getAttribute('aria-label') || own || '').replace(/\n/g, ' / ').trim(),
      x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height),
    };
  }).filter((n) => n.label && n.w > 0 && n.h > 0));
}

/**
 * Ô nhập trong form (kể cả ô chọn dạng dropdown): {name (aria-label, có ô không tên), value, x, y, w, h}, theo thứ tự trên màn hình.
 * Hộp thoại form mở ra hoặc đổi giá trị, Flutter chưa cập nhật cây semantics -> đổi viewport 1px để app dựng lại.
 */
export async function formFields(page, { refresh = true } = {}) {
  // refresh = ép app dựng lại cây semantics (~1,5s) – chỉ cần khi vừa mở hộp thoại / đổi giá trị; sau khi cuộn thì cây tự cập nhật
  if (refresh) {
    const { width, height } = page.viewportSize() || { width: 1440, height: 813 };
    await page.setViewportSize({ width, height: height + 1 });
    await sleep(400);
    await page.setViewportSize({ width, height });
    await sleep(1000);
  }
  await nodes(page);
  const list = await page.evaluate(() => [...document.querySelectorAll('flt-semantics')].flatMap((e) => {
    const i = e.querySelector(':scope > input, :scope > textarea');
    if (!i) return [];
    const r = e.getBoundingClientRect();
    return [{ id: e.id, name: i.getAttribute('aria-label') || '', value: i.value || '', x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }];
  }));
  return list.filter((f) => f.w > 0 && f.h > 0).sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Nút không có nhãn (dấu +, thùng rác, X đóng sheet): {x, y, w, h}. */
export async function plainButtons(page) {
  await nodes(page);
  return page.evaluate(() => [...document.querySelectorAll('flt-semantics[role=button]')].flatMap((e) => {
    if (e.getAttribute('aria-label') || e.textContent.trim()) return [];
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? [{ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }] : [];
  }));
}

/** Node đầu tiên có nhãn khớp (chỉ lấy node nằm trong màn hình). */
export async function findNode(page, re) {
  return (await nodes(page)).find((n) => re.test(n.label) && n.y > 0 && n.y < 813);
}

/** Chờ tới khi có node khớp (hoặc hết giờ -> null). */
export async function waitNode(page, re, timeout = 30000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(300)) {
    const n = await findNode(page, re);
    if (n) return n;
  }
  return null;
}

/** Bấm node theo nhãn; không thấy thì bấm toạ độ dự phòng (nếu có), không có nữa thì ném lỗi. */
export async function tapLabel(page, re, fallback, wait = 1200) {
  const n = await findNode(page, re);
  if (n) await page.mouse.click(n.x, n.y);
  else if (fallback) await page.mouse.click(fallback[0], fallback[1]);
  else throw new Error(`Không thấy "${re.source}" trên màn hình`);
  await sleep(wait);
}

/**
 * Bấm toạ độ rồi chờ màn hình thay đổi; không đổi (app chưa sẵn sàng / bấm hụt) thì bấm lại.
 * Trả về true nếu màn hình đã đổi.
 */
export async function clickUntilChange(page, x, y, { tries = 4, wait = 2500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const before = await page.screenshot().catch(() => null);
    await page.mouse.click(x, y);
    await sleep(wait);
    const after = await page.screenshot().catch(() => null);
    if (!before || !after || !before.equals(after)) return true;
  }
  return false;
}

/** Bấm toạ độ tới khi xuất hiện node thoả điều kiện (app chưa sẵn sàng thì bấm lại). */
export async function clickUntilNode(page, x, y, pred, { tries = 4, wait = 3000 } = {}) {
  for (let i = 0; i < tries; i++) {
    await page.mouse.click(x, y);
    for (const end = Date.now() + wait; Date.now() < end; await sleep(300)) {
      if ((await nodes(page)).some(pred)) return true;
    }
  }
  return false;
}

/**
 * Bấm ô nhập ở (x, y) rồi gõ text. Flutter chỉ tạo <input> thật khi ô đã focus -> chờ có input rồi mới gõ
 * (gõ sớm sẽ mất mấy ký tự đầu), gõ xong kiểm tra giá trị, sai thì xoá gõ lại.
 */
export async function typeInto(page, x, y, text, tries = 3, { delay = 25 } = {}) {
  const value = () => page.evaluate(() => {
    const el = document.activeElement;
    return el && /^(INPUT|TEXTAREA)$/.test(el.tagName) ? el.value : null;
  }).catch(() => null);
  for (let i = 0; i < tries; i++) {
    await page.mouse.click(x, y);
    for (const end = Date.now() + 5000; Date.now() < end && (await value()) === null; ) await sleep(300);
    await sleep(300);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    // Gõ nhanh rồi chờ giá trị khớp (tối đa 1,5s); Flutter rớt ký tự thì lượt sau gõ chậm lại
    await page.keyboard.type(text, { delay: i ? 60 : delay });
    for (const end = Date.now() + 1500; Date.now() < end; await sleep(200)) {
      if ((await value()) === text) return true;
    }
  }
  return false;
}

/** Ảnh chụp từng bước để tra lỗi: output/debug/<runId>-<nn>-<tên>.png */
export function shooter(runId) {
  const dir = path.join(OUTPUT_DIR, 'debug');
  mkdirSync(dir, { recursive: true });
  let n = 0;
  return async (page, name) => {
    const file = path.join(dir, `${runId}-${String(++n).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file }).catch(() => {});
    return file;
  };
}
