import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ENVIRONMENTS } from '../../config/environments.js';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE_DIR = path.join(ROOT_DIR, '.cache');
export const OUTPUT_DIR = path.join(ROOT_DIR, 'output');

const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const envName = process.env.SOP_ENV || 'stag';
const target = ENVIRONMENTS[envName];
if (!target) {
  throw new Error(`SOP_ENV="${envName}" không tồn tại. Có: ${Object.keys(ENVIRONMENTS).join(', ')}`);
}

const env = (key, fallback = '') => (process.env[key] ?? '').trim() || fallback;

export const config = {
  ...target,
  // Dữ liệu mặc định của đơn (sửa được trên giao diện)
  defaults: {
    phone: env('DEFAULT_PHONE'),
    address: env('DEFAULT_ADDRESS', '123, Trương Định, Phường Bến Thành, Hồ Chí Minh'),
    combo: env('DEFAULT_COMBO', 'GigaF1'),
    comboIndex: Number(env('DEFAULT_COMBO_INDEX', '1')) || 1,
    payment: env('DEFAULT_PAYMENT', 'Napas'),
  },
  headless: env('HEADLESS', 'false').toLowerCase() === 'true',
  browser: env('BROWSER', 'auto').toLowerCase(),
  uiPort: Number(env('UI_PORT')) || 3005,
};

/** Tài khoản Portal SOP: đọc lại .env mỗi lần (sửa trên giao diện / tay đều có hiệu lực ngay). Không log. */
export function credentials() {
  const parsed = existsSync(envFile) ? Object.fromEntries(
    readFileSync(envFile, 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]),
  ) : {};
  return { user: (parsed.SOP_USER ?? process.env.SOP_USER ?? '').trim(), password: parsed.SOP_PASSWORD ?? process.env.SOP_PASSWORD ?? '' };
}

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
