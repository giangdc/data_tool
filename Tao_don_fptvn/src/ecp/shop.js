// Nguồn thứ 3: Shop selfservice (staging.fpt.vn/shop – web Vue cũ, backend Laravel) – khảo sát 2026-11-06.
// Gói không có trên ECP/FCP (vd combo-internet-lux800-vvip: trang gói -> "Đăng ký ngay" = /shop/internet/register/<route>).
// Luồng (cùng 1 phiên cookie – đơn gắn với phiên, phiên khác gọi báo "Mã đơn hàng không tồn tại"):
//   GET trang đăng ký (lấy cookie phiên + XSRF-TOKEN) -> package/get-by-route -> order/create (OrderId, OrderCode)
//   -> package/get-detail -> payment/get-payment-method -> order/update-detail -> gift/update -> order/summary (TotalVAT)
//   -> checkout/process-checkout -> checkout/create-payment-transaction (DisplayType None = xong | QRCode | WebApp)
// Cookie phiên = như token checkout: chỉ ở server + output/orders.jsonl, không trả ra trình duyệt, không log.
import { httpRequest } from '../core/http.js';
import { formatVnd } from './product.js';

const SALE_TEAM_ID = 29; // web mặc định (sessionStorage.SaleTeamId || 29)

// PTTT Shop thấy ngày 2026-11-06 (gói Lux800) – chỉ để hiện trước khi tạo đơn; API PTTT cần OrderId nên lúc tạo đơn mới lấy danh sách thật
export const SHOP_DEFAULT_METHODS = [
  ['VIETQR', 'Thanh toán bằng VietQR'], ['MOMO', 'Ví điện tử Momo'], ['BANK_TRANSFER', 'Chuyển khoản nhanh'], ['ZALO_PAY', 'Ví ZaloPay'],
  ['COD', 'Thanh toán tại nhà'], ['DOMESTIC', 'Thẻ ATM nội địa'], ['INTERNATIONAL', 'Thẻ tín dụng'], ['APPLE_PAY', 'Apple Pay'],
].map(([code, name]) => ({ code, name, method: code === 'COD' ? 'COD' : 'Online' }));

const shopErr = (message, status = 422, code) => Object.assign(new Error(message), { status, code });

/** 1 phiên Shop (cookie jar). toJSON()/from() để lưu lại xem trạng thái đơn sau. */
export class ShopSession {
  constructor(webUrl, proxy, cookies = {}) {
    this.webUrl = webUrl.replace(/\/$/, '');
    this.proxy = proxy;
    this.jar = new Map(Object.entries(cookies));
    this.referer = `${this.webUrl}/shop/`;
  }

  static from(webUrl, proxy, saved) {
    return new ShopSession(webUrl, proxy, saved?.cookies || {});
  }

  toJSON() {
    return { cookies: Object.fromEntries(this.jar) };
  }

  #headers(json) {
    const host = new URL(this.webUrl).host;
    const xsrf = this.jar.get('XSRF-TOKEN');
    return {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
      Accept: json ? 'application/json, text/plain, */*' : 'text/html',
      Host: host,
      // Laravel kiểm tra header này (thiếu -> 400 "Invalid X-Forwarded-Host Header")
      'X-Forwarded-Host': host,
      Origin: this.webUrl,
      Referer: this.referer,
      'X-Requested-With': 'XMLHttpRequest',
      ...(this.jar.size && { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') }),
      ...(xsrf && { 'X-XSRF-TOKEN': decodeURIComponent(xsrf) }),
      ...(json && { 'Content-Type': 'application/json' }),
    };
  }

  #keep(setCookies) {
    for (const c of setCookies || []) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      if (i > 0) this.jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
  }

  /** Mở trang đăng ký của gói -> cookie phiên + XSRF */
  async open(path) {
    this.referer = `${this.webUrl}${path}`;
    const res = await httpRequest(this.referer, { method: 'GET', headers: this.#headers(false) }, this.proxy);
    this.#keep(res.setCookies);
    if (!this.jar.has('XSRF-TOKEN')) throw shopErr(`Không mở được phiên Shop (${path}: HTTP ${res.status})`, 502);
    return this;
  }

  /** POST /shop/api/<path> -> data; error != 0 -> ném lỗi (status 422, câu báo của Shop) */
  async post(path, body = {}) {
    const res = await httpRequest(`${this.webUrl}/shop/api/${path}`, { method: 'POST', headers: this.#headers(true), body: JSON.stringify(body) }, this.proxy);
    this.#keep(res.setCookies);
    let j;
    try {
      j = JSON.parse(res.text);
    } catch {
      throw shopErr(`Shop ${path}: HTTP ${res.status} (không phải JSON)`, res.status >= 500 ? 502 : 422);
    }
    if (!res.ok && j?.error === undefined) throw shopErr(`Shop ${path}: HTTP ${res.status} ${j?.message || ''}`.trim(), res.status >= 500 ? 502 : 422);
    if (j.error !== 0) {
      const sub = j.data?.title && j.data.title !== 'Thông báo' ? ` (${j.data.title})` : '';
      throw shopErr(`${j.message || 'Shop báo lỗi'}${sub} [shop ${path}]`, 422, j.data?.session_expired ? 'SHOP_SESSION_EXPIRED' : 'SHOP_ERROR');
    }
    return j.data;
  }
}

/** Link -> đường dẫn trang đăng ký Shop: /shop/<loại>/register/<route>; link trang gói /internet/<route> -> loại internet */
export function shopRegisterPath(sourceUrl, route) {
  const parts = new URL(sourceUrl).pathname.split('/').filter(Boolean);
  const kind = parts[0] === 'shop' ? parts[1] : 'internet';
  return `/shop/${kind}/register/${route}`;
}

/** Địa chỉ ECP (Locations.resolve) -> địa chỉ Shop. Shop: DistrictId = phường (id ECP), WardId = ward_id của Shop */
export async function shopLocation(session, addr) {
  const list = await session.post('selfservice/v2/location/get-district', { LocationId: String(addr.provinceId) });
  const w = (list || []).find((x) => Number(x.id) === Number(addr.wardId));
  if (!w) throw shopErr(`Shop không có phường "${addr.wardName}" của ${addr.provinceName}`, 400);
  const loc = { LocationId: Number(addr.provinceId), DistrictId: Number(addr.wardId), WardId: Number(w.ward_id), BuildingId: 0 };
  if (addr.houseType === 'apartment') {
    const b = await session.post('selfservice/location/get-building', { SaleTeamId: SALE_TEAM_ID, LocationId: loc.LocationId, DistrictId: loc.DistrictId, WardId: loc.WardId }).catch(() => []);
    const name = String(addr.buildingName || '').toLowerCase();
    const hit = (b || []).find((x) => String(x.text || x.Name || '').toLowerCase() === name);
    if (!hit) throw shopErr(`Shop không có chung cư "${addr.buildingName || 'Nơi khác'}" ở ${addr.wardName} – chọn Nhà riêng hoặc chung cư khác`, 400);
    loc.BuildingId = Number(hit.id ?? hit.Id);
  }
  return loc;
}

/** Gói Shop tại địa chỉ (get-by-route) -> data (PackageName, RealMonth, HasPolicy, PackageServices...) */
export const getShopPackage = (session, route, loc) =>
  session.post('selfservice/package/get-by-route', { ...loc, RouteName: route, OrderType: 1, SaleTeamId: SALE_TEAM_ID });

export const getShopDetail = (session, route, loc, pkg, orderId = 0) =>
  session.post('selfservice/package/get-detail', { SaleTeamId: SALE_TEAM_ID, ...loc, PackageServices: pkg.PackageServices, OrderId: orderId, RouteName: route });

/** "Chọn gói dịch vụ" = PackageServicesInfo: nhóm 1 trả sau 1 tháng, nhóm 2/3 trả trước N tháng */
export function parseShopOffers(detail, packageName) {
  const offers = (detail?.PackageInfoDetail?.PackageServicesInfo || []).map((g) => {
    const prepaid = g.PrePaid > 0;
    const price = prepaid ? g.PriceVAT : g.RealMonth;
    return {
      key: `shop:${g.ServiceGroupId}`,
      shopGroupId: g.ServiceGroupId,
      prePaid: g.PrePaid,
      billingTypeName: prepaid ? 'Trả trước' : 'Trả sau',
      months: g.MonthUsed,
      label: `${packageName} - ${g.MonthUsed} tháng`,
      price,
      priceText: prepaid ? formatVnd(price) : `${formatVnd(price)}/tháng`,
      gifts: [],
      extras: [], // dịch vụ bổ sung Shop (FPT Play Box...) chưa hỗ trợ
    };
  });
  return { offers, addons: [] };
}

/** OrderDetail như web (internetPayment): dịch vụ chính theo nhóm + phí lắp đặt (GroupServiceDetail) + thiết bị bắt buộc theo nhóm */
export function buildOrderDetail(detail, offer) {
  const grp = offer.shopGroupId;
  const svc = (s, r, qty = 1) => ({
    ServiceId: s.ServiceId, SubServiceId: s.SubServiceId, SubServiceName: s.SubServiceName, SubServiceTypeId: s.SubServiceTypeId,
    SalesPolicyServices: [{ PolicyId: r.PolicyId, PsId: r.PsId, ProgramId: r.ProgramID, RealQty: qty, ServiceCode: r.ServiceCode, Price: r.Price, PriceVAT: r.PriceVAT, DeployTypeId: r.DeployTypeId, PrePaid: r.PrePaid, MonthUsed: r.MonthUsed }],
  });
  const mains = detail?.ServiceMain?.Services || [];
  const Services = [];
  for (const s of mains) {
    const r = s.SalesPolicyServices.find((x) => x.ServiceGroupId === grp);
    if (!r) continue;
    Services.push(svc(s, r));
    if (r.GroupServiceDetail) Services.push(svc(r.GroupServiceDetail, r.GroupServiceDetail)); // "PLĐ Net"
  }
  const subIds = mains.map((s) => s.SubServiceId);
  const Products = (detail?.ServiceRequire?.Products || []).filter((p) => p.IsDefault).map((p) => {
    const r = p.SalesPolicyProducts.find((x) => !x.ApplyServices?.length || x.ApplyServices.some((a) => subIds.includes(a.ApplySubServiceId) && a.ApplyPrepaid === offer.prePaid));
    return r && {
      ServiceId: p.ServiceId, SubServiceId: p.SubServiceId, SubServiceName: p.SubServiceName, SubServiceTypeId: p.SubServiceTypeId,
      SalesPolicyProducts: [{ PolicyId: r.PolicyId, PsId: r.PsId, ProgramId: r.ProgramID, RealQty: Math.max(r.DefaultQty || 0, r.FromQty || 1), RevokeId: r.RevokeId, StatusId: r.StatusId, DeployTypeId: r.DeployTypeId, ServiceCode: r.ServiceCode, Price: r.Price, PriceVAT: r.PriceVAT }],
    };
  }).filter(Boolean);
  return { Services, Products };
}

/**
 * Tạo + hoàn tất đơn Shop trên 1 phiên mới.
 * input: { route, sourceUrl, packageName, fullName, phone, address (đã resolve), note, offerKey, paymentCode, paymentPrefer[] }
 * -> { session, orderId, orderCode, method {code,name,method}, total, payment {type, url?, qrImage?, expireSeconds?}, offer, steps[], items[] }
 */
export async function placeShopOrder({ webUrl, proxy }, input) {
  const { route, address: a } = input;
  const steps = [];
  const session = await new ShopSession(webUrl, proxy).open(shopRegisterPath(input.sourceUrl, route));
  const loc = await shopLocation(session, a);
  const pkg = await getShopPackage(session, route, loc);
  if (!pkg?.HasPolicy) throw shopErr(`Địa chỉ không có chính sách bán gói này trên Shop (${a.wardName}, ${a.provinceName}) – không tạo được đơn`, 400, 'CHECKOUT_PACKAGE_NOT_AVAILABLE');

  const apt = a.houseType === 'apartment';
  const billing = apt
    ? [a.block && `Tòa ${a.block}`, a.floor && `Tầng ${a.floor}`, a.room && `Phòng ${a.room}`, a.buildingName, a.streetName, a.wardName, a.provinceName].filter(Boolean).join(', ')
    : `${a.addressNo} ${a.streetName}, ${a.wardName}, ${a.provinceName}`;
  const created = await session.post('selfservice/order/create', {
    CustomerInfo: {
      CusTypeId: 0, CusTypeL2Id: 0, ObjectTypeId: 0, FullName: input.fullName, IDCardType: 1, IDCard: '', PhoneSMS: input.phone, Gender: 1,
      LocationIdMain: loc.LocationId, DistrictIdMain: loc.DistrictId, WardIdMain: loc.WardId, StreetIdMain: Number(a.streetId) || 0,
      AddressNoMain: apt ? '' : a.addressNo, TypeHouseMain: apt ? '2' : '1', BuildingIdMain: loc.BuildingId, NoteAddress: input.note || '',
      BuildingNameMain: apt ? a.buildingName : '', FloorMain: apt ? a.floor : '', BlockMain: apt ? a.block : '', RoomMain: apt ? a.room : '',
      BillingAddress: billing, AddressType: 1,
    },
    OrderInfo: { Id: 0, ObjId: 0, SaleChannelId: 0, SaleTeamId: SALE_TEAM_ID, OrderType: 1, AccountId: 0, AccountName: '', AccountBranchId: 0, AccountLocationId: 0, RefId: 0, RefCode: '', RefSource: 0 },
    ServiceInfo: pkg.PackageServices,
    ExtendedProperties: null,
    ExtraOrderInfo: {
      TrackingID: '', CampInfo: { CampSource: '', CampMedium: '', CampName: '', CampTerm: '', CampContent: new URL(input.sourceUrl).pathname.replace(/^\//, ''), CampExtra: JSON.stringify({ route_name: route }) },
      ReferralCode: '', ReferralContract: '', WebDomainName: '', IP: '', GuestId: '',
    },
    BookportDto: { LatLng: ';' },
    ServiceType: 'internet',
    FBConvertionInfo: { fbp: '', fbc: '', Price: pkg.RealMonth || 0 },
    RouteName: route,
  });
  const orderId = created?.OrderInfo?.OrderId;
  const orderCode = created?.OrderInfo?.OrderCode;
  if (!orderId) throw shopErr('Shop order/create không trả OrderId');
  steps.push(`tạo đơn ${orderCode}`);

  const detail = await getShopDetail(session, route, loc, pkg, orderId);
  const { offers } = parseShopOffers(detail, pkg.PackageName);
  if (!offers.length) throw shopErr('Gói không có lựa chọn (chính sách) ở địa chỉ này', 400, 'CHECKOUT_PACKAGE_NOT_AVAILABLE');
  const offer = offers.find((o) => o.key === input.offerKey) ?? offers[0];
  const base = { OrderId: orderId, RouteName: route, OrderDetail: buildOrderDetail(detail, offer), Gifts: { Products: [], Services: [] }, Vouchers: [], OrderInfoExtended: null };

  const list = (await session.post('selfservice/payment/get-payment-method', base)) || [];
  const methods = list.filter((m) => m.Enable !== false).map((m) => ({ code: m.Code, name: m.Description || m.PaymentTypeL3Name || m.Code, method: m.Code === 'COD' ? 'COD' : 'Online', l2: m.PaymentTypeL2Id, l3: m.PaymentTypeL3Id, isDefault: m.Default === 1 }));
  if (!methods.length) throw shopErr('Gói không có phương thức thanh toán nào', 400);
  const preferred = (input.paymentPrefer || []).map((c) => methods.find((m) => m.code === c)).find(Boolean);
  const method = methods.find((m) => m.code === input.paymentCode) ?? (input.paymentCode ? null : preferred ?? methods.find((m) => m.isDefault) ?? methods[0]);
  if (!method) throw shopErr(`PTTT "${input.paymentCode}" không có cho đơn Shop này. Có: ${methods.map((m) => `${m.code} (${m.name})`).join(', ')}`, 400);

  await session.post('selfservice/order/update-detail', base);
  await session.post('selfservice/gift/update', { OrderId: orderId, Gifts: { Products: [], Services: [] } });
  steps.push(`sản phẩm ${offer.billingTypeName} ${offer.months} tháng`);
  const summary = await session.post('selfservice/order/summary', base);
  const total = summary?.OrderInfo?.TotalVAT ?? null;

  await session.post('selfservice/checkout/process-checkout', { OrderId: orderId, Vouchers: null, PaymentMethod: { PaymentTypeL2Id: method.l2, PaymentTypeL3Id: method.l3 }, TotalVat: total ?? 0, PrePaid: offer.prePaid });
  steps.push(`PTTT ${method.name}`);
  const tx = await session.post('selfservice/checkout/create-payment-transaction', { OrderId: orderId });
  steps.push('hoàn tất');

  const payment = tx?.DisplayType === 'QRCode' && tx.QRCodeInfo?.ImageBase64
    ? { type: 'qr', qrImage: tx.QRCodeInfo.ImageBase64, expireSeconds: (tx.QRCodeInfo.ExpireTime || 0) * 60, deeplink: tx.QRCodeInfo.OpenInAppDeeplink || '' }
    : tx?.DisplayType === 'WebApp' && tx.WebAppInfo?.RedirectUrl ? { type: 'redirect', url: tx.WebAppInfo.RedirectUrl } : { type: 'none' };
  const items = [...base.OrderDetail.Services.map((s) => ({ name: s.SubServiceName, quantity: 1, months: s.SalesPolicyServices[0].MonthUsed || null, amount: s.SalesPolicyServices[0].PriceVAT, amountText: formatVnd(s.SalesPolicyServices[0].PriceVAT) })),
    ...base.OrderDetail.Products.map((p) => ({ name: p.SubServiceName, quantity: p.SalesPolicyProducts[0].RealQty, months: null, amount: p.SalesPolicyProducts[0].PriceVAT, amountText: formatVnd(p.SalesPolicyProducts[0].PriceVAT) }))];
  return { session, orderId, orderCode: tx?.OrderCode || orderCode, method, total, payment, offer, steps, items };
}

/**
 * Trạng thái đơn Shop (cần phiên đã tạo đơn): COD (DisplayType None) -> đã tạo đơn; online -> chờ đến khi IsPaymentSuccessful.
 * -> { status, label, done?, paid?, waitingPayment?, tracking[] }
 */
export async function shopStatus(session, { orderId, paymentCode }) {
  const [pay, tracking] = await Promise.all([
    session.post('selfservice/payment/get-payment-status', { OrderId: orderId }),
    session.post('selfservice/order/get-tracking-by-order-id', { OrderId: orderId }).catch(() => []),
  ]);
  const steps = (tracking || []).map((t) => ({ desc: t.Desc, status: t.Status }));
  if (pay?.IsPaymentSuccessful) return { status: 'completed', label: 'Đã thanh toán', done: true, paid: true, tracking: steps };
  if (paymentCode === 'COD') return { status: 'completed', label: 'Đã tạo đơn · Thanh toán tại nhà', done: true, tracking: steps };
  return { status: 'recompleting', label: 'Chờ thanh toán', waitingPayment: true, tracking: steps };
}
