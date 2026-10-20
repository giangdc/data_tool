// Gói sản phẩm: lấy slug từ link chi tiết (vd https://staging.fpt.vn/internet/goi-giga) + thông tin gói.

/** Link chi tiết / link đăng ký / slug trần -> { slug, sourceUrl } */
export function parseProductUrl(input, webUrl) {
  const raw = String(input ?? '').trim();
  if (!raw) throw Object.assign(new Error('Chưa nhập link màn hình chi tiết gói'), { status: 400 });
  if (/^[a-z0-9-]+$/i.test(raw)) return { slug: raw.toLowerCase(), sourceUrl: `${webUrl}/${raw.toLowerCase()}` };
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
  return { slug: slug.toLowerCase(), sourceUrl: url.origin + url.pathname };
}

export const formatVnd = (n) => (n === null || n === undefined || n === '' ? '' : `${Number(n).toLocaleString('vi-VN')}đ`);

/** Thông tin gói (packages/get). location = {province_id, ward_id, building_id} để lấy giá theo khu vực */
export async function getProduct(api, slug, location = null) {
  const d = await api.post('/public/v1.1/packages/get', { code: slug, location });
  if (!d?.code) throw Object.assign(new Error(`Không tìm thấy gói "${slug}" trên ECP`), { status: 400 });
  return { ...summarizeProduct(d), raw: d };
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

  const offers = (d.product_offering_price || []).filter((o) => !o.status || o.status === 'active').map((o) => {
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

function summarizeProduct(d) {
  return {
    code: d.code,
    name: d.title || d.name,
    type: d.type_name || d.type,
    price: d.price?.price ?? null,
    priceText: d.price?.price != null ? `${formatVnd(d.price.price)}/${d.price.billing_cycle === 'month' ? 'tháng' : d.price.billing_cycle}` : '',
    requireLocation: d.require_location,
    endToEndSelling: d.end_to_end_selling,
  };
}
