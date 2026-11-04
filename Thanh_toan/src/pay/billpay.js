// Nghiệp vụ thanh toán khoản thu (dùng chung UI + CLI) – tái hiện luồng trang staging.fpt.vn/pay (khách vãng lai, không đăng nhập):
//   1. customer/contract-info + hi-billing-api/billings-check-by-contract-no  -> thông tin HĐ + danh sách khoản thu
//   2. hi-payment-api/v1/payment/get-list-payment-method                     -> PTTT (VietQR, Thẻ Quốc Tế, Thẻ Nội địa, Zalopay)
//   3. hi-payment-api/v1/payment/create-payment-transaction                  -> orderId (FTELBILLWEB_2_xxx) + link cổng paygateway
//   4. payByCard (Chrome thật, thẻ test .env)                                -> cổng báo kết quả
//   5. check-payment-status-by-code                                          -> PENDING -> SUCCESS (xác nhận thật)
import { randomUUID } from 'node:crypto';
import { config } from '../core/env.js';
import { HiClient } from '../core/http.js';
import { saveRecord, readRecords } from '../core/store.js';
import { cardsFor, payByCard, CARD_METHODS } from './payment.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const formatVnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;

export const STATUS_LABEL = {
  SUCCESS: 'Thành công', PENDING: 'Chờ xử lý', FAILED: 'Thất bại', FAIL: 'Thất bại', CANCEL: 'Đã hủy', CANCELLED: 'Đã hủy', EXPIRED: 'Hết hạn',
};
const METHOD_NAME = { INTERNATIONAL: 'Thẻ Quốc Tế', DOMESTIC: 'Thẻ Nội địa', VIETQR: 'QR-VietQR', ZALO_PAY: 'Ví Zalopay' };
const CSV_COLUMNS = ['time', 'contractNo', 'paymentCode', 'paymentName', 'amount', 'billCount', 'billIds', 'card', 'statusLabel', 'message'];
// Web gửi navigator.platform; giá trị nào cũng được
const PLATFORM = 'Linux x86_64';

export const normContract = (s) => String(s || '').trim().toUpperCase();

export class BillPayService {
  constructor() {
    this.hi = new HiClient(config.hiApiUrl, config.proxy);
    this.v = `/${config.apiVersion}`;
  }

  /** Số HĐ -> { contractNo, contractId, contractName, address, bills[], total, message } */
  async lookup(contractNo) {
    const no = normContract(contractNo);
    if (!/^[A-Z0-9]{6,15}$/.test(no)) throw Object.assign(new Error('Số hợp đồng không hợp lệ (vd SGABP5048)'), { status: 400 });
    const [info, data] = await Promise.all([
      this.hi.post(`${this.v}/customer/contract-info`, { contractNo: no }).catch(() => null),
      this.hi.post(`${this.v}/hi-billing-api/billings-check-by-contract-no`, { contractNo: no }),
    ]);
    const c = info?.contractInfo || {};
    const name = data.contractName || c.contractName || '';
    const bills = (data.billings || []).map((b) => ({
      billNumber: b.billNumber, // = items[].orderCode khi tạo giao dịch
      billNumberId: b.billNumberId,
      title: b.title,
      content: b.content,
      total: b.total,
      totalText: b.totalText || formatVnd(b.total),
      type: b.type,
      receiptType: b.receiptType,
      // Web chỉ cho tick khoản loại RECEIPT (loại khác hiện ô khóa)
      selectable: b.type === 'RECEIPT',
    }));
    return {
      contractNo: data.contractNo || no,
      contractId: data.contractId || c.contractId || '',
      contractName: name,
      address: data.address || c.address || '',
      bills,
      total: bills.filter((b) => b.selectable).reduce((s, b) => s + b.total, 0),
      // Không còn khoản thu -> câu thông báo của web ("... đã thanh toán hết toàn bộ các hoá đơn.")
      message: bills.length ? '' : String(data.content || 'Hợp đồng không có khoản thu cần thanh toán')
        .replace('{contractNo}', data.contractNo || no).replace('{contractName}', name),
    };
  }

  /** Khoản thu được chọn (billNumber hoặc billNumberId; rỗng = tất cả khoản chọn được) -> { contract, bills, amount } */
  async #selected(contractNo, billIds) {
    const contract = await this.lookup(contractNo);
    if (!contract.bills.length) throw Object.assign(new Error(contract.message), { status: 422 });
    const want = (billIds || []).map(String).filter(Boolean);
    const bills = contract.bills.filter((b) => b.selectable && (!want.length || want.includes(b.billNumber) || want.includes(b.billNumberId)));
    const missing = want.filter((id) => !bills.some((b) => b.billNumber === id || b.billNumberId === id));
    if (missing.length) throw Object.assign(new Error(`Không còn khoản thu ${missing.join(', ')} (đã thanh toán / không chọn được) – tra cứu lại`), { status: 409 });
    if (!bills.length) throw Object.assign(new Error('Chưa chọn khoản thu nào'), { status: 400 });
    return { contract, bills, amount: bills.reduce((s, b) => s + b.total, 0) };
  }

  /** PTTT web trả về cho các khoản thu -> [{ id, code, name, provider, group, supported, cards }] (supported = tool tự thanh toán được) */
  async methods(contractNo, billIds) {
    const { bills } = await this.#selected(contractNo, billIds);
    const data = await this.hi.post('/hi-payment-api/v1/payment/get-list-payment-method', {
      receiptType: bills.map((b) => b.receiptType),
      typeBill: bills.map((b) => b.type),
      contractNo: normContract(contractNo),
      platform: PLATFORM,
      paymentType: config.paymentType,
    });
    const list = [];
    for (const group of ['recommended', 'saved', 'other']) {
      for (const m of data?.[group] || []) {
        if (list.some((x) => x.code === m.paymentMethod)) continue;
        list.push({
          id: m.id, code: m.paymentMethod, name: m.title || METHOD_NAME[m.paymentMethod] || m.paymentMethod, provider: m.provider, group,
          supported: CARD_METHODS.includes(m.paymentMethod), cards: cardsFor(m.paymentMethod).length,
        });
      }
    }
    return list;
  }

  /** Tạo giao dịch thanh toán -> { paymentCode, sessionId, url, expireTime } */
  async #createTransaction(contractNo, bills, paymentMethod) {
    const sessionId = randomUUID();
    const amount = bills.reduce((s, b) => s + b.total, 0);
    const data = await this.hi.post('/hi-payment-api/v1/payment/create-payment-transaction', {
      contractNo: normContract(contractNo),
      paymentMethod,
      isCreateAutopay: 0,
      // Web mặc định tick "Liên kết" (lưu thẻ) – tool không liên kết thẻ test
      isTokenization: 0,
      tokenizationId: '',
      paymentType: config.paymentType,
      vouchersPayment: [],
      vouchersService: [],
      amount,
      platform: PLATFORM,
      sessionId,
      items: bills.map((b) => ({ orderCode: b.billNumber, amount: b.total })),
      appVersion: config.appVersion,
      channel: 'WEB',
    });
    const url = data?.presentations?.redirectUrl?.value;
    if (!data?.orderId) throw Object.assign(new Error('Không tạo được giao dịch thanh toán'), { status: 502 });
    return { paymentCode: data.orderId, sessionId, url, expireTime: data.expireTime, amount };
  }

  /** Trạng thái giao dịch -> { status, statusLabel, amount, content, description } */
  async status(paymentCode, sessionId = randomUUID()) {
    const d = await this.hi.post(`${this.v}/hi-payment-api/payment/check-payment-status-by-code`, { paymentCode, sessionId });
    return {
      paymentCode, status: d.status, statusLabel: STATUS_LABEL[d.status] || d.status, amount: d.amount,
      content: d.content, description: d.description_web || d.description,
    };
  }

  /** Chờ trạng thái khác PENDING (cổng báo về Hi hơi trễ) – tối đa ~30s */
  async #waitStatus(paymentCode, sessionId, ms = 30_000) {
    const t0 = Date.now();
    let st = await this.status(paymentCode, sessionId);
    while (st.status === 'PENDING' && Date.now() - t0 < ms) {
      await sleep(3000);
      st = await this.status(paymentCode, sessionId);
    }
    return st;
  }

  /**
   * Thanh toán các khoản thu bằng thẻ test: tạo giao dịch -> tự nhập thẻ -> xác nhận trạng thái.
   * Thẻ bị từ chối -> giao dịch mới + thẻ tiếp theo (CARD_<PTTT>_NUMBER2..). onStep(text) báo tiến trình.
   * -> { summary, steps[], remaining (tra cứu lại sau thanh toán) }
   */
  async pay({ contractNo, billIds, paymentMethod = config.defaults.paymentMethod, onStep = () => {} }) {
    const pm = String(paymentMethod || '').toUpperCase();
    if (!CARD_METHODS.includes(pm)) throw Object.assign(new Error(`Tool chỉ tự thanh toán được ${CARD_METHODS.map((m) => METHOD_NAME[m]).join(' / ')}`), { status: 400 });
    const cards = cardsFor(pm);
    if (!cards.length) throw Object.assign(new Error(`Chưa có thẻ test ${METHOD_NAME[pm]} trong .env (CARD_${pm}_*) – copy các dòng CARD_* từ Tao_DH/.env`), { status: 400 });

    const { contract, bills, amount } = await this.#selected(contractNo, billIds);
    const steps = [];
    const at = Date.now();
    const step = (text) => { steps.push({ at: ((Date.now() - at) / 1000).toFixed(1), text }); onStep(text); };
    step(`${contract.contractNo}: ${bills.length} khoản thu, ${formatVnd(amount)} – ${METHOD_NAME[pm]}`);

    let tx;
    let pay;
    let st;
    let cardNo = 0;
    for (const card of cards) {
      cardNo++;
      tx = await this.#createTransaction(contract.contractNo, bills, pm);
      step(`Tạo giao dịch ${tx.paymentCode}${cards.length > 1 ? ` (thẻ ${cardNo}/${cards.length})` : ''}`);
      if (!tx.url) throw Object.assign(new Error(`Giao dịch ${tx.paymentCode} không có link thanh toán`), { status: 502 });
      pay = await payByCard({ url: tx.url, pm, card, onStep: step });
      if (pay.result === 'failed') {
        step(`Thẻ ${cardNo} không thanh toán được: ${pay.message}`);
        continue;
      }
      step('Kiểm tra trạng thái giao dịch');
      st = await this.#waitStatus(tx.paymentCode, tx.sessionId);
      step(`Trạng thái: ${st.statusLabel}${st.description ? ` – ${st.description}` : ''}`);
      break;
    }
    st ||= await this.status(tx.paymentCode, tx.sessionId).catch(() => null);

    const result = st?.status === 'SUCCESS' ? 'success' : pay?.result === 'failed' || /FAIL|CANCEL|EXPIRED/.test(st?.status || '') ? 'failed' : 'unknown';
    const remaining = await this.lookup(contract.contractNo).catch(() => null);
    const summary = {
      time: new Date().toLocaleString('sv-SE'),
      contractNo: contract.contractNo,
      contractName: contract.contractName,
      paymentCode: tx.paymentCode,
      paymentMethod: pm,
      paymentName: METHOD_NAME[pm],
      amount,
      amountText: formatVnd(amount),
      billCount: bills.length,
      billIds: bills.map((b) => b.billNumberId).join(' '),
      card: `${cardNo}/${cards.length}`,
      result,
      status: st?.status || '',
      statusLabel: st?.statusLabel || (result === 'failed' ? 'Thất bại' : 'Chưa rõ'),
      message: result === 'success' ? 'Thanh toán thành công' : pay?.message || st?.description || '',
    };
    saveRecord('payments', { summary, bills, steps }, CSV_COLUMNS);
    return { summary, bills, steps, remaining };
  }

  /** Cập nhật trạng thái nhiều giao dịch -> [{paymentCode, status, statusLabel, ...}] */
  async statuses(codes) {
    return Promise.all(codes.map((c) => this.status(c).catch((e) => ({ paymentCode: c, status: 'ERROR', statusLabel: 'Lỗi', description: e.message }))));
  }

  /** Lịch sử giao dịch đã chạy (mới -> cũ) */
  history() {
    return readRecords('payments').reverse().map((r) => ({ ...r.summary, bills: r.bills }));
  }
}
