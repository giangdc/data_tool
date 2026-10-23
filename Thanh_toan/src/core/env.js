import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ENVIRONMENTS } from '../../config/environments.js';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE_DIR = path.join(ROOT_DIR, '.cache');
export const OUTPUT_DIR = path.join(ROOT_DIR, 'output');

const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const envName = process.env.TT_ENV || 'stag';
const target = ENVIRONMENTS[envName];
if (!target) {
  throw new Error(`TT_ENV="${envName}" không tồn tại. Có: ${Object.keys(ENVIRONMENTS).join(', ')}`);
}

const env = (key, fallback = '') => (process.env[key] ?? '').trim() || fallback;

export const config = {
  ...target,
  // Thẻ test theo phương thức – sửa được trên giao diện
  cards: {
    // Thẻ quốc tế (xác thực 3DS Cardinal): date = hiệu lực MM/YY
    intl: {
      number: env('CARD_NUMBER', '4000000000001091'),
      name: env('CARD_NAME', 'NGUYEN VAN A'),
      date: env('CARD_EXPIRY', '12/26'),
      cvv: env('CARD_CVV', '111'),
      otp: env('CARD_OTP', '1234'),
    },
    // Thẻ nội địa (Napas): date = ngày phát hành MM/YY, không có CVV
    domestic: {
      number: env('DOMESTIC_CARD_NUMBER', '9704000000000018'),
      name: env('DOMESTIC_CARD_NAME', 'NGUYEN VAN A'),
      date: env('DOMESTIC_CARD_ISSUE', '03/07'),
      cvv: '',
      otp: env('DOMESTIC_CARD_OTP', 'otp'),
    },
  },
  // SĐT chủ thẻ (popup "Xác nhận số điện thoại")
  phone: env('PHONE', '0868650892'),

  // Trình duyệt
  browser: env('BROWSER', 'auto').toLowerCase(),
  cdpUrl: env('CDP_URL'),
  loginWaitMs: (Number(env('LOGIN_WAIT_MIN')) || 5) * 60 * 1000,
  stepWaitMs: (Number(env('STEP_WAIT_SEC')) || 60) * 1000,
};
