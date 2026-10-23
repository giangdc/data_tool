// Luồng "Giao hàng tại quầy" xuyên 3 hệ thống:
//   Fox ERP  1-4  tìm HĐ → nhận xử lý phiếu → chọn kho + SĐT → đề nghị xuất kho (tạo phiếu tạm ứng)
//   SCM      5-6  tạo phiếu nhập kho có MAC → nhập MAC vào phiếu tạm ứng → Xác nhận V2
//   Fox ERP  7    chọn GHTK → Lưu phiếu → Đóng hàng hoàn tất (tạo vận đơn)
//   GHTK     8-10 webhook Test: đẩy trạng thái (mặc định 5 - Đã giao hàng) → Fox ERP: Giao hàng thành công
// Trạng thái từng bước đọc lại từ phiếu Fox ERP nên chạy lại cùng HĐ sẽ tiếp tục từ bước còn dở.
import { randomBytes } from 'node:crypto';
import { config } from './core/env.js';
import { debugShot, getContext, sleep, waitUntil } from './core/browser.js';
import { recentRuns } from './core/store.js';
import * as erp from './systems/erp.js';
import * as scm from './systems/scm.js';
import { pushStatus, GHTK_STATUSES } from './systems/ghtk.js';

// Chạy tới đâu thì dừng
export const STOP_POINTS = {
  advance: 'Tạo phiếu tạm ứng (Fox ERP bước 1-4)',
  scm: 'Xác nhận tạm ứng (SCM bước 5-6)',
  ship: 'Tạo vận đơn GHTK (Fox ERP bước 7)',
  done: 'Đẩy trạng thái GHTK (bước 8-10)',
};

// "FPT Camera Play 4=AABB…|CCDD…; FPT Camera IQ 4S=EEFF…" <-> [{ name, macs }]
const formatMacs = (items) => items.map((i) => `${i.name}=${i.macs.join('|')}`).join('; ');
const parseMacs = (s = '') => s.split(';').map((p) => p.split('=')).filter(([n, m]) => n && m)
  .map(([name, m]) => ({ name: name.trim(), macs: m.split('|').map((x) => x.trim()).filter(Boolean) }));

/** MAC/serial ngẫu nhiên 12 ký tự hex (SCM nhận 12-43 ký tự hex, không dấu ":"), không trùng MAC trong `used`. */
export function randomMac(used = new Set(), prefix = config.macPrefix) {
  const p = prefix.replace(/[^0-9A-F]/g, '').slice(0, 10);
  for (;;) {
    const mac = p + randomBytes(6).toString('hex').toUpperCase().slice(0, 12 - p.length);
    if (!used.has(mac)) {
      used.add(mac);
      return mac;
    }
  }
}

/** MAC đã dùng ở các lần chạy trước (để không sinh trùng). */
const usedMacs = () => new Set(recentRuns(100000).flatMap((r) => parseMacs(r.macs).flatMap((i) => i.macs)));

function itemCodeFor(name) {
  const key = Object.keys(config.itemCodes).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? config.itemCodes[key] : '';
}

/**
 * opts: { contract, stock, phone, carrier, ghtkStatus, until }
 * onLog(msg): báo tiến độ; onState(partial): cập nhật kết quả đang có (để giao diện hiển thị ngay).
 */
export async function runFlow(opts, onLog = () => {}, onState = () => {}) {
  const o = {
    stock: config.erpStock, phone: config.stockPhone, carrier: config.carrier, ghtkStatus: config.ghtkStatus, until: 'done',
    ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined && v !== '')),
  };
  if (!o.contract) throw new Error('Chưa nhập số hợp đồng');
  if (!STOP_POINTS[o.until]) throw new Error(`"Chạy tới" không hợp lệ: ${o.until}`);
  if (o.until === 'done' && !GHTK_STATUSES[o.ghtkStatus]) throw new Error(`Trạng thái GHTK không hợp lệ: ${o.ghtkStatus}`);
  const contract = o.contract.trim().toUpperCase();

  const record = { contract, startedAt: new Date().toISOString() };
  const set = (patch) => { Object.assign(record, patch); onState({ ...record }); };
  const pick = (t) => ({
    orderCode: t.orderCode, deliveryCode: t.deliveryCode, ticketStatus: t.ticketStatus, deliveryStatus: t.deliveryStatus,
    ...(t.advanceCode && { advanceCode: t.advanceCode }), ...(t.trackingCode && { trackingCode: t.trackingCode }),
  });
  let page;
  let system = config.erpUrl; // hệ thống đang thao tác -> chụp đúng tab khi lỗi

  try {
    // ---- Fox ERP 1-4
    onLog(`[Fox ERP] Tìm HĐ ${contract}`);
    page = await erp.openTicketPage(contract, onLog);
    let t = await erp.selectTicket(page, { onLog });
    set(pick(t));
    onLog(`[Fox ERP] Phiếu ${t.deliveryCode} – mã ĐH ${t.orderCode} – ${t.ticketStatus}`);

    if (t.advanceCode) {
      onLog(`[Fox ERP] Đã có phiếu tạm ứng ${t.advanceCode} – bỏ qua bước 2-4`);
    } else {
      t = await erp.acceptTicket(page, onLog);
      t = await erp.chooseStock(page, { stock: o.stock, phone: o.phone }, onLog);
      const advanceCode = await erp.requestAdvance(page, onLog);
      set({ advanceCode });
      onLog(`[Fox ERP] ✔ Tạo phiếu tạm ứng vật tư ${advanceCode}`);
      t = await erp.reloadTicket(page, record.deliveryCode);
    }
    if (o.until === 'advance') return finish();

    // ---- SCM 5-6
    if (t.advanceConfirmed) {
      onLog('[SCM] Tạm ứng đã được xác nhận – bỏ qua bước 5-6');
    } else {
      system = config.scmUrl;
      // Thiết bị nào cần MAC: SCM quyết định (popup "Nhập MAC" của phiếu tạm ứng chỉ liệt kê chủng loại quản lý MAC).
      // Chỉ ĐỌC popup rồi đóng; thứ tự thao tác vẫn là: tạo phiếu nhập (MAC vào kho) TRƯỚC -> xác nhận tạm ứng SAU.
      let wanted;
      try {
        onLog(`[SCM] Đọc thiết bị cần MAC của phiếu ${record.advanceCode} (chỉ xem, không nhập)`);
        wanted = (await scm.readMacCategories(record.advanceCode, onLog)).filter((c) => c.need > 0);
      } catch (err) {
        // Dự phòng: thiết bị trong lịch sử phiếu có khai trong ITEM_CODES
        onLog(`⚠ Không đọc được từ SCM (${err.message}) – dùng ITEM_CODES trong .env`);
        wanted = t.advanceItems.filter((i) => itemCodeFor(i.name)).map((i) => ({ name: i.name, need: i.qty }));
      }
      const macNames = new Set(wanted.map((w) => w.name.toLowerCase()));
      const others = t.advanceItems.map((i) => i.name).filter((n) => !macNames.has(n.toLowerCase()));
      if (others.length) onLog(`[SCM] Không cần MAC: ${others.join(', ')}`);
      // Mỗi lần chạy luôn tạo phiếu nhập MỚI với MAC mới (không trùng MAC đã dùng ở các lần trước)
      const used = usedMacs();
      const items = wanted.map((c) => ({
        name: c.name, code: itemCodeFor(c.name), equipmentId: c.equipmentId,
        macs: Array.from({ length: c.need }, () => randomMac(used)),
      }));
      let macs = items.flatMap((i) => i.macs);
      if (items.length) {
        set({ macs: formatMacs(items) });
        onLog(`[SCM] Tạo phiếu nhập kho cho ${macs.length} thiết bị: ${record.macs}`);
        const importCode = await scm.createImport(items, onLog, () => randomMac(used));
        // MAC có thể đã được đổi nếu SCM báo trùng
        set({ importCode, macs: formatMacs(items) });
        macs = items.flatMap((i) => i.macs);
        onLog(`[SCM] ✔ Tạo phiếu nhập ${importCode}`);
      } else {
        onLog('[SCM] Phiếu tạm ứng không có vật tư cần MAC');
      }
      await scm.confirmAdvance(record.advanceCode, macs, onLog);
      onLog('[SCM] ✔ Xác nhận tạm ứng – chờ Fox ERP đồng bộ');
      system = config.erpUrl;
      await page.bringToFront();
      t = await erp.waitAdvanceConfirmed(page, record.deliveryCode, onLog);
      set(pick(t));
    }
    if (o.until === 'scm') return finish();

    // ---- Fox ERP 7
    await page.bringToFront();
    if (t.trackingCode) {
      onLog(`[Fox ERP] Đã có vận đơn ${t.trackingCode} – bỏ qua bước 7`);
    } else {
      const trackingCode = await erp.closeAndShip(page, { carrier: o.carrier, deliveryCode: record.deliveryCode }, onLog);
      set({ trackingCode });
      onLog(`[Fox ERP] ✔ Tạo vận đơn ${trackingCode}`);
    }
    t = await erp.reloadTicket(page, record.deliveryCode);
    set(pick(t));
    if (o.until === 'ship') return finish();

    // ---- GHTK 8-10
    const label = GHTK_STATUSES[o.ghtkStatus];
    const seen = (h) => h.split(label).length - 1;
    const before = seen(t.history);
    system = config.ghtkUrl;
    set({ ghtkStatus: await pushStatus(record.trackingCode, o.ghtkStatus, onLog) });
    system = config.erpUrl;
    onLog('[Fox ERP] Chờ nhận trạng thái từ GHTK');
    await page.bringToFront();
    t = await waitUntil(async () => {
      const r = await erp.reloadTicket(page, record.deliveryCode);
      if (seen(r.history) > before) return r;
      await sleep(4000);
      return null;
    }, { timeout: config.syncWaitMs, interval: 0, message: `Quá ${config.syncWaitMs / 1000}s Fox ERP chưa nhận trạng thái từ GHTK` });
    set(pick(t));
    onLog(`[Fox ERP] ✔ Trạng thái phiếu: ${t.ticketStatus} – giao hàng: ${t.deliveryStatus}`);
    return finish(t);
  } catch (err) {
    const ctx = await getContext().catch(() => null);
    const shotPage = system === config.erpUrl ? page : ctx?.pages().find((p) => p.url().startsWith(system));
    const shot = await debugShot(shotPage || page, `flow-${contract}`);
    set({ error: err.message, finishedAt: new Date().toISOString(), ...(shot && { screenshot: shot }) });
    throw Object.assign(err, { record });
  }

  function finish(t) {
    // Lịch sử xử lý sau khi giao thành công có các bước tự động (hoàn ứng, active camera, PHHD) – báo lại nếu lỗi
    const warnings = (t?.history.match(/[^\n]*(KHÔNG thành công|Không tìm thấy)[^\n]*/g) || []).map((s) => s.trim());
    set({ finishedAt: new Date().toISOString(), ...(warnings.length && { warnings }) });
    onLog(`✔ Xong (${STOP_POINTS[o.until]})`);
    return record;
  }
}
