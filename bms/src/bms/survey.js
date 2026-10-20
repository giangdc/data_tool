// Khảo sát dịch vụ trước khi lên YC HĐ (dịch vụ Kênh truyền – LeasedLine, tool SM mã "LC").
// BMS chặn tạo YC HĐ: "... (LeasedLine) cần khảo sát trước khi lên yêu cầu Hợp đồng".
// Luồng (giống thao tác tay BMS -> SM):
//   1. BMS: tạo Công việc loại 4 "Yêu cầu khảo sát" cho dịch vụ (POST /api/works)
//   2. SM : tạo phiếu khảo sát theo workId – 1 địa chỉ ONNET (POST registration-addresses/bulk)
//   3. SM : phân công + nhập kết quả Thành công cho Thuê bao (Hạ tầng FTI), Access (FTI), Core (NOC)
//   4. SM : chốt kết quả cuối cùng = Thành công -> SM báo về BMS: công việc "Khảo sát thành công"
import { ApiError } from '../core/http.js';
import { pick, formatDate } from '../data/random.js';
import { normalizeCode } from './approval.js';

const NOTE = 'AUTO-QC';
const WORK_SURVEY = 4; // loại công việc: 4 = Yêu cầu khảo sát
const RESULT_OK = 'Khảo sát thành công';
const SM_TOOL = 'LC'; // tool LeasedLine trên SM – loại duy nhất tool hỗ trợ
const OK = '204'; // trạng thái khảo sát SM: 202 chưa KS, 203 đang KS, 204 thành công, 205 không thành công
const ONNET = 6100;
const SUB_HA_TANG_FTI = '611'; // đơn vị KS thuê bao "Hạ tầng FTI" (tự nhận kết quả Thành công)
const ACCESS_FTI = '607';
const REGION = { code: 'HCM', id: 9, provinceId: 8, provinceName: 'Thành phố Hồ Chí Minh' };

export class SurveyError extends Error {
  status = 400;
}

function apiMessage(err) {
  if (!(err instanceof ApiError)) return err.message;
  if (err.status === 403) return 'Tài khoản không có quyền thao tác';
  return err.body?.errors?.map((e) => e?.message).filter(Boolean).join('; ') || err.body?.error?.message || err.message;
}

async function surveyWorks(api, code) {
  const { data = [] } = (await api.get('/api/works/by-opportunity', { OpportunityId: code, PageIndex: 1, PageSize: 50 })) || {};
  return data.filter((w) => w.type === WORK_SURVEY && w.isActive !== false);
}

/**
 * Trạng thái khảo sát của 1 cơ hội:
 * { required, done, label, workId, service } – required = dịch vụ cần khảo sát trước khi lên HĐ.
 * BMS chỉ trả danh sách dịch vụ cần KS (works/opportunity-service) khi CHƯA có công việc khảo sát.
 */
export async function getSurveyState(api, code) {
  const c = normalizeCode(code);
  const [pending, works] = await Promise.all([api.get('/api/works/opportunity-service', { oppId: c }), surveyWorks(api, c)]);
  const service = pending?.surveys?.[0] ?? null;
  const done = works.find((w) => w.result === RESULT_OK);
  if (done) return { code: c, required: true, done: true, label: RESULT_OK, workId: done.workId };
  if (works.length) {
    const w = works[0];
    return { code: c, required: true, done: false, label: `Đang khảo sát${w.result ? ` (${w.result})` : ''}`, workId: w.workId };
  }
  if (service) return { code: c, required: true, done: false, label: 'Cần khảo sát', workId: null, service };
  return { code: c, required: false, done: false, label: 'Không cần khảo sát', workId: null };
}

// 1. Công việc khảo sát trên BMS (người thực hiện = thành viên phụ trách cơ hội, thường là AM)
async function createWork(api, code, service, fallbackExecutive) {
  const members = (await api.get('/api/works/members', { oppId: code })) || [];
  const deadline = new Date(Date.now() + 7 * 864e5);
  const res = await api.post('/api/works', {
    name: `${NOTE} khảo sát ${service.displayName}`,
    opportunityId: code,
    description: `${NOTE} tạo yêu cầu khảo sát tự động`,
    priority: 2,
    executiveName: members[0] || fallbackExecutive,
    deadline: `${formatDate(deadline)}T23:59:00`,
    type: WORK_SURVEY,
    serviceTypeId: service.serviceTypeId,
    serviceGroupId: service.serviceGroupId,
    serviceId: service.serviceId,
    idOfServiceTypeInPack: service.idOfServiceTypeInPack,
    servicePackId: service.servicePackId,
    attachedFileIds: [],
  });
  return res.workId;
}

// 2. Phiếu khảo sát SM: 1 địa chỉ ONNET ở HCM, người liên hệ = người đại diện KH
async function createSurveyRequest(sm, workId) {
  const info = await sm.get(`/registrations/by-work-id/${workId}/integrated-info`);
  const [branches, communes] = await Promise.all([
    sm.get('/lookups/branches', { regionId: REGION.id }),
    sm.get('/lookups/communes', { provinceId: REGION.provinceId }),
  ]);
  const branch = branches.find((b) => b.code === REGION.code) || branches[0];
  const ward = pick(communes);
  const street = `Số ${1 + Math.floor(Math.random() * 200)} Đường ${NOTE}`;
  const today = new Date();
  const deploy = new Date(today.getFullYear(), today.getMonth() + 4, 0); // giống mặc định form: cuối tháng +3
  const address = {
    regionCode: REGION.code,
    branchCode: branch.code,
    wardId: ward.id,
    provinceId: REGION.provinceId,
    street,
    address: [street, ward.nameVN || ward.name, REGION.provinceName].join(', '),
    building: null,
    contactName: info.cusRepresentName || info.cusName,
    contactPhone: info.cusPhone,
    contactEmail: null,
    isMainAddress: true,
    mainAddressNote: NOTE,
    isNeedSolution: false,
    surveyPlanDate: formatDate(today),
    deployPlanDate: formatDate(deploy),
    channelTypeCode: ONNET,
    hirePartnerCode: null,
    bandwidth: 100,
    internationalBandwidth: null,
  };
  return sm.post('/registration-addresses/bulk', {
    workId: Number(workId),
    saleMan: info.saleMan,
    priorityWork: info.priorityWork,
    bmsOpportunity: info.oppId,
    bmsRefCode: info.refCode,
    regionCode: REGION.code,
    emails: ['autoqc@example.com'],
    serviceTypeId: info.serviceTypeCode,
    isConnectHA: null,
    directionConnectionCSPCode: null,
    regionConnectionCSPCode: null,
    portConnection: null,
    connectionCSPTypeCode: null,
    note: null,
    domesticAddresses: [address],
    internationalAddresses: [],
    dcAddresses: [],
  });
}

// 3 + 4. Nhập kết quả Thành công cho từng phần còn thiếu rồi chốt kết quả cuối cùng
async function completeSurvey(sm, surveyId, techFollow) {
  const { survey } = await sm.get(`/surveys/${surveyId}`);
  if (survey.finalStatusCode === OK) return false;
  const today = formatDate(new Date());
  const dates = { surveyRecommendedDate: today, surveyAppointmentDate: today, surveyFinalDate: today };
  const result = { reasonCode: null, statusCode: OK, reasonNotOkCode: null, note: NOTE };
  if (!survey.subscriptionId) {
    await sm.post(`/surveys/${surveyId}/subscription`, {
      subscriptionCode: SUB_HA_TANG_FTI,
      note: NOTE,
      surveyRecommendedDate: null,
      surveyAppointmentDate: null,
      surveyFinalDate: `${today}T00:00:00`,
      surveyDate: today,
    });
  }
  if (!survey.accessId) {
    await sm.post(`/surveys/${surveyId}/access`, {
      accessCode: ACCESS_FTI,
      ...dates,
      ...result,
      constructionPlans: [{ popPlus: NOTE, ring: 'Other', switchOlt: '1', portInfo: '1000', expectedCost: 0, approveDate: today, images: null }],
    });
  }
  if (!survey.coreId) {
    await sm.post(`/surveys/${surveyId}/core`, {
      ...dates,
      ...result,
      mPopSdhNode: NOTE,
      interfaceCode: '4', // 1GE
      deliveryCustomerDate: today,
      returnDate: today,
      constructionPlans: [{ images: null }],
    });
  }
  await sm.put(`/surveys/${surveyId}/final-status`, { finalStatusCode: OK, ftiTechFollow: techFollow });
  return true;
}

/**
 * Khảo sát dịch vụ của 1 cơ hội đến khi BMS ghi nhận "Khảo sát thành công".
 * api = BMS, sm = ApiClient SM (cùng tài khoản), user = tk đang đăng nhập (người follow KS trên SM).
 * Chạy lại được: bước nào đã làm (công việc, phiếu KS, từng phần KS) thì bỏ qua.
 */
export async function createSurvey(api, sm, code, { user } = {}) {
  const c = normalizeCode(code);
  const steps = [];
  try {
    const before = await getSurveyState(api, c);
    if (!before.required) throw new SurveyError(`${c}: dịch vụ không cần khảo sát (hoặc cơ hội chưa có dịch vụ cần KS)`);
    if (before.done) throw new SurveyError(`${c}: đã khảo sát thành công trước đó`);

    let workId = before.workId;
    if (!workId) {
      if (before.service.toolCode !== SM_TOOL) {
        throw new SurveyError(`${c}: chưa hỗ trợ khảo sát dịch vụ ${before.service.displayName} (tool ${before.service.toolCode || '?'}) – hiện chỉ hỗ trợ LeasedLine`);
      }
      workId = await createWork(api, c, before.service, user);
      steps.push(`Công việc KS ${workId}`);
    } else {
      const work = await api.get(`/api/works/${workId}`);
      if (work.toolCode !== SM_TOOL) throw new SurveyError(`${c}: công việc KS ${workId} thuộc tool ${work.toolCode || '?'} – chưa hỗ trợ`);
    }

    let reg = await sm.get(`/registrations/by-work-id/${workId}`);
    if (!reg?.exists) {
      await createSurveyRequest(sm, workId);
      reg = await sm.get(`/registrations/by-work-id/${workId}`);
      steps.push(`Phiếu KS ${reg.registrationCode}`);
    }

    const { items = [] } = (await sm.get('/surveys', { search: reg.bmsSurveyCode, pageNumber: 1, pageSize: 50 })) || {};
    const surveys = items.filter((s) => s.bms_SurveyCode === reg.bmsSurveyCode);
    if (!surveys.length) throw new SurveyError(`${c}: không tìm thấy phiếu khảo sát ${reg.bmsSurveyCode} trên SM`);
    let finished = 0;
    for (const s of surveys) finished += (await completeSurvey(sm, s.id, user)) ? 1 : 0;
    if (finished) steps.push(`KS thành công ${finished} địa chỉ`);

    // SM báo kết quả về BMS bất đồng bộ (thường ~1-3s)
    let state = await getSurveyState(api, c);
    for (let i = 0; i < 8 && !state.done; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      state = await getSurveyState(api, c);
    }
    return { code: c, steps, state, workId, registrationCode: reg.registrationCode, surveyCode: reg.bmsSurveyCode };
  } catch (err) {
    if (err instanceof SurveyError || (err instanceof ApiError && err.status === 401)) throw err;
    throw new SurveyError(`${c}: ${steps.length ? `đã "${steps.join(' → ')}" rồi lỗi: ` : ''}${apiMessage(err)}`);
  }
}

/** Bản ghi lưu output/surveys.* */
export function toSurveyRecord({ env, user, result }) {
  return {
    createdAt: new Date().toISOString(),
    env,
    createdBy: user,
    code: result.code,
    workId: result.workId,
    registrationCode: result.registrationCode,
    surveyCode: result.surveyCode,
    status: result.state?.label ?? '',
    steps: result.steps.join(' → '),
  };
}

export const SURVEY_CSV_COLUMNS = ['createdAt', 'env', 'createdBy', 'code', 'workId', 'registrationCode', 'surveyCode', 'status', 'steps'];
