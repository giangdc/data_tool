#!/usr/bin/env node
// Khảo sát cổng thanh toán Thẻ tín dụng (INTERNATIONAL) + Thẻ ATM (DOMESTIC), không cần thư viện:
// tạo đơn test (hoặc dùng mã đơn có sẵn) -> mở Chrome THẬT (tránh WAF chặn headless; đi proxy như config.proxy)
// vào trang thanh toán -> BÁO người dùng nhập thẻ (console + thông báo desktop) -> theo dõi khi người dùng nhập:
//   - log (khao-sat/pay-log/<mã>-<time>.jsonl): URL (che query), redirect, status request document/xhr/fetch,
//     cấu trúc form (type/name/id/placeholder/label), các nút/mục đã bấm, checkout/get trước/sau – KHÔNG có giá trị ô nhập
//   - luồng (khao-sat/pay-log/<PTTT>-flow.json): thứ tự trang -> ô nhập (selector + biến .env) -> nút bấm, cho bản tự thanh toán 1.4
//   - GIÁ TRỊ người dùng nhập -> ghi thẳng vào .env (CARD_<PTTT>_NUMBER/NAME/EXPIRY/ISSUE_DATE/CVV/OTP/...), không in ra màn hình
//
//   node khao-sat/pay-recorder.js [--pm INTERNATIONAL,DOMESTIC] [--code <mã đơn>] [--no-save] [--port 9333]
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, appendFileSync, mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { config, ROOT_DIR } from '../src/core/env.js';
import { readRecords } from '../src/core/store.js';
import { getCheckout, orderStatus } from '../src/ecp/checkout.js';
import { OrderService } from '../src/ecp/orders.js';

const { values: args } = parseArgs({
  options: {
    pm: { type: 'string', default: 'INTERNATIONAL,DOMESTIC' },
    code: { type: 'string' },
    port: { type: 'string', default: '9333' },
    'no-save': { type: 'boolean', default: false },
  },
});
const service = new OrderService();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOG_DIR = path.join(ROOT_DIR, 'khao-sat', 'pay-log');
const ENV_FILE = path.join(ROOT_DIR, '.env');
mkdirSync(LOG_DIR, { recursive: true });

// URL: giữ host + path, che giá trị query/hash (có thể chứa token phiên)
function maskUrl(u) {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) x.searchParams.set(k, '***');
    if (x.hash) x.hash = '#***';
    return x.toString();
  } catch {
    return String(u).slice(0, 200);
  }
}
const shortUrl = (u) => { try { const x = new URL(u); return x.host + x.pathname.replace(/[A-Za-z0-9_-]{20,}/g, '*'); } catch { return String(u).slice(0, 80); } };

function notify(title, body) {
  process.stdout.write('\x07');
  execFile('notify-send', ['-u', 'critical', '-a', 'FPT.vn Order Tool', title, body], () => {});
}

// Ô nhập -> hậu tố biến .env (thứ tự kiểm tra quan trọng: OTP/CVV trước, tên sau cùng)
const FIELD_RULES = [
  ['OTP', /otp|challenge|one.?time|mã xác (thực|nhận)/],
  ['CVV', /cvv|cvc|csc|security.?code|mã bảo mật/],
  ['ISSUE_DATE', /phát hành|issue|valid.?from|ngày hiệu lực/],
  ['EXPIRY', /exp|hết hạn|hiệu lực đến|mm\s*\/\s*yy|valid.?thru/],
  ['NUMBER', /card.?(num|no)|cc-number|số thẻ|pan\b|\bnumber\b/],
  ['NAME', /holder|cc-name|card.?name|tên|chủ thẻ|\bname\b/],
  ['EMAIL', /e-?mail/],
  ['PHONE', /phone|mobile|điện thoại/],
];
function classify(f) {
  const s = [f.name, f.id, f.placeholder, f.autocomplete, f.label].join(' ').toLowerCase();
  for (const [k, re] of FIELD_RULES) if (re.test(s)) return k;
  return 'FIELD_' + (f.name || f.id || f.placeholder || 'X').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase().slice(0, 30);
}

// Ghi/thay biến trong .env, giữ nguyên các dòng khác
function saveEnv(vars) {
  let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
  for (const [k, v] of Object.entries(vars)) {
    const line = `${k}="${String(v).replace(/["\n\r]/g, '')}"`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    if (re.test(text)) text = text.replace(re, line);
    else {
      if (!text.includes('# Thẻ test')) text += `${text && !text.endsWith('\n') ? '\n' : ''}\n# Thẻ test (pay-recorder tự ghi khi người dùng nhập trên cổng thanh toán) – KHÔNG commit\n`;
      text += line + '\n';
    }
  }
  writeFileSync(ENV_FILE, text, { mode: 0o600 });
}

// Cấu trúc form – chỉ thuộc tính, không đọc value (đi cả iframe cùng origin)
const FORM_PROBE = `(() => {
  const docs = [document];
  for (const f of document.querySelectorAll('iframe')) { try { if (f.contentDocument) docs.push(f.contentDocument); } catch {} }
  const lab = (el) => (el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.closest('label')?.innerText || '').trim().slice(0, 80);
  const pick = (el) => ({ tag: el.tagName.toLowerCase(), type: el.type || '', name: el.name || '', id: el.id || '',
    placeholder: el.placeholder || '', autocomplete: el.autocomplete || '', maxlength: el.maxLength > 0 ? el.maxLength : undefined,
    label: lab(el), cls: String(el.className || '').slice(0, 80), visible: !!(el.offsetWidth || el.offsetHeight) });
  const all = (sel) => docs.flatMap((d) => [...d.querySelectorAll(sel)]);
  return {
    title: document.title, url: location.href,
    fields: all('input, select, textarea').filter((e) => e.type !== 'hidden').map(pick),
    buttons: all('button, input[type=submit], [role=button]').map((b) => ({ text: (b.innerText || b.value || '').trim().slice(0, 60), id: b.id, type: b.type || '', disabled: !!b.disabled })),
    iframes: all('iframe').map((f) => ({ src: f.src, id: f.id, name: f.name, title: f.title })),
    headings: all('h1,h2,h3,.alert,.error,[role=alert]').map((h) => h.innerText.trim().slice(0, 120)).filter(Boolean).slice(0, 15),
  };
})()`;

// Giá trị ô nhập + các click (gắn listener 1 lần mỗi document) – chỉ dùng để ghi .env, không ghi log
const VALUE_PROBE = `(() => {
  const docs = [document];
  for (const f of document.querySelectorAll('iframe')) { try { if (f.contentDocument) docs.push(f.contentDocument); } catch {} }
  const out = { url: location.href, values: [], clicks: [] };
  for (const d of docs) {
    if (!d.__qcClicks) {
      d.__qcClicks = [];
      d.addEventListener('click', (e) => {
        const el = e.target.closest('button, a, [role=button], [onclick], li, label, input[type=radio], input[type=checkbox], img') || e.target;
        if (el.matches?.('input:not([type=radio]):not([type=checkbox]), textarea, select')) return;
        d.__qcClicks.push({ tag: el.tagName.toLowerCase(), id: el.id || '', cls: String(el.className || '').slice(0, 60),
          text: (el.innerText || el.value || el.alt || el.title || '').trim().slice(0, 60) });
      }, true);
    }
    out.clicks.push(...d.__qcClicks.splice(0));
    for (const el of d.querySelectorAll('input, select, textarea')) {
      if (['hidden', 'submit', 'button', 'checkbox', 'radio'].includes(el.type) || !el.value) continue;
      out.values.push({ tag: el.tagName.toLowerCase(), type: el.type || '', name: el.name || '', id: el.id || '',
        placeholder: el.placeholder || '', autocomplete: el.autocomplete || '',
        label: (el.labels?.[0]?.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 80), value: el.value });
    }
  }
  return out;
})()`;

const pms = args.pm.toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);
if (args.code && pms.length > 1) throw new Error('--code chỉ dùng với 1 PTTT (--pm INTERNATIONAL hoặc --pm DOMESTIC)');
for (const pm of pms) await runOnce(pm, args.code?.toUpperCase());
process.exit(0);

async function runOnce(pm, code) {
  console.log(`\n════════ ${pm === 'DOMESTIC' ? 'THẺ ATM' : pm === 'INTERNATIONAL' ? 'THẺ TÍN DỤNG' : pm} (${pm}) ════════`);
  // ---- 1. Đơn test + link thanh toán ----
  let payUrl;
  if (code) {
    const rec = readRecords('orders').filter((r) => r.summary?.code === code).pop();
    if (!rec?.complete?.redirect_url) throw new Error(`Đơn ${code} không có link thanh toán trong output/orders.jsonl`);
    payUrl = rec.complete.redirect_url;
  } else {
    const d = config.defaults;
    console.log(`Tạo đơn test ${d.url} · PTTT ${pm}…`);
    const r = await service.create({ url: d.url, fullName: d.fullName, phone: d.phone, address: {}, note: 'AUTO-QC khảo sát thanh toán', paymentCode: pm });
    if (r.payment.type !== 'redirect') throw new Error(`PTTT ${pm} không trả link thanh toán (type ${r.payment.type})`);
    code = r.summary.code;
    payUrl = r.payment.url;
    console.log(`✔ Đơn ${code} – ${r.summary.statusLabel} · ${r.summary.total}đ`);
  }

  const logFile = path.join(LOG_DIR, `${code}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const t0 = Date.now();
  const log = (type, data) => {
    appendFileSync(logFile, JSON.stringify({ t: ((Date.now() - t0) / 1000).toFixed(1), type, ...data }) + '\n');
    if (!['request', 'form', 'frame'].includes(type)) console.log(`[${type}]`, data.url || data.status || data.text || '');
  };

  async function checkOrder(label) {
    const rec = readRecords('orders').filter((r) => r.summary?.code === code).pop();
    const d = await getCheckout(service.api.withToken(rec.token));
    const pi = d.payment_info || {};
    log('order', { label, status: d.status, mapped: orderStatus(d), payment_info: { ...pi, redirect_url: pi.redirect_url ? maskUrl(pi.redirect_url) : undefined }, completed_at: d.completed_at, updated_at: d.updated_at });
    return d;
  }
  await checkOrder('trước thanh toán');

  // ---- 2. Chrome thật, profile tạm riêng, đi cùng proxy với tool (WAF chặn IP ngoài mạng công ty) ----
  const profile = mkdtempSync(path.join(tmpdir(), 'fptvn-pay-'));
  const proxyArgs = config.proxy ? [`--proxy-server=${config.proxy.url}`, `--proxy-bypass-list=${['<-loopback>', ...config.proxy.bypass].join(';')}`] : [];
  const chrome = spawn('google-chrome', [
    `--remote-debugging-port=${args.port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    ...proxyArgs, '--new-window', payUrl,
  ], { stdio: 'ignore' });
  let chromeClosed = false;
  chrome.on('exit', () => (chromeClosed = true));
  if (config.proxy) console.log(`Chrome đi proxy ${config.proxy.url} (${config.proxy.source})`);

  let wsUrl;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await sleep(250);
    wsUrl = await fetch(`http://127.0.0.1:${args.port}/json/version`).then((r) => r.json()).then((j) => j.webSocketDebuggerUrl).catch(() => null);
  }
  if (!wsUrl) throw new Error('Không kết nối được Chrome DevTools');

  const ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let seq = 0;
  const waiting = new Map();
  const send = (method, params = {}, sessionId) => new Promise((ok) => {
    const id = ++seq;
    waiting.set(id, ok);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const evaluate = (expression, sessionId) => send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)
    .then((r) => r?.result?.result?.value).catch(() => null);

  const sessions = new Map(); // sessionId -> targetInfo
  const reqType = new Map();
  const lastProbe = new Map();
  const notified = new Set();
  const captured = new Map(); // khóa ô nhập -> { page, field, env, value }
  const flow = []; // [{step:'page'|'field'|'click', ...}] – không có giá trị
  let returned = false;

  async function probe(sessionId, why) {
    const v = await evaluate(FORM_PROBE, sessionId);
    if (!v) return;
    const page = { ...v, url: maskUrl(v.url), iframes: v.iframes.map((f) => ({ ...f, src: maskUrl(f.src) })) };
    const key = JSON.stringify(page);
    if (key === lastProbe.get(sessionId)) return;
    lastProbe.set(sessionId, key);
    log('form', { why, ...page });
    const blocked = /you have been blocked|access denied|attention required/i.test(v.title + ' ' + v.headings.join(' '));
    const where = shortUrl(v.url);
    if (blocked && !notified.has('blocked:' + where)) {
      notified.add('blocked:' + where);
      console.log(`\n✖ BỊ CHẶN (Cloudflare/WAF) tại ${where} – "${v.title}". Đóng Chrome để thoát.`);
      notify('Cổng thanh toán bị chặn', where);
    } else if (!blocked && v.fields.some((f) => f.visible && !['checkbox', 'radio', 'button', 'submit'].includes(f.type)) && !notified.has(where)) {
      notified.add(where);
      flow.push({ step: 'page', url: where, title: v.title, headings: v.headings.slice(0, 5) });
      const names = v.fields.filter((f) => f.visible).map((f) => f.label || f.placeholder || f.name || f.id).filter(Boolean).slice(0, 8);
      console.log(`\n🔔 ĐÃ TỚI MÀN NHẬP THÔNG TIN: ${where}\n   "${v.title}" – ô: ${names.join(' · ')}\n   → Mời nhập thông tin thẻ test trên cửa sổ Chrome rồi bấm Thanh toán / Xác nhận.`);
      notify(`Mời nhập thông tin ${pm === 'DOMESTIC' ? 'thẻ ATM' : 'thẻ tín dụng'}`, `${where}\n${names.join(' · ')}`);
    } else if (!blocked && !notified.has('page:' + where)) {
      notified.add('page:' + where);
      flow.push({ step: 'page', url: where, title: v.title, headings: v.headings.slice(0, 5) });
    }
  }

  // Theo dõi người dùng nhập: giữ giá trị mới nhất (khác rỗng) của từng ô, thứ tự ô + click theo lần đầu xuất hiện
  async function watchValues(sessionId) {
    const v = await evaluate(VALUE_PROBE, sessionId);
    if (!v) return;
    const where = shortUrl(v.url);
    for (const c of v.clicks) {
      flow.push({ step: 'click', url: where, ...c });
      log('click', { url: where, ...c });
    }
    for (const f of v.values) {
      const sel = f.id ? `#${f.id}` : f.name ? `${f.tag}[name="${f.name}"]` : f.placeholder ? `${f.tag}[placeholder="${f.placeholder}"]` : f.tag;
      const k = where + ' ' + sel;
      const old = captured.get(k);
      if (!old) {
        const env = `CARD_${pm}_${classify(f)}`;
        captured.set(k, { env, value: f.value });
        flow.push({ step: 'field', url: where, selector: sel, type: f.type, label: f.label || f.placeholder, env });
        log('input', { url: where, selector: sel, env, length: f.value.length });
        console.log(`  ✎ đang nhập ${f.label || f.placeholder || sel} → ${env}`);
      } else if (!/[●•*]/.test(f.value)) old.value = f.value; // Foxpay che số thẻ (●) khi rời ô -> giữ bản đầy đủ
    }
  }

  async function setupSession(sessionId) {
    await Promise.all([
      send('Network.enable', {}, sessionId),
      send('Page.enable', {}, sessionId).catch(() => {}),
      // KHÔNG Runtime.enable: Cloudflare dò được DevTools qua nó -> "Sorry, you have been blocked"
      send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => {}),
    ]);
  }

  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id); return; }
    const sid = m.sessionId;
    switch (m.method) {
      case 'Target.attachedToTarget': {
        const { sessionId, targetInfo } = m.params;
        sessions.set(sessionId, targetInfo);
        log('target', { kind: targetInfo.type, url: maskUrl(targetInfo.url) });
        await setupSession(sessionId);
        break;
      }
      case 'Target.detachedFromTarget':
        sessions.delete(m.params.sessionId);
        break;
      case 'Network.requestWillBeSent': {
        const { request, type, requestId } = m.params;
        if (!['Document', 'XHR', 'Fetch'].includes(type)) break;
        reqType.set(requestId, { type, method: request.method, url: maskUrl(request.url) });
        if (m.params.redirectResponse) log('redirect', { status: m.params.redirectResponse.status, from: maskUrl(m.params.redirectResponse.url), url: maskUrl(request.url) });
        break;
      }
      case 'Network.responseReceived': {
        const q = reqType.get(m.params.requestId);
        if (q) log('request', { ...q, status: m.params.response.status });
        break;
      }
      case 'Page.frameNavigated': {
        const f = m.params.frame;
        log(f.parentId ? 'frame' : 'navigate', { url: maskUrl(f.url) });
        if (!f.parentId && new URL(f.url).host === new URL(config.webUrl).host && f.url.includes('/checkout/')) returned = true;
        break;
      }
      case 'Page.loadEventFired':
        setTimeout(() => probe(sid, 'load'), 800);
        break;
    }
  };

  // Chrome tự mở trang thanh toán (không qua DevTools) -> chờ trang tải xong rồi mới gắn vào
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    await sleep(500);
    const list = await fetch(`http://127.0.0.1:${args.port}/json/list`).then((r) => r.json()).catch(() => []);
    page = list.find((t) => t.type === 'page' && !t.url.startsWith('chrome') && t.url !== 'about:blank');
  }
  if (!page) throw new Error('Chrome không mở được trang thanh toán');
  await sleep(4000);
  const { result: { sessionId: main } } = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
  sessions.set(main, { type: 'page' });
  await setupSession(main);
  log('navigate', { url: maskUrl(page.url) });
  await probe(main, 'attach');
  console.log(`▶ Chrome đã mở trang thanh toán đơn ${code}. Nhập xong & thấy kết quả (hoặc bỏ cuộc) thì ĐÓNG cửa sổ Chrome.`);

  const pageSessions = () => [...sessions].filter(([, t]) => t.type === 'page' || t.type === 'iframe').map(([s]) => s);
  const formTimer = setInterval(() => pageSessions().forEach((s) => probe(s, 'poll')), 3000);
  const valueTimer = setInterval(() => pageSessions().forEach((s) => watchValues(s)), 500);

  while (!chromeClosed && !returned) await sleep(500);
  if (returned) {
    console.log('Đã quay về staging.fpt.vn – chờ 5s cho trang kết quả…');
    await sleep(5000);
    for (const s of pageSessions()) await probe(s, 'returned');
  }
  clearInterval(formTimer);
  clearInterval(valueTimer);

  // ---- 3. Lưu thông tin đã nhập + luồng ----
  const vars = {};
  for (const { env, value } of captured.values()) {
    let k = env;
    for (let i = 2; k in vars && vars[k] !== value; i++) k = `${env}_${i}`; // ô trùng loại (vd OTP 2 lần) -> _2
    vars[k] = value;
  }
  if (Object.keys(vars).length && !args['no-save']) {
    saveEnv(vars);
    console.log(`💾 Đã lưu vào .env: ${Object.keys(vars).join(', ')} (giá trị không in ra)`);
  } else console.log(Object.keys(vars).length ? '(--no-save: không ghi .env)' : 'Không ghi nhận ô nhập nào có giá trị.');
  const flowFile = path.join(LOG_DIR, `${pm}-flow.json`);
  writeFileSync(flowFile, JSON.stringify({ pm, code, recordedAt: new Date().toISOString(), returned, flow }, null, 2));
  console.log('Luồng:', path.relative(ROOT_DIR, flowFile));

  // ---- 4. Trạng thái đơn sau thanh toán ----
  for (const wait of [0, 5000, 15000]) {
    await sleep(wait);
    const d = await checkOrder(`sau thanh toán +${wait / 1000}s`);
    console.log(`Trạng thái: ${d.status} → ${orderStatus(d).label}`);
  }
  try { ws.close(); } catch {}
  if (!chromeClosed) chrome.kill();
  while (!chromeClosed) await sleep(200);
  rmSync(profile, { recursive: true, force: true });
  console.log(`✔ Xong ${pm}. Log:`, path.relative(ROOT_DIR, logFile));
}
