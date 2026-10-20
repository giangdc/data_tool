// Duyệt cơ hội trên BMS (trang "Duyệt cơ hội" > tab Đánh giá).
// Luồng: TPP đánh giá (requestType 4/6) -> BGĐ phê duyệt đánh giá (requestType 5/7) -> Đã duyệt.
// Đánh giá "Đạt" tất cả tiêu chí thường được hệ thống tự phê duyệt luôn (không cần bước BGĐ).
import { ApiError } from '../core/http.js';

const APPROVED = 1;
const WAITING = 2;
const TPP_STEP = [4, 6];
const BGD_STEP = [5, 7];
const EVALUATION_PASS = 1; // 1 = Đạt, 2 = Không đạt
const BGD_APPROVE = 3; // 3 = Phê duyệt, 4 = Từ chối

// Lỗi nghiệp vụ -> hiện nguyên câu cho người dùng
export class ApprovalError extends Error {
  status = 400;
}

function bmsMessage(err) {
  if (!(err instanceof ApiError)) return err.message;
  if (err.status === 403) return 'Tài khoản không có quyền duyệt cơ hội này';
  return err.body?.errors?.map((e) => e?.message).filter(Boolean).join('; ') || err.message;
}

export function normalizeCode(code) {
  const c = String(code ?? '').trim().toUpperCase();
  if (!/^CH\d+$/.test(c)) throw new ApprovalError(`Mã cơ hội không hợp lệ: "${code}" (dạng CH000xxxxx)`);
  return c;
}

function describe(o) {
  const requestType = Number(o.requestType);
  const approved = o.approvalStatus === APPROVED;
  const waiting = o.approvalStatus === WAITING;
  const label = approved ? 'Đã duyệt'
    : !waiting ? `Không chờ duyệt (trạng thái ${o.approvalStatus ?? '?'})`
    : TPP_STEP.includes(requestType) ? 'Chờ TPP đánh giá'
    : BGD_STEP.includes(requestType) ? 'Chờ BGĐ phê duyệt'
    : 'Chờ duyệt (cơ hội mới)';
  return { code: o.opportunityId, approvalStatus: o.approvalStatus, requestType, approved, waiting, label };
}

/** Trạng thái duyệt của 1 cơ hội: { code, approved, waiting, label, ... } */
export async function getApprovalState(api, code) {
  const c = normalizeCode(code);
  try {
    return describe(await api.get(`/api/opportunities/${c}`));
  } catch (err) {
    if (err instanceof ApiError && err.status !== 401) throw new ApprovalError(`${c}: ${bmsMessage(err)}`);
    throw err;
  }
}

/** Duyệt 1 cơ hội bằng tài khoản của api. Trả về { code, steps, state }. */
export async function approveOpportunity(api, code, { note = 'AUTO-QC duyệt tự động' } = {}) {
  const c = normalizeCode(code);
  let state = await getApprovalState(api, c);
  if (state.approved) throw new ApprovalError(`${c} đã được duyệt trước đó`);
  if (!state.waiting) throw new ApprovalError(`${c}: ${state.label}`);

  const steps = [];
  let duplicated = false;
  try {
    for (let round = 0; round < 2 && !state.approved; round++) {
      if (TPP_STEP.includes(state.requestType)) {
        const crit = await api.get('/api/evaluation-opportunities/criteria', { opportunityId: c, isFromConfig: true });
        if (!crit) throw new ApprovalError(`${c}: Tài khoản không có quyền đánh giá (TPP)`);
        const result = await api.put('/api/evaluation-opportunities/evaluate', {
          opportunityId: c,
          note,
          criteria: (crit.evaluations || []).map((a) => ({
            criteriaId: a.criteriaId,
            id: a.id ?? a.criteriaId,
            criteria: a.criteria,
            requirement: a.requirement ?? '',
            description: a.description,
            evaluation: EVALUATION_PASS,
            note: null,
          })),
        });
        duplicated ||= Boolean(result?.isDuplicated);
        steps.push('TPP đánh giá: Đạt');
      } else if (BGD_STEP.includes(state.requestType)) {
        const result = await api.put('/api/evaluation-opportunities/bgd-approve', {
          opportunityId: c,
          bgdApprovalStatus: BGD_APPROVE,
          reason: note,
        });
        duplicated ||= Boolean(result?.isDuplicated);
        steps.push('BGĐ phê duyệt');
      } else {
        throw new ApprovalError(`${c}: ${state.label} – loại yêu cầu ${state.requestType} chưa hỗ trợ duyệt tự động`);
      }
      state = await getApprovalState(api, c);
    }
  } catch (err) {
    if (err instanceof ApprovalError || (err instanceof ApiError && err.status === 401)) throw err;
    throw new ApprovalError(`${c}: ${bmsMessage(err)}`);
  }

  if (!state.approved) {
    throw new ApprovalError(
      `${c}: đã thực hiện "${steps.join(' → ')}" nhưng cơ hội vẫn ${state.label}` +
        (duplicated ? ' (BMS báo trùng dịch vụ với cơ hội khác của khách hàng)' : ''),
    );
  }
  return { code: c, steps, state, duplicated };
}
