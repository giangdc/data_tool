// Danh sách link gói (data/*.csv, cột: Tên nhóm, Loại, Tên trang, Link staging) – dùng cho ô "Chọn gói" và chế độ tạo đơn hàng loạt.
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../core/env.js';

export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const DEFAULT_LIST = 'listgoi.csv';

/** Tách 1 dòng CSV (hỗ trợ ô có dấu phẩy trong "...") */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Các file danh sách trong data/ */
export function listFiles() {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR).filter((f) => f.toLowerCase().endsWith('.csv')).sort((a, b) => (a === DEFAULT_LIST ? -1 : b === DEFAULT_LIST ? 1 : a.localeCompare(b)));
}

/** Tên file hợp lệ trong data/ (chặn ../) */
export function resolveFile(file = DEFAULT_LIST) {
  const name = path.basename(String(file || DEFAULT_LIST));
  if (!listFiles().includes(name)) throw Object.assign(new Error(`Không có file danh sách data/${name}`), { status: 404 });
  return { name, full: path.join(DATA_DIR, name) };
}

/** So sánh link bỏ qua hoa/thường, dấu / cuối, query */
export const sameUrl = (a, b) => {
  const n = (u) => String(u || '').trim().split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
  return n(a) === n(b);
};

const csvCell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

/**
 * Thêm 1 gói vào cuối file danh sách (giữ BOM + cột gốc). Trùng link -> lỗi 409.
 * row: { group, type?, name, url } -> dòng vừa thêm { no, group, type, name, url }
 */
export function addRow(file, row) {
  const { name: fileName, full } = resolveFile(file);
  const cat = readCatalog(fileName);
  const dup = cat.rows.find((r) => sameUrl(r.url, row.url));
  if (dup) throw Object.assign(new Error(`Link đã có trong danh sách (dòng #${dup.no} – ${dup.name})`), { status: 409, row: dup });
  const cells = [row.group, row.type || 'Chi tiết', row.name, row.url].map((v) => String(v ?? '').trim());
  const raw = readFileSync(full, 'utf8');
  appendFileSync(full, (raw.endsWith('\n') || !raw ? '' : '\n') + cells.map(csvCell).join(',') + '\n');
  return readCatalog(fileName).rows.find((r) => sameUrl(r.url, row.url));
}

/**
 * Đọc danh sách -> { file, header[], rows: [{ no, group, type, name, url, cells[] }] }
 * no = số thứ tự dòng dữ liệu (1..n), bỏ dòng trống / không có link.
 */
export function readCatalog(file) {
  const { name, full } = resolveFile(file);
  const lines = readFileSync(full, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const header = splitCsvLine(lines.shift() || '');
  const rows = lines
    .map(splitCsvLine)
    .filter((c) => /^https?:\/\//i.test(c[3] || ''))
    .map((c, i) => ({ no: i + 1, group: c[0] || '', type: c[1] || '', name: c[2] || '', url: c[3], cells: c }));
  return { file: name, header, rows };
}
