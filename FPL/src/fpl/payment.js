// Tự thanh toán thẻ test (chuyển từ tool fpt.vn – FPT Play dùng chung cổng Foxpay paygateway-stag.fpt.vn): mở Chrome THẬT
// (WAF/Cloudflare chặn headless) đi cùng proxy với tool -> link cổng (value_display) -> điền thẻ trong .env
// -> theo dõi tới khi cổng báo kết quả / quay về dev.fptplay.vn/dich-vu/thanh-toan/<PTTT>.
// Không thư viện: CDP qua WebSocket có sẵn Node 22. KHÔNG Runtime.enable (Cloudflare dò được), không log giá trị thẻ.
//   Thẻ tín dụng (INTERNATIONAL): Foxpay #card-number/#card-name/#expiration-date/#cvv-number -> #checkout-btn
//     -> 3DS Cardinal (iframe creq.jsp) input[name=challengeDataEntry] -> SUBMIT -> /payment/v3/result "Thanh toán thành công!"
//   Thẻ ATM (DOMESTIC): NAPAS #selectBank/#napasCardNo/#napasNameOnCard/#napasIssueDate -> #napasProcessBtn1
//     -> #napasOtpCode -> #napasProcessBtn2 -> 302 về return_url
// Kết quả cuối cùng vẫn đối chiếu lại bằng paymentgw/payment_hub/check_transaction (orders.js).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from '../core/env.js';

export const CARD_METHODS = ['INTERNATIONAL', 'DOMESTIC'];
const FIELDS = {
  INTERNATIONAL: ['NUMBER', 'NAME', 'EXPIRY', 'CVV', 'OTP'],
  DOMESTIC: ['BANK', 'NUMBER', 'NAME', 'ISSUE_DATE', 'OTP'],
};
const TIMEOUT = 4 * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAX_CARDS = 5;

/**
 * Các thẻ test của PTTT (đọc .env), theo thứ tự thử: thẻ 1 = CARD_<PTTT>_<Ô>, thẻ n = CARD_<PTTT>_NUMBER<n>
 * (+ CARD_<PTTT>_<Ô><n> nếu khác thẻ 1, thiếu thì dùng ô của thẻ 1). Thẻ thiếu ô bị bỏ qua.
 */
export function cardsFor(pm) {
  const keys = FIELDS[pm];
  if (!keys) return [];
  const env = (k) => process.env[`CARD_${pm}_${k}`]?.trim() || '';
  const cards = [];
  for (let n = 1; n <= MAX_CARDS; n++) {
    const sfx = n === 1 ? '' : String(n);
    if (n > 1 && !env(`NUMBER${sfx}`)) continue;
    const card = Object.fromEntries(keys.map((k) => [k, env(k + sfx) || env(k)]));
    if (keys.every((k) => card[k])) cards.push({ ...card, no: n });
  }
  return cards;
}

/** Số thẻ test đã có của từng PTTT -> { INTERNATIONAL: 2, DOMESTIC: 1 } (0 = chưa có) */
export const cardStatus = () => Object.fromEntries(CARD_METHODS.map((pm) => [pm, cardsFor(pm).length]));

// Các màn đã biết: tìm phần tử đang hiện trong document của 1 target (page / iframe khác origin)
const DETECT = `(() => {
  const vis = (s) => { const e = document.querySelector(s); return e && (e.offsetWidth || e.offsetHeight) ? e : null; };
  const text = (document.title + ' ' + [...document.querySelectorAll('h1,h2,h3,h4,.alert,.error,[role=alert],.text-danger')]
    .map((h) => h.innerText).join(' | ')).replace(/\\s+/g, ' ').slice(0, 400);
  let step = null;
  if (vis('#card-number') && vis('#cvv-number')) step = 'foxpay';
  else if (vis('input[name=challengeDataEntry]')) step = 'cardinal';
  else if (vis('#napasOtpCode')) step = 'napasOtp';
  else if (vis('#napasCardNo')) step = 'napasCard';
  return { url: location.href, step, text };
})()`;

/** Điền 1 ô: gõ phím thật (form có mask), sai thì gán value + event */
async function fill(cdp, sid, selector, value, { digits = false } = {}) {
  const sel = JSON.stringify(selector);
  const ok = await cdp.eval(`(() => { const e = document.querySelector(${sel}); if (!e) return false;
    e.focus(); e.select?.(); return true; })()`, sid);
  if (!ok) throw new Error(`Không thấy ô ${selector}`);
  const typed = digits ? value.replace(/\D/g, '') : value;
  try {
    for (const ch of typed) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch }, sid);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }, sid);
    }
  } catch {
    // target không hỗ trợ Input -> dùng cách gán bên dưới
  }
  const norm = (s) => (digits ? s.replace(/\D/g, '') : s.toUpperCase());
  // Đọc trước khi blur: Foxpay che số thẻ thành ● khi rời ô
  const got = await cdp.eval(`document.querySelector(${sel})?.value || ''`, sid);
  await cdp.eval(`document.querySelector(${sel})?.blur()`, sid);
  if (norm(got) === norm(value)) return;
  // Gõ không ăn (ô không nhận key event của frame) -> gán thẳng qua setter gốc để framework nhận
  await cdp.eval(`(() => { const e = document.querySelector(${sel});
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set; set.call(e, ${JSON.stringify(value)});
    for (const t of ['input', 'change', 'blur']) e.dispatchEvent(new Event(t, { bubbles: true })); })()`, sid);
}

async function select(cdp, sid, selector, value) {
  const done = await cdp.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false;
    const v = ${JSON.stringify(value)}; const o = [...e.options].find((o) => o.value === v || o.text.trim() === v); if (!o) return false;
    e.value = o.value; e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`, sid);
  if (!done) throw new Error(`Không chọn được ${selector} theo CARD_DOMESTIC_BANK`);
}

/** Bấm nút (chờ hết disabled tối đa 8s) */
async function click(cdp, sid, selector) {
  for (let i = 0; i < 16; i++) {
    const r = await cdp.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return 'missing';
      if (e.disabled) return 'disabled'; e.click(); return 'ok'; })()`, sid);
    if (r === 'ok') return;
    await sleep(500);
  }
  // Chẩn đoán: ô nào trống / báo lỗi (chỉ độ dài + chữ lỗi, không lấy giá trị)
  const diag = await cdp.eval(`[...document.querySelectorAll('input:not([type=hidden]), select')].filter((e) => e.offsetWidth || e.offsetHeight)
    .map((e) => (e.id || e.name) + ':' + e.value.length + (e.matches(':invalid') || e.getAttribute('aria-invalid') === 'true' ? '!' : '')).join(' ')
    + ' | ' + [...document.querySelectorAll('.error, .text-red-500, .text-danger, [role=alert], .invalid-feedback, small, p')]
      .map((x) => x.innerText.trim()).filter((s) => s && s.length < 80).slice(0, 6).join(' / ')`, sid).catch(() => '');
  throw new Error(`Không bấm được ${selector} (nút bị khóa – ô chưa hợp lệ?) ${diag}`);
}

const STEP_LABEL = {
  foxpay: 'Nhập thẻ tín dụng', cardinal: 'Xác thực 3DS (OTP)', napasCard: 'Nhập thẻ ATM (NAPAS)', napasOtp: 'Nhập OTP NAPAS',
};

async function runStep(cdp, sid, step, card) {
  switch (step) {
    case 'foxpay':
      await fill(cdp, sid, '#card-number', card.NUMBER, { digits: true });
      await fill(cdp, sid, '#card-name', card.NAME);
      await fill(cdp, sid, '#expiration-date', card.EXPIRY, { digits: true });
      await fill(cdp, sid, '#cvv-number', card.CVV, { digits: true });
      return click(cdp, sid, '#checkout-btn');
    case 'cardinal':
      await fill(cdp, sid, 'input[name=challengeDataEntry]', card.OTP);
      return click(cdp, sid, 'input[type=submit][value=SUBMIT], input[type=submit]');
    case 'napasCard':
      await select(cdp, sid, '#selectBank', card.BANK);
      await fill(cdp, sid, '#napasCardNo', card.NUMBER, { digits: true });
      await fill(cdp, sid, '#napasNameOnCard', card.NAME);
      await fill(cdp, sid, '#napasIssueDate', card.ISSUE_DATE, { digits: true });
      return click(cdp, sid, '#napasProcessBtn1');
    case 'napasOtp':
      await fill(cdp, sid, '#napasOtpCode', card.OTP);
      return click(cdp, sid, '#napasProcessBtn2');
  }
}

const SUCCESS = /thanh toán thành công|giao dịch thành công|payment success/i;
const FAILED = /thất bại|không thành công|bị từ chối|hết hạn|không được hỗ trợ|có lỗi xảy ra|failed|declined|expired|invalid|không hợp lệ|sai (mã|otp)/i;
const BLOCKED = /you have been blocked|access denied|attention required/i;

/** Client CDP tối giản (flatten sessions) */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.waiting = new Map();
    this.handlers = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id) {
        const w = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        if (w) (m.error ? w.fail(new Error(m.error.message)) : w.ok(m.result));
      } else this.handlers.forEach((h) => h(m));
    };
  }
  send(method, params = {}, sessionId) {
    return new Promise((ok, fail) => {
      const id = ++this.seq;
      this.waiting.set(id, { ok, fail });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  eval(expression, sessionId) {
    return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId).then((r) => r?.result?.value);
  }
}

let queue = Promise.resolve(); // 1 phiên Chrome tại 1 thời điểm

/**
 * Tự thanh toán 1 link thanh toán bằng 1 thẻ test (phần tử của cardsFor). onStep(text) báo tiến trình.
 * Thẻ/OTP bị từ chối (bước lặp lại, nút khóa, cổng báo lỗi) -> result 'failed' (thử thẻ khác được); lỗi môi trường -> ném.
 * -> { result: 'success' | 'failed' | 'unknown', message, steps: [{at, text}], finalUrl }
 */
export function payByCard({ url, pm, card, onStep = () => {} }) {
  const run = queue.then(() => doPay({ url, pm, card, onStep }));
  queue = run.catch(() => {});
  return run;
}

async function doPay({ url, pm, card, onStep }) {
  if (!card) throw Object.assign(new Error(`Chưa có thẻ test cho ${pm} trong .env (CARD_${pm}_${FIELDS[pm]?.join('/') ?? '*'}) – copy từ tool fpt.vn hoặc xem .env.example`), { status: 400 });
  if (/[●•*]/.test(card.NUMBER)) throw Object.assign(new Error(`CARD_${pm}_NUMBER${card.no > 1 ? card.no : ''} trong .env bị che (●) – nhập lại số thẻ đầy đủ (sửa .env)`), { status: 400 });
  if (!url) throw Object.assign(new Error('Đơn không có link thanh toán'), { status: 400 });

  const t0 = Date.now();
  const steps = [];
  const step = (text) => { steps.push({ at: ((Date.now() - t0) / 1000).toFixed(1), text }); onStep(text); };
  const profile = mkdtempSync(path.join(tmpdir(), 'fpl-autopay-'));
  const proxy = config.proxy ? [`--proxy-server=${config.proxy.url}`, `--proxy-bypass-list=${['<-loopback>', ...config.proxy.bypass].join(';')}`] : [];
  const chrome = spawn(process.env.CHROME_PATH || 'google-chrome', [
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=900,900', ...proxy, '--new-window', url,
  ], { stdio: 'ignore' });
  let closed = false;
  chrome.on('exit', () => (closed = true));
  chrome.on('error', () => (closed = true));
  let ws;
  try {
    step('Mở Chrome → cổng thanh toán');
    // Cổng DevTools ngẫu nhiên: Chrome ghi vào <profile>/DevToolsActivePort
    let port;
    for (let i = 0; i < 60 && !port && !closed; i++) {
      await sleep(250);
      try { port = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch {}
    }
    if (!port) throw new Error('Không mở được Chrome (cần google-chrome, hoặc đặt CHROME_PATH trong .env)');
    // Chờ trang thanh toán tự tải (không qua DevTools) rồi mới gắn vào
    let page;
    for (let i = 0; i < 60 && !page && !closed; i++) {
      await sleep(500);
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
      page = list.find((t) => t.type === 'page' && /^https?:/.test(t.url));
    }
    if (!page) throw new Error('Chrome không mở được trang thanh toán');
    const wsUrl = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).then((j) => j.webSocketDebuggerUrl);
    ws = new WebSocket(wsUrl);
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error('Không kết nối được Chrome DevTools')); });
    const cdp = new Cdp(ws);

    const sessions = new Map(); // sessionId -> 'page' | 'iframe'
    let main;
    let topUrl = page.url;
    cdp.handlers.push((m) => {
      if (m.method === 'Target.attachedToTarget') {
        sessions.set(m.params.sessionId, m.params.targetInfo.type);
        cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, m.params.sessionId).catch(() => {});
      } else if (m.method === 'Target.detachedFromTarget') sessions.delete(m.params.sessionId);
      else if (m.method === 'Page.frameNavigated' && m.sessionId === main && !m.params.frame.parentId) topUrl = m.params.frame.url;
    });
    await sleep(3000);
    main = (await cdp.send('Target.attachToTarget', { targetId: page.id, flatten: true })).sessionId;
    sessions.set(main, 'page');
    await cdp.send('Page.enable', {}, main);
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, main);

    const done = new Map(); // bước -> số lần đã làm
    let result = 'unknown';
    let message = '';
    const staging = new URL(config.webUrl).host;
    while (Date.now() - t0 < TIMEOUT) {
      if (closed) { message = 'Chrome bị đóng trước khi có kết quả'; break; }
      if (new URL(topUrl).host === staging) {
        // Cổng trả về return_url trên web FPT Play
        if (result === 'unknown') result = done.size && !FAILED.test(message) ? 'success' : 'unknown';
        message ||= `Cổng thanh toán đã chuyển về ${staging}`;
        step(`Quay về ${staging}`);
        break;
      }
      let acted = false;
      for (const [sid] of [...sessions]) {
        const d = await cdp.eval(DETECT, sid).catch(() => null);
        if (!d) continue;
        if (BLOCKED.test(d.text)) throw new Error('Cổng thanh toán chặn truy cập (Cloudflare) – cần mạng/proxy công ty');
        if (SUCCESS.test(d.text)) { result = 'success'; message = 'Cổng báo: Thanh toán thành công'; break; }
        if (d.step) {
          const n = done.get(d.step) || 0;
          // Bấm xong mà vẫn ở màn này kèm thông báo lỗi (vd Foxpay "Loại thẻ không được hỗ trợ") -> thẻ bị từ chối, không nhập lại
          if (n && FAILED.test(d.text)) { result = 'failed'; message = `${STEP_LABEL[d.step]}: cổng báo lỗi – ${d.text.slice(0, 180)}`; break; }
          if (n >= 2) { result = 'failed'; message = `${STEP_LABEL[d.step]} lặp lại – thẻ/OTP bị từ chối? ${d.text.slice(0, 150)}`; break; }
          step(STEP_LABEL[d.step]);
          try {
            await runStep(cdp, sid, d.step, card);
          } catch (err) {
            result = 'failed';
            message = err.message;
            break;
          }
          done.set(d.step, n + 1);
          acted = true;
          // Chờ màn này chuyển đi (bấm xong trang còn hiện vài giây) – còn nguyên sau 20s mới tính là lặp lại
          for (let i = 0; i < 40 && !closed && new URL(topUrl).host !== new URL(config.webUrl).host; i++) {
            await sleep(500);
            const again = await cdp.eval(DETECT, sid).catch(() => null);
            if (again?.step !== d.step) break;
          }
          break;
        }
        if (done.size && FAILED.test(d.text)) { result = 'failed'; message = d.text.slice(0, 200); break; }
      }
      if (result !== 'unknown') { step(message); break; }
      await sleep(acted ? 2500 : 700);
    }
    if (result === 'unknown' && !message) message = 'Hết thời gian chờ kết quả thanh toán';
    if (result === 'success') await sleep(1500); // cho cổng kịp redirect/callback
    return { result, message, steps, finalUrl: topUrl.replace(/\?.*$/, '') };
  } finally {
    try { ws?.close(); } catch {}
    if (!closed) chrome.kill();
    for (let i = 0; i < 20 && !closed; i++) await sleep(200);
    rmSync(profile, { recursive: true, force: true });
  }
}
