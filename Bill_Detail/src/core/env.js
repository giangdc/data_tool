import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ENVIRONMENTS } from '../../config/environments.js';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE_DIR = path.join(ROOT_DIR, '.cache');
export const OUTPUT_DIR = path.join(ROOT_DIR, 'output');

const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const envName = process.env.INSIDE_ENV || 'stag';
const target = ENVIRONMENTS[envName];
if (!target) {
  throw new Error(`INSIDE_ENV="${envName}" không tồn tại. Có: ${Object.keys(ENVIRONMENTS).join(', ')}`);
}

export const config = {
  ...target,
  locationId: process.env.LOCATION_ID || '8',
  timeoutMs: (Number(process.env.REQUEST_TIMEOUT_SEC) || 120) * 1000,
};

/** Ghi/cập nhật 1 biến trong .env (giữ nguyên các dòng khác) và áp dụng ngay. */
export function saveEnvValue(key, value) {
  // Máy mới chưa có .env -> lấy .env.example làm khung để người dùng thấy đủ tùy chọn
  const base = existsSync(envFile) ? envFile : path.join(ROOT_DIR, '.env.example');
  const lines = existsSync(base) ? readFileSync(base, 'utf8').split('\n') : [];
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(envFile, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
  process.env[key] = value;
}
