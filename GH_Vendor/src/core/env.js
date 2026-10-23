import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ENVIRONMENTS } from '../../config/environments.js';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE_DIR = path.join(ROOT_DIR, '.cache');
export const OUTPUT_DIR = path.join(ROOT_DIR, 'output');

const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const envName = process.env.GHV_ENV || 'stag';
const target = ENVIRONMENTS[envName];
if (!target) {
  throw new Error(`GHV_ENV="${envName}" không tồn tại. Có: ${Object.keys(ENVIRONMENTS).join(', ')}`);
}

const env = (key, fallback = '') => (process.env[key] ?? '').trim() || fallback;

export const config = {
  ...target,
  // Tài khoản Fox ERP (không bắt buộc): để trống thì tool chờ bạn tự đăng nhập trong cửa sổ trình duyệt
  erpUser: env('ERP_USER'),
  erpPassword: env('ERP_PASSWORD'),

  // Dữ liệu mặc định cho popup "Xác nhận giao hàng" ({code} = mã đơn hàng FTEL)
  invoiceNcu: env('INVOICE_NCU', 'HDNCU-{code}'),
  invoiceFtel: env('INVOICE_FTEL', 'HDFTEL-{code}'),
  // Tệp hoá đơn điện tử: để trống thì tool tự tạo 1 file PDF test
  invoiceFile: env('INVOICE_FILE'),

  // Trình duyệt
  browser: env('BROWSER', 'auto').toLowerCase(),
  cdpUrl: env('CDP_URL'),
  loginWaitMs: (Number(env('LOGIN_WAIT_MIN')) || 5) * 60 * 1000,
  // Fox ERP Vendor tải danh sách rất chậm (1-2 phút)
  listWaitMs: (Number(env('LIST_WAIT_SEC')) || 240) * 1000,
  // Chờ sau khi chọn tình trạng rồi mới bấm Xác nhận (bấm sớm thì hệ thống bỏ qua, không báo gì)
  confirmDelayMs: (Number(env('CONFIRM_DELAY_SEC')) || 5) * 1000,
  maxPages: Number(env('MAX_PAGES')) || 5,
};
