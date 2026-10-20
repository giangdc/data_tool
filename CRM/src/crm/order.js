// Tạo đơn hàng từ version báo giá KH chọn (3 bước như màn /order/create):
//   1. Thông tin KH: tạo hồ sơ KH chính thức (KH mới ngẫu nhiên) hoặc dùng KH đã có
//   2. Hợp đồng: HĐ dịch vụ, tiền mặt, địa chỉ thu cước   3. Triển khai: 1 địa chỉ, đủ các dòng báo giá
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CACHE_DIR } from '../core/env.js';
import { addDays, companyName, digits, formatDate, mobilePhone, personName, pick, taxCode } from '../data/random.js';
import { FlowError } from './opportunity.js';
import { getFlowState } from './flow.js';

const ORDER = '/agreement-management/api/order';

// Địa chỉ mặc định: TP.HCM / Phường An Phú (đã kiểm chứng có danh sách đường trên stag)
export const DEFAULT_ADDRESS = { provinceId: 79, provinceCode: '79', wardId: 12631, wardCode: '25975', wardName: 'Phường An Phú' };
// Nguồn khách hàng "Khác"
const SOURCE_OTHER = 'bf61f54d-fce8-448b-9424-c20f66b1410d';

const noAccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

/** Danh sách đường của phường – API rất chậm (20–40s) -> timeout dài + cache file. */
export async function getStreets(api, addr = DEFAULT_ADDRESS) {
  const file = path.join(CACHE_DIR, `streets-${addr.provinceCode}-${addr.wardCode}.json`);
  if (existsSync(file)) {
    try {
      const cached = JSON.parse(readFileSync(file, 'utf8'));
      if (cached.length) return cached;
    } catch {
      // cache hỏng -> tải lại
    }
  }
  const res = await api.post('/agreement-management/api/address/streets', { provinceCode: addr.provinceCode, wardCode: addr.wardCode }, { timeoutMs: 120_000 });
  const streets = (res?.streets || []).filter((s) => s.id && s.name);
  if (!streets.length) throw new FlowError(`${addr.wardName}: không có danh sách đường (${res?.message || 'rỗng'})`);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(streets));
  return streets;
}

const generalInfo = (api, versionId) => api.get(`${ORDER}/general-information`, { versionId });

// Bước 1: đảm bảo cơ hội có KH chính thức + người liên hệ
async function ensureCustomer(api, oppId, info, { prefix, addr }) {
  if (info.hasCustomerInfo && info.partyId) {
    await api.post('/customer-management/api/party/setup-for-opportunity', {
      opportunityId: oppId, existingPartyId: info.partyId, existingContactId: info.relatedContactId ?? null, partyInfo: null, contactInfo: null,
    });
    return { created: false };
  }
  const phone = mobilePhone();
  const customer = {
    partyName: companyName(prefix),
    email: null,
    phoneNumber: phone,
    taxCode: taxCode(),
    identificationCard: null,
    passport: null,
    sourceId: SOURCE_OTHER,
    provinceId: addr.provinceId,
    wardId: addr.wardId,
    addressNo: `${digits(2)} Duong ${prefix}`,
  };
  const contact = { name: `${prefix} ${personName()}`, positionName: null, email: null, primaryPhone: phone };
  await api.post('/customer-management/api/party/setup-for-opportunity', {
    opportunityId: oppId, existingPartyId: null, existingContactId: null, partyInfo: customer, contactInfo: contact,
  });
  return { created: true, customer, contact };
}

async function contactIdOf(api, info) {
  if (info.relatedContactId) return info.relatedContactId;
  const res = await api.get(`/customer-management/api/related-contact/${info.partyId}/contacts`, { isSelection: true, page: 1, fetch: 20, keyword: '' });
  const id = (res?.items ?? res ?? [])[0]?.id;
  if (!id) throw new FlowError('Khách hàng chưa có người liên hệ');
  return id;
}

/** Tạo đơn hàng cho cơ hội đã đánh dấu version + chính sách đã ban hành. */
export async function createOrder(api, oppId, { prefix, addr = DEFAULT_ADDRESS, contractDays = 30, fixedStreetId } = {}) {
  const st = await getFlowState(api, oppId);
  if (st.step === 'done') return { state: st, existed: true, steps: [] };
  if (st.step !== 'order') {
    const why = { quote: 'chưa có báo giá', select: 'chưa đánh dấu version KH chọn', issuing: `chính sách báo giá đang "${st.label}" – chờ thêm`, blocked: st.label };
    throw new FlowError(`${st.code}: chưa tạo đơn được – ${why[st.step] || st.label}`);
  }
  const steps = [];
  const versionId = st.version.id;

  let info = await generalInfo(api, versionId);
  const cust = await ensureCustomer(api, oppId, info, { prefix, addr });
  steps.push(cust.created ? 'Tạo hồ sơ KH' : 'Dùng KH có sẵn');
  info = await generalInfo(api, versionId);
  const contactId = await contactIdOf(api, info);

  const streets = await getStreets(api, addr);
  const fixed = fixedStreetId && streets.find((s) => s.id === fixedStreetId);
  const billing = fixed || pick(streets.slice(0, 20));
  const deploy = fixed || pick(streets.slice(0, 20));
  steps.push('Lấy danh sách đường');

  const today = new Date();
  const f = new FormData();
  const add = (k, v) => f.append(k, String(v));
  add('quoteVersionId', versionId);
  const a = 'agreementInfo.';
  add(`${a}documentType`, 1); // Hợp đồng
  add(`${a}agreementKind`, 2); // Hợp đồng dịch vụ
  add(`${a}quoteVersionId`, versionId);
  add(`${a}isPaymentRecorded`, false);
  add(`${a}signDate`, formatDate(today));
  add(`${a}startDate`, formatDate(today));
  add(`${a}endDate`, formatDate(addDays(contractDays, today)));
  add(`${a}paymentMethod`, 1); // Tiền mặt
  const b = `${a}billingAddress.`;
  add(`${b}provinceId`, addr.provinceId);
  add(`${b}wardId`, addr.wardId);
  add(`${b}address`, billing.name);
  add(`${b}addressInvoiceStreet`, billing.name);
  add(`${b}nation`, 'Việt Nam');
  add(`${b}addressInvoiceNumber`, digits(2));
  add(`${b}addressInvoiceStreetId`, billing.id);
  const d = `${a}deploymentAddress[0].`;
  add(`${d}provinceId`, addr.provinceId);
  add(`${d}wardId`, addr.wardId);
  add(`${d}address`, deploy.name);
  add(`${d}addressInstallStreetVn`, deploy.name);
  add(`${d}addressInstallStreet`, noAccent(deploy.name));
  add(`${d}addressInstallStreetId`, deploy.id);
  add(`${d}relatedContactId`, contactId);
  add(`${d}typeHouse`, 1); // Nhà phố
  add(`${d}addressInstallNumber`, digits(2));
  (info.quoteItems || []).forEach((it, i) => {
    add(`${d}subService[${i}].policySubServiceId`, it.policySubServiceId);
    add(`${d}subService[${i}].quantity`, it.quantity);
  });
  const members = (info.oppMembers || []).map((m) => ({ id: m.empId ?? m.employeeId ?? m.id, pct: m.percentage }));
  if (members.length === 1 || !members.some((m) => m.pct)) members.forEach((m) => (m.pct = Math.round(100 / members.length)));
  members.forEach((m, i) => {
    add(`${a}memberInfos[${i}].employeeId`, m.id);
    add(`${a}memberInfos[${i}].percentage`, m.pct);
  });

  let orderId;
  try {
    orderId = await api.post(ORDER, f, { timeoutMs: 120_000 });
  } catch (err) {
    // Stag: API tạo đơn có lúc treo > 25s -> nginx 504 (tạo tay trên UI CRM cũng lỗi, 19/10/2026);
    // gọi lại ngay thì backend báo "Hệ thống đang xử lý". Kiểm tra xem đơn có được tạo muộn không.
    const busy = /đang xử lý/i.test(err.message);
    if (!(err.status === 504 || err.status === 0 || busy)) throw err;
    const later = await getFlowState(api, oppId).catch(() => null);
    if (later?.step === 'done') return { state: later, orderId: later.order.id, orderStatus: null, steps: [...steps, 'Gửi đơn hàng (phản hồi chậm)'], customer: cust.customer };
    throw new FlowError(
      busy
        ? `${st.code}: CRM vẫn đang xử lý yêu cầu tạo đơn trước đó – chờ 1–2 phút rồi bấm "↻ Trạng thái" / thử lại`
        : `${st.code}: CRM stag không phản hồi khi tạo đơn hàng (${err.status === 504 ? '504 Gateway Time-out' : 'quá thời gian chờ'}) – lỗi phía server CRM (tạo tay trên UI cũng bị), thử lại sau`,
    );
  }
  steps.push('Gửi đơn hàng');
  const state = await getFlowState(api, oppId);
  let orderStatus = null;
  try {
    const o = await api.get(`${ORDER}/${orderId}`);
    orderStatus = o?.statusName ?? o?.orderStatusName ?? Object.entries(o || {}).find(([k, v]) => /status.*name/i.test(k) && typeof v === 'string')?.[1] ?? null;
  } catch {
    // không đọc được chi tiết đơn -> bỏ qua trạng thái
  }
  return { state, orderId, orderStatus, steps, customer: cust.customer ?? { partyName: info.partyName, taxCode: info.taxCode } };
}

export const ORDER_CSV_COLUMNS = ['createdAt', 'env', 'createdBy', 'oppCode', 'quoteCode', 'versionName', 'orderCode', 'customerName', 'taxCode', 'orderId'];

export function toOrderRecord({ env, user, result }) {
  const st = result.state;
  return {
    summary: {
      createdAt: new Date().toLocaleString('vi-VN'),
      env,
      createdBy: user,
      oppCode: st.code,
      quoteCode: st.quote?.code,
      versionName: st.quote?.selectedVersion,
      orderCode: st.order?.code,
      orderId: st.order?.id ?? result.orderId,
      customerName: result.customer?.partyName,
      taxCode: result.customer?.taxCode,
    },
  };
}
