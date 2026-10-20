// Cơ hội: tìm theo mã/link/id, đọc cơ hội mẫu thành "template", tạo cơ hội mới theo template.
import { digits, mobilePhone, addDays, startOfDayIso, timeTag } from '../data/random.js';
import { listQuotes, listVersions } from './quote.js';

const OPP = '/sales-management/api/opportunity';
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export class FlowError extends Error {
  status = 400;
}

/** "CH2610160004" | link https://crm-stag.fpt.net/opportunity/<id> | <id> -> id cơ hội. */
export async function resolveOpportunityId(api, input) {
  const text = String(input ?? '').trim();
  const guid = text.match(GUID)?.[0];
  if (guid) return guid.toLowerCase();
  const code = text.toUpperCase();
  if (!/^CH\d+$/.test(code)) throw new FlowError(`"${text}" không phải mã cơ hội (CH…), link hoặc id cơ hội`);
  const res = await api.get(OPP, { keyword: code, page: 1, fetch: 10 });
  const items = res?.items ?? res?.data ?? (Array.isArray(res) ? res : []);
  const hit = items.find((o) => o.code === code);
  if (!hit) throw new FlowError(`Không tìm thấy cơ hội ${code} (hoặc tài khoản không có quyền xem)`);
  return hit.id;
}

export const getOpportunity = (api, id) => api.get(`${OPP}/${id}`);

// Dòng báo giá mẫu không có productType -> lấy theo dịch vụ của cơ hội (1 = thuê bao, 2 = phí khởi tạo)
function productTypeOf(item, specs) {
  return specs.find((s) => s.valueId === item.productId)?.productType ?? (/lắp đặt|khởi tạo|triển khai/i.test(item.name) ? 2 : 1);
}

/** Đọc cơ hội mẫu + version báo giá KH chọn -> dữ liệu cần để tạo cơ hội/báo giá mới giống hệt. */
export async function loadTemplate(api, input) {
  const oppId = await resolveOpportunityId(api, input);
  const opp = await getOpportunity(api, oppId);
  const specs = (opp.services || []).flatMap((s) =>
    (s.opportunityProductSpecification || []).map((p) => ({
      productName: s.serviceGroupName || p.productOffering?.name,
      productSpecificationId: p.productOffering?.productSpecificationId,
      productCatalogId: p.productOffering?.productCatalogId,
      charId: p.prodSpecCharId,
      charName: p.prodSpecCharName,
      valueId: p.prodSpecCharValueId,
      valueName: p.prodSpecCharValueName,
      productType: p.productType,
    })),
  );
  if (!specs.length) throw new FlowError(`Cơ hội mẫu ${opp.code} không có sản phẩm/dịch vụ đề xuất`);

  const quote = (await listQuotes(api, oppId))[0];
  if (!quote) throw new FlowError(`Cơ hội mẫu ${opp.code} chưa có báo giá để copy`);
  const versions = await listVersions(api, quote.id, oppId);
  const version = versions.find((v) => v.isSelected) || versions[0];
  if (!version?.quoteItem?.length) throw new FlowError(`Báo giá mẫu ${quote.code} không có dòng sản phẩm`);
  const pt = version.quotePaymentTerm || {};

  return {
    sample: { id: opp.id, code: opp.code, name: opp.name?.trim(), quoteCode: quote.code, versionName: version.name },
    opportunity: {
      saleId: opp.saleId,
      saleEmail: opp.saleManInfo?.email,
      saleName: opp.saleManInfo?.fullName,
      approverId: opp.userCanApproval,
      approverEmail: opp.emailCanApproval,
      channelId: opp.channelId,
      channelName: opp.channelName,
      productCatalogId: specs[0].productCatalogId,
      priority: opp.priority ?? 2,
      expectedRevenue: opp.expectedRevenue ?? 500000,
      successRate: opp.successRate ?? 50,
      dealSizeId: opp.dealSizeId ?? 1,
      opportunityType: opp.opportunityType ?? 0,
      supportTechFlag: opp.supportTechFlag ?? 1,
      members: (opp.members || []).map((m) => ({
        empId: m.empId,
        email: m.email,
        name: m.fullName,
        percentage: m.percentage,
        roleMembers: (m.roleMembers || []).map((r) => r.roleMemberType),
      })),
      specs,
    },
    quote: {
      extraClause: version.extraClause ?? null,
      legalEntityInformation: version.legalEntityInformation ?? 1,
      customerType: version.customerType ?? 1,
      paymentTerm: { paymentType: pt.type ?? 1, paymentRequest: pt.paymentRequest ?? 1, paymentTerm: pt.paymentTerm ?? 15, paymentTermNotes: null },
      items: version.quoteItem.map((i) => ({
        productId: i.productId,
        name: i.name,
        quantity: i.quantity,
        unitOfMeasure: i.unitOfMeasure ?? 2,
        unitOfMeasureText: i.unitOfMeasureText,
        productPrice: i.productPrice ?? i.price,
        vatRate: i.vatRate ?? 10,
        productType: productTypeOf(i, specs),
      })),
    },
  };
}

/** Tóm tắt template cho giao diện. */
export function describeTemplate(tpl) {
  const { opportunity: o, quote: q } = tpl;
  const total = q.items.reduce((s, i) => s + i.productPrice * i.quantity, 0);
  return {
    sample: tpl.sample,
    am: o.saleEmail,
    amName: o.saleName,
    approver: o.approverEmail,
    channel: o.channelName,
    expectedRevenue: o.expectedRevenue,
    successRate: o.successRate,
    services: o.specs.map((s) => `${s.productName} / ${s.charName} / ${s.valueName}`),
    items: q.items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.productPrice, type: i.productType === 2 ? 'Phí khởi tạo' : 'Thuê bao' })),
    total,
  };
}

/** Tạo cơ hội mới (KH tiềm năng mới) giống cơ hội mẫu -> { id, code, payload }. */
export async function createOpportunity(api, tpl, { prefix }) {
  const o = tpl.opportunity;
  const members = o.members.length
    ? o.members
    : [{ empId: o.saleId, email: o.saleEmail, name: o.saleName, percentage: 100, roleMembers: [1] }];
  const payload = {
    description: '',
    saleLeadId: null,
    name: `[${prefix}] ${tpl.sample.name || o.specs[0].productName} - ${timeTag()}-${digits(3)}`,
    sourceId: null,
    saleId: o.saleId,
    services: o.specs.map((s) => ({ oppId: null, serviceGroupId: s.productSpecificationId, serviceTypeId: s.valueId, prodSpecCharId: s.charId })),
    members: members.map((m) => ({
      empId: m.empId,
      email: m.email,
      name: m.name,
      percentage: m.percentage,
      roleMembers: m.roleMembers,
      isPrimary: m.roleMembers.includes(1),
      roleMember: 0,
    })),
    selectedMembers: members.map((m) => m.empId),
    priority: o.priority,
    partyType: 2, // Khách hàng tiềm năng (hồ sơ chính thức tạo ở bước đơn hàng)
    partyClassification: 1, // Tổ chức - Trong nước
    channelId: o.channelId,
    expectedRevenue: o.expectedRevenue,
    successRate: o.successRate,
    endDate: startOfDayIso(addDays(30)),
    prospectContactName: `${prefix} Lien He ${digits(4)}`,
    prospectContactInfo: mobilePhone(),
    productCatalogId: o.productCatalogId,
    productSpecByIndex: [],
    userCanApproval: o.approverId,
    saleLeadNote: null,
    opportunityType: o.opportunityType,
    dealSizeId: o.dealSizeId,
    supportTechFlag: o.supportTechFlag,
    isHasSpecification: true,
  };
  const id = await api.post(OPP, payload);
  const created = await getOpportunity(api, id);
  return { id, code: created.code, payload };
}

export const OPPORTUNITY_CSV_COLUMNS = ['createdAt', 'env', 'createdBy', 'code', 'name', 'sampleCode', 'contact', 'am', 'oppId'];

export function toOpportunityRecord({ env, user, tpl, result }) {
  const p = result.payload;
  return {
    summary: {
      createdAt: new Date().toLocaleString('vi-VN'),
      env,
      createdBy: user,
      oppId: result.id,
      code: result.code,
      name: p.name,
      sampleCode: tpl.sample.code,
      contact: `${p.prospectContactName} · ${p.prospectContactInfo}`,
      am: tpl.opportunity.saleEmail,
    },
    payload: p,
  };
}
