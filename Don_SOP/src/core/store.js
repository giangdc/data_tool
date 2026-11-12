// Lưu kết quả đơn ra output/orders.jsonl + orders.csv
import fs from 'node:fs';
const DIR = new URL('../../output/', import.meta.url);
const JSONL = new URL('orders.jsonl', DIR);
const CSV = new URL('orders.csv', DIR);
const COLS = ['createdAt', 'orderCode', 'orderId', 'name', 'phone', 'totalVAT', 'status', 'contractCode', 'quotationUrl'];
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function save(rec) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(JSONL, JSON.stringify(rec) + '\n');
  if (!fs.existsSync(CSV)) fs.writeFileSync(CSV, COLS.join(',') + '\n');
  fs.appendFileSync(CSV, COLS.map((c) => esc(rec[c])).join(',') + '\n');
  return rec;
}
// Ghi mã hợp đồng vào đơn đã lưu (viết lại cả 2 file)
export function updateContract(orderId, contractCode) {
  const all = history(1e9).reverse();
  const row = all.find((r) => r.orderId === orderId);
  if (row) row.contractCode = contractCode;
  fs.writeFileSync(JSONL, all.map((r) => JSON.stringify(r)).join('\n') + (all.length ? '\n' : ''));
  fs.writeFileSync(CSV, COLS.join(',') + '\n' + all.map((r) => COLS.map((c) => esc(r[c])).join(',')).join('\n') + (all.length ? '\n' : ''));
  return row;
}
// Ghi mã HĐ theo MÃ ĐƠN (đơn tạo từ app Mobile không có orderId)
export function updateContractByCode(orderCode, contractCode) {
  const all = history(1e9).reverse();
  const row = all.find((r) => r.orderCode === orderCode);
  if (row) { row.contractCode = contractCode; delete row.contractError; }
  fs.writeFileSync(JSONL, all.map((r) => JSON.stringify(r)).join('\n') + (all.length ? '\n' : ''));
  fs.writeFileSync(CSV, COLS.join(',') + '\n' + all.map((r) => COLS.map((c) => esc(r[c])).join(',')).join('\n') + (all.length ? '\n' : ''));
  return row;
}
export function history(limit = 100) {
  try {
    return fs.readFileSync(JSONL, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).reverse().slice(0, limit);
  } catch { return []; }
}
