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

const envName = process.env.FPL_ENV || 'dev';
const target = ENVIRONMENTS[envName];
if (!target) {
  throw new Error(`FPL_ENV="${envName}" không tồn tại. Có: ${Object.keys(ENVIRONMENTS).join(', ')}`);
}

/**
 * Proxy ra Internet (máy công ty: DNS nội bộ không phân giải api-staging.fptplay.net). Thứ tự:
 *   1. FPL_PROXY trong .env (vd http://proxy.fpt.vn:80; "none" = gọi thẳng)
 *   2. Proxy hệ thống GNOME (Settings > Network > Proxy: Manual)
 *   3. Biến môi trường HTTPS_PROXY (+ NO_PROXY)
 * -> { url, source, bypass: [host pattern] } hoặc null
 */
function detectProxy() {
  const explicit = process.env.FPL_PROXY?.trim();
  if (explicit) return explicit.toLowerCase() === 'none' ? null : { url: explicit, source: 'FPL_PROXY (.env)', bypass: [] };
  if (process.platform === 'linux') {
    try {
      const g = (...k) => execFileSync('gsettings', ['get', ...k], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (g('org.gnome.system.proxy', 'mode') === "'manual'") {
        const host = g('org.gnome.system.proxy.https', 'host').replace(/^'|'$/g, '');
        const port = g('org.gnome.system.proxy.https', 'port') || '80';
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

export const config = {
  ...target,
  proxy: detectProxy(),
  defaults: {
    url: process.env.DEFAULT_URL || `${target.webUrl}/dich-vu/v-vip2?from_source=main`,
    phone: process.env.FPL_PHONE || '0964633310',
  },
};

for (const [k, v] of Object.entries(readSettings())) if (SETTABLE.includes(k) && v) config.defaults[k] = v;

/** OTP mặc định của môi trường dev (FPL_OTP trong .env) – không trả ra trình duyệt / không log */
export const defaultOtp = () => process.env.FPL_OTP?.trim() || '';

/** Lưu mặc định mới ({phone?, url?}) vào output/settings.json và áp dụng ngay -> defaults */
export function saveDefaults(patch) {
  const next = readSettings();
  for (const k of SETTABLE) if (patch[k]) next[k] = config.defaults[k] = String(patch[k]).trim();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return config.defaults;
}
