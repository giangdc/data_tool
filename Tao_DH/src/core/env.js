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

const envName = process.env.FPTVN_ENV || 'stag';
const target = ENVIRONMENTS[envName];
if (!target) {
  throw new Error(`FPTVN_ENV="${envName}" không tồn tại. Có: ${Object.keys(ENVIRONMENTS).join(', ')}`);
}

/**
 * Proxy ra Internet cho API ECP. Máy công ty: DNS nội bộ không phân giải apis-stag.fpt.vn, Chrome đi qua proxy hệ thống
 * (proxy.fpt.vn:80) còn Node thì không -> "fetch failed". Thứ tự:
 *   1. ECP_PROXY trong .env (vd http://proxy.fpt.vn:80; "none" = gọi thẳng)
 *   2. Proxy hệ thống GNOME (Settings > Network > Proxy: Manual)
 *   3. Biến môi trường HTTPS_PROXY (+ NO_PROXY)
 * -> { url, source, bypass: [host pattern] } hoặc null
 */
function detectProxy() {
  const explicit = process.env.ECP_PROXY?.trim();
  if (explicit) return explicit.toLowerCase() === 'none' ? null : { url: explicit, source: 'ECP_PROXY (.env)', bypass: [] };
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

// Mặc định người dùng tự đặt trên UI (nút "Đặt mặc định") – ưu tiên hơn .env, dùng chung UI + CLI
const SETTINGS_FILE = path.join(OUTPUT_DIR, 'settings.json');
const SETTABLE = ['url', 'phone'];
function readSettings() {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Giá trị mặc định của form tạo đơn (người dùng sửa được trên UI / CLI)
export const config = {
  ...target,
  proxy: detectProxy(),
  defaults: {
    url: process.env.DEFAULT_URL || `${target.webUrl}/internet/goi-giga`,
    fullName: process.env.DEFAULT_NAME || 'AUTO-QC Test',
    phone: process.env.DEFAULT_PHONE || '0964633310',
    province: process.env.DEFAULT_PROVINCE || 'Hồ Chí Minh',
    ward: process.env.DEFAULT_WARD || 'Phường Bến Thành',
    street: process.env.DEFAULT_STREET || 'Trương Định',
    addressNo: process.env.DEFAULT_ADDRESS_NO || '123',
    // Chung cư mặc định (phường khác không có chung cư này -> "Nơi khác")
    building: process.env.DEFAULT_BUILDING || 'Tòa nhà VP 55 Nam Kỳ Khởi Nghĩa',
    note: process.env.DEFAULT_NOTE || 'AUTO-QC tạo đơn test',
  },
};

for (const [k, v] of Object.entries(readSettings())) if (SETTABLE.includes(k) && v) config.defaults[k] = v;

/** Lưu mặc định mới ({phone?, url?}) vào output/settings.json và áp dụng ngay -> defaults */
export function saveDefaults(patch) {
  const next = readSettings();
  for (const k of SETTABLE) if (patch[k]) next[k] = config.defaults[k] = String(patch[k]).trim();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return config.defaults;
}
