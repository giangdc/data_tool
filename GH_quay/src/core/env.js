import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ENVIRONMENTS } from '../../config/environments.js';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE_DIR = path.join(ROOT_DIR, '.cache');
export const OUTPUT_DIR = path.join(ROOT_DIR, 'output');

const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const envName = process.env.GHQ_ENV || 'stag';
const target = ENVIRONMENTS[envName];
if (!target) {
  throw new Error(`GHQ_ENV="${envName}" không tồn tại. Có: ${Object.keys(ENVIRONMENTS).join(', ')}`);
}

const env = (key, fallback = '') => (process.env[key] ?? '').trim() || fallback;

function parseItemCodes(raw) {
  // "FPT Camera Play 4=20058112; FPT Camera IQ 4S=20055098"
  return Object.fromEntries(
    raw.split(/[;\n]/).map((s) => s.split('=').map((x) => x.trim())).filter(([k, v]) => k && v),
  );
}

export const config = {
  ...target,
  // Tài khoản (không bắt buộc): để trống thì tool chờ bạn tự đăng nhập trong cửa sổ trình duyệt
  erpUser: env('ERP_USER'),
  erpPassword: env('ERP_PASSWORD'),
  scmUser: env('SCM_USER'),
  scmPassword: env('SCM_PASSWORD'),
  ghtkUser: env('GHTK_USER'),
  ghtkPassword: env('GHTK_PASSWORD'),

  // Dữ liệu mặc định của luồng
  erpStock: env('ERP_STOCK', 'KTNTESTMAC'), // Kho xuất bên Fox ERP = Mã kho Inside bên SCM
  scmStockName: env('SCM_STOCK_NAME', 'Kho KTN test MAC'), // Tên kho bên SCM (combo Kho chỉ tìm được theo tên)
  stockPhone: env('STOCK_PHONE', '0775335608'),
  scmImportType: env('SCM_IMPORT_TYPE', 'Nhập khác'),
  scmGoodsState: env('SCM_GOODS_STATE', 'Hàng mới'),
  scmWarrantyV2: env('SCM_WARRANTY_V2', 'true').toLowerCase() !== 'false',
  carrier: env('CARRIER', 'Giao hàng tiết kiệm'),
  ghtkStatus: env('GHTK_STATUS', '5'),
  ghtkWebhookMatch: env('GHTK_WEBHOOK_MATCH', 'apis-stag.fpt.vn'),
  macPrefix: env('MAC_PREFIX').toUpperCase(),
  itemCodes: parseItemCodes(env('ITEM_CODES', 'FPT Camera Play 4=20058112; FPT Camera IQ 4S=20055098')),

  // Trình duyệt
  browser: env('BROWSER', 'auto').toLowerCase(),
  cdpUrl: env('CDP_URL'),
  loginWaitMs: (Number(env('LOGIN_WAIT_MIN')) || 5) * 60 * 1000,
  syncWaitMs: (Number(env('SYNC_WAIT_SEC')) || 120) * 1000,
};
