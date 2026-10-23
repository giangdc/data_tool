// Gói sản phẩm: lấy slug từ link chi tiết (vd https://staging.fpt.vn/internet/goi-giga) + thông tin gói.

/** Link chi tiết / link đăng ký / slug trần -> { slug, sourceUrl } */
export function parseProductUrl(input, webUrl) {
  const raw = String(input ?? '').trim();
  if (!raw) throw Object.assign(new Error('Chưa nhập link màn hình chi tiết gói'), { status: 400 });
  // Giữ nguyên hoa/thường: mã gói FCP phân biệt (PRD_NET_001), gói ECP thì getProduct tự hạ thường
  if (/^[\w-]+$/.test(raw)) return { slug: raw, sourceUrl: `${webUrl}/${raw}` };
  let url;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    throw Object.assign(new Error(`Link không hợp lệ: ${raw}`), { status: 400 });
  }
  const parts = url.pathname.split('/').filter(Boolean);
  // /checkout/register/<slug> hoặc /<danh-muc>/<slug>
  const slug = parts[0] === 'checkout' ? parts[2] : parts.at(-1);
  if (!slug || parts.length < 2) throw Object.assign(new Error(`Không lấy được mã gói từ link: ${raw} (cần dạng ${webUrl}/internet/<gói>)`), { status: 400 });
  if (new URL(webUrl).host !== url.host) throw Object.assign(new Error(`Link phải thuộc ${new URL(webUrl).host} (môi trường đang chọn)`), { status: 400 });
  return { slug, sourceUrl: url.origin + url.pathname };
}

// service_id-sub_service_type_id (hằng số trong bundle FE checkout): phí lắp đặt thiết bị / gói giao hàng (tự lắp đặt)
const INSTALL_FEE_TYPES = ['3-13', '4-404'];
const DELIVERY_TYPES = ['3-305', '4-405'];
const serviceType = (p) => `${p?.service_id}-${p?.sub_service_type_id}`;

// Loại gói thiết bị (giá bán 1 lần, không phải cước tháng)
const DEVICE_TYPES = ['fpt-camera', 'ap', 'smart-tivi', 'fpt-smart-home'];

export const formatVnd = (n) => (n === null || n === undefined || n === '' ? '' : `${Number(n).toLocaleString('vi-VN')}đ`);

/**
 * Thông tin gói. location = {province_id, ward_id, building_id} để lấy giá theo khu vực.
 * Gói catalog cũ (ECP, packages/get) -> source 'ECP'; không có thì tìm catalog mới FCP (products/content, vd PRD_NET_001) -> source 'FCP'.
 * slug = mã gói dùng cho checkout (bundle_code).
 */
export async function getProduct(api, slug, location = null) {
  const d = await api.post('/public/v1.1/packages/get', { code: slug.toLowerCase(), location });
  if (d?.code) return { ...summarizeProduct(d), source: 'ECP', slug: d.code, raw: d };
  const c = await api.post('/channel/public/v1/products/content', { slug }).catch(() => null);
  if (c?.source === 'FCP' && c.product_code) {
    return { code: c.product_code, name: c.display_name, type: c.product_type, price: null, priceText: '', source: 'FCP', slug: c.product_code, raw: c };
  }
  throw Object.assign(new Error(`Không tìm thấy gói "${slug}" trên ECP / FCP`), { status: 400 });
}

/** Gói FCP: bảng giá theo địa chỉ (products/quote) */
export const getFcpQuote = (api, productCode, location) =>
  api.post('/public/v2/products/quote', { product_code: productCode, location_id: location.province_id, ward_id: location.ward_id, building_id: location.building_id });

/**
 * Lựa chọn gói FCP từ quote (như parseOffers): mỗi option của nhóm CORE_BUNDLE (trả sau / trả trước N tháng) = 1 offer.
 * calculate chỉ gửi payment_term_id + usage (như web) -> option trùng (term, usage) chỉ giữ cái đầu.
 * Thiết bị (nhóm attr_dev_*, bắt buộc 1) ECP tự gán; dịch vụ đi kèm (FSafe, Camera...) chưa hỗ trợ.
 */
export function parseFcpOffers(q) {
  const po = q?.pricing_options?.[0];
  const seen = new Set();
  const offers = (po?.offering_price || []).filter((o) => o.render_group_code === 'CORE_BUNDLE' && o.usage != null).filter((o) => {
    const k = `${o.payment_term_id}:${o.usage}`;
    return !seen.has(k) && seen.add(k);
  }).map((o) => ({
    key: `fcp:${o.payment_term_id}:${o.usage}`,
    paymentTermId: o.payment_term_id,
    billingTypeName: o.payment_term_name || (o.payment_term_id === 2 ? 'Trả sau' : 'Trả trước'),
    months: o.usage,
    label: o.display_name,
    price: o.price ?? null,
    priceText: formatVnd(o.price),
    gifts: [],
    extras: [],
  }));
  const devices = (po?.offering_price || []).filter((o) => o.render_group_code !== 'CORE_BUNDLE').map((o) => o.display_name);
  return { offers, addons: [], mainName: q?.display_attributes?.product_long_name, devices };
}

/**
 * Lựa chọn của gói tại 1 địa chỉ (packages/get có location):
 *  offers  = "Thông tin sản phẩm" trên web: mỗi chính sách giá (trả sau / trả trước N tháng)
 *  extras  = "Mua các dịch vụ/Thiết bị bổ sung" (sản phẩm vai trò Extra), giá theo từng offer
 *  addons  = sản phẩm đi kèm bắt buộc của gói chính (vd Thiết bị đi kèm Net) – luôn gửi
 *  gifts   = nhóm quà tặng (camera...) web tự chọn sẵn theo offer
 * offers rỗng = địa chỉ không có chính sách bán gói -> không tạo được đơn.
 */
export function parseOffers(d) {
  const products = (d.product_offering || []).flatMap((g) => g.products || []);
  const main = products.find((p) => p.item_role === 1) || products[0];
  const addons = (main?.children || [])
    .filter((c) => c.purchase_type === 'add-on')
    .map((c) => ({ sku_id: c.id, parent_sku_id: c.parent_sku_id, quantity: c.item_quantity || 1 }));
  const extraProducts = products.filter((p) => p.item_role === 2);
  const groups = d.product_offering_group || [];

  const offers = (d.product_offering_price || []).filter((o) => !o.status || o.status === 'active').flatMap((o) => {
    if (o.contract_length_months == null) return deviceOffers(d, o, products);
    const prices = new Map((o.sku_prices || []).filter((s) => !s.parent_sku_id).map((s) => [s.sku_id, s.price]));
    const gifts = (o.applicable_offering_group_ids || []).map((gid) => {
      const g = groups.find((x) => x.id === gid);
      const sg = g?.sku_groups?.find((s) => s.default_checked);
      return sg && { group_id: g.id, sku_group_id: sg.id, quantity: 1, name: sg.name };
    }).filter(Boolean);
    const prepaid = o.billing_type_id === 1;
    return {
      key: `${o.id}:${o.billing_type_id}:${o.contract_length_months}`,
      priceListId: o.id,
      billingTypeId: o.billing_type_id,
      billingTypeName: o.billing_type_name || (prepaid ? 'Trả trước' : 'Trả sau'),
      billingCycle: o.billing_cycle || 'month',
      months: o.contract_length_months,
      label: `${main?.name || d.title || d.name} - ${o.contract_length_months} tháng`,
      price: o.summary?.service_price?.price ?? prices.get(main?.id) ?? null,
      priceText: formatVnd(o.summary?.service_price?.price ?? prices.get(main?.id)),
      gifts,
      extras: extraProducts.filter((p) => prices.has(p.id)).map((p) => ({
        skuId: p.id, name: p.name, type: p.purchase_type, price: prices.get(p.id), priceText: formatVnd(prices.get(p.id)),
      })),
    };
  });
  return { offers, addons, mainName: main?.name };
}

/**
 * Gói thiết bị (vd Combo 2 Camera): chính sách không có chu kỳ, chu kỳ nằm ở sku dịch vụ chính (gói lưu trữ An Tâm 1/6/12 tháng)
 * -> mỗi chu kỳ = 1 lựa chọn. calculate phải gửi products (thiết bị + gói lưu trữ kèm số tháng) như web.
 * Mặc định "Hỗ trợ lắp đặt" (gửi phí triển khai của từng thiết bị); gói giao hàng hiện ở bổ sung là "Tôi muốn tự lắp đặt".
 */
function deviceOffers(d, o, products) {
  const mains = products.filter((p) => p.item_role === 1);
  const service = mains.find((p) => p.purchase_type === 'billing');
  const mainPrices = (o.sku_prices || []).filter((s) => !s.parent_sku_id);
  const cycles = service ? mainPrices.filter((s) => s.sku_id === service.id).sort((a, b) => a.contract_length_months - b.contract_length_months) : [];
  const installFees = mains.flatMap((p) => (p.children || []).filter((c) => INSTALL_FEE_TYPES.includes(serviceType(c)))
    .map((c) => ({ sku_id: c.id, parent_sku_id: c.parent_sku_id, quantity: p.item_quantity || 1 })));
  const prices = new Map(mainPrices.map((s) => [s.sku_id, s.price]));
  // Tổng phí triển khai (giá theo chính sách, sku_prices có parent_sku_id) – để UI ghi rõ khi chọn "Hỗ trợ lắp đặt"
  const feeTotal = installFees.reduce((sum, f) => sum + (o.sku_prices || [])
    .filter((s) => s.sku_id === f.sku_id && s.parent_sku_id === f.parent_sku_id).reduce((a, s) => a + (s.price || 0) * f.quantity, 0), 0);
  const extras = products.filter((p) => p.item_role === 2 && prices.has(p.id)).map((p) => {
    const delivery = DELIVERY_TYPES.includes(serviceType(p)) && installFees.length > 0;
    return {
      skuId: p.id, name: delivery ? `Tôi muốn tự lắp đặt (${p.name})` : p.name, type: p.purchase_type,
      price: prices.get(p.id), priceText: formatVnd(prices.get(p.id)), delivery,
      ...(delivery && { installFeeCount: installFees.length, installFeeText: formatVnd(feeTotal) }),
    };
  });
  return (cycles.length ? cycles : [null]).map((c) => ({
    key: `${o.id}:${o.billing_type_id}:${c?.contract_length_months ?? ''}`,
    priceListId: o.id,
    billingTypeId: o.billing_type_id ?? null,
    billingTypeName: c ? (c.billing_type_id === 2 ? 'Trả sau' : 'Trả trước') : 'Mua thiết bị',
    billingCycle: o.billing_cycle ?? null,
    contractMonths: o.contract_length_months ?? null,
    months: c?.contract_length_months ?? null,
    label: c ? `${service.name} - ${c.contract_length_months} tháng` : d.title || d.name,
    price: c?.price ?? null,
    priceText: formatVnd(c?.price),
    gifts: [],
    products: mains.map((p) => ({
      sku_id: p.id, parent_sku_id: null, quantity: p.item_quantity || 1, contract_length_months: p === service ? c?.contract_length_months ?? null : null,
    })),
    installFees,
    extras,
  }));
}

function summarizeProduct(d) {
  return {
    code: d.code,
    name: d.title || d.name,
    type: d.type_name || d.type,
    price: d.price?.price ?? null,
    priceText: d.price?.price == null ? ''
      : DEVICE_TYPES.includes(d.type) ? formatVnd(d.price.price)
        : `${formatVnd(d.price.price)}/${d.price.billing_cycle === 'month' ? 'tháng' : d.price.billing_cycle}`,
    requireLocation: d.require_location,
    endToEndSelling: d.end_to_end_selling,
  };
}
