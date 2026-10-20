// Trạng thái luồng của 1 cơ hội: cần báo giá -> cần đánh dấu version -> chờ ban hành -> tạo đơn -> xong.
import { getOpportunity } from './opportunity.js';
import { listQuotes, listVersions, POLICY_STATUS } from './quote.js';

/**
 * step: 'quote' (chưa có BG) | 'select' (chưa đánh dấu version) | 'issuing' (chờ chính sách ban hành)
 *       | 'order' (tạo đơn được) | 'done' (đã có đơn) | 'blocked' (chính sách bị từ chối/hủy)
 */
export async function getFlowState(api, oppId) {
  const opp = await getOpportunity(api, oppId);
  const state = {
    oppId,
    code: opp.code,
    name: opp.name?.trim(),
    customer: opp.accountName || opp.party?.partyName || opp.prospectContactName || '',
    stageName: opp.stageName,
    approval: opp.approvalStatusName,
  };
  const quote = (await listQuotes(api, oppId))[0];
  if (!quote) return { ...state, step: 'quote', label: 'Chưa có báo giá' };
  state.quote = { id: quote.id, code: quote.code, versions: quote.totalVersion, selectedVersion: quote.selectedVersion };
  if (quote.hasOrder) {
    return { ...state, step: 'done', label: 'Đã có đơn hàng', order: { id: quote.orderId, code: quote.orderCode } };
  }

  const versions = await listVersions(api, quote.id, oppId);
  const selected = versions.find((v) => v.isSelected);
  if (!selected) return { ...state, step: 'select', label: 'Chưa đánh dấu version' };
  const policy = selected.quotePolicy?.[0];
  state.version = {
    id: selected.id,
    name: selected.name,
    policyId: policy?.policyId,
    policyStatus: policy?.status,
    policyLabel: POLICY_STATUS[policy?.status] ?? (policy ? `Chính sách ${policy.status}` : 'Chưa có chính sách'),
    canCreateOrder: Boolean(selected.canCreateOrder),
    total: (selected.quoteItem || []).reduce((s, i) => s + (i.total ?? i.price * i.quantity ?? 0), 0),
  };
  if (selected.canCreateOrder) return { ...state, step: 'order', label: 'Sẵn sàng tạo đơn' };
  if ([2, 3].includes(policy?.status)) return { ...state, step: 'blocked', label: `Chính sách ${state.version.policyLabel.toLowerCase()}` };
  if (selected.isExpired) return { ...state, step: 'blocked', label: 'Version đã hết hạn' };
  return { ...state, step: 'issuing', label: state.version.policyLabel };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chờ tới khi version KH chọn tạo đơn được (chính sách "Đã ban hành"). onTick(state, waitedMs). */
export async function waitUntilOrderable(api, oppId, { timeoutMs, intervalMs = 15_000, onTick } = {}) {
  const start = Date.now();
  for (;;) {
    const st = await getFlowState(api, oppId);
    if (st.step !== 'issuing') return st;
    const waited = Date.now() - start;
    if (waited >= timeoutMs) return st;
    onTick?.(st, waited);
    await sleep(Math.min(intervalMs, timeoutMs - waited));
  }
}
