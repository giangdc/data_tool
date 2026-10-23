// Tiện ích điều khiển app Flutter web (Sale Platform): DOM không có chữ, chỉ có canvas.
// - Bấm theo toạ độ (viewport cố định 1440x813, xem core/browser.js)
// - Đọc nhãn qua cây semantics (flt-semantics) – bật bằng cách click flt-semantics-placeholder
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR } from '../core/env.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bật semantics (1 lần / trang) rồi trả về các node có nhãn: {role, label, x, y, w, h}. */
export async function nodes(page) {
  await page.evaluate(() => {
    document.querySelector('flt-semantics-placeholder')?.click();
    // Lớp semantics chỉ để ĐỌC: cho click xuyên xuống canvas (nếu không, vài nút như "Xác nhận" địa chỉ không ăn)
    if (!document.getElementById('sop-tool-sem-css')) {
      const st = document.createElement('style');
      st.id = 'sop-tool-sem-css';
      st.textContent = 'flt-semantics-host, flt-semantics { pointer-events: none !important; }';
      document.head.appendChild(st);
    }
  }).catch(() => {});
  await sleep(300);
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

/** Node đầu tiên có nhãn khớp (chỉ lấy node nằm trong màn hình). */
export async function findNode(page, re) {
  return (await nodes(page)).find((n) => re.test(n.label) && n.y > 0 && n.y < 813);
}

/** Chờ tới khi có node khớp (hoặc hết giờ -> null). */
export async function waitNode(page, re, timeout = 30000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(1000)) {
    const n = await findNode(page, re);
    if (n) return n;
  }
  return null;
}

/** Bấm node theo nhãn; không thấy thì bấm toạ độ dự phòng (nếu có), không có nữa thì ném lỗi. */
export async function tapLabel(page, re, fallback) {
  const n = await findNode(page, re);
  if (n) await page.mouse.click(n.x, n.y);
  else if (fallback) await page.mouse.click(fallback[0], fallback[1]);
  else throw new Error(`Không thấy "${re.source}" trên màn hình`);
  await sleep(1200);
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
    for (const end = Date.now() + wait; Date.now() < end; await sleep(500)) {
      if ((await nodes(page)).some(pred)) return true;
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
