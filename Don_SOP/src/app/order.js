// Tạo đơn (báo giá) trên Sale Platform bằng API — phát lại luồng app SOP đã bắt được.
// Luồng: login -> (resolve địa chỉ) -> get-price-quotation -> order/validate(Confirm) -> order/update -> quotation/detail
import fs from 'node:fs';
import { login, spPost, SP } from '../core/sp.js';
import { save, updateContract } from '../core/store.js';

const ROOT = new URL('../../', import.meta.url);
const tpl = () => JSON.parse(fs.readFileSync(new URL('config/order-template.json', ROOT), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const ok = (r) => r.data?.Code === 200 || r.data?.Data?.Result != null;
const result = (r) => r.data?.Data?.Result;
const errMsg = (r) => {
  const m = r.data?.Message;
  return (m?.Message || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || m?.Title || `Code ${r.data?.Code}`;
};

const CACHE = new URL('.cache/sp-session.json', ROOT);

// Đăng nhập, trả về ngữ cảnh gọi API (token + instanceVer + hàm api()).
// Dùng lại token đã lưu nếu còn hạn (như app, ~8h) để tránh bị giới hạn đăng nhập.
export async function session({ fresh = false } = {}) {
  let res = null;
  if (!fresh) {
    try {
      const c = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
      if (c.expireAt > Date.now() + 60000 && c.result?.AccessToken) res = c.result;
    } catch {}
  }
  if (!res) {
    const { sp } = await login();
    res = sp.data?.Data?.Result;
    if (!res?.AccessToken) throw new Error('Đăng nhập Sale Platform lỗi: ' + errMsg(sp));
    const lifeMs = (res.AccessTokenLifeTime ? res.AccessTokenLifeTime * 60 * 1000 : 0) || 60 * 60 * 1000; // LifeTime tính bằng phút
    try { fs.mkdirSync(new URL('.cache/', ROOT), { recursive: true }); } catch {}
    fs.writeFileSync(CACHE, JSON.stringify({ expireAt: Date.now() + lifeMs, result: res }), { mode: 0o600 });
  }
  // InstanceVer là mảng [{Format:'sale/{instanceVer}', FormatVal:'sale/v1'}...] -> lấy 'v1' của nhóm sale
  let instanceVer = 'v1';
  if (Array.isArray(res.InstanceVer)) {
    const sale = res.InstanceVer.find((x) => /^sale\//.test(x.FormatVal || ''));
    const m = (sale?.FormatVal || '').match(/\/(v\d+)/);
    if (m) instanceVer = m[1];
  } else if (typeof res.InstanceVer === 'string') instanceVer = res.InstanceVer;
  const token = res.AccessToken;
  const api = (name, body) => spPost(SP.api, `${name.replace('{v}', instanceVer)}`, body, token);
  return { token, instanceVer, api, info: res };
}

const P = (instanceVer, p) => `gateway/sale/${instanceVer}/api/${p}`;

// Tra địa chỉ: tỉnh HCM=8 mặc định; tìm phường + đường theo tên (gần đúng, không dấu).
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function pick(list, name, nameKey = 'Name') {
  const n = norm(name);
  return list.find((x) => norm(x[nameKey]) === n) || list.find((x) => norm(x[nameKey]).includes(n) || n.includes(norm(x[nameKey]))) || null;
}

export async function resolveAddress(ctx, { locationId = 8, ward, street }) {
  const v = ctx.instanceVer;
  const dist = await ctx.api(P(v, 'order-info/get-district'), { LocationId: locationId });
  const wards = result(dist) || [];
  const w = ward ? pick(wards, ward) : wards[0];
  if (!w) throw new Error(`Không tìm thấy phường "${ward}"`);
  const st = await ctx.api(P(v, 'order-info/get-street'), { LocationId: locationId, DistrictId: w.Id, WardId: w.WardId });
  const streets = result(st) || [];
  const s = street ? pick(streets, street) : streets[0];
  if (!s) throw new Error(`Không tìm thấy đường "${street}" ở ${w.Name}`);
  return { LocationId: locationId, DistrictId: w.Id, WardId: w.WardId, StreetId: s.Id, wardName: w.Name, streetName: s.Name };
}

// Lấy context địa chỉ mặc định (theo mẫu đã bắt) để gọi net/packages
function defaultCtxAddress(T) {
  const a = T.orderUpdate.OrderDetails[0].Address;
  const c = T.orderUpdate.CustomerInfo;
  return { LocationId: a.LocationId, DistrictId: a.DistrictId, WardId: a.WardId, BuildingId: 0,
    CusTypeId: c.CusTypeId, CusTypeL2Id: c.CusTypeL2Id, ObjectTypeId: c.ObjectTypeId };
}

// Lấy danh sách NHÓM DỊCH VỤ khả dụng tại địa chỉ (Internet, FPT Play, Camera...)
export async function listServices(opts = {}) {
  const ctx = opts.ctx || await session();
  const v = ctx.instanceVer;
  const r = await ctx.api(P(v, 'order-info/get-permission-services'), { ServiceAvailable: [] });
  if (!ok(r)) throw new Error('Lấy nhóm dịch vụ lỗi: ' + errMsg(r));
  return (result(r)?.Services || []).map((x) => ({ serviceId: x.ServiceId, name: x.ServiceName }));
}

// Lấy TẤT CẢ gói Net + nhóm dịch vụ khả dụng tại 1 địa chỉ. Trả danh sách nhóm -> gói -> chu kỳ.
export async function listPackages(opts = {}) {
  const ctx = opts.ctx || await session();
  const v = ctx.instanceVer;
  const T = tpl();
  let base = defaultCtxAddress(T);
  if (opts.ward || opts.street) {
    const addr = await resolveAddress(ctx, { locationId: opts.locationId, ward: opts.ward, street: opts.street });
    base = { ...base, LocationId: addr.LocationId, DistrictId: addr.DistrictId, WardId: addr.WardId };
  }
  const r = await ctx.api(P(v, 'net/packages'), { ...base, ServiceAvailable: null, ObjId: 0 });
  if (!ok(r)) throw new Error('Lấy gói lỗi: ' + errMsg(r));
  const groups = {};
  for (const sub of result(r) || []) {
    const g = sub.SubServiceTypeName || 'Khác';
    (groups[g] = groups[g] || []).push({
      subServiceId: sub.SubServiceId, name: sub.SubServiceName,
      prepaids: (sub.PrePaid || []).map((p) => ({ key: p.Key, months: p.MonthUsed, label: p.Value })),
      deployTypes: (sub.DeployTypes || []).map((d) => ({ id: d.DeployTypeId, name: d.DeployTypeName })),
    });
  }
  return groups;
}

// Thay SĐT/tên/số nhà vào các thân request bắt được (địa chỉ giữ như mẫu đã bắt).
function patchCustomer(c, { name, phone, addressNo }) {
  if (!c) return c;
  if (name != null) c.FullName = name;
  if (phone != null) c.PhoneSMS = phone;
  if (addressNo != null) c.AddressNoMain = String(addressNo);
  return c;
}
function patchOrderDetails(list, { addressNo }) {
  if (Array.isArray(list)) for (const d of list) if (d.Address && addressNo != null) d.Address.AddressNo = String(addressNo);
  return list;
}

// Lấy OrderTag + mã đơn từ chi tiết đơn
export async function orderDetail(ctx, orderId) {
  const d = await ctx.api(P(ctx.instanceVer, 'order/detail'), { OrderId: orderId });
  const info = result(d)?.OrderInfo;
  if (!info) throw new Error('Không lấy được chi tiết đơn ' + orderId + ': ' + errMsg(d));
  return info;
}

// Tạo HỢP ĐỒNG từ 1 đơn đã có. Trả { contractCode, objId, orderCode }
export async function createContract(orderId, providedCtx) {
  const ctx = providedCtx || await session();
  const v = ctx.instanceVer;
  const info = await orderDetail(ctx, orderId);
  const orderCode = info.OrderCode;
  const val = await ctx.api(P(v, 'contract/validate'), { OrderId: orderId, OrderTag: info.OrderTag });
  const k1 = result(val)?.ValidateKey;
  if (!k1) throw new Error('contract/validate lỗi: ' + errMsg(val));
  const reg = await ctx.api(P(v, 'contract/create-registration'), { OrderId: orderId, ValidateKey: k1 });
  const k2 = result(reg)?.ValidateKey;
  if (!k2) throw new Error('contract/create-registration lỗi: ' + errMsg(reg));
  const cre = await ctx.api(P(v, 'contract/create'), { OrderId: orderId, ValidateKey: k2 });
  const c = result(cre);
  if (!c?.ObjContract) throw new Error('contract/create lỗi: ' + errMsg(cre));
  updateContract(orderId, c.ObjContract);
  return { contractCode: c.ObjContract, objId: c.ObjId, orderCode, orderId };
}

// Đặt địa chỉ (DistrictId/WardId/StreetId) vào mọi OrderDetails.Address + CustomerInfo *Main của 1 body
function setAddress(body, addr) {
  if (!addr) return;
  const a = { DistrictId: addr.DistrictId, WardId: addr.WardId, StreetId: addr.StreetId };
  if (addr.LocationId != null) a.LocationId = addr.LocationId;
  if (Array.isArray(body.OrderDetails)) for (const d of body.OrderDetails) if (d.Address) Object.assign(d.Address, a);
  if (body.CustomerInfo) {
    const c = body.CustomerInfo;
    if (addr.LocationId != null) c.LocationIdMain = addr.LocationId;
    c.DistrictIdMain = addr.DistrictId; c.WardIdMain = addr.WardId; c.StreetIdMain = addr.StreetId;
  }
}
// Đặt ServiceDetail (gói đã chọn) vào mọi OrderDetails.Services[].ServiceDetail của 1 body
function setServiceDetail(body, sd) {
  if (!sd) return;
  if (Array.isArray(body.OrderDetails)) for (const d of body.OrderDetails) for (const s of (d.Services || [])) s.ServiceDetail = clone(sd);
}
// Dựng ServiceDetail cho gói chọn. Nền = mẫu REQUEST báo giá (các trường chính sách = 0)
// để server tự định giá lại theo gói; không lấy nền đã-định-giá (dính chính sách gói cũ).
function buildServiceDetail(T, pkg, prepaid, deployType) {
  const base = clone(T.priceQuotation.Services[0].ServiceDetail[0]);
  Object.assign(base, {
    SubServiceId: pkg.subServiceId, SubServiceName: pkg.name,
    PrePaid: prepaid.months, MonthUsed: prepaid.months, Key: prepaid.key, PrePaidName: prepaid.label,
    DeployTypeId: deployType?.id ?? base.DeployTypeId, DeployTypeName: deployType?.name ?? base.DeployTypeName,
    // xoá mọi dấu vết chính sách/giá của gói cũ
    ProgramId: 0, PromotionId: 0, PsId: 0, PolicyId: 0, PolicyName: '', PsGroup: 0, PriceGroupId: '',
    Title: [], Total: 0, TotalVAT: 0, Discount: 0, DiscountVAT: 0,
  });
  return [base];
}

// Tạo 1 báo giá. opts: { phone, name, addressNo, paymentType, ward, street, locationId, package, prepaidKey, prepaidMonths }
// Không truyền ward/street/package -> phát lại mẫu đã bắt. Có -> tự tra địa chỉ + chọn gói.
// Danh sách Xã/Phường (HCM mặc định) — cùng nguồn app dùng cho dropdown Xã/Phường.
export async function listWards({ locationId = 8, ctx } = {}) {
  ctx = ctx || await session();
  const r = await ctx.api(P(ctx.instanceVer, 'order-info/get-district'), { LocationId: locationId });
  if (!ok(r)) throw new Error('Lấy Xã/Phường lỗi: ' + errMsg(r));
  return (result(r) || []).map((w) => w.Name);
}
// Danh sách Đường của 1 phường — cùng nguồn app dùng cho dropdown Đường.
export async function listStreets({ locationId = 8, ward, ctx } = {}) {
  ctx = ctx || await session();
  const v = ctx.instanceVer;
  const d = await ctx.api(P(v, 'order-info/get-district'), { LocationId: locationId });
  const w = pick(result(d) || [], ward);
  if (!w) throw new Error(`Không tìm thấy phường "${ward}"`);
  const r = await ctx.api(P(v, 'order-info/get-street'), { LocationId: locationId, DistrictId: w.Id, WardId: w.WardId });
  if (!ok(r)) throw new Error('Lấy Đường lỗi: ' + errMsg(r));
  return (result(r) || []).map((s) => s.Name);
}

// Kiểm tra gói có chính sách giá tại địa chỉ không (chạy validate + get-price-quotation như app,
// KHÔNG tạo đơn). Trả { ok:true, totalVAT, policyName, title } hoặc { ok:false, error } (thông báo của hệ thống).
export async function checkPrice(opts = {}) {
  try {
    const ctx = await session();
    const p = await prepareQuote(ctx, tpl(), opts);
    const d = p.policy || {};
    return { ok: true, totalVAT: p.totalVAT, policyName: d.PolicyName || '', title: (d.Title || []).join(', '), package: p.serviceDetail?.[0]?.SubServiceName, prepaid: p.serviceDetail?.[0]?.PrePaidName };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function createQuote(opts = {}) {
  const ctx = await session();
  const v = ctx.instanceVer;
  const T = tpl();
  const { patch, dynamic, addr, serviceDetail, policyKey, pricedDetail, totalVAT } = await prepareQuote(ctx, T, opts);

  // 3. order/validate (Confirm:1 bỏ qua cảnh báo trùng đơn) -> ValidateKey
  const valReq = clone(T.orderValidate);
  valReq.Confirm = 1; valReq.PolicyKey = policyKey;
  patchCustomer(valReq.CustomerInfo, patch); patchOrderDetails(valReq.OrderDetails, patch);
  setAddress(valReq, addr); if (pricedDetail) setServiceDetail(valReq, pricedDetail);
  if (opts.paymentType != null) valReq.OrderInfo.PaymentType = opts.paymentType;
  valReq.OrderInfo.TotalVAT = valReq.OrderInfo.TotalVATOriginal = totalVAT;
  let val = await ctx.api(P(v, 'order/validate'), valReq);
  if (!result(val)?.ValidateKey) val = await ctx.api(P(v, 'order/validate'), valReq); // một số case cần 2 lượt
  const validateKey = result(val)?.ValidateKey;
  if (!validateKey) throw new Error('order/validate không trả ValidateKey: ' + errMsg(val));

  // 4. order/update -> OrderId + OrderCode
  const updReq = clone(T.orderUpdate);
  updReq.Confirm = 1; updReq.PolicyKey = policyKey; updReq.ValidateKey = validateKey;
  patchCustomer(updReq.CustomerInfo, patch); patchOrderDetails(updReq.OrderDetails, patch);
  setAddress(updReq, addr); if (pricedDetail) setServiceDetail(updReq, pricedDetail);
  if (opts.paymentType != null) updReq.OrderInfo.PaymentType = opts.paymentType;
  updReq.OrderInfo.TotalVAT = updReq.OrderInfo.TotalVATOriginal = totalVAT;
  const upd = await ctx.api(P(v, 'order/update'), updReq);
  const u = result(upd);
  if (!u?.OrderCode) throw new Error('Tạo đơn lỗi: ' + errMsg(upd));

  // 5. quotation/detail -> link báo giá
  const q = await ctx.api(P(v, 'quotation/detail'), { OrderId: u.OrderId });
  const quote = result(q)?.Quotation;

  const rec = {
    orderId: u.OrderId, orderCode: u.OrderCode, totalVAT,
    quotationCode: quote?.QuotationCode, quotationUrl: quote?.URL, status: quote?.StatusDescription,
    phone: patch.phone, name: patch.name,
    package: serviceDetail?.[0]?.SubServiceName || 'Giga (mẫu)',
    ward: addr?.wardName, street: addr?.streetName,
    createdAt: new Date().toISOString(),
  };
  save(rec);
  return rec;
}

// Bước 0-2 của luồng tạo đơn: tra địa chỉ + dựng gói + validate + lấy báo giá (PolicyKey, giá).
// Ném lỗi (kèm thông báo của hệ thống) nếu gói không có chính sách giá tại địa chỉ.
async function prepareQuote(ctx, T, opts) {
  const v = ctx.instanceVer;
  const patch = { phone: opts.phone || '0868650892', name: opts.name || 'QC test', addressNo: opts.addressNo ?? '1' };
  const dynamic = !!(opts.ward || opts.street || opts.package);

  // 0. Nếu đổi địa chỉ/gói: tra địa chỉ + chọn gói, dựng ServiceDetail
  let addr = null, serviceDetail = null;
  if (dynamic) {
    if (opts.ward || opts.street) addr = await resolveAddress(ctx, { locationId: opts.locationId, ward: opts.ward, street: opts.street });
    if (opts.package) {
      const groups = await listPackages({ ctx, ward: opts.ward, street: opts.street, locationId: opts.locationId });
      const all = Object.values(groups).flat();
      const n = norm(opts.package);
      const pkg = all.find((p) => norm(p.name) === n) || all.find((p) => norm(p.name).includes(n));
      if (!pkg) throw new Error(`Không tìm thấy gói "${opts.package}". Xem danh sách: node src/cli.js packages`);
      let pp = null;
      if (opts.prepaidKey) pp = pkg.prepaids.find((x) => x.key === opts.prepaidKey);
      else if (opts.prepaidLabel) pp = pkg.prepaids.find((x) => norm(x.label) === norm(opts.prepaidLabel));
      else if (opts.prepaidMonths != null) pp = pkg.prepaids.find((x) => x.months === Number(opts.prepaidMonths));
      pp = pp || pkg.prepaids.find((x) => x.key === '6_6') || pkg.prepaids.find((x) => x.months > 1) || pkg.prepaids[0];
      if (opts.prepaidLabel && !pp) throw new Error(`Gói "${pkg.name}" không có gói tính cước "${opts.prepaidLabel}"`);
      if (!pp) throw new Error(`Gói "${pkg.name}" không có chu kỳ khả dụng`);
      serviceDetail = buildServiceDetail(T, pkg, pp, pkg.deployTypes?.[0]);
    }
  }

  // 1. Chuẩn bị bối cảnh: validate dịch vụ Net + validate service-info
  const vn = clone(T.validateNet); patchOrderDetails(vn.OrderDetails, patch); setAddress(vn, addr); setServiceDetail(vn, serviceDetail);
  const vnr = await ctx.api(P(v, 'order-info/validate-net-service-info'), vn);
  if (result(vnr)?.IsValid === false) throw Object.assign(new Error(result(vnr).Reason || errMsg(vnr)), { pickAnotherPackage: true });
  let popCode = null;
  if (T.validateServiceInfo) {
    const vs = clone(T.validateServiceInfo); patchOrderDetails(vs.OrderDetails, patch); setAddress(vs, addr); setServiceDetail(vs, serviceDetail);
    const vsr = await ctx.api(P(v, 'order-info/validate-service-info'), vs);
    popCode = result(vsr)?.DataPort?.PopCode || null;
  }

  // 2. Báo giá -> PolicyKey + giá
  const priceReq = clone(T.priceQuotation);
  if (addr) { priceReq.LocationId = addr.LocationId; priceReq.DistrictId = addr.DistrictId; priceReq.WardId = addr.WardId; }
  if (popCode) priceReq.POPCode = popCode;
  if (serviceDetail && priceReq.Services?.[0]) priceReq.Services[0].ServiceDetail = clone(serviceDetail);
  const price = await ctx.api(P(v, 'order-info/get-price-quotation'), priceReq);
  if (!ok(price)) throw new Error('Lấy báo giá lỗi: ' + errMsg(price));
  const priceRes = result(price);
  const policyKey = priceRes.Key;
  const pricedDetail = priceRes.Services?.[0]?.ServiceDetail;
  const sum = priceSummary(pricedDetail);
  const totalVAT = sum.total || (dynamic && serviceDetail ? 0 : T.orderUpdate.OrderInfo.TotalVAT);
  // Gói đổi mà không có chính sách giá tại địa chỉ (không bán được ở đây) -> báo để chọn gói khác
  if (dynamic && serviceDetail && (!sum.policy || totalVAT <= 0)) {
    const e = new Error(`Gói "${serviceDetail[0].SubServiceName}" không có giá tại địa chỉ này (không bán được ở đây). Vui lòng chọn gói khác.`);
    e.pickAnotherPackage = true;
    throw e;
  }

  return { patch, dynamic, addr, serviceDetail, policyKey, pricedDetail, totalVAT, policy: sum.policy };
}

// Giá thật nằm trong ServiceDetail[].Price[] (mục Default=1) + ExtendedServices (phí lắp đặt...).
function priceSummary(pricedDetail) {
  let total = 0, policy = null;
  for (const d of pricedDetail || []) {
    const list = d.Price || [];
    const p = list.find((x) => x.Default === 1) || list[0];
    if (p) {
      policy = policy || p;
      total += (p.TotalVAT || 0) + (p.ExtendedServices || []).reduce((s, e) => s + (e.TotalVAT || 0), 0);
    } else {
      total += d.TotalVAT || 0;
      if (!policy && d.PolicyId) policy = d;
    }
  }
  return { total, policy };
}

// Tạo đơn RỒI tạo hợp đồng luôn, có retry khi lỗi tạm thời.
// opts như createQuote + { retries = 2 }. Trả rec kèm contractCode.
export async function createQuoteWithContract(opts = {}) {
  const retries = opts.retries ?? 2;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const rec = await createQuote(opts);
      try {
        const c = await createContract(rec.orderId);
        rec.contractCode = c.contractCode; rec.objId = c.objId;
      } catch (ce) {
        rec.contractError = ce.message; // đơn đã tạo xong, chỉ HĐ lỗi
      }
      return rec;
    } catch (e) {
      lastErr = e;
      if (e.pickAnotherPackage) throw e; // lỗi do gói -> không retry, để user chọn gói khác
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

// ---- Nhóm dịch vụ khác Internet (FPT Play...) — phát lại khuôn bắt từ Portal (config/service-templates.json) ----
const svcTpl = () => { try { return JSON.parse(fs.readFileSync(new URL('config/service-templates.json', ROOT), 'utf8')); } catch { return {}; } };
export const desktopServices = () => Object.keys(svcTpl()).filter((k) => !k.startsWith('_'));
// ---- Nhóm dựng THẲNG từ API (mục có "gen" trong service-templates.json, không cần ghi từ Portal) ----
// gen: { id, name, validate, extKey?, pkgs:[{path, body?, name?, prepaid?}], devs:[{path, body?, name?, line?:{path, idKey}}] }
// pkgs[0] = gói chính (chọn trên UI); pkgs[1..] = gói kèm theo mặc định. devs[0] = thiết bị (chọn trên UI).
// Không có pkgs (Smart Home) -> kiểu "retail": danh sách thiết bị làm "gói", biến thể lấy từ devs[0].line.
const GEN_BASE = { LocationId: 8, DistrictId: 1000009764, WardId: 1000107464, BuildingId: 0, CusTypeId: 102, CusTypeL2Id: 132, ObjectTypeId: 138, ServiceAvailable: null, ObjId: 0 };
const genShape = () => { const c = svcTpl()['FPT Camera']; return { svc: c.priceQuotation.Services[0].ServiceDetail[0], prod: c.priceQuotation.Products[0].ProductDetail[0], addr: c.validateService.body.OrderDetails[0].Address }; };
const genList = async (ctx, p, extra = {}) => {
  const r = await ctx.api(P(ctx.instanceVer, p.path), { ...GEN_BASE, ...(p.body || {}), ...extra });
  if (!ok(r) || !Array.isArray(result(r))) throw new Error('App báo: ' + errMsg(r));
  return result(r);
};
const mapPkg = (x) => ({ id: x.SubServiceId, name: x.SubServiceName, typeId: x.SubServiceTypeId, typeName: x.SubServiceTypeName, deploy: (x.DeployTypes || [])[0],
  prepaids: (x.PrePaid || []).map((p) => ({ key: p.Key, label: p.Value, prepaid: p.PrePaid, months: p.MonthUsed })) });
const genSvcLine = (g, pk, pp) => ({ ...genShape().svc, ServiceId: g.id, ServiceName: g.name, SubServiceTypeId: pk.typeId, SubServiceTypeName: pk.typeName, SubServiceId: pk.id, SubServiceName: pk.name,
  PrePaid: pp.prepaid, PrePaidName: pp.label, MonthUsed: pp.months, Key: pp.key, DeployTypeId: pk.deploy?.DeployTypeId ?? 0, DeployTypeName: pk.deploy?.DeployTypeName ?? 'Không' });
const genProdLine = (g, dv) => { const l = { ...genShape().prod, ServiceId: g.id, ServiceName: g.name }; for (const k of [...DEV_KEYS, 'ApplySubServiceId', 'ApplyPrePaid']) if (k in dv) l[k] = dv[k]; return l; };
// Dựng validateService + priceQuotation cho nhóm gen theo lựa chọn (sel: {pk, pp, dv}).
async function genTemplate(ctx, t, sel) {
  const g = t.gen, Services = [], Products = [];
  if (sel.pp) Services.push(genSvcLine(g, sel.pk, sel.pp));
  for (const p of (g.pkgs || []).slice(1)) {
    const list = (await genList(ctx, p)).map(mapPkg);
    const pk = list.find((x) => x.name === p.name) || list[0];
    const pp = pk && (pk.prepaids.find((x) => x.label === p.prepaid) || pk.prepaids[0]);
    if (pk && pp) Services.push(genSvcLine(g, pk, pp));
  }
  if (sel.dv) Products.push(genProdLine(g, sel.dv));
  const S = Services.length ? [{ ServiceId: g.id, ServiceName: g.name, ServiceDetail: Services }] : [];
  const Pr = Products.length ? [{ ServiceId: g.id, ServiceName: g.name, ProductDetail: Products }] : [];
  const { ObjId, ...b } = GEN_BASE;
  // Dịch vụ bắt buộc mua kèm (VIP 247 cần Camera/Play/Internet; VioEdu cần Internet gói Sky):
  // with: { template: '<nhóm có khuôn Portal>' } -> lấy nguyên dòng báo giá của khuôn đó; hoặc { id, name, pkgs, devs } -> dựng như gen.
  const extKeys = [];
  const PS = [], PP = [];
  for (const w of g.with || []) {
    if (w.template) {
      const wt = svcTpl()[w.template];
      PS.push(...clone(wt.priceQuotation.Services || [])); PP.push(...clone(wt.priceQuotation.Products || []));
      if (wt.extKey) extKeys.push(wt.extKey);
      continue;
    }
    const ws = [], wp = [];
    for (const p of w.pkgs || []) {
      const list = (await genList(ctx, p)).map(mapPkg);
      const pk = list.find((x) => x.name === p.name) || list[0];
      const pp = pk && (pk.prepaids.find((x) => x.label === p.prepaid) || pk.prepaids[0]);
      if (!pk || !pp) throw new Error(`App báo: Không có gói "${p.name || ''}" của ${w.name} để mua kèm.`);
      ws.push(genSvcLine(w, pk, pp));
    }
    for (const d of w.devs || []) {
      const list = await genList(ctx, d);
      const dv = list.find((x) => x.SubServiceName === d.name && x.StatusName === 'Mới' && x.DeployTypeName === 'TIN/PNC') || list.find((x) => x.SubServiceName === d.name) || list[0];
      if (dv) wp.push(genProdLine(w, dv));
    }
    // Internet: thiết bị (ONT) không có API danh sách riêng -> lấy dòng thiết bị trong khuôn đơn Internet đã ghi, gắn theo gói vừa chọn.
    if (w.netDevice && ws[0]) {
      const src = (tpl().orderValidate.OrderDetails[0].Products || []).find((x) => x.ServiceId === 1)?.ProductDetail?.[0];
      if (src) wp.push({ ...genShape().prod, ...clone(src), ApplySubServiceId: ws[0].SubServiceId, ApplyPrePaid: ws[0].PrePaid,
        ProgramId: 0, PromotionId: 0, PsId: 0, PolicyId: 0, PolicyName: '', PsGroup: 0, PriceGroupId: '', Title: [], Total: 0, TotalVAT: 0, Discount: 0, DiscountVAT: 0, ServiceCode: 0, Default: 0 });
    }
    if (ws.length) PS.push({ ServiceId: w.id, ServiceName: w.name, ServiceDetail: ws });
    if (wp.length) PP.push({ ServiceId: w.id, ServiceName: w.name, ProductDetail: wp });
  }
  return {
    extKey: g.extKey, extKeys, extProps: g.extProps,
    validateService: g.validate ? { path: g.validate, body: { OrderDetails: [{ Address: clone(genShape().addr), Services: [...PS, ...S], Products: [...PP, ...Pr] }], OrderRenewDetails: null } } : null,
    priceQuotation: { ...b, POPCode: null, Services: [...PS, ...S], Products: [...PP, ...Pr], ExtendedInfo: g.extInfo || [] },
  };
}
export function serviceTemplateInfo(service) {
  const t = svcTpl()[service];
  if (!t || service.startsWith('_')) return null;
  if (t.gen) {
    const d = t.default || {};
    return { service, phone: t.phone, source: t.source || 'Dựng từ API Sale Platform', default: d, labels: t.labels || {}, gen: true,
      items: [d.package && `${d.package}${d.prepaid ? ` (${d.prepaid})` : ''}`, ...(t.gen.pkgs || []).slice(1).map((p) => p.name && `${p.name}${p.prepaid ? ` (${p.prepaid})` : ''}`), d.device].filter(Boolean), totalVAT: t.totalVAT ?? null };
  }
  const items = [];
  eachDetail(t.priceQuotation, (kind, x) => items.push(kind === 'svc' ? `${x.SubServiceName}${x.PrePaidName ? ` (${x.PrePaidName})` : ''}` : `${x.SubServiceName} (${[x.StatusName, x.DeployTypeName].filter(Boolean).join(' + ')})`));
  return { service, phone: t.phone, source: t.source, default: t.default || {}, labels: t.options?.labels || {}, items, totalVAT: t.totalVAT };
}
// Danh sách gói + chu kỳ của nhóm (FPT Play: fptplay/packages, Camera: camera-bundle/cloud, ...).
// Sản phẩm khác (kind=retail): "gói" = thiết bị lẻ lấy từ retailequipment/list-type.
export async function servicePackages(service, providedCtx) {
  const t = svcTpl()[service];
  if (t?.gen) {
    const ctx = providedCtx || await session();
    if (t.gen.pkgs?.length) return (await genList(ctx, t.gen.pkgs[0])).map(mapPkg);
    return (await genList(ctx, t.gen.devs[0])).map((d) => ({ id: d.SubServiceId, name: d.SubServiceName, prepaids: [] }));
  }
  if (!t?.options?.packages) return [];
  const ctx = providedCtx || await session();
  const r = await ctx.api(P(ctx.instanceVer, t.options.packages.path), t.options.packages.body);
  if (!ok(r)) throw new Error('Lấy gói lỗi: ' + errMsg(r));
  if (t.options.kind === 'retail') {
    return (result(r) || []).flatMap((g) => (g.ParentDetail || []).map((d) => ({ id: d.SubServiceId, name: `${g.ParentName} › ${d.SubServiceName}`, prepaids: [] })));
  }
  return (result(r) || []).map((x) => ({ id: x.SubServiceId, name: x.SubServiceName, typeId: x.SubServiceTypeId, typeName: x.SubServiceTypeName,
    prepaids: (x.PrePaid || []).map((p) => ({ key: p.Key, label: p.Value, prepaid: p.PrePaid, months: p.MonthUsed })) }));
}
// Thiết bị (FPT Play: phụ thuộc gói + chu kỳ; Sản phẩm khác: các biến thể của thiết bị đã chọn)
export async function serviceDevices(service, pkgId, prepaid, providedCtx) {
  const t = svcTpl()[service];
  if (t?.gen) {
    const dv = t.gen.devs?.[0];
    if (!dv) return [];
    const ctx = providedCtx || await session();
    const retail = !t.gen.pkgs?.length;
    const list = retail ? await genList(ctx, dv.line, { [dv.line.idKey || 'SubServiceId']: Number(pkgId) })
      : await genList(ctx, dv, dv.dependsOnPkg ? { ApplySubServiceId: Number(pkgId), ApplyPrePaid: Number(prepaid) } : {});
    return list.map((d) => ({ ...d, label: `${d.SubServiceName} (${[d.StatusName, d.DeployTypeName].filter(Boolean).join(' + ')}${retail ? `, thu hồi ${d.RevokeName}` : ''})${!retail && d.ParentName && d.ParentName !== d.SubServiceName ? ' · ' + d.ParentName : ''}` }));
  }
  if (!t?.options?.devices) return [];
  const ctx = providedCtx || await session();
  const o = t.options;
  const body = o.kind === 'retail' ? { ...o.devices.body, SubServiceId: Number(pkgId) }
    : o.devices.dependsOnPkg ? { ...o.devices.body, ApplySubServiceId: Number(pkgId), ApplyPrePaid: Number(prepaid) } : o.devices.body;
  const r = await ctx.api(P(ctx.instanceVer, o.devices.path), body);
  if (!ok(r)) throw new Error('Lấy thiết bị lỗi: ' + errMsg(r));
  return (result(r) || []).map((d) => ({ ...d, label: `${d.SubServiceName} (${[d.StatusName, d.DeployTypeName].filter(Boolean).join(' + ')}${o.kind === 'retail' ? `, thu hồi ${d.RevokeName}` : ''})${o.kind === 'retail' ? '' : (d.ParentName ? ' · ' + d.ParentName : '')}` }));
}
const DEV_KEYS = ['SubServiceTypeId', 'SubServiceTypeName', 'ParentName', 'ParentNameVN', 'GroupId', 'SubServiceId', 'SubServiceName', 'StatusId', 'StatusName', 'RevokeId', 'RevokeName', 'DeployTypeId', 'DeployTypeName', 'UseId', 'UseName', 'LanWire'];
const eachDetail = (body, fn) => { for (const d of body.OrderDetails || [body]) { for (const s of d.Services || []) (s.ServiceDetail || []).forEach((x, i) => fn('svc', x, i, s)); for (const p of d.Products || []) (p.ProductDetail || []).forEach((x, i) => fn('prod', x, i, p)); } };
// Ghép giá từ get-price-quotation vào 1 dòng chi tiết (như Portal): trường chính sách lấy từ Price[Default=1]
function pricedLine(priced, tmpl) {
  const p = (priced.Price || []).find((x) => x.Default === 1) || (priced.Price || [])[0];
  const out = { ...tmpl };
  for (const k of Object.keys(out)) {
    if (p && k in p && k !== 'Default' && k !== 'ServiceCode') out[k] = p[k];
    else if (k in priced && k !== 'Price') out[k] = priced[k];
  }
  return { line: out, price: p };
}
// Dựng thân order/validate: KH (có ảnh giấy tờ) dùng chung + địa chỉ + dòng dịch vụ/thiết bị đã gắn giá.
// Dòng chi tiết của validate có đúng cấu trúc dòng trong request báo giá -> lấy request làm khuôn, đổ giá từ phản hồi.
export function buildValidate(t, cust, reqPQ, pr, phone, service) {
  const shell = clone(t.orderValidate || cust.orderValidate);
  const sp = t.orderValidate ? t.phone : cust.phone;
  const val = JSON.parse(JSON.stringify(shell).replaceAll(`"${sp}"`, JSON.stringify(phone)));
  const addr = (t.validateService?.body?.OrderDetails || [])[0]?.Address || val.OrderDetails?.[0]?.Address;
  let total = 0;
  const priceLines = (reqList, resList, key) => {
    const out = [];
    for (const rq of reqList || []) {
      const rs = (resList || []).find((x) => x.ServiceId === rq.ServiceId) || {};
      const lines = [];
      (rs[key] || []).forEach((pd, j) => {
        const tmpl = (rq[key] || [])[j] || (rq[key] || [])[0] || {};
        const { line, price: p } = pricedLine(pd, tmpl);
        if (!p) throw new Error(`App báo: Không tìm thấy chính sách giá cho ${pd.SubServiceName}${pd.PrePaidName ? ` (${pd.PrePaidName})` : ''}.`);
        lines.push(line); total += p.TotalVAT || 0;
        for (const e of [...(p.ExtendedServices || []), ...(key === 'ProductDetail' ? [] : [])]) {
          const ex = { ...tmpl };
          for (const k of Object.keys(e)) if (k in tmpl || /^Apply/.test(k)) ex[k] = e[k];
          lines.push(ex); total += e.TotalVAT || 0;
        }
      });
      // Thiết bị Internet đi kèm (ONT 0đ) không được báo giá trả lại -> giữ nguyên dòng request như Portal.
      if (!lines.length && rq.ServiceId === 1 && key === 'ProductDetail') lines.push(...clone(rq[key] || []));
      out.push({ ...rq, [key]: lines });
    }
    return out;
  };
  const Services = priceLines(reqPQ.Services, pr.Services, 'ServiceDetail');
  const Products = priceLines(reqPQ.Products, pr.Products, 'ProductDetail').filter((x) => x.ProductDetail.length);
  val.OrderDetails = [{ Address: clone(addr), Services, Products }];
  val.OrderInfo.ServiceList = [...new Set([...Services, ...Products].map((x) => x.ServiceId))];
  val.OrderInfo.TotalVAT = val.OrderInfo.TotalVATOriginal = total;
  if (val.ExtendedProperties && service !== 'FPT Play') delete val.ExtendedProperties.FPTPlay;
  const ep = t.validateService?.body?.ExtendedProperties;
  if (ep) val.ExtendedProperties = { ...(val.ExtendedProperties || {}), ...clone(ep) };
  if (t.extProps) val.ExtendedProperties = { ...(val.ExtendedProperties || {}), ...clone(t.extProps) };
  for (const k of [t.extKey, ...(t.extKeys || [])].filter(Boolean)) val.ExtendedProperties = { ...(val.ExtendedProperties || {}), [k]: { ...((val.ExtendedProperties || {})[k] || {}), PhoneNumber: phone } };
  return val;
}
// opts: {service, phone, name, contract, package, prepaid, device}
export async function createServiceQuote(opts = {}) {
  const t = svcTpl()[opts.service];
  if (!t) throw new Error(`Desktop chưa có khuôn cho nhóm "${opts.service}" — dùng tab Mobile.`);
  const ctx = await session();
  const v = ctx.instanceVer;
  const phone = opts.phone || t.phone;
  const swap = (o) => JSON.parse(JSON.stringify(o).replaceAll(`"${t.phone}"`, JSON.stringify(phone)));
  // Gói / chu kỳ / thiết bị user chọn (mặc định theo mẫu)
  const want = { ...(t.default || {}), ...Object.fromEntries(['package', 'prepaid', 'device'].filter((k) => opts[k]).map((k) => [k, opts[k]])) };
  let sel = null;
  const retailKind = t.gen ? !t.gen.pkgs?.length : t.options?.kind === 'retail';
  if (t.options || t.gen) {
    const pks = await servicePackages(opts.service, ctx);
    const pk = pks.find((x) => x.name === want.package) || pks.find((x) => x.name.toLowerCase() === String(want.package).toLowerCase()) || pks.find((x) => norm(x.name) === norm(want.package) && !/\+/.test(x.name + want.package));
    if (!pk) throw new Error(`App báo: Không có "${want.package}" tại địa chỉ này.`);
    let pp = null;
    if (pk.prepaids.length) {
      pp = pk.prepaids.find((x) => x.label === want.prepaid) || pk.prepaids.find((x) => norm(x.label) === norm(want.prepaid)) || pk.prepaids.find((x) => x.key === want.prepaid);
      if (!pp) throw new Error(`App báo: Gói "${pk.name}" không có gói tính cước "${want.prepaid}".`);
    }
    const devs = await serviceDevices(opts.service, pk.id, pp?.prepaid, ctx);
    const pref = (l) => l.sort((a, b) => (b.StatusName === 'Mới') - (a.StatusName === 'Mới') || (b.RevokeName === 'Không') - (a.RevokeName === 'Không') || (b.DeployTypeName === 'TIN/PNC') - (a.DeployTypeName === 'TIN/PNC'));
    const dv = want.device ? (devs.find((d) => d.label === want.device) || pref(devs.filter((d) => norm(d.SubServiceName) === norm(want.device)))[0]) : null;
    if (want.device && !dv) throw new Error(`App báo: Thiết bị "${want.device}" không áp dụng cho ${pk.name}${pp ? ' ' + pp.label : ''}.`);
    if (retailKind && !dv) throw new Error('App báo: Chưa chọn thiết bị.');
    sel = { pk, pp, dv, dependsOnPkg: !!(t.gen ? t.gen.devs?.[0]?.dependsOnPkg : t.options.devices?.dependsOnPkg), retail: retailKind };
  }
  if (t.gen && opts.cross?.noWith) t.gen.with = []; // bán thêm: HĐ đã có dịch vụ nền (Internet...) -> không mua kèm lại
  if (t.gen) Object.assign(t, await genTemplate(ctx, t, sel));
  const applySel = (body) => {
    if (!sel || t.gen) return body;
    eachDetail(body, (kind, x, i) => {
      if (kind === 'svc' && i === 0 && sel.pp) Object.assign(x, { SubServiceId: sel.pk.id, SubServiceName: sel.pk.name, PrePaid: sel.pp.prepaid, PrePaidName: sel.pp.label, MonthUsed: sel.pp.months, Key: sel.pp.key });
      if (kind === 'prod' && i === 0 && sel.dv) { for (const k of DEV_KEYS) if (k in sel.dv) x[k] = sel.dv[k]; if (sel.dependsOnPkg) { x.ApplySubServiceId = sel.pk.id; x.ApplyPrePaid = sel.pp.prepaid; } }
    });
    if (!sel.dv) for (const d of body.OrderDetails || [body]) if (d.Products) d.Products = [];

    return body;
  };
  // opts.cross (bán thêm, xem cross-sell.js): đổi path sang cross-selling + gắn ObjId/địa chỉ/KH của hợp đồng
  const X = opts.cross;
  if (t.validateService) {
    const vb = applySel(swap(t.validateService.body));
    const r = await ctx.api(P(v, X ? X.path(t.validateService.path) : t.validateService.path), X ? X.body(vb) : vb);
    if (result(r)?.IsValid === false) throw new Error(`App báo: ${(result(r).Reason || []).join(' ') || errMsg(r)}`);
  }
  const reqPQ = X ? X.pq(applySel(swap(t.priceQuotation))) : applySel(swap(t.priceQuotation));
  const price = await ctx.api(P(v, 'order-info/get-price-quotation'), reqPQ);
  if (!ok(price) || !result(price)?.Key) throw new Error('Lấy báo giá lỗi: ' + errMsg(price));
  const pr = result(price);
  const val = buildValidate(t, svcTpl()._customer, reqPQ, pr, phone, opts.service);
  if (X) X.val(val);
  const total = val.OrderInfo.TotalVAT;
  const lineItems = () => { const it = []; eachDetail(val, (kind, x) => it.push(kind === 'svc' ? `${x.SubServiceName}${x.PrePaidName ? ` (${x.PrePaidName})` : ''}` : `${x.SubServiceName} (${[x.StatusName, x.DeployTypeName].filter(Boolean).join(' + ')})`)); return it; };
  if (opts.dryRun) {
    const pol = (pr.Services?.[0]?.ServiceDetail?.[0] || pr.Products?.[0]?.ProductDetail?.[0])?.Price?.find((x) => x.Default === 1);
    return { ok: true, totalVAT: total, items: lineItems(), policyName: pol?.PolicyName || '', title: (pol?.Title || []).join(', ') };
  }
  if (X) return X.submit({ val, pr, reqPQ, items: lineItems() });
  val.PolicyKey = pr.Key; val.Confirm = 1; val.CustomerInfoDuplicate = null;
  if (opts.name) val.CustomerInfo.FullName = opts.name;
  val.CustomerInfo.PhoneSMS = phone;
  // Như Portal: order/validate-price trả danh sách phương thức thanh toán hợp lệ cho báo giá này -> lấy mặc định của hệ thống.
  let payTypes = [];
  if (opts.probePay) try {
    const vpr = await ctx.api(P(v, "order/validate-price"), { ...reqPQ, POPCode: reqPQ.POPCode ?? null, IsValidatePolicyOnly: false, PaymentPreviousId: 0, PaymentCurrentId: 0, Key: pr.Key });
    const vp = result(vpr);
    payTypes = (vp?.PaymentTypes || []).map((x) => ({ id: x.PaymentTypeId, name: x.PaymentTypeName }));
    if (vp?.PaymentTypeDefault?.PaymentTypeId) val.OrderInfo.PaymentType = vp.PaymentTypeDefault.PaymentTypeId;
  } catch {}
  const payType = opts.paymentType ?? t.gen?.paymentType;
  if (payType != null) val.OrderInfo.PaymentType = payType;
  if (t.gen?.email && !val.CustomerInfo.Email) val.CustomerInfo.Email = t.gen.email;
  if (opts.validateOnly) { // chạy order/validate (không order/update) để kiểm tra đủ thông tin tạo đơn, không sinh đơn
    const rv = await ctx.api(P(v, 'order/validate'), val);
    return { ok: !!result(rv)?.ValidateKey, paymentType: val.OrderInfo.PaymentType, payTypes, totalVAT: total, items: lineItems(), reason: (result(rv)?.Reason || []).join(' ') || (result(rv)?.ValidateKey ? '' : errMsg(rv)) };
  }
  let r, vk;
  for (let i = 0; i < 3 && !vk; i++) {
    r = await ctx.api(P(v, 'order/validate'), val);
    vk = result(r)?.ValidateKey;
    if (!vk && !/thử lại/i.test((result(r)?.Reason || []).join(' ') + errMsg(r))) break;
    if (!vk) await new Promise((s) => setTimeout(s, 3000));
  }
  if (!vk) throw new Error('App báo: ' + ((result(r)?.Reason || []).join(' ') || errMsg(r)));
  const u = await ctx.api(P(v, 'order/update'), { ...val, ValidateKey: vk });
  const up = result(u);
  if (!up?.OrderCode) throw new Error('Tạo đơn lỗi: ' + errMsg(u));
  const q = await ctx.api(P(v, 'quotation/detail'), { OrderId: up.OrderId });
  const quote = result(q)?.Quotation;
  const items = lineItems();
  const rec = {
    orderId: up.OrderId, orderCode: up.OrderCode, totalVAT: val.OrderInfo?.TotalVAT,
    quotationCode: quote?.QuotationCode, quotationUrl: quote?.URL, status: quote?.StatusDescription,
    phone, name: val.CustomerInfo.FullName, package: `${opts.service}: ${items.join(' · ')}`, source: 'desktop',
    createdAt: new Date().toISOString(),
  };
  save(rec);
  if (opts.contract) {
    try { const c = await createContract(up.OrderId, ctx); rec.contractCode = c.contractCode; }
    catch (e) { rec.contractError = e.message; }
  }
  return rec;
}
