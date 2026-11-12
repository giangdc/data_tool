// Client Sale Platform (sapi.fpt.vn) – ký request giống app SOP (Flutter):
//   Digest   = base64(HMAC-SHA256(secret, JSON body))
//   CheckSum = keyId=..,created=..,signature=base64(HMAC-SHA256(secret, "keyId=..,digest=..,created=..,token=Bearer <tk>")))
import crypto from 'node:crypto';
import fs from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
export const SP = {
  login: 'https://sapi.fpt.vn/saleplatform-gateway-api-staging/',
  api: 'https://sapi.fpt.vn/saleplatform-api-staging/',
  sop: 'https://gateway-sop-stg.fpt.vn/',
};

export function loadEnv() {
  const t = fs.readFileSync(new URL('.env', ROOT), 'utf8');
  return Object.fromEntries(t.split('\n').map((l) => l.match(/^(\w+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
}
const keys = () => JSON.parse(fs.readFileSync(new URL('.cache/sp-keys.json', ROOT), 'utf8'));
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64');

export function signHeaders(body, token = '', useBasic = false) {
  const { keyId, basicPass, secret } = keys();
  const json = body != null ? JSON.stringify(body) : '';
  const digest = hmac(secret, json);
  const created = String(Math.floor(Date.now() / 1000));
  const basic = Buffer.from(`${keyId}:${basicPass}`).toString('base64');
  const tk = useBasic ? `Basic ${basic}` : token ? `Bearer ${token}` : '';
  const sig = hmac(secret, `keyId=${keyId},digest=${digest},created=${created},token=${tk}`);
  const h = {
    'content-type': 'application/json;charset=utf-8',
    CheckSum: `keyId=${keyId},created=${created},signature=${sig}`,
    Digest: digest,
    authorization: !useBasic && token ? `Bearer ${token}` : `Basic ${basic}`,
  };
  return { headers: h, json };
}

export async function spPost(base, path, body, token, useBasic = !token) {
  const { headers, json } = signHeaders(body, token, useBasic);
  const r = await fetch(base + path, { method: 'POST', headers, body: json });
  const t = await r.text();
  try { return { status: r.status, data: JSON.parse(t) }; } catch { return { status: r.status, data: t }; }
}

// Đăng nhập: SOP basic-auth -> sc_sdk_token -> token Sale Platform
export async function login() {
  for (let attempt = 1; ; attempt++) {
    try { return await loginOnce(); }
    catch (e) { if (attempt >= 3 || !/sc_sdk_token/.test(e.message)) throw e; await new Promise((r) => setTimeout(r, 1200)); }
  }
}
async function loginOnce() {
  const env = loadEnv();
  const r1 = await fetch(SP.sop + 'auth-service/api/auth-service/sign-in/basic-auth', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://portal-sop-stg.fpt.vn' },
    body: JSON.stringify({ username: env.APP_USERNAME, password: env.APP_PASSWORD, remember: true }) });
  const s1 = await r1.json();
  if (!s1?.data?.access_token) throw new Error('Đăng nhập SOP lỗi: ' + (s1?.message || r1.status));
  let sdk = null, lastStatus = 0;
  for (let i = 0; i < 4 && !sdk; i++) {
    if (i) await new Promise((r) => setTimeout(r, 800));
    const r2 = await fetch(SP.sop + 'auth-service/api/auth-service/sdk/refresh-access-key-desktop', {
      headers: { authorization: `Bearer ${s1.data.access_token}`, origin: 'https://portal-sop-stg.fpt.vn' } });
    lastStatus = r2.status;
    sdk = (await r2.json().catch(() => null))?.data?.sc_sdk_token;
  }
  if (!sdk) throw new Error(`Không lấy được sc_sdk_token (HTTP ${lastStatus})`);
  const app = JSON.parse(fs.readFileSync(new URL('config/sp-app.json', ROOT), 'utf8'));
  const r3 = await spPost(SP.login, 'gateway/auth/api/v3/authentication/token', {
    GrantType: 'one_time_password_2', Token: sdk, RedirectUrl: '', AccountName: '', Password: '',
    Platform: app.Platform, Device: app.Device, ClientApp: app.ClientApp,
    OldVersion: app.OldVersion, CurrentVersion: app.CurrentVersion, Bundle: app.Bundle,
    PsId: s1.data.user_info?.emp_id || '' });
  return { sop: s1.data, sp: r3 };
}
