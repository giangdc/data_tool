import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ENVIRONMENTS } from '../../config/environments.js';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE_DIR = path.join(ROOT_DIR, '.cache');
export const OUTPUT_DIR = path.join(ROOT_DIR, 'output');

const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const envName = process.env.CRM_ENV || 'stag';
const target = ENVIRONMENTS[envName];
if (!target) {
  throw new Error(`CRM_ENV="${envName}" không tồn tại. Có: ${Object.keys(ENVIRONMENTS).join(', ')}`);
}

export const config = {
  ...target,
  password: process.env.CRM_PASSWORD || '',
  emailDomain: process.env.CRM_EMAIL_DOMAIN || 'fpt.com',
  defaultUser: process.env.CRM_USER || '',
  sampleOpportunity: process.env.CRM_SAMPLE_OPP || target.sampleOpportunityId,
  dataPrefix: process.env.DATA_PREFIX || 'AUTO-QC',
  // Chờ chính sách báo giá "Đã ban hành" trước khi tạo đơn (thực tế ~2–3 phút)
  orderWaitMinutes: Number(process.env.ORDER_WAIT_MINUTES) || 10,
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

// "stag_hoangnv75" -> "stag_hoangnv75@fpt.com"; giữ nguyên nếu đã là email
export function toEmail(username) {
  const u = username.trim();
  return u.includes('@') ? u : `${u}@${config.emailDomain}`;
}
