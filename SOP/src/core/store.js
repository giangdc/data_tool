// Lưu lại các lần chạy: JSONL (đầy đủ) + CSV (mở bằng Excel để tra nhanh).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR, ROOT_DIR } from './env.js';

export const RUN_CSV_COLUMNS = [
  'finishedAt', 'phone', 'customer', 'address', 'combo', 'comboIndex', 'packageName', 'payment', 'orderCode', 'contractCode', 'bookport', 'quoteLink', 'error',
];

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function saveRun(record, kind = 'orders') {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  appendFileSync(path.join(OUTPUT_DIR, `${kind}.jsonl`), JSON.stringify(record) + '\n');

  const csvFile = path.join(OUTPUT_DIR, `${kind}.csv`);
  // BOM để Excel hiển thị đúng tiếng Việt
  if (!existsSync(csvFile)) appendFileSync(csvFile, '﻿' + RUN_CSV_COLUMNS.join(',') + '\n');
  appendFileSync(csvFile, RUN_CSV_COLUMNS.map((k) => csvCell(record[k])).join(',') + '\n');
  return csvFile;
}

export function recentRuns(limit = 30, kind = 'orders') {
  const file = path.join(OUTPUT_DIR, `${kind}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).slice(-limit).reverse()
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (file, data) => {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
};

// ---- Danh sách gói theo địa chỉ (gói phụ thuộc khu vực lắp đặt): output/packages.json ----
const PACKAGES_FILE = path.join(OUTPUT_DIR, 'packages.json');
const PACKAGES_SAMPLE = path.join(ROOT_DIR, 'config', 'packages-default.json');
const addrKey = (a) => String(a).trim().toLowerCase().replace(/\s+/g, ' ');

export function savePackages(address, packages) {
  const all = readJson(PACKAGES_FILE, {});
  all[addrKey(address)] = { address, updatedAt: new Date().toISOString(), packages };
  writeJson(PACKAGES_FILE, all);
}

/** Gói đã tải cho địa chỉ; chưa tải thì dùng danh sách khảo sát sẵn (sample: true). */
export function loadPackages(address) {
  const hit = readJson(PACKAGES_FILE, {})[addrKey(address)];
  if (hit) return hit;
  const sample = readJson(PACKAGES_SAMPLE, { packages: [] });
  return { address: sample.address, updatedAt: null, sample: true, packages: sample.packages };
}

// ---- Danh sách KH "Khách hàng của tôi" theo tài khoản: output/customers.json ----
const CUSTOMERS_FILE = path.join(OUTPUT_DIR, 'customers.json');

export function saveCustomers(account, customers) {
  const all = readJson(CUSTOMERS_FILE, {});
  all[account] = { updatedAt: new Date().toISOString(), customers };
  writeJson(CUSTOMERS_FILE, all);
}

export const loadCustomers = (account) => readJson(CUSTOMERS_FILE, {})[account] || null;

/** KH đã biết (có id) theo SĐT – dùng để mở thẳng màn Tạo báo giá, không qua danh sách / chi tiết KH. */
export const findCustomer = (account, phone) => loadCustomers(account)?.customers?.find((c) => c.phone === phone && c.id) || null;

/** Ghi nhớ id KH (vd SĐT nhập tay, tìm thấy qua ô tìm kiếm) để lượt sau mở thẳng. */
export function rememberCustomer(account, customer) {
  const all = readJson(CUSTOMERS_FILE, {});
  const entry = all[account] || { updatedAt: new Date().toISOString(), customers: [] };
  const old = entry.customers.find((c) => c.phone === customer.phone);
  entry.customers = old ? entry.customers.map((c) => (c === old ? { ...c, ...customer } : c)) : [...entry.customers, customer];
  all[account] = entry;
  writeJson(CUSTOMERS_FILE, all);
}

// ---- Gói của dịch vụ khác theo id dịch vụ: output/service-options.json (chưa tải thì dùng danh sách khảo sát sẵn) ----
const SERVICE_OPTIONS_FILE = path.join(OUTPUT_DIR, 'service-options.json');
const SERVICE_OPTIONS_SAMPLE = path.join(ROOT_DIR, 'config', 'service-options-default.json');

export function saveServiceOptions(id, options, form) {
  const all = readJson(SERVICE_OPTIONS_FILE, {});
  all[id] = { updatedAt: new Date().toISOString(), options, ...(form ? { form } : {}) };
  writeJson(SERVICE_OPTIONS_FILE, all);
}

export const loadServiceOptions = () => ({ ...readJson(SERVICE_OPTIONS_SAMPLE, {}), ...readJson(SERVICE_OPTIONS_FILE, {}) });
