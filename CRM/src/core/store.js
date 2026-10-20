// Lưu lại dữ liệu đã tạo: JSONL (đầy đủ) + CSV (mở bằng Excel để tra nhanh).
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

/** Đọc các bản ghi gần nhất (mới nhất trước). */
export function readRecords(kind, limit = 200) {
  const file = path.join(OUTPUT_DIR, `${kind}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(-limit)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
