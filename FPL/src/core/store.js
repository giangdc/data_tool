// Lưu đơn đã tạo: JSONL (đầy đủ, kèm token checkout để xem lại chi tiết) + CSV (mở bằng Excel).
// output/ không đóng gói / không commit vì chứa token checkout.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR } from './env.js';

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function saveRecord(kind, record, columns) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  appendFileSync(path.join(OUTPUT_DIR, `${kind}.jsonl`), JSON.stringify(record) + '\n');

  const csvFile = path.join(OUTPUT_DIR, `${kind}.csv`);
  // BOM để Excel hiển thị đúng tiếng Việt
  if (!existsSync(csvFile)) appendFileSync(csvFile, '﻿' + columns.join(',') + '\n');
  appendFileSync(csvFile, columns.map((k) => csvCell(record.summary?.[k])).join(',') + '\n');
  return csvFile;
}

/** Đọc toàn bộ bản ghi của 1 loại (cũ -> mới) */
export function readRecords(kind) {
  const file = path.join(OUTPUT_DIR, `${kind}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
