import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ENVIRONMENTS } from '../../config/environments.js';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE_DIR = path.join(ROOT_DIR, '.cache');
export const OUTPUT_DIR = path.join(ROOT_DIR, 'output');

const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const envName = process.env.TMDT_ENV || 'stag';
const target = ENVIRONMENTS[envName];
if (!target) throw new Error(`TMDT_ENV="${envName}" không tồn tại. Có: ${Object.keys(ENVIRONMENTS).join(', ')}`);

// Mặc định form – đặt lại được bằng nút ☆ trên UI (lưu output/settings.json, ưu tiên hơn .env)
const SETTINGS_FILE = path.join(OUTPUT_DIR, 'settings.json');
const SETTABLE = ['source', 'phone', 'locationId', 'districtId', 'wardId', 'streetId', 'addressNo'];
function readSettings() {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export const config = {
  ...target,
  defaults: {
    source: process.env.DEFAULT_SOURCE || 'Tiktok',
    phone: process.env.DEFAULT_PHONE || '0868650892',
    // Hồ Chí Minh · Phường Phú Thuận · Huỳnh Tấn Phát (đơn TikTok tạo thành công 12/11/2026)
    locationId: process.env.DEFAULT_LOCATION_ID || '8',
    districtId: process.env.DEFAULT_DISTRICT_ID || '1000009764',
    wardId: process.env.DEFAULT_WARD_ID || '1000107464',
    streetId: process.env.DEFAULT_STREET_ID || '1001003171',
    addressNo: process.env.DEFAULT_ADDRESS_NO || 'qc test',
  },
};
for (const [k, v] of Object.entries(readSettings())) if (SETTABLE.includes(k) && v) config.defaults[k] = String(v);

/** Lưu mặc định mới vào output/settings.json và áp dụng ngay -> defaults */
export function saveDefaults(patch) {
  const next = readSettings();
  for (const k of SETTABLE) if (patch[k] != null && patch[k] !== '') next[k] = config.defaults[k] = String(patch[k]).trim();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return config.defaults;
}
