import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ENVIRONMENTS } from '../../config/environments.js';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE_DIR = path.join(ROOT_DIR, '.cache');
export const OUTPUT_DIR = path.join(ROOT_DIR, 'output');

const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

/**
 * Thẻ test dùng chung với các tool trước (Tao_don_fptvn, FPL): .env của tool này chưa có CARD_* thì lấy từ .env tool bên cạnh.
 * Chỉ nạp biến CARD_* còn thiếu, không ghi đè, không in giá trị. -> tên file đã dùng | null
 */
function loadSharedCards() {
  const has = (k) => Boolean(process.env[k]?.trim());
  if (has('CARD_INTERNATIONAL_NUMBER') && has('CARD_DOMESTIC_NUMBER')) return null;
  for (const dir of ['Tao_don_fptvn', 'FPL']) {
    const file = path.join(ROOT_DIR, '..', dir, '.env');
    if (!existsSync(file)) continue;
    let used = false;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*(CARD_[A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m || has(m[1])) continue;
      process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      used = true;
    }
    if (used) return path.relative(ROOT_DIR, file);
  }
  return null;
}
export const sharedCardsFrom = loadSharedCards();

const envName = process.env.BILLPAY_ENV || 'stag';
const target = ENVIRONMENTS[envName];
if (!target) {
  throw new Error(`BILLPAY_ENV="${envName}" không tồn tại. Có: ${Object.keys(ENVIRONMENTS).join(', ')}`);
}

/**
 * Proxy ra Internet (giống Tao_don_fptvn): máy công ty DNS nội bộ không phân giải *.fpt.vn public, Chrome đi proxy hệ thống
 * còn Node thì không. Thứ tự: BILLPAY_PROXY (.env, "none" = gọi thẳng) -> proxy GNOME -> HTTPS_PROXY.
 * -> { url, source, bypass: [host pattern] } hoặc null
 */
function detectProxy() {
  const explicit = process.env.BILLPAY_PROXY?.trim();
  if (explicit) return explicit.toLowerCase() === 'none' ? null : { url: explicit, source: 'BILLPAY_PROXY (.env)', bypass: [] };
  if (process.platform === 'linux') {
    try {
      const g = (...k) => execFileSync('gsettings', ['get', ...k], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (g('org.gnome.system.proxy', 'mode') === "'manual'") {
        const host = g('org.gnome.system.proxy.https', 'host').replace(/^'|'$/g, '');
        const port = g('org.gnome.system.proxy.https', 'port') || '80';
        // ignore-hosts dạng ['localhost', 'a.fpt.net;b.fpt.vn;*.fpt.net'] – tách cả dấu ;
        const bypass = [...g('org.gnome.system.proxy', 'ignore-hosts').matchAll(/'([^']+)'/g)].flatMap((m) => m[1].split(';')).filter(Boolean);
        if (host) return { url: `http://${host}:${port}`, source: 'proxy hệ thống (GNOME)', bypass };
      }
    } catch {
      // không có gsettings / không phải GNOME
    }
  }
  const env = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (env) return { url: env, source: 'HTTPS_PROXY', bypass: (process.env.NO_PROXY || process.env.no_proxy || '').split(',').map((s) => s.trim()).filter(Boolean) };
  return null;
}

// Mặc định người dùng tự đặt trên UI (nút ☆) – ưu tiên hơn .env, dùng chung UI + CLI
const SETTINGS_FILE = path.join(OUTPUT_DIR, 'settings.json');
const SETTABLE = ['contractNo', 'paymentMethod'];
function readSettings() {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export const config = {
  ...target,
  proxy: detectProxy(),
  defaults: {
    contractNo: process.env.DEFAULT_CONTRACT || '',
    paymentMethod: process.env.DEFAULT_PAYMENT_METHOD || 'INTERNATIONAL',
  },
};

for (const [k, v] of Object.entries(readSettings())) if (SETTABLE.includes(k) && v) config.defaults[k] = v;

/** Lưu mặc định mới ({contractNo?, paymentMethod?}) vào output/settings.json và áp dụng ngay -> defaults */
export function saveDefaults(patch) {
  const next = readSettings();
  for (const k of SETTABLE) if (patch[k]) next[k] = config.defaults[k] = String(patch[k]).trim().toUpperCase();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return config.defaults;
}
