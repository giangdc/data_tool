// Báo giá: tạo báo giá theo template, đánh dấu version KH chọn, chờ chính sách ban hành.
import { addDays, endOfDayIso, formatDate } from '../data/random.js';

const QUOTES = '/product-catalog-management/api/quotes';
const PAGE = { page: 1, fetch: 20, keyword: '' };

// quotePolicy[].status
export const POLICY_STATUS = { 1: 'Đã ban hành', 2: 'Bị từ chối', 3: 'Đã hủy', 4: 'Đang được ban hành' };

const itemsOf = (res) => res?.items ?? (Array.isArray(res) ? res : []);

/** Báo giá của 1 cơ hội (mới nhất trước) – có hasOrder / orderId / orderCode. */
export async function listQuotes(api, oppId) {
  return itemsOf(await api.get(QUOTES, { refId: oppId, quoteTargetType: 1, ...PAGE }));
}

/** Các version của 1 báo giá (mới nhất trước) – có isSelected, canCreateOrder, quotePolicy, quoteItem. */
export async function listVersions(api, quoteId, oppId) {
  return itemsOf(await api.get(`${QUOTES}/quote-version`, { quoteId, refId: oppId, ...PAGE }));
}

// Rule CRM: tổng SL phí khởi tạo = tổng SL thuê bao (sai -> "Số lượng gói dịch vụ thuê bao phải bằng số lượng phí khởi tạo…")
export function checkQuoteItems(items) {
  const sum = (type) => items.filter((i) => i.productType === type).reduce((s, i) => s + Number(i.quantity), 0);
  const sub = sum(1), setup = sum(2);
  return sub === setup ? null : `Tổng số lượng thuê bao (${sub}) khác tổng số lượng phí khởi tạo (${setup}) – CRM sẽ từ chối`;
}

/** Tạo báo giá cho cơ hội từ dòng báo giá mẫu -> { id, code, payload }. */
export async function createQuote(api, oppId, tpl, { prefix }) {
  const existing = (await listQuotes(api, oppId))[0];
  if (existing) return { id: existing.id, code: existing.code, existed: true };
  const q = tpl.quote;
  const today = new Date();
  const payload = {
    name: `[${prefix}] ${formatDate(today).split('-').reverse().join('/')} ${tpl.opportunity.specs[0].charName || 'Báo giá'}`,
    refId: oppId,
    targetType: 1,
    memberId: tpl.opportunity.saleId,
    surveyCode: null,
    organizationCode: 1,
    quoteVersion: {
      description: null,
      effective: endOfDayIso(today),
      expiration: endOfDayIso(addDays(29, today)),
      monthValue: null,
      extraClause: q.extraClause,
      quoteActionType: 1,
      legalEntityInformation: q.legalEntityInformation,
      quoteItems: q.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        name: i.name,
        unitOfMeasure: i.unitOfMeasure,
        unitOfMeasureText: null,
        productPrice: i.productPrice,
        vatRate: i.vatRate,
        discountValue: null,
        quoteDiscountType: 1,
        productType: i.productType,
      })),
      quotePaymentTerm: q.paymentTerm,
      customerType: q.customerType,
    },
    isCreateNew: true,
  };
  const id = await api.post(QUOTES, payload);
  const code = (await listQuotes(api, oppId)).find((x) => x.id === id)?.code;
  return { id, code, payload };
}

/** Đánh dấu version KH chọn (mặc định version mới nhất) -> { quote, version, already }. */
export async function selectVersion(api, oppId) {
  const quote = (await listQuotes(api, oppId))[0];
  if (!quote) throw Object.assign(new Error('Cơ hội chưa có báo giá – tạo báo giá trước'), { status: 400 });
  const versions = await listVersions(api, quote.id, oppId);
  const selected = versions.find((v) => v.isSelected);
  if (selected) return { quote, version: selected, already: true };
  const version = versions[0];
  await api.put(`${QUOTES}/version-selection`, { quoteId: quote.id, quoteVersionId: version.id });
  return { quote, version, already: false };
}

export const QUOTE_CSV_COLUMNS = ['createdAt', 'env', 'createdBy', 'oppCode', 'quoteCode', 'total', 'quoteId'];

export function toQuoteRecord({ env, user, oppCode, result }) {
  const items = result.payload?.quoteVersion?.quoteItems || [];
  return {
    summary: {
      createdAt: new Date().toLocaleString('vi-VN'),
      env,
      createdBy: user,
      oppCode,
      quoteCode: result.code,
      quoteId: result.id,
      total: items.reduce((s, i) => s + i.productPrice * i.quantity, 0),
    },
    payload: result.payload,
  };
}
