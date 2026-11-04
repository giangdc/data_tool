import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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

// Tài khoản từng hệ thống: key trên giao diện -> tên biến trong .env / thuộc tính trong config
export const ACCOUNT_KEYS = {
  erp: { name: 'Fox ERP', userEnv: 'ERP_USER', passEnv: 'ERP_PASSWORD', user: 'erpUser', pass: 'erpPassword' },
  scm: { name: 'SCM', userEnv: 'SCM_USER', passEnv: 'SCM_PASSWORD', user: 'scmUser', pass: 'scmPassword' },
  ghtk: { name: 'GHTK lab', userEnv: 'GHTK_USER', passEnv: 'GHTK_PASSWORD', user: 'ghtkUser', pass: 'ghtkPassword' },
};

// Giá trị có # / dấu cách / dấu nháy phải bọc nháy, không thì loadEnvFile cắt mất phần sau #
function quoteEnv(value) {
  if (!/[\s#'"`\\]/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('`')) return `\`${value}\``;
  if (!value.includes('"')) return `"${value}"`;
  throw Object.assign(new Error('Giá trị chứa đủ cả 3 loại dấu nháy \' " ` – .env không lưu được'), { status: 400 });
}

/** Ghi KEY=value vào .env của máy (tạo từ .env.example nếu chưa có) và áp dụng ngay. */
export function saveEnvValue(key, value) {
  value = String(value ?? '').replace(/[\r\n]/g, '').trim();
  const base = existsSync(envFile) ? envFile : path.join(ROOT_DIR, '.env.example');
  const lines = existsSync(base) ? readFileSync(base, 'utf8').split('\n') : [];
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  const line = `${key}=${quoteEnv(value)}`;
  if (idx >= 0) lines[idx] = line;
  else lines.push(line);
  writeFileSync(envFile, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
  chmodSync(envFile, 0o600); // .env có mật khẩu: chỉ chủ máy đọc được
  process.env[key] = value;
}

/**
 * Lưu tài khoản nhập trên giao diện: { erp: { user, password }, ... }.
 * Mật khẩu để trống = giữ mật khẩu đã lưu (giao diện không bao giờ nhận lại mật khẩu).
 */
export function saveAccounts(accounts = {}) {
  for (const [key, k] of Object.entries(ACCOUNT_KEYS)) {
    const a = accounts[key];
    if (!a) continue;
    const user = String(a.user ?? '').trim();
    if (user !== config[k.user]) {
      saveEnvValue(k.userEnv, user);
      config[k.user] = user;
      // Đổi/xoá tài khoản mà không nhập mật khẩu mới -> bỏ mật khẩu cũ (của tài khoản khác)
      if (!a.password) { saveEnvValue(k.passEnv, ''); config[k.pass] = ''; }
    }
    if (a.password) { saveEnvValue(k.passEnv, a.password); config[k.pass] = String(a.password).replace(/[\r\n]/g, '').trim(); }
  }
  return accountSummary();
}

/** Tài khoản đã lưu để hiện trên giao diện (chỉ tên đăng nhập + có mật khẩu hay chưa). */
export const accountSummary = () => Object.fromEntries(Object.entries(ACCOUNT_KEYS).map(([key, k]) => [
  key, { name: k.name, user: config[k.user], hasPassword: Boolean(config[k.pass]) },
]));
