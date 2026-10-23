// Luồng "Giao hàng NCU (Vendor)" trên Fox ERP – app Quản lý NCU:
//   Giao hàng, triển khai NCU → tab Quản lý phiếu giao hàng → tìm phiếu theo mã đơn hàng FTEL
//   Chưa giao hàng → Đang giao hàng (popup Xác nhận giao hàng: hoá đơn NCU, ngày HĐ, tệp hoá đơn điện tử, hoá đơn FTEL)
//   Đang giao hàng → Đã hoàn tất
// Trạng thái đọc lại từ danh sách nên chạy lại cùng mã sẽ tiếp tục từ bước còn dở.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config, OUTPUT_DIR } from './core/env.js';
import { debugShot, getContext } from './core/browser.js';
import * as vendor from './systems/vendor.js';

// Chạy tới tình trạng nào thì dừng
export const TARGETS = {
  shipping: vendor.STATUSES.shipping,
  done: vendor.STATUSES.done,
};

const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};
const fill = (template, code) => template.replaceAll('{code}', code);

/** File PDF 1 trang tối giản làm "hoá đơn điện tử" test. */
function testInvoicePdf(code) {
  const dir = path.join(OUTPUT_DIR, 'invoices');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `hoa-don-test-${code}.pdf`);
  if (existsSync(file)) return file;
  const text = `BT /F1 14 Tf 20 50 Td (HOA DON TEST - ${code.replace(/[()\\]/g, '')}) Tj ET`;
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 360 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${text.length}>>stream\n${text}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(file, out, 'latin1');
  return file;
}

/** "SGK1, SGK2\nSGK3" -> ['SGK1','SGK2','SGK3'] */
export const parseCodes = (s = '') => [...new Set(String(s).split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean))];

/**
 * Chạy 1 mã. opts: { code, target, invoiceNcu, invoiceDate, invoiceFtel, invoiceFile }
 * onLog(msg): báo tiến độ; onState(partial): kết quả đang có.
 */
export async function runOne(opts, onLog = () => {}, onState = () => {}) {
  const code = String(opts.code || '').trim();
  if (!code) throw new Error('Chưa nhập mã đơn hàng');
  const target = opts.target || 'done';
  if (!TARGETS[target]) throw new Error(`"Chạy tới" không hợp lệ: ${target}`);

  const record = { orderCode: code, target: TARGETS[target], startedAt: new Date().toISOString() };
  const set = (patch) => { Object.assign(record, patch); onState({ ...record }); };
  const invoiceFile = opts.invoiceFile || config.invoiceFile || testInvoicePdf(code);
  if (!existsSync(invoiceFile)) throw new Error(`Không thấy tệp hoá đơn: ${invoiceFile}`);
  const invoice = {
    ncu: fill(opts.invoiceNcu || config.invoiceNcu, code),
    date: opts.invoiceDate || '',
    ftel: fill(opts.invoiceFtel ?? config.invoiceFtel, code),
    file: invoiceFile,
    fileName: path.basename(invoiceFile),
  };
  let page;
  try {
    onLog(`[Fox ERP] Tìm phiếu giao hàng ${code}`);
    page = await vendor.openDeliveryPage(onLog);
    await vendor.openList(page, onLog);
    let first = true;
    const info = await vendor.advanceTicket(page, code, { target, invoice }, onLog, (i) => {
      set({
        supplier: i.supplier, poCode: i.poCode, pghCode: i.pghCode, customer: i.customer, status: i.status,
        ...(first && { statusBefore: i.status }),
      });
      first = false;
    });
    if (record.statusBefore === vendor.STATUSES.pending) {
      set({ invoiceNcu: invoice.ncu, invoiceDate: invoice.date || today(), invoiceFtel: invoice.ftel, invoiceFile: invoice.fileName });
    }
    set({ status: info.status, finishedAt: new Date().toISOString() });
    onLog(`✔ ${code}: ${info.status}`);
    return record;
  } catch (err) {
    const ctx = await getContext().catch(() => null);
    const shot = await debugShot(page || ctx?.pages()[0], `flow-${code}`);
    set({ error: err.message, finishedAt: new Date().toISOString(), ...(shot && { screenshot: shot }) });
    throw Object.assign(err, { record });
  }
}

/** Chạy nhiều mã lần lượt; mã lỗi không chặn mã sau. onRecord(record) gọi sau mỗi mã (để lưu). */
export async function runFlow(opts, onLog = () => {}, onState = () => {}, onRecord = () => {}) {
  const codes = parseCodes(opts.codes ?? opts.code);
  if (!codes.length) throw new Error('Chưa nhập mã đơn hàng');
  const results = [];
  const publish = (current) => onState({ results: current ? [...results, current] : [...results] });
  for (const code of codes) {
    if (codes.length > 1) onLog(`—— ${code} (${results.length + 1}/${codes.length})`);
    let record;
    try {
      record = await runOne({ ...opts, code }, onLog, publish);
    } catch (err) {
      record = err.record || { orderCode: code, error: err.message };
      onLog(`✖ ${code}: ${err.message}`);
    }
    results.push(record);
    onRecord(record);
    publish();
  }
  const failed = results.filter((r) => r.error);
  if (failed.length) {
    throw Object.assign(new Error(`${failed.length}/${results.length} mã lỗi: ${failed.map((r) => r.orderCode).join(', ')}`), { record: { results } });
  }
  return { results };
}
