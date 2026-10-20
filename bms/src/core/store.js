// Lưu lại dữ liệu đã tạo: JSONL (đầy đủ payload) + CSV (mở bằng Excel để tra nhanh).
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR } from './env.js';

const CSV_COLUMNS = ['createdAt', 'env', 'createdBy', 'code', 'name', 'serviceGroup', 'serviceType', 'customerName', 'taxCode', 'am', 'tpp', 'bgd'];

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function saveRecord(kind, record, columns = CSV_COLUMNS) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  appendFileSync(path.join(OUTPUT_DIR, `${kind}.jsonl`), JSON.stringify(record) + '\n');

  const csvFile = path.join(OUTPUT_DIR, `${kind}.csv`);
  // BOM để Excel hiển thị đúng tiếng Việt
  if (!existsSync(csvFile)) appendFileSync(csvFile, '﻿' + columns.join(',') + '\n');
  appendFileSync(csvFile, columns.map((k) => csvCell(record.summary?.[k])).join(',') + '\n');
  return csvFile;
}
