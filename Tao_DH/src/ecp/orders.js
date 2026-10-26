// Dịch vụ tạo / tra cứu đơn dùng chung cho UI (server.js) và CLI.
// Token checkout chỉ nằm ở server + output/orders.jsonl, không trả ra trình duyệt.
import { config } from '../core/env.js';
import { EcpClient } from '../core/http.js';
import { saveRecord, readRecords } from '../core/store.js';
import { Locations } from './location.js';
import { parseProductUrl, getProduct, parseOffers, getFcpQuote, parseFcpOffers } from './product.js';
import {
  createCheckout, setAddress, applySelection, checkoutSnapshot, placeOrder, getCheckout, toOrderView, orderStatus,
  toLocation, addressText, noPolicyMessage, NO_POLICY, changePayment, onlineMethods, toPayment,
} from './checkout.js';
import { payByCard, cardsFor, CARD_METHODS } from './payment.js';

export const ORDER_CSV_COLUMNS = ['createdAt', 'env', 'code', 'orderId', 'productCode', 'productName', 'offerLabel', 'extras', 'fullName', 'phone', 'houseType', 'address', 'paymentName', 'total', 'statusLabel', 'sourceUrl'];

export const PAYMENT_CSV_COLUMNS = ['at', 'code', 'paymentCode', 'card', 'result', 'message', 'statusAfter'];

const offerLabel = (o) => `${o.billingTypeName} · ${o.label}`;

const PREPARED_TTL = 30 * 60_000; // checkout chuẩn bị sẵn để lấy PTTT, quá 30 phút thì tạo checkout mới

export class OrderService {
  constructor() {
    this.api = new EcpClient(config.ecpApiUrl, config.clientId, undefined, config.proxy);
    this.locations = new Locations(this.api);
    this.prepared = new Map(); // checkoutId -> { token, slug, source: 'ECP'|'FCP', sourceUrl, product, at }
    this.pending = new Map(); // mã đơn -> { qr } (ảnh QR chỉ giữ trong phiên, không ghi file)
  }

  #tokens() {
    // mã đơn -> token (đơn mới nhất thắng)
    const map = new Map();
    for (const r of readRecords('orders')) if (r.summary?.code && r.token) map.set(r.summary.code, r);
    return map;
  }

  /**
   * Lựa chọn hợp lệ của gói tại địa chỉ: offer (mặc định cái đầu tiên) + dịch vụ bổ sung (mặc định không chọn).
   * Địa chỉ không có chính sách -> ném lỗi code NO_POLICY.
   */
  async #selection(product, addr, offerKey, extras = []) {
    const { offers, addons } = product.source === 'FCP'
      ? parseFcpOffers(await getFcpQuote(this.api, product.slug, toLocation(addr)).catch((err) => (err.status < 500 ? null : Promise.reject(err))))
      : parseOffers((await getProduct(this.api, product.slug, toLocation(addr))).raw);
    if (!offers.length) throw Object.assign(new Error(noPolicyMessage(addr)), { status: 400, code: NO_POLICY });
    const offer = offers.find((o) => o.key === offerKey) ?? offers[0];
    // Bổ sung không còn trong offer mới (đổi chu kỳ) thì bỏ
    const extraSkuIds = [...new Set(extras.map(String))].filter((id) => offer.extras.some((e) => String(e.skuId) === id));
    return { offers, selection: { offer, addons, extraSkuIds } };
  }

  /** Chạy tuần tự theo checkout (UI có thể gửi nhiều cập nhật liên tiếp – tránh address/calculate xen kẽ nhau) */
  #serial(p, fn) {
    const run = (p.queue || Promise.resolve()).then(fn, fn);
    p.queue = run.catch(() => {});
    return run;
  }

  /** Áp địa chỉ + lựa chọn lên checkout đã chuẩn bị -> dữ liệu cho form (chính sách, sản phẩm, bổ sung, PTTT, giá) */
  #configure(p, input) {
    return this.#serial(p, () => this.#doConfigure(p, input));
  }

  async #doConfigure(p, { address, offerKey, extras }) {
    const addr = await this.locations.resolve(address, config.defaults);
    const capi = this.api.withToken(p.token);
    p.at = Date.now();
    try {
      await setAddress(capi, addr, p.source);
      const { offers, selection } = await this.#selection(p.product, addr, offerKey, extras);
      await applySelection(capi, { slug: p.slug, ...selection });
      const { methods, view } = await checkoutSnapshot(capi, p.slug, p.source);
      const { offer, extraSkuIds } = selection;
      return {
        policy: { ok: true },
        address: { ...addr, text: addressText(addr) },
        offers: offers.map(({ extras: ex, gifts, ...o }) => ({ ...o, gifts: gifts.map((g) => g.name) })),
        offerKey: offer.key,
        extras: offer.extras,
        selectedExtras: extraSkuIds,
        gifts: offer.gifts.map((g) => g.name),
        methods,
        items: view?.items || [],
        total: view?.totals,
      };
    } catch (err) {
      if (err.code !== NO_POLICY) throw err;
      return { policy: { ok: false, message: err.message }, address: { ...addr, text: addressText(addr) }, offers: [], extras: [], selectedExtras: [], gifts: [], methods: [], items: [], total: null };
    }
  }

  /** Bước 1: link gói (+ địa chỉ, lựa chọn) -> tạo checkout, trả về gói + chính sách + sản phẩm + bổ sung + PTTT + giá */
  async prepare({ url, address, offerKey, extras } = {}) {
    const { sourceUrl, ...u } = parseProductUrl(url, config.webUrl);
    const { raw, ...product } = await getProduct(this.api, u.slug);
    const { slug, source } = product;
    const { checkoutId, token } = await createCheckout(this.api, { slug, source, sourceUrl, webUrl: config.webUrl });
    this.#gc();
    const p = { token, slug, source, sourceUrl, product, at: Date.now() };
    this.prepared.set(checkoutId, p);
    return { checkoutId, product, sourceUrl, ...(await this.#configure(p, { address, offerKey, extras })) };
  }

  /** Đổi địa chỉ / sản phẩm / bổ sung trên checkout đã chuẩn bị */
  async update({ checkoutId, address, offerKey, extras }) {
    const p = this.prepared.get(checkoutId);
    if (!p) throw Object.assign(new Error('Phiên chuẩn bị đã hết hạn, bấm "Tải gói" lại'), { status: 410 });
    return { checkoutId, ...(await this.#configure(p, { address, offerKey, extras })) };
  }

  /**
   * Bước 2: tạo đơn. Có checkoutId (đã prepare) thì dùng lại, không thì tạo checkout mới từ url.
   * -> { summary, payment: { type: 'none'|'redirect'|'qr', url?, qrImage?, expireSeconds? }, steps, view }
   */
  async create({ checkoutId, url, fullName, phone, address, note, paymentCode, offerKey, extras, user } = {}) {
    let p = checkoutId && this.prepared.get(checkoutId);
    const addr = await this.locations.resolve(address, config.defaults);
    if (!p) {
      const { sourceUrl, ...u } = parseProductUrl(url, config.webUrl);
      const { raw, ...product } = await getProduct(this.api, u.slug);
      const { slug, source } = product;
      // Kiểm tra chính sách trước khi tạo checkout
      await this.#selection(product, addr, offerKey, extras);
      const c = await createCheckout(this.api, { slug, source, sourceUrl, webUrl: config.webUrl });
      p = { token: c.token, slug, source, sourceUrl, product };
      checkoutId = c.checkoutId;
    }
    const { selection } = await this.#selection(p.product, addr, offerKey, extras);
    this.prepared.delete(checkoutId); // 1 checkout chỉ tạo được 1 đơn
    const capi = this.api.withToken(p.token);
    const { steps, method, complete, order } = await this.#serial(p, () => placeOrder(capi, {
      slug: p.slug, source: p.source, fullName, phone, address: addr, note: note ?? config.defaults.note, paymentCode, selection,
    }));
    const { offer, extraSkuIds } = selection;

    const view = toOrderView(order) || { code: complete.order_code, orderId: complete.order_id, ...orderStatus(complete), totals: {} };
    const payment = toPayment(complete);
    if (payment.type === 'qr') this.pending.set(view.code, { qr: payment });

    const summary = {
      createdAt: new Date().toLocaleString('vi-VN'),
      env: config.name,
      createdBy: user || '',
      code: view.code,
      orderId: view.orderId,
      productCode: p.slug,
      source: p.source,
      productName: p.product?.name,
      offerLabel: offerLabel(offer),
      extras: offer.extras.filter((e) => extraSkuIds.includes(String(e.skuId))).map((e) => e.name).join('; '),
      sourceUrl: p.sourceUrl,
      fullName: String(fullName).trim(),
      phone: String(phone).replace(/[\s.]/g, ''),
      houseType: addr.houseType === 'apartment' ? 'Chung cư' : 'Nhà riêng',
      address: view.customer?.address || addressText(addr),
      paymentCode: method.code,
      paymentName: method.name,
      total: view.totals?.final ?? null,
      status: view.status,
      statusLabel: view.label,
    };
    saveRecord('orders', {
      summary,
      token: p.token,
      complete: { status: complete.status, display_type: complete.display_type, redirect_url: complete.redirect_url || '' },
      order: view,
    }, ORDER_CSV_COLUMNS);
    return { summary, payment, steps, view };
  }

  /** Kết quả tự thanh toán gần nhất theo mã đơn (output/payments.jsonl) */
  #payments() {
    const map = new Map();
    for (const r of readRecords('payments')) if (r.summary?.code) map.set(r.summary.code, r.summary);
    return map;
  }

  /**
   * Staging lỗi: thanh toán thẻ thành công nhưng ECP vẫn `recompleting` -> hiện theo kết quả cổng (tool đã tự thanh toán)
   */
  #withGateway(st, pay) {
    if (!st.waitingPayment || pay?.result !== 'success') return st;
    return { ...st, label: 'Đã thanh toán (cổng) · ECP chưa cập nhật', done: true, paid: true, waitingPayment: false, gatewayPaid: true };
  }

  /** Đơn tool đã tạo, còn chờ thanh toán (chưa tự thanh toán thành công) -> { rec, capi } */
  async #waiting(code, action) {
    const rec = this.#tokens().get(code);
    if (!rec) throw Object.assign(new Error(`Không có đơn ${code} trong lịch sử của tool`), { status: 404 });
    const capi = this.api.withToken(rec.token);
    const st = orderStatus(await getCheckout(capi));
    if (!st.waitingPayment) throw Object.assign(new Error(`Đơn ${code} không còn chờ thanh toán (${st.label}) – không ${action} được`), { status: 409 });
    if (this.#payments().get(code)?.result === 'success') throw Object.assign(new Error(`Đơn ${code} đã tự thanh toán thành công trước đó`), { status: 409 });
    return { rec, capi };
  }

  /** Đổi PTTT (hoặc giữ PTTT) + hoàn tất lại -> link/QR mới, ghi bản ghi mới cho đơn (cùng token) */
  async #changePayment(rec, capi, paymentCode) {
    const { method, complete } = await changePayment(capi, rec.summary.productCode, paymentCode, rec.summary.source);
    const summary = { ...rec.summary, paymentCode: method.code, paymentName: method.name, paymentChangedAt: new Date().toLocaleString('vi-VN') };
    const order = toOrderView(await getCheckout(capi).catch(() => null)) || rec.order;
    const r = { summary, token: rec.token, complete: { status: complete.status, display_type: complete.display_type, redirect_url: complete.redirect_url || '' }, order };
    saveRecord('orders', r, ORDER_CSV_COLUMNS);
    const payment = toPayment(complete);
    this.pending.delete(summary.code);
    if (payment.type === 'qr') this.pending.set(summary.code, { qr: payment });
    return { rec: r, payment, method };
  }

  /**
   * Thanh toán lại đơn còn chờ thanh toán với PTTT khác (vd thẻ lỗi -> ATM / VietQR). Chỉ PTTT online.
   * -> { summary, payment, view: orderStatus, canAutoPay }
   */
  async repay(code, { paymentCode } = {}) {
    code = String(code || '').trim().toUpperCase();
    if (!paymentCode) throw Object.assign(new Error('Chọn PTTT để thanh toán lại'), { status: 400 });
    const { rec, capi } = await this.#waiting(code, 'đổi PTTT');
    const r = await this.#changePayment(rec, capi, String(paymentCode).toUpperCase());
    const view = orderStatus(await getCheckout(capi));
    return { summary: r.rec.summary, payment: r.payment, view, canAutoPay: CARD_METHODS.includes(r.method.code) };
  }

  /**
   * Tự thanh toán đơn chờ thanh toán bằng thẻ test (.env) – chỉ Thẻ tín dụng / Thẻ ATM.
   * Nhiều thẻ (CARD_<PTTT>_NUMBER2...): thẻ trước bị từ chối thì tạo link thanh toán mới (cùng PTTT) và thử thẻ sau.
   * -> { code, paymentCode, card, result: success|failed|unknown, message, steps, order: orderStatus sau thanh toán }
   */
  async pay(code, { onStep = () => {} } = {}) {
    code = String(code || '').trim().toUpperCase();
    let { rec, capi } = await this.#waiting(code, 'tự thanh toán');
    const pm = rec.summary.paymentCode;
    if (!CARD_METHODS.includes(pm)) throw Object.assign(new Error(`Tự thanh toán chỉ hỗ trợ Thẻ tín dụng / Thẻ ATM (đơn ${code}: ${rec.summary.paymentName || pm})`), { status: 400 });
    const cards = cardsFor(pm);
    if (!cards.length) throw Object.assign(new Error(`Chưa có thẻ test cho ${pm} trong .env – chạy khao-sat/pay-recorder.js để nhập`), { status: 400 });

    // Đã thử trước đó (link cổng đã dùng / có thể hết hạn ~15 phút) -> lấy link mới
    let fresh = !this.#payments().has(code);
    const steps = [];
    let r;
    let card;
    for (const [i, c] of cards.entries()) {
      card = c;
      const tag = cards.length > 1 ? `Thẻ ${i + 1}/${cards.length} · ` : '';
      const note = (text) => { steps.push({ at: '', text: tag + text }); onStep(tag + text); };
      if (i > 0 || !fresh) {
        note('Tạo link thanh toán mới');
        ({ rec } = await this.#changePayment(rec, capi, pm));
      }
      fresh = false;
      r = await payByCard({ url: rec.complete?.redirect_url, pm, card: c, onStep: (t) => onStep(tag + t) });
      steps.push(...r.steps.map((s) => ({ ...s, text: tag + s.text })));
      if (r.result !== 'failed') break;
      if (i < cards.length - 1) {
        note(`Thẻ ${i + 1} lỗi: ${r.message.slice(0, 120)}`);
        if (!orderStatus(await getCheckout(capi)).waitingPayment) break; // đơn hết hiệu lực -> dừng
      }
    }
    const after = orderStatus(await getCheckout(capi));
    const summary = { at: new Date().toLocaleString('vi-VN'), code, paymentCode: pm, card: `${card.no}/${cards.length}`, result: r.result, message: r.message, statusAfter: after.status };
    saveRecord('payments', { summary, steps, finalUrl: r.finalUrl }, PAYMENT_CSV_COLUMNS);
    return { code, paymentCode: pm, card: summary.card, result: r.result, message: r.message, steps, order: this.#withGateway(after, summary) };
  }

  /** Chi tiết 1 đơn tool đã tạo (đọc mới từ ECP) */
  async detail(code) {
    const rec = this.#tokens().get(String(code).trim().toUpperCase());
    if (!rec) throw Object.assign(new Error(`Không có đơn ${code} trong lịch sử của tool (chỉ xem được đơn do tool tạo)`), { status: 404 });
    const pay = this.#payments().get(rec.summary.code);
    const view = { ...toOrderView(await getCheckout(this.api.withToken(rec.token))) };
    Object.assign(view, this.#withGateway(view, pay));
    const payUrl = view.waitingPayment ? rec.complete?.redirect_url || '' : '';
    // Còn chờ thanh toán -> cho đổi PTTT / thanh toán lại
    const changeMethods = view.waitingPayment ? await onlineMethods(this.api.withToken(rec.token), rec.summary.productCode, rec.summary.source).catch(() => []) : [];
    return { ...view, summary: rec.summary, payUrl, autoPay: pay || null, canAutoPay: view.waitingPayment && CARD_METHODS.includes(rec.summary.paymentCode), changeMethods, qr: view.waitingPayment ? this.pending.get(view.code)?.qr ?? null : null };
  }

  /** Trạng thái nhiều đơn (cột Trạng thái ở bảng kết quả) */
  async statuses(codes = []) {
    const tokens = this.#tokens();
    const pays = this.#payments();
    const list = [...new Set(codes.filter(Boolean))].slice(0, 200);
    const out = [];
    for (let i = 0; i < list.length; i += 5) {
      out.push(...(await Promise.all(list.slice(i, i + 5).map(async (code) => {
        const rec = tokens.get(code);
        if (!rec) return { code, error: 'Không có trong lịch sử tool' };
        try {
          const d = await getCheckout(this.api.withToken(rec.token));
          const st = this.#withGateway(orderStatus(d), pays.get(code));
          return { code, ...st, total: d.summary?.final_amount ?? null, hasPayUrl: Boolean(rec.complete?.redirect_url), canAutoPay: Boolean(st.waitingPayment && CARD_METHODS.includes(rec.summary.paymentCode)) };
        } catch (err) {
          return { code, error: err.message };
        }
      }))));
    }
    return out;
  }

  /** 200 đơn gần nhất (mới -> cũ). Đơn đổi PTTT có nhiều bản ghi -> 1 dòng (bản mới nhất, vị trí lúc tạo) */
  history() {
    const map = new Map();
    for (const r of readRecords('orders')) if (r.summary?.code) map.set(r.summary.code, r.summary); // Map giữ thứ tự lần đầu
    return [...map.values()].slice(-200).reverse();
  }

  #gc() {
    const now = Date.now();
    for (const [id, p] of this.prepared) if (now - p.at > PREPARED_TTL) this.prepared.delete(id);
  }
}
