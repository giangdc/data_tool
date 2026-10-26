// Luồng checkout fpt.vn qua API ECP (đã khảo sát 2026-10-16 trên staging.fpt.vn):
//   checkout/create -> address -> [payment-methods/get] -> customer -> payment -> voucher/apply -> complete -> checkout/get
// Tạo checkout + địa chỉ trước để lấy danh sách PTTT của gói (PTTT chỉ có sau bước address).
// Gói catalog mới FCP (source 'FCP', vd PRD_NET_001 – khảo sát 2026-10-22): create/address/calculate/payment-methods/customer/payment
// dùng bản v2 (/ordering/public/v2), voucher/complete/get vẫn v1. PTTT v2 chọn bằng payment_method_id.
import { formatVnd } from './product.js';

const P = '/ordering/public/v1';
const P2 = '/ordering/public/v2';
/** Bước create/address/calculate/payment-methods/customer/payment: gói FCP đi v2 */
const base = (source) => (source === 'FCP' ? P2 : P);

const httpErr = (message) => Object.assign(new Error(message), { status: 400 });

/** Tạo checkout cho 1 gói -> { checkoutId, token } */
export async function createCheckout(api, { slug, sourceUrl, webUrl, source }) {
  const path = new URL(sourceUrl).pathname.replace(/^\//, '');
  const d = await api.post(`${base(source)}/checkout/create`, {
    bundles: [{ bundle_code: slug }],
    ...(source === 'FCP' && { order_info: { order_type: 1 } }),
    referral: {
      tracking_id: '', url: webUrl, camp_medium: '', camp_name: '', camp_term: '', camp_content: '',
      camp_extra: JSON.stringify({ url: sourceUrl, route_name: slug }),
      utm_source: '', utm_medium: '', utm_campaign: '', utm_content: path, utm_term: '', ref: '', route_name: '', source_url: '',
    },
  });
  if (!d?.checkout_id || !d?.token) throw httpErr('Không tạo được checkout (API không trả checkout_id)');
  return { checkoutId: d.checkout_id, token: d.token };
}

/** Địa chỉ dạng chữ như web: nhà riêng "123, Trương Định, ..." · chung cư "Tòa A1, Tầng 5, Phòng 501, VVA Tower, Trương Định, ..." */
export function addressText(a) {
  const head = a.houseType === 'apartment'
    ? [a.block && `Tòa ${a.block}`, a.floor && `Tầng ${a.floor}`, a.room && `Phòng ${a.room}`, a.buildingName]
    : [a.addressNo];
  return [...head, a.streetName, a.wardName, a.provinceName].filter(Boolean).join(', ');
}

/** Địa chỉ đã chuẩn hóa (Locations.resolve) -> payload address/customer của ECP */
export function toAddressPayload(a) {
  const apt = a.houseType === 'apartment';
  return {
    address: addressText(a),
    location_id: a.provinceId,
    district_id: null,
    ward_id: a.wardId,
    street_id: a.streetId,
    address_no: apt ? '' : a.addressNo,
    type_house: apt ? 'apartment' : 'private_house',
    building_id: apt ? a.buildingId : null,
    building_name: apt ? a.buildingName : '',
    floor: apt ? a.floor : '',
    block: apt ? a.block : '',
    room: apt ? a.room : '',
  };
}

/** location cho packages/get (giá/chính sách theo khu vực, chung cư) */
export const toLocation = (a) => ({ province_id: a.provinceId, ward_id: a.wardId, building_id: a.houseType === 'apartment' && a.buildingId > 0 ? a.buildingId : 0 });

export const NO_POLICY = 'CHECKOUT_PACKAGE_NOT_AVAILABLE';
export const noPolicyMessage = (a) =>
  `Địa chỉ không có chính sách bán gói này (${addressText(a)}${a.houseType === 'apartment' ? ' – chung cư' : ''}) – không tạo được đơn. Đổi địa chỉ / chung cư khác.`;

/**
 * Gửi địa chỉ lên checkout. Địa chỉ không có chính sách -> ném lỗi (code NO_POLICY) với câu dễ hiểu.
 * (web fpt.vn nuốt lỗi này, vẫn cho đi tiếp rồi báo "Đăng ký thành công" mà không có đơn)
 */
export async function setAddress(capi, address, source) {
  try {
    return await capi.post(`${base(source)}/checkout/address`, toAddressPayload(address));
  } catch (err) {
    if (err.code === NO_POLICY) throw Object.assign(new Error(noPolicyMessage(address)), { status: 400, code: NO_POLICY });
    throw err;
  }
}

/**
 * Áp lựa chọn sản phẩm (chu kỳ) + dịch vụ bổ sung lên checkout (checkout/calculate – như khi bấm trên trang thanh toán).
 * offer: phần tử của parseOffers().offers · extraSkuIds: sku dịch vụ/thiết bị bổ sung được tick
 */
export async function applySelection(capi, { slug, offer, addons, extraSkuIds = [] }) {
  const unknown = extraSkuIds.filter((id) => !offer.extras.some((e) => String(e.skuId) === String(id)));
  if (unknown.length) throw httpErr(`Dịch vụ bổ sung không có trong lựa chọn "${offer.label}": ${unknown.join(', ')}`);
  // Gói FCP (parseFcpOffers): chỉ gửi hình thức trả + số tháng sử dụng như web
  if (offer.paymentTermId != null) {
    return capi.post(`${P2}/checkout/calculate`, { bundles: [{ bundle_code: slug, payment_term_id: offer.paymentTermId, contract_length_months: offer.months }] });
  }
  return capi.post(`${P}/checkout/calculate`, {
    bundles: [{
      bundle_code: slug,
      price_list_id: offer.priceListId,
      billing_type_id: offer.billingTypeId,
      billing_cycle: offer.billingCycle,
      contract_length_months: offer.products ? offer.contractMonths : offer.months,
      products: offer.products ?? [],
      addons,
      extras: [
        ...extraSkuIds.map((id) => ({ sku_id: Number(id), parent_sku_id: null, quantity: 1 })),
        // Gói thiết bị: không chọn "tự lắp đặt" (gói giao hàng) thì gửi phí triển khai = hỗ trợ lắp đặt (như web)
        ...(offer.extras.some((e) => e.delivery && extraSkuIds.map(String).includes(String(e.skuId))) ? [] : offer.installFees ?? []),
        // Quà tặng web tự chọn sẵn theo chính sách trả trước (vd camera)
        ...offer.gifts.map(({ group_id, sku_group_id, quantity }) => ({ group_id, sku_group_id, quantity })),
      ],
    }],
  });
}

/** PTTT khả dụng của gói -> [{ code, name, method: 'COD'|'Online', type, icon, id }] (thứ tự như web; id = payment_method_id của FCP) */
export async function getPaymentMethods(capi, slug, source) {
  const list = (source === 'FCP'
    ? await capi.post(`${P2}/checkout/payment-methods/get`)
    : await capi.post(`${P}/checkout/payment-methods/get`, { bundle_codes: [slug] })) || [];
  return list.map((m) => ({ code: m.code, name: m.name, method: m.payment_method, type: m.payment_type, icon: m.icon, id: m.payment_method_id }));
}

/** Chọn PTTT cho checkout (FCP: theo payment_method_id) */
const selectPayment = (capi, method, source) => capi.post(`${base(source)}/checkout/payment`, source === 'FCP'
  ? { selected_payment_method_id: method.id, selected_online_method: method.method === 'COD' ? '' : method.code }
  : { selected_payment_method: method.method, selected_online_method: method.method === 'COD' ? null : method.code });

export const getCheckout = (capi) => capi.post(`${P}/checkout/get`, {});

/** Đọc lại PTTT + giá hiện tại của checkout (sau khi đổi địa chỉ / lựa chọn) */
export async function checkoutSnapshot(capi, slug, source) {
  const [methods, data] = await Promise.all([getPaymentMethods(capi, slug, source), getCheckout(capi)]);
  return { methods, view: toOrderView(data) };
}

const SDT = /^0\d{9}$/;

/**
 * Tạo đơn trên checkout đã có (đã set địa chỉ hoặc chưa).
 * input: { slug, source, fullName, phone, address (đã resolve), note, paymentCode, selection: {offer, addons, extraSkuIds} }
 * -> { steps, complete (data của checkout/complete), order (checkout/get), method }
 */
export async function placeOrder(capi, input) {
  const fullName = String(input.fullName ?? '').trim();
  const phone = String(input.phone ?? '').replace(/[\s.]/g, '');
  if (!fullName) throw httpErr('Chưa nhập Họ tên');
  if (!SDT.test(phone)) throw httpErr(`Số điện thoại không hợp lệ: "${input.phone}" (cần 10 số, bắt đầu bằng 0)`);
  const steps = [];

  const { source } = input;
  await setAddress(capi, input.address, source);
  steps.push('địa chỉ');

  // Lỗi ở bước này web fpt.vn vẫn báo "Đăng ký thành công" (thực chất chỉ là lead) -> tool báo lỗi thật
  const address = toAddressPayload(input.address);
  await capi.post(`${base(source)}/checkout/customer`, { full_name: fullName, phone, ...address, note: String(input.note ?? '') });
  steps.push('khách hàng');

  if (input.selection) {
    await applySelection(capi, { slug: input.slug, ...input.selection });
    steps.push(`sản phẩm ${input.selection.offer.billingTypeName} ${input.selection.offer.months} tháng${input.selection.extraSkuIds?.length ? ` + ${input.selection.extraSkuIds.length} bổ sung` : ''}`);
  }

  // PTTT phụ thuộc lựa chọn (vd thêm dịch vụ bổ sung thì mất "Thanh toán tại nhà") -> lấy sau calculate
  const methods = await getPaymentMethods(capi, input.slug, source);
  if (!methods.length) throw httpErr('Gói không có phương thức thanh toán nào với lựa chọn / địa chỉ này');
  const method = methods.find((m) => m.code === input.paymentCode) ?? (input.paymentCode ? null : methods[0]);
  if (!method) throw httpErr(`PTTT "${input.paymentCode}" không khả dụng với lựa chọn này. Có: ${methods.map((m) => `${m.code} (${m.name})`).join(', ')}`);

  await selectPayment(capi, method, source);
  steps.push(`PTTT ${method.name}`);

  // Web tự áp ưu đãi mặc định trước khi thanh toán
  await capi.post(`${P}/voucher/apply`, { vouchers: [], mode: 'Auto' }).catch(() => {});

  const complete = await capi.post(`${P}/checkout/complete`, {}).catch((err) => {
    if (/ServiceCode not found/i.test(err.message)) {
      err.message += ' – hệ thống chưa cấu hình mã dịch vụ cho chính sách này (staging 2026-10: mọi lựa chọn trả trước đều lỗi), thử "Trả sau"';
    }
    throw err;
  });
  steps.push('hoàn tất');
  if (!complete?.order_code) throw httpErr(`checkout/complete không trả mã đơn (status: ${complete?.status ?? '?'})`);

  const order = await getCheckout(capi).catch(() => null);
  return { steps, method, complete, order };
}

/**
 * Đổi PTTT của đơn đang chờ thanh toán rồi hoàn tất lại (cùng mã đơn, link/QR thanh toán mới).
 * Chỉ PTTT online: đổi sang "Thanh toán tại nhà" ECP báo ORDER_SUBMISSION_FAILED (staging 2026-10-19).
 * -> { method, complete }
 */
export async function changePayment(capi, slug, paymentCode, source) {
  const methods = await onlineMethods(capi, slug, source);
  const method = methods.find((m) => m.code === paymentCode);
  if (!method) throw httpErr(`PTTT "${paymentCode}" không đổi được cho đơn này. Có: ${methods.map((m) => `${m.code} (${m.name})`).join(', ')}`);
  await selectPayment(capi, method, source);
  await capi.post(`${P}/voucher/apply`, { vouchers: [], mode: 'Auto' }).catch(() => {});
  const complete = await capi.post(`${P}/checkout/complete`, {});
  if (!complete?.redirect_url && !complete?.qr_code_info?.image_base64) throw httpErr(`Đổi PTTT xong nhưng không có link/QR thanh toán (status: ${complete?.status ?? '?'})`);
  return { method, complete };
}

/** PTTT đổi được khi thanh toán lại (bỏ COD) */
export const onlineMethods = async (capi, slug, source) => (await getPaymentMethods(capi, slug, source)).filter((m) => m.method !== 'COD');

/** checkout/complete -> cách thanh toán cho UI: { type: 'none'|'redirect'|'qr', url?, qrImage?, expireSeconds?, deeplink? } */
export function toPayment(complete) {
  if (complete?.redirect_url) return { type: 'redirect', url: complete.redirect_url };
  const qr = complete?.qr_code_info;
  if (qr?.image_base64) return { type: 'qr', qrImage: qr.image_base64, expireSeconds: (qr.expire_time || 0) * 60, deeplink: qr.open_in_app_deeplink || '' };
  return { type: 'none' };
}

// Giờ API trả dạng "2026-10-16 09:36:03" (UTC) -> ISO để UI hiển thị giờ máy
const toIso = (s) => (s ? new Date(s.replace(' ', 'T') + (/[zZ+]/.test(s.slice(10)) ? '' : 'Z')).toISOString() : null);

/**
 * Trạng thái đơn (checkout.status + PTTT):
 *  open -> chưa hoàn tất · recompleting -> chờ thanh toán online · completed -> đã tạo đơn (COD) / đã thanh toán (online)
 */
export function orderStatus(d) {
  const st = d?.status;
  const pay = d?.payment_info?.selected_payment_method;
  if (st === 'completed') return { status: st, label: pay === 'Online' ? 'Đã thanh toán' : 'Đã tạo đơn · Thanh toán tại nhà', done: true, paid: pay === 'Online' };
  if (st === 'recompleting') return { status: st, label: 'Chờ thanh toán', waitingPayment: true };
  if (st === 'open') return { status: st, label: 'Chưa hoàn tất' };
  return { status: st, label: st || '?' };
}

/** checkout/get -> dữ liệu gọn cho màn hình xem đơn */
export function toOrderView(d) {
  if (!d) return null;
  const c = d.customer_info || {};
  const pi = d.payment_info || {};
  const calc = d.calculation_detail || {};
  return {
    code: d.order_code || d.checkout_id,
    orderId: d.order_id,
    checkoutId: d.checkout_id,
    ...orderStatus(d),
    createdAt: toIso(d.created_at),
    updatedAt: toIso(d.updated_at),
    completedAt: toIso(d.completed_at),
    customer: { fullName: c.full_name, phone: c.phone, address: c.address, note: c.note, location: c.location_name, locationCode: c.location_code },
    bundles: (d.bundles || []).map((b) => ({ code: b.bundle_code, name: b.bundle_name, type: b.bundle_type, quantity: b.quantity })),
    items: (d.line_items || []).map((li) => ({
      name: li.display_name,
      quantity: li.quantity,
      months: li.prepaid_month ?? li.contract_month ?? null,
      extra: Boolean(li.is_extra),
      deployType: li.deploy_type_name,
      amount: li.pricing?.amount ?? null,
      amountText: formatVnd(li.pricing?.amount),
    })),
    promotions: (d.promotions || []).map((p) => p?.name || p?.code || p?.voucher_code).filter(Boolean),
    payment: {
      method: pi.selected_payment_method,
      online: pi.selected_online_method,
      gateway: pi.payment_gateway,
    },
    totals: {
      main: calc.sub_total_main, required: calc.sub_total_required, extra: calc.sub_total_extra,
      voucher: calc.voucher_discount, grand: calc.grand_total,
      final: d.summary?.final_amount ?? calc.grand_total,
      finalText: formatVnd(d.summary?.final_amount ?? calc.grand_total),
    },
  };
}
