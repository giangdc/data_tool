// Nghiệp vụ màn "Liệt kê cước": tìm hợp đồng -> danh sách hóa đơn -> chi tiết hóa đơn.
// Tham số lấy từ JS của trang BillHistoryNew (khảo sát: khao-sat/KHAO_SAT.md).
import { config } from '../core/env.js';
import { request, requestJson, ApiError } from '../core/http.js';

// ddlField: 4 = Số hợp đồng; ddlSearch: 1 = Chính xác
const SEARCH_BY_CONTRACT = '4';
const MATCH_EXACT = '1';

/** "/Date(1718298000000)/" -> Date */
export function parseNetDate(v) {
  const ms = /\/Date\((-?\d+)/.exec(v ?? '')?.[1];
  return ms ? new Date(Number(ms)) : null;
}

const VN = { timeZone: 'Asia/Ho_Chi_Minh' };
export function formatDate(v, withTime = false) {
  const d = parseNetDate(v);
  if (!d) return '';
  const date = d.toLocaleDateString('en-GB', VN);
  return withTime ? `${date} ${d.toLocaleTimeString('en-GB', VN)}` : date;
}

const PAID_TYPES = { 1: 'TM', 2: 'CK', 3: 'UNT', 4: 'SEC', 5: 'TDC', 7: 'ATM', 8: 'Mobi', 9: 'Khác', 10: 'Auto', 11: 'Quầy', 12: 'Internet' };

/** Tìm hợp đồng theo số HĐ (chính xác). Trả [{objId, contract, name, address, status, location}] */
export async function findContracts(keyword) {
  const contract = String(keyword ?? '').trim();
  if (!contract) throw new ApiError('Chưa nhập số hợp đồng', { status: 400 });
  const data = await requestJson('POST', '/InternetSubs/Accounting/LayoutSearch20/onLS_ViewReport', {
    form: { LocationID: config.locationId, Search: SEARCH_BY_CONTRACT, KeywordSup: MATCH_EXACT, Keyword: contract },
  });
  return (Array.isArray(data) ? data : []).map((r) => ({
    objId: r.ID,
    contract: r.Contract,
    name: r.Name,
    address: r.PaymentAddress,
    status: r.StatusDesc,
    location: r.Location,
    locationId: r.LocationID,
  }));
}

/**
 * Danh sách hóa đơn của 1 hợp đồng (ObjID). month/year = 0 là toàn bộ.
 * Lưu ý: "toàn bộ" với HĐ nhiều hóa đơn mất ~15s (chỗ inside hay timeout), lọc theo năm chỉ ~0.5s.
 */
export async function listBills(objId, { month = 0, year = 0 } = {}) {
  if (!objId) throw new ApiError('Thiếu ObjID của hợp đồng', { status: 400 });
  const data = await requestJson('GET', '/InternetSubs/Accounting/BillHistoryNew/LoadReport', {
    query: { vID: objId, QMont: month || 0, QYear: year || 0, IsSSTCus: 0 },
  });
  return (Array.isArray(data) ? data : []).map(toBillRow);
}

function noteOf(b) {
  if (b.PaidAction > 0) return 'Đã hủy hóa đơn';
  const remain = (b.Amount ?? 0) - (b.PaidTotal ?? 0);
  if (remain !== 0) return `Còn nợ ${remain.toLocaleString('vi-VN')}`;
  const type = b.PaidTypeName || PAID_TYPES[b.PaidType] || '';
  return [type, formatDate(b.LastPaidDate, true)].filter(Boolean).join(' – ');
}

// Cột giống bảng "Báo cáo tổng hợp" trên inside + tham số để mở chi tiết
export function toBillRow(b) {
  return {
    stt: b.STT,
    content: b.Content,
    billNumber: b.BillNumber,
    billDate: formatDate(b.BillDate, true),
    branch: b.BranchCode,
    digital: b.Digital === 1 ? 'Điện tử' : b.Digital === 0 ? 'Giấy' : '',
    amount: b.Amount,
    paidTotal: b.PaidTotal,
    transaction: b.PaymentDetailReceipt,
    salesName: b.SalesName,
    note: noteOf(b),
    paymentInform: b.PaymentInform,
    cancelled: b.PaidAction > 0,
    contract: b.Contract,
    detail: { BillNumber: b.BillNumber, ObjID: b.ObjID, Month: b.Month, Year: b.Year },
  };
}

// Bỏ script / handler sự kiện (trang gốc chặn copy, gọi hàm của trang cha) – giữ nguyên bảng + style.
// Partial có `<div class="driver" />`: jQuery 1.9 của inside tự đổi thành `<div></div>`, trình duyệt thì coi là thẻ mở
// (phần sau bị lồng vào, mờ đi) -> mở rộng thẻ tự đóng giống jQuery.
function sanitize(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi, '<$1></$2>')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

/** HTML "Chi tiết của Hóa đơn" (header + bảng Chi tiết + Thông tin loại DV + Chi tiết DV Telecom). */
export async function billDetail({ BillNumber, ObjID, Month, Year }) {
  if (!BillNumber || !ObjID) throw new ApiError('Thiếu số hóa đơn / ObjID', { status: 400 });
  const html = await request('GET', '/InternetSubs/Accounting/LayoutSearch20/GetPartialPublicDetail', {
    query: { BillNumber, ObjID, Month, Year },
  });
  return { html: sanitize(html), found: /<table/i.test(html) };
}
