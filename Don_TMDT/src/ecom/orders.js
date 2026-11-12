// Nghiệp vụ tạo đơn TMĐT (TikTok / Shopee) trên SPF Web Admin – trang Ecomercial/OrderECPlatform. Dùng chung UI + CLI.
//   Tab "Cập nhật chính sách": tra đơn theo RefCode (OrderECPlatform) -> Thử lại (RetryOrderECPlatform + OrderId) / Ngắt kết nối (ConnectOrderEcom)
//   Tab "Cập nhật địa chỉ/SDT": Load RefCode (GetOrderDetailByEcom) -> địa chỉ (MasterData) -> tạo đơn (RetryOrderECPlatform + địa chỉ)
import { SETTLE_INSTANCE, SOURCES } from '../../config/environments.js';
import { config, saveDefaults } from '../core/env.js';
import { ApiError, spf } from '../core/spf.js';
import { readRecords, saveRecord } from '../core/store.js';

export const CSV_COLUMNS = ['time', 'source', 'refCode', 'mode', 'orderId', 'orderCode', 'regCode', 'contract', 'phone', 'address', 'sku', 'total', 'paymentStatus', 'detailUrl'];
const KIND = 'orders';
export const SETTLE_COLUMNS = ['time', 'source', 'orderId', 'orderCode', 'refCode', 'actionCode', 'taskCodes', 'tasks', 'replicate', 'paymentStatus', 'detailUrl'];
const SETTLE_KIND = 'settle';

export function normSource(s) {
  const k = Object.keys(SOURCES).find((x) => x.toLowerCase() === String(s || config.defaults.source).trim().toLowerCase());
  if (!k) throw new ApiError(`Nguồn "${s}" không hỗ trợ. Có: ${Object.keys(SOURCES).join(', ')}`, 400);
  return k;
}
const normRef = (r) => {
  const v = String(r || '').trim();
  if (!v) throw new ApiError('Chưa nhập RefCode', 400);
  return v;
};
const normPhone = (p) => {
  const v = String(p || '').replace(/[^\d]/g, '').replace(/^84(?=\d{9}$)/, '0');
  if (!/^0\d{9}$/.test(v)) throw new ApiError(`SĐT "${p}" không hợp lệ (cần 10 số, bắt đầu bằng 0)`, 400);
  return v;
};
const decode = (s) => String(s ?? '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
// Lỗi "mềm" (không thấy đơn trên sàn...) hiện ra nhưng vẫn làm tiếp; hết phiên (401) thì báo hẳn
const softError = (e) => {
  if (e.status === 401) throw e;
  return { error: e.message };
};
export const detailUrl = (orderId) => `${config.baseUrl}${config.basePath}/order/detail?OrderId=${orderId}`;
const vnd = (n) => (n == null || n === '' ? '' : `${Number(n).toLocaleString('vi-VN')}đ`);

/** 1 dòng ở tab Cập nhật chính sách -> dạng gọn */
function toRow(r) {
  return {
    orderId: r.orderId, orderCode: r.orderCode, orderType: r.orderType, regCode: r.regCode, contract: r.contract,
    saleChannel: r.saleChannel, saleTeam: r.saleTeam, saleTeamId: r.saleTeamID, source: r.saleTeamID === 130 ? 'Shopee' : 'Tiktok',
    refCode: r.refCode, phone: r.phone, createdBy: r.createdBy, createdDate: r.createdDate,
    total: r.totalVat, totalText: vnd(r.totalVat), paymentStatus: r.paymentStatus, paymentType: r.paymentTypeName,
    canRetry: Boolean(r.isRetryCreateOrder), canDisconnect: Boolean(r.isDisconnectOrder), canConnect: Boolean(r.isConnectOrder),
    detailUrl: detailUrl(r.orderId),
  };
}

export class EcomService {
  #provinces = null;

  // ---------- phiên ----------
  session() {
    return { loggedIn: spf.hasSession, hasToken: spf.hasToken, loginAt: spf.loginAt };
  }
  async login(token) {
    await spf.login(token);
    return this.session();
  }
  logout() {
    spf.logout();
    return this.session();
  }

  // ---------- địa chỉ ----------
  async provinces() {
    if (this.#provinces) return this.#provinces;
    const html = await spf.request('/Ecomercial/OrderECPlatform', { method: 'GET', raw: true });
    const sel = html.match(/<select[^>]+id="slLocation"[\s\S]*?<\/select>/)?.[0] || '';
    const list = [...sel.matchAll(/<option value="(\d+)">([^<]*)<\/option>/g)].map((m) => ({ id: Number(m[1]), name: decode(m[2]).trim() }));
    if (!list.length) throw new ApiError('Không đọc được danh sách Tỉnh/TP từ SPF Web Admin', 502);
    return (this.#provinces = list);
  }
  async districts(locationId) {
    return (await spf.request('/MasterData/GetDistrict', { form: { locationId } })) || [];
  }
  async wards(locationId, districtId) {
    return (await spf.request('/MasterData/GetWard', { form: { districtId, locationId } })) || [];
  }
  async streets(locationId, districtId, wardId) {
    return (await spf.request('/MasterData/GetStreet', { form: { wardId, districtId, locationId } })) || [];
  }

  /** Địa chỉ đầy đủ (id) + tên để ghi lịch sử. Thiếu trường nào lấy mặc định. */
  async resolveAddress(a = {}) {
    const d = config.defaults;
    const addr = {
      locationId: Number(a.locationId || d.locationId), districtId: Number(a.districtId || d.districtId),
      wardId: Number(a.wardId || d.wardId), streetId: Number(a.streetId || d.streetId),
      addressNo: String(a.addressNo ?? d.addressNo).trim(),
    };
    if (!addr.addressNo) throw new ApiError('Chưa nhập Số nhà', 400);
    const names = [];
    {
      const [ps, ds, ws, ss] = await Promise.all([
        this.provinces(), this.districts(addr.locationId), this.wards(addr.locationId, addr.districtId),
        this.streets(addr.locationId, addr.districtId, addr.wardId),
      ]).catch((e) => {
        throw Object.assign(new ApiError(`Không kiểm tra được địa chỉ: ${e.message}`, e.status || 502), { code: e.code });
      });
      const name = (list, id) => list.find((x) => Number(x.id) === id)?.name;
      if (!name(ds, addr.districtId)) throw new ApiError(`Quận/Phường id ${addr.districtId} không thuộc Tỉnh/TP id ${addr.locationId}`, 400);
      if (!ss.some((x) => Number(x.id) === addr.streetId)) throw new ApiError(`Đường id ${addr.streetId} không thuộc phường đã chọn`, 400);
      names.push(addr.addressNo, name(ss, addr.streetId), name(ws, addr.wardId), name(ds, addr.districtId), name(ps, addr.locationId));
    }
    addr.text = names.filter(Boolean).join(', ');
    return addr;
  }

  // ---------- tra cứu ----------
  /** Thông tin đơn trên sàn (Load ở tab Cập nhật địa chỉ/SDT) */
  async ecomDetail(source, refCode) {
    source = normSource(source);
    refCode = normRef(refCode);
    const r = await spf.request('/Ecomercial/GetOrderDetailByEcom', { form: { refCode, source } });
    const d = r?.data;
    if (!d) throw new ApiError(`Không tìm thấy đơn ${SOURCES[source].label} có RefCode ${refCode}`, 404);
    return {
      id: d.id, status: d.status, createTime: d.createTime, trackingNumber: d.trackingNumber,
      phone: d.recipientAddress?.phoneNumber || '', address: d.recipientAddress?.address || '',
      items: (d.lineItems || []).map((i) => ({
        skuName: i.skuName, sellerSku: i.sellerSku, productName: i.productName, image: i.skuImage,
        originalPrice: Number(i.originalPrice), salePrice: Number(i.salePrice),
      })),
      totalAmount: Number(d.payment?.totalAmount || 0), totalText: vnd(d.payment?.totalAmount),
    };
  }

  /** Tra đơn đã tạo trên SPF (tab Cập nhật chính sách). by: refcode | ordercode | orderid */
  async search(source, value, by = 'refcode') {
    source = normSource(source);
    const Type = { ordercode: 1, orderid: 2, refcode: 3 }[String(by).toLowerCase()];
    if (!Type) throw new ApiError('Tra theo refcode | ordercode | orderid', 400);
    const r = await spf.request('/Ecomercial/OrderECPlatform', {
      form: { Type, Value: normRef(value), RefSource: SOURCES[source].refSource, PageIndex: 1, PageSize: 50 },
    });
    return (r?.data || []).map(toRow);
  }

  /** Load: thông tin trên sàn + đơn đã có trên SPF -> gợi ý hướng làm */
  async load(source, refCode) {
    source = normSource(source);
    refCode = normRef(refCode);
    const [ecom, orders] = await Promise.all([
      this.ecomDetail(source, refCode).catch(softError),
      this.search(source, refCode),
    ]);
    return { source, refCode, ecom, orders, plan: planFor(orders) };
  }

  // ---------- thao tác ----------
  async disconnect(orderId, saleTeamId) {
    await spf.request('/Ecomercial/ConnectOrderEcom', { form: { OrderId: orderId, SaleTeamId: saleTeamId, IsConnect: false } });
    return { orderId, disconnected: true };
  }
  async connect(orderId, saleTeamId) {
    await spf.request('/Ecomercial/ConnectOrderEcom', { form: { OrderId: orderId, SaleTeamId: saleTeamId, IsConnect: true } });
    return { orderId, connected: true };
  }

  /**
   * Tạo đơn TMĐT theo RefCode:
   *  1. Tra RefCode ở tab Cập nhật chính sách.
   *  2. Có đơn được phép "Thử lại" -> Retry theo OrderId (+ SĐT).
   *  3. Có đơn đang kết nối: disconnectOld -> ngắt kết nối rồi tạo mới; không -> báo lỗi (409).
   *  4. Không có đơn -> tab Cập nhật địa chỉ/SDT: RetryOrderECPlatform với SĐT + địa chỉ.
   */
  async create({ onStep = () => {}, ...opts }) {
    const steps = [];
    const step = (text, ok = true) => {
      steps.push({ text, ok });
      onStep(text);
    };
    try {
      return await this.#create(opts, steps, step);
    } catch (e) {
      // Báo lỗi kèm các bước đã chạy (vd đã ngắt kết nối đơn cũ rồi mới lỗi)
      step(`✖ ${e.message}`, false);
      e.steps = steps;
      throw e;
    }
  }

  async #create({ source, refCode, phone, address, disconnectOld = false }, steps, step) {
    source = normSource(source);
    refCode = normRef(refCode);
    phone = normPhone(phone || config.defaults.phone);

    const ecom = await this.ecomDetail(source, refCode).catch(softError);
    if (ecom.error) step(`Thông tin sàn: ${ecom.error}`, false);
    else step(`Đơn ${SOURCES[source].label} ${refCode}: ${ecom.items.map((i) => i.skuName).join(', ') || '-'} · ${ecom.totalText}`);

    let orders = await this.search(source, refCode);
    step(orders.length ? `Tab Cập nhật chính sách: có ${orders.length} đơn gắn RefCode (${orders.map((o) => o.orderCode).join(', ')})` : 'Tab Cập nhật chính sách: chưa có đơn gắn RefCode');

    let mode;
    let result;
    let addr = null;
    const retryable = orders.find((o) => o.canRetry);
    if (retryable) {
      mode = 'retry';
      step(`Thử lại đơn ${retryable.orderCode} (OrderId ${retryable.orderId}) với SĐT ${phone}`);
      result = await spf.request('/Ecomercial/RetryOrderECPlatform', {
        form: { OrderId: retryable.orderId, Phone: phone, RefCode: undefined, LocationId: 0, DistrictId: 0, WardId: 0, StreetId: 0, AddressNo: '', Source: source },
      });
      result = { data: { orderId: result?.data?.orderId || retryable.orderId, orderCode: result?.data?.orderCode || retryable.orderCode } };
    } else {
      const connected = orders.filter((o) => o.canDisconnect);
      if (connected.length) {
        if (!disconnectOld) {
          throw new ApiError(
            `RefCode đã gắn đơn ${connected.map((o) => o.orderCode).join(', ')} – bật "Ngắt kết nối đơn cũ rồi tạo lại" (CLI: --disconnect) để tạo đơn mới`,
            409, { code: 'ORDER_EXISTS', orders },
          );
        }
        for (const o of connected) {
          await this.disconnect(o.orderId, o.saleTeamId || SOURCES[source].saleTeamId);
          step(`Ngắt kết nối đơn cũ ${o.orderCode} (OrderId ${o.orderId})`);
        }
      }
      mode = 'create';
      addr = await this.resolveAddress(address);
      step(`Tab Cập nhật địa chỉ/SDT: tạo đơn · SĐT ${phone} · ${addr.text || `${addr.addressNo} (street ${addr.streetId})`}`);
      result = await spf.request('/Ecomercial/RetryOrderECPlatform', {
        form: {
          Phone: phone, RefCode: refCode, LocationId: addr.locationId, DistrictId: addr.districtId, WardId: addr.wardId,
          StreetId: addr.streetId, AddressNo: addr.addressNo, Source: source,
        },
      });
    }

    const orderId = result?.data?.orderId;
    const orderCode = result?.data?.orderCode;
    if (!orderId) throw new ApiError('SPF báo thành công nhưng không trả về OrderId', 502);
    step(`✔ Đã tạo đơn ${orderCode} (OrderId ${orderId})`);

    // Thông tin sau tạo (PĐK / HĐ có thể chưa lên ngay – queue chạy nền)
    let info = null;
    try {
      info = (await this.search(source, String(orderId), 'orderid'))[0] || null;
      if (!info) step('Chưa tra được đơn vừa tạo ở tab Cập nhật chính sách (PĐK/HĐ có thể lên sau) – bấm Cập nhật trạng thái', false);
    } catch (e) {
      step(`Đã tạo đơn nhưng tra lại thông tin bị lỗi: ${e.message}`, false);
    }
    const summary = {
      time: new Date().toISOString(), source, refCode, mode, orderId, orderCode,
      regCode: info?.regCode || '', contract: info?.contract || '', phone,
      address: addr ? addr.text : '', sku: ecom.items?.map((i) => i.skuName).join(' | ') || '',
      total: info?.totalText || ecom.totalText || '', paymentStatus: info?.paymentStatus || '', detailUrl: detailUrl(orderId),
    };
    saveRecord(KIND, { summary, address: addr, ecom: ecom.error ? null : ecom, steps }, CSV_COLUMNS);
    return { summary, steps, order: info };
  }

  /** Trạng thái đơn: dòng ở tab chính sách + tiến độ queue (Tạo PĐK & HĐ, khoản thu...) */
  async status(orderId, source) {
    const errors = [];
    const [row, queue] = await Promise.all([
      this.search(source || config.defaults.source, String(orderId), 'orderid').then((r) => r[0] || null)
        .catch((e) => (errors.push(`Tra đơn lỗi: ${e.message}`), null)),
      spf.request('/Order/QueueTracking', { form: { OrderId: orderId } })
        .catch((e) => (errors.push(`Tiến độ queue lỗi: ${e.message}`), [])),
    ]);
    // Hết phiên thì báo hẳn (để UI hiện ô nhập token)
    if (errors.length === 2 && /Access Token|hết hạn/.test(errors.join(' '))) throw new ApiError(errors[0].replace(/^Tra đơn lỗi: /, ''), 401);
    // status 200/2000 = xong, âm (-200) = lỗi; chưa chạy: status null + taskStatus 7 (đã đẩy, chờ chạy) / 201 (không áp dụng)
    const allTasks = (Array.isArray(queue) ? queue : []).map((q) => ({
      name: String(q.taskName || '').trim(), actionCode: q.actionCode, taskCode: q.taskCode, status: q.status, taskStatus: q.taskStatus,
      done: q.status === 200 || q.status === 2000, failed: q.status != null && q.status < 0, queued: q.queueId != null || q.status != null,
      runTime: q.runTime, doneTime: q.doneTime, retry: q.currentRetry,
    }));
    const tasks = allTasks.filter((t) => t.queued);
    return { orderId: Number(orderId), order: row, tasks, allTasks, errors, detailUrl: detailUrl(orderId) };
  }

  async statuses(ids, source) {
    return Promise.all(ids.map((id) => this.status(id, source).catch((e) => {
      if (e.status === 401) throw e;
      return { orderId: Number(id), error: e.message };
    })));
  }

  history() {
    return readRecords(KIND).reverse();
  }

  // ---------- quyết toán (Queue/PushCustomTask) ----------
  /** Danh sách task quyết toán của nguồn: Tiktok_CompletedOrder / SPFShopeeCompletedOrder, Instance 1 */
  async settleTasks(source) {
    source = normSource(source);
    const actionCode = SOURCES[source].settleAction;
    // Không có task thì SPF trả 204 (rỗng)
    const text = await spf.request('/queue/GetListTaskByActionCode', { form: { ActionCode: actionCode, Instance: SETTLE_INSTANCE }, raw: true });
    let list = [];
    if (text.trim()) {
      try {
        list = JSON.parse(text);
      } catch {
        throw new ApiError('SPF /queue/GetListTaskByActionCode trả về dữ liệu không phải JSON (phiên hết hạn?)', 502);
      }
    }
    if (!list.length) throw new ApiError(`ActionCode ${actionCode} (Instance ${SETTLE_INSTANCE}) không có task nào trên SPF`, 404);
    const tasks = list.map((t) => ({ taskCode: t.taskCode, parentTaskCode: t.parentTaskCode || 0, name: String(t.taskName || '').trim(), api: t.apiImplement }));
    return { source, actionCode, instance: SETTLE_INSTANCE, tasks };
  }

  /**
   * Quyết toán đơn = đẩy task ActionCode quyết toán (Queue -> PushCustomTask, ReferType 1 = Order, ReferId = OrderId).
   * taskCodes bỏ trống = tất cả task. Task con phải chọn kèm task cha (giống web).
   */
  async settle({ source, orderId, taskCodes, replicate = false }) {
    source = normSource(source);
    orderId = String(orderId || '').trim();
    if (!/^\d+$/.test(orderId)) throw new ApiError('OrderId không hợp lệ', 400);
    const order = (await this.search(source, orderId, 'orderid'))[0];
    if (!order) throw new ApiError(`Không tìm thấy OrderId ${orderId} của ${SOURCES[source].label} (sai nguồn?)`, 404);

    const { actionCode, tasks } = await this.settleTasks(source);
    const all = tasks.map((t) => t.taskCode);
    const chosen = taskCodes?.length ? [...new Set(taskCodes.map(Number))] : all;
    const bad = chosen.filter((c) => !all.includes(c));
    if (bad.length) throw new ApiError(`Task ${bad.join(', ')} không có trong ${actionCode}`, 400);
    for (const c of chosen) {
      const t = tasks.find((x) => x.taskCode === c);
      if (t.parentTaskCode && !chosen.includes(t.parentTaskCode)) {
        throw new ApiError(`Task ${c} "${t.name}" cần chọn kèm task cha ${t.parentTaskCode}`, 400);
      }
    }
    chosen.sort((a, b) => a - b);

    const text = await spf.request('/queue/PushCustomTask', {
      form: { TaskCode: chosen.join(','), ReferType: 1, ReferId: orderId, ActionCode: actionCode, Instance: SETTLE_INSTANCE, IsRelicate: replicate ? 1 : 0 },
      raw: true,
    });
    if (text.trim() !== 'true') {
      const why = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new ApiError(`SPF không nhận task quyết toán${why ? `: ${why}` : ''}`, 502);
    }
    const summary = {
      time: new Date().toISOString(), source, orderId: Number(orderId), orderCode: order.orderCode, refCode: order.refCode || '',
      actionCode, taskCodes: chosen.join(','), tasks: chosen.map((c) => tasks.find((t) => t.taskCode === c).name).join(' | '),
      replicate: replicate ? 'có' : '', paymentStatus: order.paymentStatus || '', detailUrl: detailUrl(orderId),
    };
    saveRecord(SETTLE_KIND, { summary }, SETTLE_COLUMNS);
    return { summary, order };
  }

  /** Tiến độ quyết toán: các task của ActionCode quyết toán trong QueueTracking + trạng thái thanh toán */
  async settleStatus(source, orderId) {
    source = normSource(source);
    const s = await this.status(orderId, source);
    const actionCode = SOURCES[source].settleAction;
    const tasks = s.allTasks.filter((t) => t.actionCode === actionCode).sort((a, b) => a.taskCode - b.taskCode);
    return { ...s, actionCode, tasks };
  }

  settleHistory() {
    return readRecords(SETTLE_KIND).reverse();
  }

  saveDefaults(patch) {
    if (patch.source) patch.source = normSource(patch.source);
    if (patch.phone) patch.phone = normPhone(patch.phone);
    return saveDefaults(patch);
  }
}

/** Gợi ý hướng làm theo đơn đã có (giống thao tác tay) */
export function planFor(orders) {
  const retry = orders.find((o) => o.canRetry);
  if (retry) return { action: 'retry', text: `Đơn ${retry.orderCode} lỗi, được phép Thử lại → tool sẽ Retry theo OrderId (tab Cập nhật chính sách)` };
  const connected = orders.filter((o) => o.canDisconnect);
  if (connected.length) return { action: 'exists', text: `RefCode đã gắn đơn ${connected.map((o) => o.orderCode).join(', ')} → cần Ngắt kết nối rồi tạo lại` };
  return { action: 'create', text: 'Chưa có đơn gắn RefCode → tạo ở tab Cập nhật địa chỉ/SDT' };
}
