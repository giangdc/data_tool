// Bán thêm (cross-selling) vào HỢP ĐỒNG CÓ SẴN — phát lại luồng Portal SOP đã ghi
// (khao-sat/capture/cross-sell.jsonl, 2026-11-11, đơn mẫu HCMUV0026VII trên HĐ SGABP5868).
// Luồng: contract/search -> cross-selling/check-contract -> contract/detail
//   -> validate dịch vụ (bản cross-selling) -> get-price-quotation -> order/validate-price -> order/total
//   -> order/cross-selling/validate -> validate1 -> update -> quotation/detail
//   -> (tuỳ chọn) contract/cross-selling/validate -> update (sinh phiếu đăng ký gắn vào HĐ gốc)
// Thiết bị lẻ: dựng dòng thiết bị trực tiếp (như Portal). Nhóm khác (FPT Play, Play SA...): dùng lại khuôn bán mới
// (createServiceQuote) qua hook opts.cross để đổi path + gắn ObjId/địa chỉ/KH của hợp đồng.
import { session, orderDetail, createServiceQuote, desktopServices } from './order.js';
import { save, updateContract } from '../core/store.js';
import fs from 'node:fs';
const NET_TPL = new URL('../../config/order-template.json', import.meta.url);

// Nhớ HĐ đã chấm dứt (không bao giờ bán thêm được) để chế độ ngẫu nhiên bỏ qua, đỡ tốn lượt gọi.
const DEAD = new URL('../../.cache/xs-dead-contracts.json', import.meta.url);
const readDead = () => { try { return new Set(JSON.parse(fs.readFileSync(DEAD, 'utf8'))); } catch { return new Set(); } };
const addDead = (objId) => { const s = readDead(); s.add(objId); try { fs.mkdirSync(new URL('./', DEAD), { recursive: true }); fs.writeFileSync(DEAD, JSON.stringify([...s])); } catch {} };

const ok = (r) => r.data?.Code === 200;
const result = (r) => r.data?.Data?.Result;
const errMsg = (r) => {
  const m = r.data?.Message;
  return (m?.Message || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || m?.Title || `Code ${r.data?.Code}`;
};
const reasons = (r) => (result(r)?.Reason || []).filter(Boolean).join(' ') || errMsg(r);
const P = (ctx, p) => `gateway/sale/${ctx.instanceVer}/api/${p}`;
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Nhóm bán thêm + SĐT dùng tìm hợp đồng ngẫu nhiên (FPT Play / Play SA: 0775335608, nhóm khác: 0868650892).
export const RETAIL = 'Sản phẩm khác'; // = Thiết bị lẻ
export const INTERNET = 'Internet';
const PLAY_PHONE = '0775335608', OTHER_PHONE = '0868650892';
const SKIP = new Set(['Internet', RETAIL]);
export function crossServices() {
  const list = [INTERNET, RETAIL, ...desktopServices().filter((s) => !SKIP.has(s))];
  const order = ['FPT Play', 'FPT Play Stand Alone', INTERNET, RETAIL];
  return list.sort((a, b) => ((order.indexOf(a) + 1) || 99) - ((order.indexOf(b) + 1) || 99))
    .map((s) => ({ service: s, phone: /^FPT Play/.test(s) ? PLAY_PHONE : OTHER_PHONE }));
}
const randomPhone = () => '0868' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
const phoneOf = (service) => (/^FPT Play/.test(service) ? PLAY_PHONE : OTHER_PHONE);

const EXT_INFO = [
  { Key: 'affiliate_contract', Name: 'Số hợp đồng liên kết Dịch vụ Camera - VMS', Value: '', TypeInput: 'textbox' },
  { Key: 'parent_contract', Name: 'Hợp đồng Dự án (HD Cha)', Value: '', TypeInput: 'textbox' },
];
const DEV_KEYS = ['SubServiceTypeId', 'SubServiceTypeName', 'ParentName', 'ParentNameVN', 'GroupId', 'SubServiceId', 'SubServiceName',
  'StatusId', 'StatusName', 'RevokeId', 'RevokeName', 'DeployTypeId', 'DeployTypeName', 'UseId', 'UseName', 'LanWire'];
const PRICE_KEYS = ['ProgramId', 'Total', 'TotalVAT', 'Title', 'PolicyId', 'PolicyName', 'PsGroup', 'PriceGroupId', 'PsId', 'PromotionId'];

export const variantLabel = (d) => `${d.SubServiceName} (${[d.StatusName, d.DeployTypeName].filter(Boolean).join(' + ')}, thu hồi ${d.RevokeName})`;

// ---------- Hợp đồng ----------
// Tìm hợp đồng theo SĐT (SearchCriteria 1) hoặc mã HĐ (SearchCriteria 4).
export async function searchContracts(q, ctx) {
  ctx = ctx || await session();
  const v = String(q || '').trim();
  if (!v) throw new Error('Nhập mã hợp đồng hoặc SĐT');
  const r = await ctx.api(P(ctx, 'contract/search'), { LocationId: 8, SearchCriteria: /^\d{9,11}$/.test(v) ? 1 : 4, SearchValue: v.toUpperCase() });
  if (!ok(r)) throw new Error('Tìm hợp đồng lỗi: ' + errMsg(r));
  return (result(r) || []).map((x) => ({ objId: x.ObjId, contract: x.ObjContract, name: (x.FullName || '').trim(), address: x.ObjAddress }));
}

// Kiểm tra HĐ được bán thêm + lấy chi tiết. Mã -351 (còn phiếu ĐK chưa hoàn thành) chỉ là cảnh báo như Portal.
async function loadContract(ctx, objId) {
  const c = await ctx.api(P(ctx, 'order-info/cross-selling/check-contract'), { ObjId: objId, ObjContract: null, ServiceAvailable: null });
  const code = c.data?.Code;
  let warning = '';
  if (code === -351) warning = errMsg(c);
  else if (code !== 200) {
    if (/chấm dứt/i.test(errMsg(c))) addDead(objId);
    throw new Error('Hợp đồng không bán thêm được: ' + errMsg(c));
  }
  // contract/detail hay trả "Không tìm thấy..." ở lượt đầu (Portal cũng bị, lượt sau mới được) -> thử lại
  let d, det;
  for (let i = 0; i < 4; i++) {
    if (i) await new Promise((s) => setTimeout(s, 1200));
    d = await ctx.api(P(ctx, 'contract/detail'), { ObjId: objId });
    det = result(d);
    if (det?.ObjContract) break;
  }
  if (!det?.ObjContract) throw new Error('Không lấy được chi tiết hợp đồng: ' + errMsg(d));
  const main = (det.ObjServiceAddressInfo || []).find((a) => a.IsMainAddress === 1) || det.ObjServiceAddressInfo?.[0];
  if (!main?.Address) throw new Error('Hợp đồng không có địa chỉ lắp đặt');
  return { objId, det, addr: main.Address, warning };
}

// Danh sách HĐ ứng viên: nhập mã HĐ -> đúng 1 HĐ; ngẫu nhiên -> mọi HĐ của SĐT, xáo trộn.
async function candidates(ctx, o) {
  if (o.objId) return [{ objId: Number(o.objId), contract: o.contract }];
  if (o.mode === 'random') {
    const phone = o.phone || phoneOf(o.service);
    const dead = readDead();
    const list = (await searchContracts(phone, ctx)).filter((x) => !dead.has(x.objId));
    if (!list.length) throw new Error(`SĐT ${phone} không có hợp đồng nào còn bán thêm được`);
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return list;
  }
  const want = String(o.contract || '').trim().toUpperCase();
  if (!want) throw new Error('Nhập số hợp đồng');
  const list = await searchContracts(want, ctx);
  const hit = list.find((x) => x.contract === want) || (list.length === 1 ? list[0] : null);
  if (!hit) throw new Error(list.length ? `SĐT có ${list.length} hợp đồng, nhập 1 mã HĐ cụ thể` : `Không tìm thấy hợp đồng "${want}"`);
  return [hit];
}

export async function contractInfo(o) {
  const ctx = await session();
  const [c] = await candidates(ctx, { ...o, mode: 'contract' });
  const { det, addr, warning } = await loadContract(ctx, c.objId);
  return { objId: c.objId, contract: det.ObjContract, name: (det.FullName || '').trim(), phone: det.PhoneSMS, address: addr.FullAddress, warning };
}

// ---------- Dựng thân request theo hợp đồng ----------
const baseCtx = ({ det, addr, objId }) => ({ LocationId: addr.LocationId, DistrictId: addr.DistrictId, WardId: addr.WardId, BuildingId: addr.BuildingId || 0,
  CusTypeId: det.CusTypeId, CusTypeL2Id: det.CusTypeL2Id, ObjectTypeId: det.ObjectTypeId, ServiceAvailable: det.ServiceAvailable || [], ObjId: objId });

const orderAddress = (a) => ({ LocationId: a.LocationId, DistrictId: a.DistrictId, WardId: a.WardId, StreetId: a.StreetId, TypeHouse: a.TypeHouse,
  Position: a.Position ?? 0, BuildingId: a.BuildingId || 0, CustomerLatLng: null, Floor: a.Floor ?? null, Room: a.Room ?? null, Block: a.Block ?? null,
  AddressNo: a.AddressNo, NoteAddress: '' });

function customerInfo({ det, addr }) {
  return {
    CusTypeId: det.CusTypeId, CusTypeL2Id: det.CusTypeL2Id, ObjectTypeId: det.ObjectTypeId, FullName: det.FullName,
    IDCardType: det.IDCardType ?? 1, IDCard: det.IDCard ?? '', DateOfIssue: null, PlaceOfIssue: null, IDAddress: det.IDAddress ?? '', DOB: null,
    CusRank: det.CusRank || '', CusRankDesc: det.CusRankDesc || '', Email: det.Email ?? '', CountryCode: null, BudgetRelationCode: null,
    RepresentativeFullName: det.RepresentativeFullName ?? '', RepresentativeDOB: null, RepresentativeIDCard: det.RepresentativeIDCard ?? null,
    RepresentativeIDCardType: 0, RepresentativeDateOfIssue: null, RepresentativePlaceOfIssue: null, Bank: null, BankAccount: null,
    OfficePhone: null, PhoneSMS: det.PhoneSMS, Contact1: null, Phone1: null, EmployeeId: null, CompanyName: null,
    LocationIdMain: addr.LocationId, DistrictIdMain: addr.DistrictId, WardIdMain: addr.WardId, StreetIdMain: addr.StreetId,
    TypeHouseMain: addr.TypeHouse, PositionMain: addr.Position ?? 0, BuildingIdMain: addr.BuildingId || 0, AddressNoMain: addr.AddressNo,
    LocationIdChargeable: 0, DistrictIdChargeable: 0, WardIdChargeable: 0, StreetIdChargeable: 0, TypeHouseChargeable: 0, PositionChargeable: 0, BuildingIdChargeable: 0,
    LocationIdBilling: 0, DistrictIdBilling: 0, WardIdBilling: 0, StreetIdBilling: 0, TypeHouseBilling: 0, PositionBilling: 0, BuildingIdBilling: 0,
    NoteAddress: null, NoteDeploy: null, MarketingChannel: 0, Gender: 0, ImageIDCard: null, ImageDocument: null, ImageOtherISP: null,
    ImageCustomer: null, ImageBilling: null, PayMonthlyCharges: 0, FoxpayAgree: 0, ExtendedInfo: EXT_INFO,
  };
}
const fgold = ({ det }) => ({ FGold: { CusRank: det.CusRank || '', CusRankDesc: det.CusRankDesc || '' } });

// Thân order/cross-selling/validate từ các dòng đã gắn giá (Services/Products).
function crossValidateBody(C, Services, Products, totalVAT, extProps) {
  return {
    PolicyKey: null,
    OrderInfo: { Id: 0, ServiceList: [...new Set([...Services, ...Products].map((x) => x.ServiceId))], ServiceAvailable: C.det.ServiceAvailable || [], PaymentType: 8,
      TotalVATOriginal: totalVAT, TotalVAT: totalVAT, Discount: 0, DiscountPayment: 0, RefId: 0, PrePaidPercentActived: 0, RefCode: null,
      RefSource: 3, ObjId: C.objId, ObjContract: C.det.ObjContract, DiscountComboRenew: 0, MinimumPayment: 0 },
    CustomerInfo: customerInfo(C),
    OrderDetails: [{ Address: orderAddress(C.addr), Services, Products }],
    ExtendedProperties: { ...fgold(C), ...(extProps || {}) }, OrderRenewDetails: null,
  };
}

// Chốt đơn bán thêm: validate-price -> order/total -> validate -> validate1 -> update -> quotation -> (HĐ)
async function submitCross(ctx, C, val, key, o, label) {
  const api = (p, b) => ctx.api(P(ctx, p), b);
  const { Services, Products } = val.OrderDetails[0];
  const vp = await api('order/validate-price', { POPCode: null, IsValidatePolicyOnly: false, PaymentPreviousId: 0, PaymentCurrentId: 0, Key: key,
    ...baseCtx(C), Services, Products, ExtendedInfo: EXT_INFO });
  if (!ok(vp)) throw new Error('Kiểm tra chính sách lỗi: ' + errMsg(vp));
  const payType = result(vp)?.PaymentTypeDefault?.PaymentTypeId ?? 8;
  const tt = await api('order/total', { PolicyKey: key, PaymentTypeId: payType, DiscountComboRenew: 0, ObjId: C.objId, Services, Products, Vouchers: [], ExtendedInfo: EXT_INFO });
  const tot = result(tt);
  if (!ok(tt) || !tot) throw new Error('Tính tổng tiền lỗi: ' + errMsg(tt));
  // Hình thức thanh toán cước hàng tháng (FPT Play có cước trả sau bắt buộc chọn) — lấy mục mặc định như Portal
  const mp = await api('order-info/get-method-pay-charges', { ServiceList: val.OrderInfo.ServiceList });
  const methods = result(mp) || [];
  const m = methods.find((x) => x.Position === 1) || methods[0];
  if (m) val.CustomerInfo.PayMonthlyCharges = m.PayMonthlyChargesId;
  val.PolicyKey = key;
  Object.assign(val.OrderInfo, { PaymentType: payType, TotalVATOriginal: tot.TotalVATOriginal, TotalVAT: tot.TotalVAT, Discount: tot.Discount || 0, DiscountPayment: tot.DiscountPayment || 0 });
  // Portal gọi validate -> validate1 (kèm key lượt 1) -> update (kèm key lượt 2)
  // Server hay trả "...Vui lòng thử lại." ở validate (bán mới cũng gặp) -> thử lại tối đa 3 lượt
  let v0, k1;
  for (let i = 0; i < 3 && !k1; i++) {
    if (i) await new Promise((s) => setTimeout(s, 3000));
    v0 = await api('order/cross-selling/validate', val);
    k1 = result(v0)?.ValidateKey;
    if (!k1 && !/thử lại/i.test(reasons(v0))) break;
  }
  if (!k1) throw new Error('App báo: ' + reasons(v0));
  const v1 = await api('order/cross-selling/validate1', { ...val, ValidateKey: k1 });
  const k2 = result(v1)?.ValidateKey;
  if (!k2) throw new Error('App báo: ' + reasons(v1));
  if (o.validateOnly) return { ok: true, validated: true, totalVAT: val.OrderInfo.TotalVAT, items: [label] }; // kiểm tra đủ điều kiện, không sinh đơn
  const u = await api('order/cross-selling/update', { ...val, ValidateKey: k2 });
  const up = result(u);
  if (!up?.OrderCode) throw new Error('Tạo đơn bán thêm lỗi: ' + reasons(u));
  const q = await api('quotation/detail', { OrderId: up.OrderId });
  const quote = result(q)?.Quotation;
  const rec = {
    orderId: up.OrderId, orderCode: up.OrderCode, totalVAT: tot.TotalVAT, quotationCode: quote?.QuotationCode, quotationUrl: quote?.URL || '',
    status: quote?.StatusDescription, phone: o.phone || phoneOf(o.service), name: (C.det.FullName || '').trim(),
    package: `Bán thêm ${C.det.ObjContract} · ${o.service}: ${label}${o.accountPhone ? ` · SĐT tài khoản ${o.accountPhone}` : ''}`, crossSellOf: C.det.ObjContract, source: 'desktop', createdAt: new Date().toISOString(),
  };
  if (C.warning) rec.warning = C.warning;
  save(rec);
  if (o.contractAfter) {
    try { const c = await crossSellContract(ctx, up.OrderId, C.det.ObjContract); rec.contractCode = c.code; if (c.regCode) rec.regCode = c.regCode; }
    catch (e) { rec.contractError = e.message; }
  }
  return rec;
}

// ---------- Thiết bị lẻ ----------
async function listVariants(ctx, C, subServiceId) {
  const b = baseCtx(C);
  const r = await ctx.api(P(ctx, 'retailequipment/list'), { LocationId: b.LocationId, DistrictId: b.DistrictId, WardId: b.WardId, BuildingId: b.BuildingId,
    CusTypeId: b.CusTypeId, CusTypeL2Id: b.CusTypeL2Id, SubServiceId: Number(subServiceId), ObjectTypeId: b.ObjectTypeId, ServiceAvailable: b.ServiceAvailable, ObjId: C.objId });
  if (!ok(r)) throw new Error('Lấy biến thể thiết bị lỗi: ' + errMsg(r));
  return result(r) || [];
}
function productLine(dv, qty) {
  const l = { ServiceId: 6, ServiceName: 'Sản phẩm khác', ItemType: 0, ProgramId: 0, ApplySubServiceId: null, ApplyPrePaid: null,
    Qty: qty, Total: 0, TotalVAT: 0, Discount: 0, DiscountVAT: 0, Title: [], PolicyId: 0, PolicyName: '', PsGroup: 0, PriceGroupId: '',
    Default: 0, PsId: 0, PromotionId: 0, ApplySubServiceTypeId: null, PrePaidPercent: 0 };
  for (const k of DEV_KEYS) l[k] = dv[k] ?? null;
  return l;
}
async function retailCross(ctx, C, o) {
  const api = (p, b) => ctx.api(P(ctx, p), b);
  // o.package = "Nhóm › Thiết bị" hoặc SubServiceId; o.device = nhãn biến thể
  const subId = o.packageId || (await retailDeviceId(o.package));
  const variants = await listVariants(ctx, C, subId);
  const dv = (o.device && variants.find((d) => variantLabel(d) === o.device || norm(variantLabel(d)) === norm(o.device)))
    || (!o.device && (variants.find((d) => d.StatusName === 'Mới' && d.DeployTypeId === 1) || variants[0]));
  if (!dv) throw new Error(o.device ? `Không có biến thể "${o.device}"` : 'Thiết bị không có biến thể nào để bán');
  const address = orderAddress(C.addr);
  const products = [{ ServiceId: 6, ServiceName: 'Sản phẩm khác', ProductDetail: [productLine(dv, Math.max(1, Number(o.qty) || 1))] }];

  const vr = await api('order-info/cross-selling/validate-retailequipment-service-info', { ObjId: C.objId, OrderDetails: [{ Address: address, Products: products }], OrderRenewDetails: null });
  if (!ok(vr) || result(vr)?.IsValid === false) throw new Error('Kiểm tra thiết bị lỗi: ' + reasons(vr));
  const vs = await api('order-info/cross-selling/validate-service-info', { ObjId: C.objId, OrderId: 0, CustomerInfo: customerInfo(C),
    OrderDetails: [{ Address: address, Services: [], Products: products }], ExtendedProperties: fgold(C), OrderRenewDetails: null });
  if (!ok(vs) || result(vs)?.IsValid === false) throw new Error('Kiểm tra dịch vụ lỗi: ' + reasons(vs));
  await api('order/cross-selling/validate-extend-order', { OrderDetails: [{ Address: address, Services: [], Products: products }], ObjId: C.objId, OrderRenewDetails: [], ExtendedInfo: EXT_INFO });

  const pq = await api('order-info/get-price-quotation', { ...baseCtx(C), POPCode: null, Services: [], Products: products, ExtendedInfo: EXT_INFO });
  const pr = result(pq);
  if (!ok(pq) || !pr) throw new Error('Lấy giá lỗi: ' + errMsg(pq));
  const priced = products.map((p) => {
    const pp = (pr.Products || []).find((x) => x.ServiceId === p.ServiceId);
    return { ...p, ProductDetail: p.ProductDetail.map((l, i) => {
      const src = pp?.ProductDetail?.[i];
      const price = (src?.Price || []).find((x) => x.Default === 1) || src?.Price?.[0];
      if (!price) throw new Error(`Thiết bị "${l.SubServiceName}" không có chính sách giá`);
      const out = { ...l, LanWire: l.LanWire ?? 0 };
      for (const k of PRICE_KEYS) if (k in price) out[k] = price[k];
      return out;
    }) };
  });
  const line = priced[0].ProductDetail[0];
  const total = line.TotalVAT * (line.Qty || 1);
  const label = `${line.SubServiceName} (${[line.StatusName, line.DeployTypeName].filter(Boolean).join(' + ')}) x${line.Qty}`;
  if (o.dryRun) return { ok: true, totalVAT: total, policyName: line.PolicyName, title: (line.Title || []).join(', '), items: [label] };
  return submitCross(ctx, C, crossValidateBody(C, [], priced, total), pr.Key, o, label);
}
// Thiết bị lẻ: tên "Nhóm › Thiết bị" -> SubServiceId (dùng danh sách của nhóm Sản phẩm khác)
let retailCache = null;
async function retailDeviceId(name) {
  const { servicePackages } = await import('./order.js');
  retailCache = retailCache || await servicePackages(RETAIL);
  const hit = retailCache.find((x) => x.name === name) || retailCache.find((x) => norm(x.name).endsWith(norm(name)));
  if (!hit) throw new Error(`Không có thiết bị "${name}"`);
  return hit.id;
}

// ---------- Internet ----------
// Gói/chu kỳ lấy từ net/packages theo địa chỉ HĐ; dòng gói + PLĐ Net gắn giá từ get-price-quotation;
// thiết bị ONT lấy theo khuôn bán mới Internet (config/order-template.json) như luồng bán mới.
const clone = (o) => JSON.parse(JSON.stringify(o));
function pricedServices(reqServices, resServices) {
  let total = 0;
  const out = (reqServices || []).map((rq) => {
    const rs = (resServices || []).find((x) => x.ServiceId === rq.ServiceId) || {};
    const lines = [];
    (rs.ServiceDetail || []).forEach((pd, j) => {
      const tmpl = rq.ServiceDetail[j] || rq.ServiceDetail[0];
      const price = (pd.Price || []).find((x) => x.Default === 1) || pd.Price?.[0];
      if (!price) throw new Error(`Gói "${pd.SubServiceName}" không có chính sách giá tại hợp đồng này`);
      const line = { ...tmpl };
      for (const k of Object.keys(line)) {
        if (k in price && k !== 'Default' && k !== 'ServiceCode') line[k] = price[k];
        else if (k in pd && k !== 'Price') line[k] = pd[k];
      }
      lines.push(line); total += price.TotalVAT || 0;
      for (const e of price.ExtendedServices || []) { // PLĐ Net (trả sau)...
        const ex = { ...tmpl };
        for (const k of Object.keys(e)) if (k in tmpl || /^Apply/.test(k)) ex[k] = e[k];
        lines.push(ex); total += e.TotalVAT || 0;
      }
    });
    return { ...rq, ServiceDetail: lines };
  });
  return { services: out, total };
}
async function internetCross(ctx, C, o) {
  const api = (p, b) => ctx.api(P(ctx, p), b);
  const T = JSON.parse(fs.readFileSync(NET_TPL, 'utf8'));
  const r = await api('net/packages', { ...baseCtx(C), ServiceAvailable: C.det.ServiceAvailable || null });
  if (!ok(r)) throw new Error('Lấy gói Internet lỗi: ' + errMsg(r));
  const pkgs = result(r) || [];
  const n = norm(o.package || 'Giga');
  const pkg = pkgs.find((x) => norm(x.SubServiceName) === n) || pkgs.find((x) => norm(x.SubServiceName).includes(n));
  if (!pkg) throw new Error(`Hợp đồng này không có gói Internet "${o.package || 'Giga'}"`);
  const pps = pkg.PrePaid || [];
  const pp = (o.prepaid && pps.find((x) => x.Value === o.prepaid || norm(x.Value) === norm(o.prepaid))) || (!o.prepaid && (pps.find((x) => x.Key === '6_6') || pps[0]));
  if (!pp) throw new Error(`Gói "${pkg.SubServiceName}" không có gói tính cước "${o.prepaid}"`);
  const dep = (pkg.DeployTypes || [])[0];
  const sd = { ...clone(T.priceQuotation.Services[0].ServiceDetail[0]),
    SubServiceTypeId: pkg.SubServiceTypeId ?? 1, SubServiceTypeName: pkg.SubServiceTypeName || 'Net', SubServiceId: pkg.SubServiceId, SubServiceName: pkg.SubServiceName,
    PrePaid: pp.PrePaid ?? pp.MonthUsed, MonthUsed: pp.MonthUsed, Key: pp.Key, PrePaidName: pp.Value,
    DeployTypeId: dep?.DeployTypeId ?? 1, DeployTypeName: dep?.DeployTypeName ?? 'TIN/PNC',
    ProgramId: 0, PromotionId: 0, PsId: 0, PolicyId: 0, PolicyName: '', PsGroup: 0, PriceGroupId: '', Title: [], Total: 0, TotalVAT: 0, Discount: 0, DiscountVAT: 0 };
  const services = [{ ServiceId: 1, ServiceName: 'Internet', ServiceDetail: [sd] }];
  const address = orderAddress(C.addr);

  const vn = await api('order-info/cross-selling/validate-net-service-info', { ObjId: C.objId, OrderDetails: [{ Address: address, Services: services }], OrderRenewDetails: null });
  if (!ok(vn) || result(vn)?.IsValid === false) throw new Error('Kiểm tra dịch vụ Internet lỗi: ' + (result(vn)?.Reason || reasons(vn)));
  const vs = await api('order-info/cross-selling/validate-service-info', { ObjId: C.objId, OrderId: 0, CustomerInfo: customerInfo(C),
    OrderDetails: [{ Address: address, Services: services, Products: [] }], ExtendedProperties: fgold(C), OrderRenewDetails: null });
  if (!ok(vs) || result(vs)?.IsValid === false) throw new Error('Kiểm tra dịch vụ lỗi: ' + reasons(vs));
  const popCode = result(vs)?.DataPort?.PopCode || null;

  const pq = await api('order-info/get-price-quotation', { ...baseCtx(C), POPCode: popCode, Services: services, Products: [], ExtendedInfo: EXT_INFO });
  const pr = result(pq);
  if (!ok(pq) || !pr?.Key) throw new Error('Lấy giá lỗi: ' + errMsg(pq));
  const { services: priced, total } = pricedServices(services, pr.Services);
  if (total <= 0) throw new Error(`Gói "${pkg.SubServiceName}" không có giá tại hợp đồng này, chọn gói khác`);
  // ONT đi kèm gói (0đ) — như luồng bán mới
  const ont = (T.orderValidate.OrderDetails[0].Products || []).filter((x) => x.ServiceId === 1).map((p) => ({ ...clone(p),
    ProductDetail: p.ProductDetail.map((d) => ({ ...d, ApplySubServiceId: pkg.SubServiceId, ApplyPrePaid: sd.PrePaid })) }));
  const lines = priced[0].ServiceDetail;
  const pol = lines[0];
  const label = lines.map((x) => `${x.SubServiceName} (${x.PrePaidName})`).join(' · ') + (ont.length ? ' · ' + ont[0].ProductDetail.map((d) => `${d.SubServiceName} (${d.StatusName} + ${d.DeployTypeName})`).join(' · ') : '');
  if (o.dryRun) return { ok: true, totalVAT: total, policyName: pol.PolicyName, title: (pol.Title || []).join(', '), items: label.split(' · ') };
  return submitCross(ctx, C, crossValidateBody(C, priced, ont, total), pr.Key, o, label);
}

// ---------- Nhóm khác (FPT Play, Play SA, ...) dùng khuôn bán mới ----------
async function templateCross(ctx, C, o) {
  const X = {
    path: (p) => p.replace('order-info/', 'order-info/cross-selling/'),
    body: (b) => ({ ObjId: C.objId, ...b, OrderDetails: (b.OrderDetails || []).map((d) => ({ ...d, Address: orderAddress(C.addr) })) }),
    pq: (b) => ({ ...b, ...baseCtx(C), POPCode: b.POPCode ?? null }),
    val: (val) => {
      const d = val.OrderDetails[0];
      const ext = { ...(val.ExtendedProperties || {}) };
      Object.assign(val, crossValidateBody(C, d.Services || [], d.Products || [], val.OrderInfo.TotalVAT, ext));
      delete val.Confirm; delete val.CustomerInfoDuplicate;
    },
    submit: ({ val, pr, items }) => submitCross(ctx, C, val, pr.Key, o, items.join(' · ')),
  };
  X.noWith = true; // HĐ đã có dịch vụ nền -> bỏ dịch vụ mua kèm của khuôn bán mới (VioEdu kèm Internet Sky...)
  // FSafe Go: SĐT trong đơn là SĐT tài khoản FSafe, mỗi số chỉ đăng ký 1 lần -> dùng số test ngẫu nhiên
  const accPhone = o.service === 'FSafe Go' ? (o.accountPhone || randomPhone()) : (o.phone || phoneOf(o.service));
  if (o.service === 'FSafe Go') o.accountPhone = accPhone;
  return createServiceQuote({ service: o.service, phone: accPhone, package: o.package, prepaid: o.prepaid, device: o.device, dryRun: o.dryRun, cross: X });
}

// ---------- Điểm vào ----------
// o: { service, mode: 'random'|'contract', contract, phone, package, prepaid, device, qty, contractAfter, dryRun }
export async function createCrossSell(o = {}) {
  if (!o.service) throw new Error('Chọn dịch vụ bán thêm');
  const ctx = await session();
  const list = await candidates(ctx, o);
  const tries = o.mode === 'random' ? Math.min(list.length, 6) : 1;
  const errs = [];
  for (let i = 0; i < tries; i++) {
    let C;
    try { C = await loadContract(ctx, list[i].objId); }
    catch (e) { errs.push(`${list[i].contract}: ${e.message}`); if (o.mode === 'random') continue; throw e; }
    try {
      const r = o.service === RETAIL ? await retailCross(ctx, C, o) : o.service === INTERNET ? await internetCross(ctx, C, o) : await templateCross(ctx, C, o);
      return { ...r, contract: C.det.ObjContract, warning: C.warning, tried: errs };
    } catch (e) {
      // Ngẫu nhiên: HĐ này không bán được dịch vụ đã chọn -> thử HĐ khác (chưa sinh đơn nên an toàn)
      if (o.mode !== 'random') throw e;
      errs.push(`${C.det.ObjContract}: ${e.message.replace(/^App báo:\s*/, '')}`);
    }
  }
  throw new Error(`Thử ${errs.length} hợp đồng ngẫu nhiên của SĐT ${o.phone || phoneOf(o.service)} đều không bán thêm được:\n` + errs.join('\n'));
}

// Nút "Tạo HĐ" ở lịch sử cho đơn bán thêm. Trả { contractCode, regCode } như createContract.
export async function crossSellContractFor(orderId, objContract) {
  const c = await crossSellContract(await session(), orderId, objContract);
  return { contractCode: c.code, regCode: c.regCode, orderId };
}
// Cập nhật đơn bán thêm vào HĐ gốc: contract/cross-selling/validate -> update (cần OrderTag từ order/detail).
async function crossSellContract(ctx, orderId, objContract) {
  const info = await orderDetail(ctx, orderId);
  const v = await ctx.api(P(ctx, 'contract/cross-selling/validate'), { OrderId: orderId, OrderTag: info.OrderTag });
  const k = result(v)?.ValidateKey;
  if (!k) throw new Error('contract/cross-selling/validate: ' + reasons(v));
  const u = await ctx.api(P(ctx, 'contract/cross-selling/update'), { OrderId: orderId, ValidateKey: k });
  const r = result(u);
  if (!ok(u) || r?.IsValid === false || r?.IsSuccess === false) throw new Error('contract/cross-selling/update: ' + reasons(u));
  const code = r?.ObjContract || r?.Contract || objContract;
  updateContract(orderId, code);
  // Bán thêm sinh phiếu đăng ký (RegCode, vd SGK29695576) gắn vào HĐ gốc
  let regCode = '';
  try { regCode = (await orderDetail(ctx, orderId)).RegCode || ''; } catch {}
  return { code, regCode };
}

