// Yêu cầu tạo hợp đồng (YCTHĐ) trên BMS cho cơ hội đã duyệt.
// Luồng (giống nút "Yêu cầu tạo HĐ" ở trang chi tiết cơ hội):
//   1. Ghi chú cho các giai đoạn chưa hoàn thành (BMS bắt buộc)
//   2. Báo giá 1đ kèm file PDF mẫu (BMS bắt buộc có báo giá; 1đ thì không vượt hạn mức -> không cần duyệt giá)
//   3. Gửi đăng ký HĐ: POST /api/registration/{registrationId} -> "Chờ BGĐ duyệt"
// Dịch vụ LeasedLine (tool SM "LC"): phải khảo sát trước (survey.js); địa chỉ triển khai lấy từ phiếu KS trên SM,
// lưu nháp YC HĐ rồi khai cước trên SM (tổng cước = giá trị HĐ) trước khi gửi – nếu không BMS báo
// "Giá trị LeasedLine không đồng bộ".
// BGĐ duyệt YC HĐ: POST /api/approval-opportunities/approve-registration -> BMS cấp mã đăng ký (CMR...) + số HĐ,
// chuyển sang CM ("Chờ DEM duyệt").
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../core/env.js';
import { ApiError } from '../core/http.js';
import { pick, formatDate } from '../data/random.js';
import { normalizeCode, getApprovalState } from './approval.js';

const QUOTATION_PDF = path.join(ROOT_DIR, 'assets', 'quotation-sample.pdf');
const QUOTATION_VALUE = 1;
const STAGE_NOTE = 'AUTO-QC';
const OWNER = 1; // vị trí thành viên: 1 = AM (Owner), 2 = Co-sale
const COSALE = 2;
const BGD_WAITING = 2; // bgdApprovalStatus: 2 = chờ BGĐ duyệt, 1 = đã duyệt
const BGD_APPROVED = 1;
const REGISTRATION_APPROVE = 1; // approve-registration: 1 = phê duyệt, 2 = từ chối

export class ContractError extends Error {
  status = 400;
}

function bmsMessage(err) {
  if (!(err instanceof ApiError)) return err.message;
  if (err.status === 403) return 'Tài khoản không có quyền thao tác trên cơ hội này';
  // BMS: {errors:[{message}]}, SM: {error:{message}}
  return err.body?.errors?.map((e) => e?.message).filter(Boolean).join('; ') || err.body?.error?.message || err.message;
}

/** Trạng thái YC HĐ của 1 cơ hội: { requested, label, registrationId, ... } (requested = đã gửi YC HĐ) */
export async function getContractState(api, code) {
  const c = normalizeCode(code);
  const list = (await api.get(`/api/opportunities/${c}/contracts`)) || [];
  const sent = list.filter((x) => x.statusRegistName || x.bgdApprovalStatus != null || x.contractNo);
  const first = sent[0] || list[0];
  return {
    code: c,
    requested: sent.length > 0,
    label: sent.length ? sent.map((x) => x.statusRegistName || 'Đã gửi YC HĐ').join(', ') : 'Chưa có YC HĐ',
    registrationId: first?.registrationId ?? null,
    regCode: first?.regCode ?? null,
    contractNo: first?.contractNo ?? null,
    bgdApprovalStatus: first?.bgdApprovalStatus ?? null,
    waitingBgd: sent.some((x) => x.bgdApprovalStatus === BGD_WAITING),
    // từng dịch vụ đang chờ BGĐ duyệt (1 cơ hội tool tạo = 1 dịch vụ, vẫn duyệt hết cho chắc)
    waitingIds: sent.filter((x) => x.bgdApprovalStatus === BGD_WAITING).map((x) => x.registrationId),
  };
}

/** BGĐ duyệt YC HĐ của 1 cơ hội bằng tài khoản của api (BGĐ được chọn hoặc admin). Trả về { code, state }. */
export async function approveContractRequest(api, code, { reason = `${STAGE_NOTE} duyệt YC HĐ tự động` } = {}) {
  const c = normalizeCode(code);
  try {
    const before = await getContractState(api, c);
    if (!before.requested) throw new ContractError(`${c}: chưa có YC HĐ – tạo YC HĐ trước`);
    if (!before.waitingBgd) {
      throw new ContractError(before.bgdApprovalStatus === BGD_APPROVED
        ? `${c}: YC HĐ đã được BGĐ duyệt trước đó (${before.label})`
        : `${c}: YC HĐ không ở trạng thái chờ BGĐ duyệt (${before.label})`);
    }
    for (const registrationId of before.waitingIds) {
      try {
        await api.post('/api/approval-opportunities/approve-registration', { registrationId, approvalStatus: REGISTRATION_APPROVE, reason });
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 403)) throw err;
        throw new ContractError(`${c}: tài khoản không có quyền duyệt YC HĐ – cần BGĐ được chọn khi tạo cơ hội hoặc admin (vd: chuyennt5)`);
      }
    }
    // BMS đẩy sang CM bất đồng bộ: vài giây sau mới có mã đăng ký (CMR...) + số HĐ, trạng thái "Chờ DEM duyệt"
    let state = await getContractState(api, c);
    for (let i = 0; i < 8 && !state.regCode; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      state = await getContractState(api, c);
    }
    return { code: c, state };
  } catch (err) {
    if (err instanceof ContractError || (err instanceof ApiError && err.status === 401)) throw err;
    throw new ContractError(`${c}: ${bmsMessage(err)}`);
  }
}

// 1. Ghi chú cho giai đoạn chưa hoàn thành (chưa có ghi chú)
async function fillStageNotes(api, code) {
  const { items = [] } = (await api.get(`/api/opportunities/${code}/stages`)) || {};
  const todo = items.filter((s) => !s.actualEndDate && !s.note?.trim());
  for (const s of todo) {
    await api.put(`/api/opportunities/${code}/stages/${s.id}`, {
      opportunityId: code,
      id: s.id,
      planEndDate: String(s.planEndDate).slice(0, 10),
      note: STAGE_NOTE,
    });
  }
  return todo.length;
}

// 2. Báo giá 1đ cho dịch vụ của cơ hội
async function createQuotation(api, code) {
  const { services = [] } = (await api.get(`/api/quotation/services/${code}`)) || {};
  if (!services.length) throw new ContractError(`${code}: không lấy được dịch vụ để tạo báo giá`);
  const form = new FormData();
  form.append('opportunityId', code);
  form.append('description', `${STAGE_NOTE} báo giá tự động`);
  form.append('totalValue', String(QUOTATION_VALUE * services.length));
  services.forEach((s, i) => {
    form.append(`services[${i}].serviceGroup`, String(s.serviceGroupId ?? ''));
    form.append(`services[${i}].serviceType`, String(s.serviceTypeId ?? ''));
    form.append(`services[${i}].servicePackCode`, s.servicePackCode ?? '');
    form.append(`services[${i}].servicePackId`, '');
    form.append(`services[${i}].value`, String(QUOTATION_VALUE));
  });
  form.append('quotationDocuments', new Blob([readFileSync(QUOTATION_PDF)], { type: 'application/pdf' }), 'AUTO-QC-bao-gia.pdf');
  await api.post('/api/quotation', form);
}

// Dịch vụ tích hợp tool LeasedLine: BMS lấy địa chỉ triển khai từ SM (địa chỉ đã khảo sát)
async function leasedLineDeployment(api, code, svc) {
  const res = await api
    .post('/api/registration/deploy-address-by-service-type', {
      opportunityId: code,
      registrationId: svc.registrationId,
      serviceGroup: svc.serviceGroup,
      serviceType: svc.serviceType,
    })
    .catch((err) => {
      if (err instanceof ApiError && err.status === 401) throw err;
      return null;
    });
  if (!res?.listDeployment?.length || !/\/sm\/v2\/ll\//.test(res.urlCreateRegist || '')) return null;
  return res.listDeployment.map((d) => ({
    contactName: d.contactName,
    contactPhone: d.contactPhone,
    contactEmail: d.contactEmail,
    address: d.address,
    fullAddress: d.fullAddress ?? d.address,
    location: d.cityId,
    district: d.districtId,
    ward: d.wardId,
    wardName: null,
    refCodeIntegrated: d.refCodeIntegrated ?? d.refcode ?? null,
    isAddressOfIntegrated: true,
    isSelected: true,
    serviceType: svc.serviceType,
    serviceGroup: svc.serviceGroup,
    idOfServiceTypeInPack: null,
  }));
}

// Khai cước từng địa chỉ trên SM: tổng (phí lắp đặt + cước) phải bằng giá trị HĐ đã lưu nháp trên BMS
async function saveLeasedLineCharges(sm, code, svc, registration) {
  const refCode = `${code}_${svc.registrationId}`;
  const detail = await sm.get('/bms-charge-details', { refCode, serviceGroupId: svc.serviceGroup, serviceTypeId: svc.serviceType });
  const prepaid = detail.paymentTypeCode === '3901'; // 3901 trả trước, 3902 trả hàng tháng
  await sm.post('/bms-charge-details', {
    refCode,
    serviceTypeId: svc.serviceType,
    serviceGroupId: svc.serviceGroup,
    isIntergratedService: false,
    // dồn toàn bộ cước vào địa chỉ đầu tiên, các địa chỉ khác 0đ
    chargeCurrentDetails: detail.rows.map((r, i) => ({
      paymentTypeCode: detail.paymentTypeCode,
      registrationCode: r.registrationCode,
      initialFee: i === 0 ? registration.feeContract : 0,
      totalAmt: i === 0 ? registration.contractValue - registration.feeContract : 0,
      totalMonth: prepaid ? registration.dateContractMonth : 0,
    })),
  });
}

async function canCreate(api, code, svc) {
  return api.get(`/api/opportunities/${code}/can-create-registration`, {
    serviceGroup: svc.serviceGroup,
    serviceType: svc.serviceType,
    servicePackCode: svc.servicePackCode ?? undefined,
  });
}

// 3. Payload đăng ký HĐ (tương đương form "Yêu cầu tạo HĐ/PL" – đã bắt từ UI thật)
async function buildRegistration(api, code, reg, regions) {
  const c = reg.customer || {};
  const [province, ward, members] = await Promise.all([
    api.get('/api/bam/provinces').then((list) => list.find((x) => x.id === c.location)),
    c.location ? api.get('/api/bam/communes', { provinceId: c.location }).then((list) => list.find((x) => x.id === c.ward)) : null,
    api.get(`/api/opportunities/${code}/members`),
  ]);
  const contact = {
    contactName: c.representativeName || c.fullName,
    contactEmail: c.email,
    contactPhone: c.phone,
    location: c.location,
    locationName: province?.nameVN ?? null,
    address: c.address,
    country: c.country,
    fullAddress: c.fullAddress,
  };
  const months = 1;
  return {
    registration: {
      typeDocContract: 1, // Hợp đồng
      typeContract: reg.serviceGroup === 15000 ? 2 : 1, // giống mặc định của form
      paymentMethod: 2, // Trả sau
      location: pick(regions).id, // Vùng miền
      feeContract: QUOTATION_VALUE,
      monthlyFeeContract: QUOTATION_VALUE,
      dateContractMonth: months,
      contractValue: QUOTATION_VALUE + QUOTATION_VALUE * months,
      contractValueCurrency: 'VND',
      paymentTerm: 1,
      effectiveContractDate: `${formatDate(new Date())}T00:00:00`,
      limitCreditDay: 30,
      description: `${STAGE_NOTE} yêu cầu tạo HĐ tự động`,
      notes: null,
      eContractFlag: null,
      agencyContractFlag: null,
      onSiteWarranty: null,
      autoRenewContract: null,
      isDebt: null,
      debtLimitDayCount: null,
      saleName: reg.saleName,
      serviceId: reg.serviceId,
      contractNo: '',
      packServiceIds: [],
    },
    // Form thu cước lưu phường ở field district; form triển khai dùng ward
    listBillingContact: [{ ...contact, district: c.ward, districtName: ward?.nameVN ?? null }],
    listTechContact: [{ name: contact.contactName, email: c.email, phone: c.phone }],
    listDeployAddress: [{ ...contact, ward: c.ward, wardName: ward?.nameVN ?? null, idOfServiceTypeInPack: null }],
    isUpdateTemp: false,
    appCodeInsert: 'FTIBMS',
    opportunityId: code,
    listEContractDocument: [],
    listCooperationAgreementDocument: [],
    listMember: (members || [])
      .filter((m) => m.position === OWNER || m.position === COSALE)
      .map((m) => ({ name: m.name, position: m.position, contractRate: m.position === OWNER ? 100 : 0 })),
  };
}

/**
 * Tạo YC HĐ cho 1 cơ hội đã duyệt bằng tài khoản của api. Trả về { code, steps, state, payload }.
 * getSm: async () => ApiClient SM – chỉ gọi khi dịch vụ là LeasedLine (cần khai cước trên SM).
 */
export async function createContractRequest(api, code, { getSm } = {}) {
  const c = normalizeCode(code);
  const approval = await getApprovalState(api, c);
  if (!approval.approved) throw new ContractError(`${c}: cơ hội chưa được duyệt (${approval.label}) – duyệt trước rồi mới tạo HĐ`);

  const steps = [];
  try {
    const existing = await getContractState(api, c);
    const services = (await api.get(`/api/opportunities/${c}/registration-services`)) || [];
    const svc = services.find((s) => s.registrationId && !s.regCode && s.bgdApprovalStatus == null && !s.contractNo);
    if (!svc) {
      throw new ContractError(existing.requested ? `${c} đã có YC HĐ trước đó (${existing.label})` : `${c}: không còn dịch vụ nào để tạo YC HĐ`);
    }

    const noted = await fillStageNotes(api, c);
    if (noted) steps.push(`Ghi chú ${noted} giai đoạn`);

    let check = await canCreate(api, c, svc);
    if (!check?.canCreate && /báo giá/i.test(check?.message || '')) {
      await createQuotation(api, c);
      steps.push(`Báo giá ${QUOTATION_VALUE}đ`);
      check = await canCreate(api, c, svc);
    }
    if (!check?.canCreate) {
      const msg = check?.message || 'BMS không cho tạo YC HĐ';
      throw new ContractError(`${c}: ${msg}${/khảo sát/i.test(msg) ? ' – bấm "Tạo KS" (hoặc CLI survey) trước' : ''}`);
    }

    const [reg, regions, deployment] = await Promise.all([
      api.get(`/api/registration/${svc.registrationId}`),
      api.get('/api/master-data/locations-for-regist'),
      leasedLineDeployment(api, c, svc),
    ]);
    const payload = await buildRegistration(api, c, reg, regions);
    if (deployment) {
      if (!getSm) throw new ContractError(`${c}: dịch vụ LeasedLine cần khai cước trên SM – chưa có phiên SM`);
      payload.listDeployAddress = deployment;
      await api.post(`/api/registration/${svc.registrationId}`, { ...payload, isUpdateTemp: true });
      steps.push('Lưu nháp YC HĐ');
      await saveLeasedLineCharges(await getSm(), c, svc, payload.registration);
      steps.push(`Khai cước SM ${deployment.length} địa chỉ`);
    }
    await api.post(`/api/registration/${svc.registrationId}`, payload);
    steps.push('Gửi YC HĐ');

    const state = await getContractState(api, c);
    return { code: c, steps, state, registrationId: svc.registrationId, service: `${svc.serviceGroupName} / ${svc.serviceTypeName}`, payload };
  } catch (err) {
    if (err instanceof ContractError || (err instanceof ApiError && err.status === 401)) throw err;
    throw new ContractError(`${c}: ${steps.length ? `đã "${steps.join(' → ')}" rồi lỗi: ` : ''}${bmsMessage(err)}`);
  }
}

/** Bản ghi lưu output/contracts.* */
export function toContractRecord({ env, user, result }) {
  const regions = { 8: 'HCM', 4: 'HN' };
  const r = result.payload.registration;
  return {
    summary: {
      createdAt: new Date().toLocaleString('vi-VN'),
      env,
      createdBy: user,
      code: result.code,
      registrationId: result.registrationId,
      service: result.service,
      contractValue: r.contractValue,
      region: regions[r.location] ?? r.location,
      status: result.state.label,
      steps: result.steps.join(' → '),
    },
    payload: result.payload,
  };
}

/** Bản ghi lưu output/contract-approvals.* */
export function toContractApprovalRecord({ env, user, result }) {
  const st = result.state;
  return {
    summary: {
      createdAt: new Date().toLocaleString('vi-VN'),
      env,
      approvedBy: user,
      code: result.code,
      registrationId: st.registrationId,
      regCode: st.regCode,
      contractNo: st.contractNo,
      status: st.label,
    },
  };
}

export const CONTRACT_APPROVAL_CSV_COLUMNS = ['createdAt', 'env', 'approvedBy', 'code', 'registrationId', 'regCode', 'contractNo', 'status'];

export const CONTRACT_CSV_COLUMNS = ['createdAt', 'env', 'createdBy', 'code', 'registrationId', 'service', 'contractValue', 'region', 'status', 'steps'];
