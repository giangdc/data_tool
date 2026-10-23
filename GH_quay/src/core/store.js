// Lưu lại các lần chạy: JSONL (đầy đủ) + CSV (mở bằng Excel để tra nhanh).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR } from './env.js';

export const RUN_CSV_COLUMNS = [
  'finishedAt', 'contract', 'orderCode', 'deliveryCode', 'advanceCode', 'importCode', 'macs', 'trackingCode',
  'ghtkStatus', 'ticketStatus', 'deliveryStatus', 'error',
];

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function saveRun(record, kind = 'runs') {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  appendFileSync(path.join(OUTPUT_DIR, `${kind}.jsonl`), JSON.stringify(record) + '\n');

  const csvFile = path.join(OUTPUT_DIR, `${kind}.csv`);
  // BOM để Excel hiển thị đúng tiếng Việt
  if (!existsSync(csvFile)) appendFileSync(csvFile, '﻿' + RUN_CSV_COLUMNS.join(',') + '\n');
  appendFileSync(csvFile, RUN_CSV_COLUMNS.map((k) => csvCell(record[k])).join(',') + '\n');
  return csvFile;
}

export function recentRuns(limit = 30, kind = 'runs') {
  const file = path.join(OUTPUT_DIR, `${kind}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).slice(-limit).reverse()
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}
