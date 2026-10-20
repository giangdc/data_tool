// Nghiệp vụ dùng chung UI + CLI: tải gói (theo tài khoản) -> tạo giao dịch -> tự thanh toán thẻ test -> trạng thái / lịch sử.
// API (khảo sát 19/10, khao-sat/KHAO_SAT.md):
//   GET  paymentgw/packages/detail {plan_type, from_source, X-Agent, is_wap}  -> data_display.plan_detail[] (plan_id, kỳ hạn, giá, payment_gateway[])
//   POST paymentgw/coupon/check {plan_id, coupon}
//   POST paymentgw/payment_hub/create_transaction {plan_id, payment_gateway_code, display_mode, return_url, coupon_code...}
//        -> msg_data {trans_id, display_mode, value_display (link cổng | QR), expire_time}
//   GET  paymentgw/payment_hub/check_transaction {trans_id, payment_gateway_code} -> msg_data.status_code (PENDING...)
import { config } from '../core/env.js';
import { ApiError } from '../core/http.js';
import { readRecords, saveRecord } from '../core/store.js';
import { session, normalizePhone } from './auth.js';
import { payByCard, cardsFor, CARD_METHODS } from './payment.js';

const KIND = 'orders';
const COLUMNS = ['createdAt', 'code', 'phone', 'planName', 'planType', 'planId', 'offerLabel', 'total', 'coupon', 'paymentCode', 'paymentName', 'statusLabel', 'payResult'];

const STATUS_LABEL = {
  PENDING: 'Chờ thanh toán',
  PROCESSING: 'Đang xử lý',
  SUCCESS: 'Đã thanh toán',
  SUCCEEDED: 'Đã thanh toán',
  COMPLETED: 'Đã thanh toán',
  FAILED: 'Thanh toán lỗi',
  FAIL: 'Thanh toán lỗi',
  CANCELLED: 'Đã hủy',
  CANCEL: 'Đã hủy',
  EXPIRED: 'Hết hạn',
};
const PAID = /^(SUCCESS|SUCCEEDED|COMPLETED|PAID|1)$/i;
export const statusLabel = (code) => STATUS_LABEL[String(code || '').toUpperCase()] || code || '—';

const vnd = (n) => (Number(n) || 0).toLocaleString('vi-VN') + '₫';
const parseVnd = (s) => Number(String(s || '').replace(/\D/g, '')) || 0;

/** Link gói | slug -> { planType, fromSource } (vd https://dev.fptplay.vn/dich-vu/v-vip2?from_source=main) */
export function parsePlanUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw Object.assign(new Error('Thiếu link gói (vd https://dev.fptplay.vn/dich-vu/v-vip2)'), { status: 400 });
  if (!/^https?:/i.test(raw)) return { planType: raw.replace(/^\/|\/$/g, ''), fromSource: 'main' };
  const u = new URL(raw);
  const m = u.pathname.match(/\/dich-vu\/([^/]+)\/?$/);
  if (!m || m[1] === 'thanh-toan') throw Object.assign(new Error('Link gói cần dạng .../dich-vu/<mã gói>'), { status: 400 });
  return { planType: decodeURIComponent(m[1]), fromSource: u.searchParams.get('from_source') || 'main' };
}

/** Link quay về sau thanh toán = trang kết quả của web theo slug PTTT */
const returnUrl = (slug) => `${config.webUrl}/dich-vu/thanh-toan/${slug}`;

export class OrderService {
  /** SĐT + gói -> tài khoản, các kỳ hạn (offers) + PTTT của từng kỳ hạn */
  async prepare({ url, phone, otp, onStep } = {}) {
    phone = normalizePhone(phone || config.defaults.phone);
    const { planType, fromSource } = parsePlanUrl(url || config.defaults.url);
    const s = await session(phone, { otp, onStep });
    const [detail, benefit] = await Promise.all([
      s.client.get('paymentgw/packages/detail', { from_source: fromSource, plan_type: planType, 'X-Agent': 'web-playfpt', is_wap: 0 }),
      s.client.get('customergw/fetch_user_benefits').catch(() => null),
    ]);
    const md = detail.msg_data || {};
    const dd = md.data_display || {};
    const offers = (dd.plan_detail || []).map((p) => ({
      planId: String(p.plan_id),
      planType: p.plan_type || planType,
      label: p.display_value || `${p.value} ngày`,
      days: p.value,
      priceText: p.price,
      price: parseVnd(p.promotion_price) || parseVnd(p.price),
      originalPrice: p.original_price || '',
      promotionNote: p.promotion_note || '',
      methods: (p.payment_gateway || []).map((g) => ({
        slug: g.slug,
        code: g.payment_gateway_code || g.slug,
        name: g.name,
        icon: g.url_icon || '',
        note: g.promotion_info || '',
        autoRenew: !!g.is_auto_pay,
        nextPaymentDate: g.next_payment_date || '',
        displayMode: g.display_mode?.displayMode || 'REDIRECT_URL',
        hub: g.is_paymenthub_gateway !== false,
        autoPay: CARD_METHODS.includes(g.payment_gateway_code) && cardsFor(g.payment_gateway_code).length > 0,
      })),
    }));
    let blocked = '';
    if (!offers.length) blocked = md.error_message || md.title_error_message || detail.msg_content || 'Gói không có kỳ hạn nào để mua với tài khoản này';
    else if (dd.is_internet === 1) blocked = 'Gói kèm lắp đặt Internet (cần địa chỉ) – tool chưa hỗ trợ';
    return {
      phone,
      account: { ...s.user, benefit: benefit?.msg_data?.benefit_info || '' },
      plan: { planType, fromSource, name: dd.plan_name || planType, icon: dd.icon || '', note: dd.note || '', vatNote: dd.note_vat || '', typeDisplay: md.type_display, case: detail.msg_content },
      offers,
      blocked,
    };
  }

  /** Mã giảm giá -> { ok, message, discount } */
  async checkCoupon({ phone, planId, coupon }) {
    const s = await session(phone || config.defaults.phone);
    try {
      const r = await s.client.post('paymentgw/coupon/check', { plan_id: String(planId), coupon });
      return { ok: !!r.status, message: r.msg || r.msg_content || '', discount: r.msg_data?.discount_amount || 0, price: r.msg_data?.applyCouponPrice || '' };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  /**
   * Tạo 1 giao dịch mua gói.
   * input: { url, phone, planId?, paymentCode?, coupon? } (mặc định kỳ hạn đầu tiên + PTTT đầu tiên)
   * -> { summary, payment: {type: redirect|qr|none, url?, qrImage?, expireAt}, canAutoPay }
   */
  async create({ url, phone, planId, paymentCode, coupon, otp, onStep } = {}) {
    const p = await this.prepare({ url, phone, otp, onStep });
    if (p.blocked) throw Object.assign(new Error(p.blocked), { status: 422 });
    const offer = planId ? p.offers.find((o) => o.planId === String(planId)) : p.offers[0];
    if (!offer) throw Object.assign(new Error(`Kỳ hạn plan_id=${planId} không có trong gói ${p.plan.planType}`), { status: 400 });
    const code = paymentCode && String(paymentCode).trim();
    const method = code ? offer.methods.find((m) => [m.code, m.slug].some((x) => x.toUpperCase() === code.toUpperCase())) : offer.methods[0];
    if (!method) throw Object.assign(new Error(`PTTT "${code}" không có cho kỳ hạn ${offer.label}. Có: ${offer.methods.map((m) => m.code).join(', ')}`), { status: 400 });
    if (!method.hub) throw Object.assign(new Error(`PTTT ${method.name} không đi qua payment hub – tool chưa hỗ trợ`), { status: 422 });

    const s = await session(p.phone);
    onStep?.(`Tạo giao dịch ${p.plan.name} · ${offer.label} · ${method.name}`);
    const r = await s.client.post('paymentgw/payment_hub/create_transaction', {
      number: '', cvv: '', month: '', year: '',
      plan_id: Number(offer.planId),
      coupon_code: coupon || '',
      payment_gateway_code: method.code,
      display_mode: method.displayMode,
      affiliate_source: '',
      traffic_id: '',
      return_url: returnUrl(method.slug),
      is_invoice_required: 0,
      full_address: '', full_name: '', email: '', tax_code: '',
      x_agent_consumption: '', x_did_consumption: '',
    });
    const md = r.msg_data || {};
    const transId = md.trans_id || md.order_id;
    if (!transId) throw new ApiError(`Không tạo được giao dịch: ${r.msg_content || 'thiếu trans_id'}`, { status: 502, body: r });
    const mode = md.display_mode || method.displayMode;
    const payment = paymentView(mode, md);

    const summary = {
      createdAt: new Date().toLocaleString('sv-SE'),
      code: transId,
      phone: p.phone,
      phoneMask: p.account.phoneMask,
      planName: p.plan.name,
      planType: p.plan.planType,
      planId: offer.planId,
      offerLabel: offer.label,
      total: offer.price,
      coupon: coupon || '',
      paymentCode: method.code,
      paymentSlug: method.slug,
      paymentName: method.name,
      autoRenew: method.autoRenew,
      displayMode: mode,
      status: 'PENDING',
      statusLabel: statusLabel('PENDING'),
      payResult: '',
    };
    saveRecord(KIND, { summary, payment: { ...payment, qrImage: undefined }, url: url || config.defaults.url }, COLUMNS);
    return { summary, payment, canAutoPay: payment.type === 'redirect' && cardsFor(method.code).length > 0 };
  }

  /** Bản ghi mới nhất theo mã giao dịch (trong output/orders.jsonl) */
  #record(code) {
    const rec = readRecords(KIND).filter((r) => r.summary?.code === code).pop();
    if (!rec) throw Object.assign(new Error(`Không thấy giao dịch ${code} (chỉ xem được giao dịch do tool tạo)`), { status: 404 });
    return rec;
  }

  /** Trạng thái 1 giao dịch (check_transaction) */
  async #check(rec) {
    const s = await session(rec.summary.phone);
    const r = await s.client.get('paymentgw/payment_hub/check_transaction', { trans_id: rec.summary.code, payment_gateway_code: rec.summary.paymentCode });
    const md = r.msg_data || {};
    const st = String(md.status_code ?? '').toUpperCase() || 'UNKNOWN';
    return { status: st, label: statusLabel(st), paid: PAID.test(st), amount: md.amount, description: md.description || '' };
  }

  async statuses(codes) {
    return Promise.all(codes.map(async (code) => {
      try {
        const rec = this.#record(code);
        const st = await this.#check(rec);
        return { code, ...st, payResult: rec.summary.payResult || '', canAutoPay: !st.paid && rec.payment?.type === 'redirect' && cardsFor(rec.summary.paymentCode).length > 0 };
      } catch (err) {
        return { code, error: err.message };
      }
    }));
  }

  /** Chi tiết: bản ghi + trạng thái + gói đang có của tài khoản (get_user_packages theo plan_type) */
  async detail(code) {
    const rec = this.#record(code);
    const s = await session(rec.summary.phone);
    const [st, pk, subs] = await Promise.all([
      this.#check(rec).catch((err) => ({ status: 'ERROR', label: err.message })),
      s.client.get('payment/get_user_packages').catch(() => null),
      s.client.get('paymentgw/subscription/user_subscriptions').catch(() => null),
    ]);
    const owned = (pk?.packages || []).filter((x) => x.plan_type === rec.summary.planType)
      .map((x) => ({ name: x.name, planId: x.plan_id, expiredDate: x.expired_date, message: x.msg }));
    const subscriptions = (subs?.list || []).filter((x) => x.plan_type === rec.summary.planType)
      .map((x) => ({ planName: x.plan_name, status: x.status, nextPaymentDate: x.next_payment_date, method: x.name, price: x.price_display }));
    return {
      summary: rec.summary,
      payment: rec.payment,
      status: st,
      owned,
      subscriptions,
      canAutoPay: !st.paid && rec.payment?.type === 'redirect' && cardsFor(rec.summary.paymentCode).length > 0,
    };
  }

  /**
   * Tự thanh toán giao dịch bằng thẻ test (Chrome thật). Link cũ đã dùng/hết hạn hoặc thẻ trước bị từ chối
   * -> tạo giao dịch MỚI (cùng gói, kỳ hạn, PTTT) cho lần thử sau.
   * -> { code (mã cuối cùng), codes[], paymentCode, card, result, message, steps[], status }
   */
  async pay(code, { onStep = () => {} } = {}) {
    let rec = this.#record(code);
    const pm = rec.summary.paymentCode;
    if (!CARD_METHODS.includes(pm)) throw Object.assign(new Error(`Tự thanh toán chỉ hỗ trợ ${CARD_METHODS.join(' / ')} (giao dịch dùng ${pm})`), { status: 400 });
    const cards = cardsFor(pm);
    if (!cards.length) throw Object.assign(new Error(`Chưa có thẻ test CARD_${pm}_* trong .env`), { status: 400 });
    const first = await this.#check(rec);
    if (first.paid) throw Object.assign(new Error(`${code} đã thanh toán`), { status: 409 });

    const codes = [code];
    let last;
    for (let i = 0; i < cards.length; i++) {
      const expired = Number(rec.payment?.expireAt) && Number(rec.payment.expireAt) * 1000 < Date.now() + 60_000;
      if (i > 0 || rec.summary.payResult || expired) {
        onStep(i > 0 ? `Thẻ ${cards[i - 1].no} lỗi → tạo giao dịch mới cho thẻ ${cards[i].no}` : 'Link thanh toán cũ đã dùng/hết hạn → tạo giao dịch mới');
        const r = await this.create({ url: rec.url, phone: rec.summary.phone, planId: rec.summary.planId, paymentCode: pm, coupon: rec.summary.coupon });
        rec = this.#record(r.summary.code);
        codes.push(r.summary.code);
      }
      onStep(`Thẻ ${cards[i].no}/${cards.length} · giao dịch ${rec.summary.code}`);
      last = await payByCard({ url: rec.payment.url, pm, card: cards[i], onStep });
      // Đối chiếu trạng thái thật trên hệ thống FPT Play (cổng có thể báo thành công trước khi hub cập nhật)
      let st = await this.#check(rec).catch(() => null);
      for (let k = 0; k < 6 && last.result === 'success' && st && !st.paid; k++) {
        await new Promise((r) => setTimeout(r, 2500));
        st = await this.#check(rec).catch(() => st);
      }
      const summary = { ...rec.summary, status: st?.status || rec.summary.status, statusLabel: st?.label || rec.summary.statusLabel, payResult: last.result, paidAt: new Date().toLocaleString('sv-SE'), ...(st?.amount !== undefined && { paidAmount: st.amount }) };
      saveRecord(KIND, { ...rec, summary }, COLUMNS);
      rec = { ...rec, summary };
      if (last.result === 'success' || st?.paid) {
        return { code: rec.summary.code, codes, paymentCode: pm, card: `${cards[i].no}/${cards.length}`, result: 'success', message: last.message, steps: last.steps, status: st };
      }
    }
    return { code: rec.summary.code, codes, paymentCode: pm, card: `${cards.at(-1).no}/${cards.length}`, result: last.result, message: last.message, steps: last.steps, status: await this.#check(rec).catch(() => null) };
  }

  /** Lịch sử: bản ghi mới nhất mỗi mã, mới -> cũ */
  history() {
    const map = new Map();
    for (const r of readRecords(KIND)) if (r.summary?.code) map.set(r.summary.code, r.summary);
    return [...map.values()].reverse();
  }
}

function paymentView(mode, md) {
  const v = md.value_display || '';
  const expireAt = md.expire_time || '';
  if (/QR/.test(mode)) {
    const img = /^(data:|https?:)/.test(v) ? v : v ? `data:image/png;base64,${v}` : '';
    return { type: 'qr', qrImage: img, expireAt };
  }
  if (v) return { type: 'redirect', url: v, expireAt };
  return { type: 'none', expireAt };
}

export { vnd };
