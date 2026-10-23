// Luồng "Thanh toán hoá đơn HĐ" trên staging.fpt.vn/pay:
//   Tra HĐ → tích các khoản thu → Thanh toán (n) → Phương thức khác → Thẻ Quốc Tế / Thẻ Nội địa → Thanh toán → Xác nhận SĐT chủ thẻ
//   → Foxpay: nhập thẻ → OTP (3DS / Napas) → "Thanh toán thành công!" → tra lại HĐ (không còn hoá đơn cần thanh toán).
import { config } from './core/env.js';
import { debugShot, getContext } from './core/browser.js';
import * as fptvn from './systems/fptvn.js';
import * as foxpay from './systems/foxpay.js';

export const METHODS = fptvn.METHODS;

/** "SGABP1, SGABP2\nSGABP3" -> ['SGABP1','SGABP2','SGABP3'] */
export const parseContracts = (s = '') => [...new Set(String(s).toUpperCase().split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean))];

/**
 * Thanh toán 1 HĐ. opts: { contract, method, phone, card: { number, name, date, cvv, otp } }
 * onLog(msg): báo tiến độ; onState(partial): kết quả đang có.
 */
export async function runOne(opts, onLog = () => {}, onState = () => {}) {
  const contract = String(opts.contract || '').trim().toUpperCase();
  if (!contract) throw new Error('Chưa nhập số hợp đồng');
  const method = opts.method || 'intl';
  if (!METHODS[method]) throw new Error(`Phương thức không hỗ trợ: ${method}`);
  const card = { ...config.cards[method], ...Object.fromEntries(Object.entries(opts.card || {}).filter(([, v]) => v)) };
  const phone = opts.phone || config.phone;

  const record = { contract, method: METHODS[method], card: foxpay.maskCard(card.number), startedAt: new Date().toISOString() };
  const set = (patch) => { Object.assign(record, patch); onState({ ...record }); };
  let page;
  try {
    page = await fptvn.openPayPage(onLog);
    const bills = await fptvn.searchContract(page, contract, onLog);
    if (!bills.length) throw new Error(`HĐ ${contract} chưa có hoá đơn cần thanh toán`);
    set({ bills: bills.map((b) => `${b.title} (${b.period}) ${b.amount}`).join('; ') });
    onLog(`[FPT.vn] ${bills.length} khoản: ${record.bills}`);
    const total = await fptvn.selectBills(page, bills);
    set({ amount: total });
    onLog(`[FPT.vn] Đã chọn ${bills.length} khoản – tổng ${total}`);

    await fptvn.checkout(page, { method, phone }, onLog);
    const result = await (method === 'domestic' ? foxpay.payByDomesticCard(page, card, onLog) : foxpay.payByCard(page, card, onLog));
    const gate = method === 'domestic' ? '[Napas]' : '[Foxpay]';
    set({
      gatewayOrder: result.gatewayOrder, gatewayStatus: result.status || '(Napas không có trang kết quả)',
      ...(result.charged && { charged: result.charged }),
    });
    if (result.success === false) throw new Error(`Cổng thanh toán báo không thành công: ${result.status || result.message}`);
    if (result.success) onLog(`${gate} Cổng báo thành công – đơn ${result.gatewayOrder}`);
    const warnings = [];
    if (result.charged && result.txAmount && result.charged !== result.txAmount) {
      warnings.push(`Cổng thu ${result.charged} khác số tiền giao dịch ${result.txAmount}`);
    }

    const paymentCode = await foxpay.waitReturn(page);
    if (paymentCode) set({ paymentCode });
    // Kết luận bằng lần tìm thứ 2: không còn khoản thu = thành công, còn khoản thu = lỗi (cả 2 loại thẻ)
    const left = await fptvn.remainingBills(contract, onLog);
    set({ remaining: left.length ? `Còn ${left.length} khoản (${left.map((b) => b.amount).join(', ')})` : 'Hết khoản thu' });
    if (warnings.length) set({ warnings });
    if (left.length) {
      set({ status: 'Lỗi' });
      throw new Error(`${gate} báo thành công${paymentCode ? ` (paymentCode ${paymentCode})` : ''} nhưng HĐ vẫn còn ${left.length} khoản: `
        + `${left.map((b) => `${b.title} ${b.amount}`).join('; ')}${warnings.length ? ` – ${warnings.join('; ')}` : ''}`);
    }
    set({ status: 'Thành công' });
    onLog(`✔ ${METHODS[method]}: thanh toán thành công, HĐ hết khoản thu`);
    set({ finishedAt: new Date().toISOString() });
    onLog(`✔ ${contract}: ${record.status}`);
    return record;
  } catch (err) {
    const ctx = await getContext().catch(() => null);
    const shot = await debugShot(page || ctx?.pages()[0], `pay-${contract}`);
    set({ error: err.message, finishedAt: new Date().toISOString(), ...(shot && { screenshot: shot }) });
    throw Object.assign(err, { record });
  }
}

/** Thanh toán nhiều HĐ lần lượt; HĐ lỗi không chặn HĐ sau. onRecord(record) gọi sau mỗi HĐ (để lưu). */
export async function runFlow(opts, onLog = () => {}, onState = () => {}, onRecord = () => {}) {
  const contracts = parseContracts(opts.contracts ?? opts.contract);
  if (!contracts.length) throw new Error('Chưa nhập số hợp đồng');
  const results = [];
  const publish = (current) => onState({ results: current ? [...results, current] : [...results] });
  for (const contract of contracts) {
    if (contracts.length > 1) onLog(`—— ${contract} (${results.length + 1}/${contracts.length})`);
    let record;
    try {
      record = await runOne({ ...opts, contract }, onLog, publish);
    } catch (err) {
      record = err.record || { contract, error: err.message };
      onLog(`✖ ${contract}: ${err.message}`);
    }
    results.push(record);
    onRecord(record);
    publish();
  }
  const failed = results.filter((r) => r.error);
  if (failed.length) {
    throw Object.assign(new Error(`${failed.length}/${results.length} HĐ lỗi: ${failed.map((r) => r.contract).join(', ')}`), { record: { results } });
  }
  return { results };
}
