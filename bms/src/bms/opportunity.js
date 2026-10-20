// Luồng tạo cơ hội trên BMS: validate khách hàng -> tạo cơ hội (gửi duyệt).
import * as rnd from '../data/random.js';
import { buildNewCustomer, toValidatePayload } from './customer.js';

const PRIORITY_MEDIUM = 2; // "Trung bình" - mặc định trên UI
const REVENUE_PERIOD_YEAR = 1; // "Năm"

// Người được chỉ định (nếu có) phải nằm trong danh sách hợp lệ; bỏ trống -> random
function pickApprover(list, wanted, label, amName) {
  if (!list.length) throw new Error(`AM ${amName} không có ${label} nào`);
  if (!wanted) return rnd.pick(list).userName;
  const found = list.find((u) => u.userName?.toLowerCase() === String(wanted).trim().toLowerCase());
  if (!found) throw new Error(`"${wanted}" không thuộc danh sách ${label} của AM ${amName}`);
  return found.userName;
}

export async function buildOpportunityPayload(master, { group, type, am, tpp, bgd, prefix }) {
  const { sale, tpp: tppList, bgd: bgdList } = await master.approvers(am);
  const tppUser = pickApprover(tppList, tpp, 'TPP đánh giá', sale.userName);
  const bgdUser = pickApprover(bgdList, bgd, 'BGĐ phê duyệt', sale.userName);

  const customer = await buildNewCustomer(master, { prefix });
  const serviceName = type.serviceTypeName.trim();

  return {
    customerId: null,
    leadId: null,
    leadDescription: null,
    opportunity: {
      name: `[${prefix}] ${serviceName} - ${rnd.timeTag()}-${rnd.digits(3)}`,
      description: `Dữ liệu test tự động: ${group.serviceGroupName} / ${serviceName}`,
      expectedRevenue: rnd.randInt(1, 50) * 10_000_000,
      expectedRevenuePeriod: REVENUE_PERIOD_YEAR,
      expectedBudget: null,
      successRate: rnd.randInt(2, 18) * 5,
      endDate: rnd.formatDate(rnd.addDays(rnd.randInt(15, 180))),
      priority: PRIORITY_MEDIUM,
      numberRack: null,
      services: [{ serviceGroup: group.id, serviceType: type.id, servicePackCode: type.servicePackCode ?? null }],
      documents: null,
    },
    approval: {
      saleName: sale.userName,
      tppCanApproval: [tppUser],
      usersCanApproval: [bgdUser],
      userReceiveNotification: null,
      campaignId: null,
    },
    customer,
  };
}

/** Tạo 1 cơ hội. Trả về { code, payload }. */
export async function createOpportunity(api, master, options) {
  const payload = await buildOpportunityPayload(master, options);
  const valid = await api.post('/api/opportunities/validate', toValidatePayload(payload.customer));
  if (valid === false) throw new Error('BMS từ chối thông tin khách hàng (validate = false)');
  const code = await api.post('/api/opportunities', payload);
  return { code, payload };
}

/** Bản ghi lưu vào output/ (dùng chung cho CLI và giao diện web). */
export function toOpportunityRecord({ env, user, group, type, code, payload }) {
  const now = new Date();
  return {
    createdAt: now.toISOString(),
    env,
    createdBy: user,
    code,
    payload,
    summary: {
      createdAt: now.toLocaleString('vi-VN'),
      env,
      createdBy: user,
      code,
      name: payload.opportunity.name,
      serviceGroup: group.serviceGroupName,
      serviceType: type.serviceTypeName.trim(),
      customerName: payload.customer.fullName,
      taxCode: payload.customer.identity,
      am: payload.approval.saleName,
      tpp: payload.approval.tppCanApproval.join(';'),
      bgd: payload.approval.usersCanApproval.join(';'),
    },
  };
}
