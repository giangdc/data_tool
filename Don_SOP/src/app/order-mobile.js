// order-mobile.js — tạo đơn (và hợp đồng) MOBILE bằng cách điều khiển UI app SOP trên
// thiết bị Android thật qua adb. App lộ chữ qua uiautomator (text/content-desc) nên mỗi bước
// TÌM NÚT THEO CHỮ + kiểm tra màn hình đã đúng trước khi đi tiếp; toạ độ trong
// config/mobile-flow.json chỉ dùng cho vài ô không có chữ (nút +, dropdown gói).
import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Adb, sleepMs } from '../core/adb.js';
import { save } from '../core/store.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const FLOW = join(ROOT, 'config', 'mobile-flow.json');

export const HOUSE_TYPES = ['Nhà phố', 'C.Cư, C.Xá, Chợ, Thương xá', 'Nhà không số'];

async function loadFlow() { return JSON.parse(await readFile(FLOW, 'utf8')); }

// So khớp không dấu, không phân biệt hoa thường.
export const norm = (s) => String(s || '').toLowerCase().replace(/đ/g, 'd').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const same = (a, b) => norm(a) === norm(b);
const first = (n) => n.lines[0] || '';

class StepError extends Error {}

// Tạo 1 đơn Mobile.
// opts: {loaiNha, ward, street, soNha, goiDichVu, goiTinhCuoc, name, phone, contract, shots, serial, onLog}
export async function createMobileOrder(opts = {}) {
  const flow = await loadFlow();
  const d = { ...flow.defaults, servicePresets: flow.servicePresets || {}, ...clean(opts) };
  if (opts.phone == null && flow.defaults.phone) d.phone = flow.defaults.phone;
  // SĐT riêng theo dịch vụ (vd FPT Play dùng số khác) nếu không truyền phone
  if (!opts.phone) { const sp = Object.entries(flow.servicePhones || {}).find(([k]) => same(k, d.service || 'Internet')); if (sp) d.phone = sp[1]; }
  const T = flow.taps;
  const adb = new Adb(opts.serial || null, { base: flow.base });
  const log = (m) => { console.log(`  • ${m}`); opts.onLog?.(m); };

  await adb.waitDevice();
  await adb.screenSize();
  log(`Thiết bị ${adb.serial} · màn ${adb.size.join('x')}`);

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const shotDir = join(ROOT, 'output', `mobile-${ts}`);
  await mkdir(shotDir, { recursive: true });
  let step = 0;
  const shot = async (name, force = false) => {
    if (!opts.shots && !force) return null;
    const p = join(shotDir, `${String(++step).padStart(2, '0')}-${name}.png`);
    try { await adb.screencap(p); return p; } catch { return null; }
  };

  // ---- helpers đọc/tìm theo chữ ----
  const find = (nodes, m, { contains = false, pred = null } = {}) => nodes.filter((n) => {
    if (pred && !pred(n)) return false;
    if (m instanceof RegExp) return m.test(n.label);
    return contains ? norm(n.label).includes(norm(m)) : (same(first(n), m) || same(n.label, m));
  });
  const waitFor = async (m, { timeout = 30000, what = String(m), ...o } = {}) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const nodes = await adb.dump();
      const hit = find(nodes, m, o);
      if (hit.length) return { hit, nodes };
      await sleepMs(700);
    }
    throw new StepError(`Chờ quá ${timeout / 1000}s không thấy "${what}" trên màn hình.`);
  };
  const tapNode = (n, dy = 0) => adb.tapAt(n.cx, n.cy + dy);
  const keyboardShown = async () => /mInputShown=true/.test(await adb.runText(['shell', 'dumpsys', 'input_method']));
  const hideKeyboard = async () => { if (await keyboardShown()) { await adb.key('KEYCODE_BACK'); await sleepMs(700); } };
  const clearFocused = async (n = 40) => {
    await adb.key('KEYCODE_MOVE_END');
    await adb.run(['shell', 'input', 'keyevent', ...Array(n).fill('KEYCODE_DEL')]);
  };
  // Gõ vào ô đang focus rồi đọc lại; bàn phím Telex đổi chữ thì gõ lại kiểu chống Telex.
  const typeVerified = async (text, readBack) => {
    await clearFocused(); await adb.type(text); await sleepMs(700);
    let got = await readBack();
    if (got != null && norm(got) !== norm(text)) {
      await clearFocused(); await adb.typeName(text); await sleepMs(700);
      got = await readBack();
    }
    if (got != null && norm(got) !== norm(text)) throw new StepError(`Gõ "${text}" nhưng ô hiện "${got}" (kiểm tra bàn phím trên máy).`);
  };
  // Hộp thoại đang mở: {title, message, buttons:{label:node}}
  const DIALOG_BTNS = ['Xác nhận', 'Hủy', 'Không', 'Đóng', 'Đồng ý', 'OK', 'Thử lại'];
  const dialogOf = (nodes) => {
    const btns = nodes.filter((n) => DIALOG_BTNS.some((b) => same(n.label, b)) && n.h < 200 && (n.w < 900 || !same(n.label, 'Xác nhận')) && n.y2 < 2100);
    if (!btns.length) return null;
    const top = Math.min(...btns.map((b) => b.y1));
    const texts = nodes.filter((n) => n.y2 <= top + 5 && n.y1 > 150 && n.h < 1200 && n.label && !btns.includes(n) && n.w < 1000).sort((a, b) => a.y1 - b.y1);
    if (!texts.length) return null;
    const buttons = Object.fromEntries(btns.map((b) => [b.label, b]));
    return { title: texts[0].lines.join(' '), message: texts.slice(1).map((t) => t.lines.join(' ')).join(' ') || texts[0].label, buttons };
  };
  // Lỗi tạm thời ("…trong quá trình xử lý. Vui lòng thử lại…") -> bấm Xác nhận rồi làm lại bước đó.
  let transientCount = 0;
  let onTransient = null; // việc cần làm lại sau khi bấm Xác nhận lỗi tạm thời (tuỳ bước)
  const isTransient = (dlg) => /quá trình xử lý|vui lòng thử lại|hết thời gian|timeout|kết nối/i.test(`${dlg.title} ${dlg.message}`) && !/chính sách|phiếu chưa|trùng/i.test(`${dlg.title} ${dlg.message}`);
  const dialogOrRetry = async (nodes) => {
    const dlg = dialogOf(nodes);
    if (!dlg || !isTransient(dlg)) return dlg;
    if (++transientCount > 6) throw new StepError(`App báo: ${dlg.title} — ${dlg.message} (đã thử lại ${transientCount - 1} lần)`);
    log(`⟳ App báo lỗi tạm thời "${dlg.message.slice(0, 80)}" → Xác nhận và làm lại`);
    await shot('loi-tam-thoi');
    const b = dlg.buttons['Xác nhận'] || dlg.buttons['Đóng'] || dlg.buttons['OK'] || dlg.buttons['Đồng ý'] || dlg.buttons['Thử lại'];
    if (b) await tapNode(b); else await adb.key('KEYCODE_BACK');
    await sleepMs(1500);
    return { transient: true };
  };
  // Chọn 1 mục trong danh sách sheet theo chữ (cuộn nếu cần).
  const pickFromList = async (target, what) => {
    let prev = '';
    for (let i = 0; i < 10; i++) {
      const nodes = await adb.dump();
      const items = nodes.filter((n) => n.w > 800 && n.y1 > 380 && n.y2 < 2300 && n.label);
      const hit = items.find((n) => same(first(n), target) && n.h >= 100);
      if (hit) { await tapNode(hit); return; }
      const sig = items.map((n) => n.label).join('|');
      if (sig === prev) break; // hết danh sách
      prev = sig;
      await adb.swipe(540, 1900, 540, 900, 450); await sleepMs(1200);
    }
    throw new StepError(`Không thấy "${target}" trong danh sách ${what} trên app.`);
  };
  // Ô dạng "Nhãn * / Giá trị" (Loại nhà, Xã/Phường, Đường)
  const fieldNode = (nodes, label) => nodes.find((n) => n.lines.length >= 1 && norm(n.lines[0]).replace(/\s*\*$/, '') === norm(label));
  const fieldValue = (n) => (n?.lines[1] || '').trim();

  // Bước bị kẹt (chờ quá lâu, KHÔNG phải app báo lỗi) -> chạy recover (back ra / mở lại) rồi thử lại.
  const retryStep = async (name, fn, recover, tries = 3) => {
    for (let i = 1; ; i++) {
      try { return await fn(); } catch (e) {
        if (/^App báo:/.test(e.message) || i >= tries) throw e;
        log(`⟳ ${name} bị kẹt (${e.message}) → back ra và vào lại (lần ${i + 1}/${tries})`);
        await shot(`ket-${name.replace(/\s+/g, '-')}`);
        await recover();
      }
    }
  };
  // Bấm nút "+" AN TOÀN: chỉ bấm khi đang ở màn danh sách Theo dõi đơn hàng. Màn có nút Thanh toán / Chi tiết đơn hàng -> Back, KHÔNG bấm.
  const tapFab = async () => {
    for (let i = 0; i < 4; i++) {
      const ns = await adb.dump();
      const payScreen = find(ns, 'Thanh toán').some((n) => n.cy > 2000) || find(ns, 'Chi tiết đơn hàng').length || find(ns, 'Thanh toán bằng QR Code').length;
      if (payScreen) { await adb.key('KEYCODE_BACK'); await sleepMs(2500); continue; }
      if (find(ns, 'Theo dõi đơn hàng').some((n) => n.cy < 260)) { await adb.tap(...T.newOrderFab); return true; }
      return false; // màn khác (popup/đang tải) -> không bấm
    }
    return false;
  };
  const relaunch = async () => {
    await adb.run(['shell', 'am', 'force-stop', flow.package]); await sleepMs(1000);
    await adb.launch(flow.pkgActivity);
  };

  // ---- Sheet dịch vụ (Internet, FPT Play, Camera...) ----
  // Ô dropdown không có nhãn khi dump, nhưng mở ra thì tiêu đề danh sách = tên ô.
  // Chỉ xử lý các ô phía trên nút "+" đầu tiên (bỏ qua Thiết bị Box 2 / Extra / Gói triển khai).
  const isListOpen = (nodes) => nodes.find((n) => n.y1 === 0 && n.h > 2000 && n.lines.length === 1 && n.cls === 'View' && nodes.some((m) => m.w > 800 && m.y1 > 380 && m.h >= 100 && m.label));
  const readAllOptions = async () => {
    const seen = [];
    let prev = '';
    for (let i = 0; i < 12; i++) {
      const nodes = await adb.dump();
      const items = nodes.filter((n) => n.w > 800 && n.y1 > 380 && n.y2 < 2300 && n.h >= 100 && n.label).map((n) => first(n));
      for (const it of items) if (!seen.includes(it)) seen.push(it);
      const sig = items.join('|');
      if (sig === prev) break;
      prev = sig;
      await adb.swipe(540, 1900, 540, 900, 450); await sleepMs(1000);
    }
    return seen;
  };
  // Nút X của danh sách: nằm trên tiêu đề, vị trí đổi theo độ dài list (list ngắn -> X ở thấp)
  const closeList = async () => {
    const ns = await adb.dump();
    const x = ns.filter((n) => n.clickable && n.x1 < 60 && n.w < 90 && n.h < 90 && n.y1 > 150).sort((a, b) => a.y1 - b.y1)[0];
    if (x) await tapNode(x); else await adb.key('KEYCODE_BACK');
    await sleepMs(1200);
  };
  // DBG_SLOTS=1: lưu cây giao diện (rút gọn) ra output/dbg-<tên>.json để xem vì sao không nhận ô/nút
  const dbgDump = async (tag) => {
    if (!process.env.DBG_SLOTS) return;
    try {
      const ns = await adb.dump();
      const slim = ns.filter((n) => n.label || n.clickable || n.cls === 'EditText').map((n) => ({ l: n.label, cls: n.cls, c: n.clickable ? 1 : 0, x1: n.x1, y1: n.y1, w: n.w, h: n.h, lines: n.lines?.length }));
      const fsm = await import('node:fs');
      fsm.writeFileSync(new URL(`../../output/dbg-${tag.replace(/[^\w-]+/g, '_')}.json`, import.meta.url), JSON.stringify(slim, null, 1));
      log(`  [dbg] đã lưu cây giao diện: output/dbg-${tag.replace(/[^\w-]+/g, '_')}.json (${slim.length} phần tử)`);
    } catch (e) { log('  [dbg] lỗi lưu dump: ' + e.message); }
  };
  const fillServiceSheet = async (service, sel, { explore = false } = {}) => {
    // Ô dịch vụ ở hàng dưới (Oncall, Smart Home, FPro...) có thể khuất -> cuộn xuống tìm
    let hit;
    const sheetOpen = (ns) => find(ns, service).some((n) => n.cy < 420 || n.h > 2000) && find(ns, 'Xác nhận', { pred: (n) => n.h < 200 && n.cy > 2000 }).length;
    if (sheetOpen(await adb.dump())) hit = [null];
    for (let i = 0; i < 4 && !hit; i++) {
      try { ({ hit } = await waitFor(service, { pred: (n) => n.cls === 'ImageView' && n.cy > 700 && n.cy < 2250 && n.h < 400, timeout: i ? 5000 : 12000, what: `ô dịch vụ "${service}" trong Combo tùy chọn` })); }
      catch (e) { if (i === 3) throw e; await adb.swipe(540, 1900, 540, 1200, 500); await sleepMs(1500); }
    }
    if (hit[0]) await tapNode(hit[0]);
    // chờ sheet mở + tải xong (có ô dropdown bấm được)
    const sheet = async () => {
      const nodes = await adb.dump();
      const plus = nodes.filter((n) => n.w > 85 && n.w < 120 && n.h > 50 && n.h < 90 && n.x1 > 900).sort((a, b) => a.y1 - b.y1);
      const limit = plus.find((p) => p.y1 > 420)?.y1 ?? 2100;
      return { nodes, limit };
    };
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) { const { nodes } = await sheet(); if (find(nodes, 'Xác nhận', { pred: (n) => n.h < 200 }).length && find(nodes, service).length) break; await sleepMs(800); }
    await sleepMs(2500);
    // Ô trong sheet: chevron dropdown (clickable ~33px) + ô nhập (EditText), gom theo MỤC (Cloud, Thiết bị Box 1...).
    // Không bấm nút "+" -> mục chưa mở (Box 2, Extra, Gói triển khai...) tự bị bỏ qua.
    const doneRef = new Set();
    const slotsOf = (nodes) => {
      const heads = nodes.filter((n) => n.x1 < 60 && n.w > 100 && n.w < 1000 && n.y1 > 400 && !n.clickable && n.h >= 35 && n.h < 80 && n.lines.length === 1 && n.cls === 'View' && !/\*\s*$/.test(n.label)).sort((a, b) => a.y1 - b.y1);
      const raw = [
        ...nodes.filter((n) => n.clickable && n.w < 100 && n.h < 50 && n.y1 > 400 && n.y2 < 2110).map((n) => ({ x: n.w < 50 ? n.x1 - 200 : n.cx, y: n.cy, kind: 'list' })),
        ...nodes.filter((n) => n.cls === 'EditText' && n.y1 > 400 && n.y2 < 2110 && n.w < 1000 && n.h < 140).map((n) => ({ x: n.cx, y: n.cy, kind: 'input', node: n })),
      ];
      // Sheet 1 mục không có tiêu đề (VIP 247, Ultra Fast SA): lượt đầu chưa xử lý ô nào -> lấy tên dịch vụ làm tên mục
      const noHead = !heads.length && !doneRef.size;
      for (const s of raw) s.section = [...heads].reverse().find((h) => h.y1 < s.y)?.label || (noHead ? service : '');
      // ô không thấy tiêu đề mục (đã cuộn khuất = mục đã xử lý) hoặc thuộc mục bỏ qua -> không đụng tới
      const skip = (flow.skipSections || []).map(norm);
      raw.splice(0, raw.length, ...raw.filter((x) => x.section && !skip.includes(norm(x.section))));
      raw.sort((a, b) => a.y - b.y || a.x - b.x);
      const cnt = {};
      for (const s of raw) { cnt[s.section] = (cnt[s.section] || 0) + 1; s.id = `${s.section}#${cnt[s.section]}`; }
      return raw;
    };
    // chờ ô của sheet tải xong. Camera Only: popup "không có thông tin chính sách" -> bấm Xác nhận trên popup cho ô hiện ra.
    const dismissDialog = async () => {
      const dlg = dialogOf(await adb.dump());
      if (!dlg) return false;
      const b = dlg.buttons['Xác nhận'] || dlg.buttons['Đóng'] || Object.values(dlg.buttons)[0];
      if (!b) return false;
      log(`  Popup "${dlg.message || dlg.title}" → ${first(b) || 'Xác nhận'}`); await tapNode(b); await sleepMs(2500); return true;
    };
    for (const t1 = Date.now(); Date.now() - t1 < 30000;) {
      if (await dismissDialog()) continue;
      if (slotsOf(await adb.dump()).length) break;
      await sleepMs(1000);
    }
    // Camera Only (flow.confirmFirst): danh sách chỉ có dữ liệu sau khi bấm Xác nhận ở cuối form 1 lần -> bấm trước rồi mới chọn
    if (!explore || (flow.confirmFirst || []).some((x) => same(x, service))) {
      if ((flow.confirmFirst || []).some((x) => same(x, service))) {
        const ok0 = find(await adb.dump(), 'Xác nhận', { pred: (n) => n.h < 200 && n.cy > 2000 })[0];
        if (ok0) { log('  Bấm Xác nhận cuối form trước để app nạp danh sách'); await tapNode(ok0); await sleepMs(2500); await dismissDialog(); }
      }
    }
    if (process.env.DBG_SLOTS) log(`  [dbg] số ô nhận được: ${slotsOf(await adb.dump()).length}`);
    // Mục thu gọn cần mở bằng nút + (flow.addSections theo nhóm, vd FPro -> IT Remote)
    if (!explore) {
      const adds = Object.entries(flow.addSections || {}).find(([k]) => same(k, service))?.[1] || [];
      for (const name of adds) {
        let plus = null;
        for (let i = 0; i < 3 && !plus; i++) {
          const ns = await adb.dump();
          const h = ns.find((n) => n.x1 < 60 && n.w > 100 && n.y1 > 400 && !n.clickable && same(n.label, name));
          plus = h && ns.find((n) => n.clickable && n.w >= 55 && n.w <= 110 && n.h >= 55 && n.h <= 95 && n.x1 > 900 && Math.abs(n.cy - h.cy) < 60);
          if (!plus) { await adb.swipe(540, 1700, 540, 1200, 400); await sleepMs(800); }
        }
        if (plus) { log(`  Mở mục "${name}" (nút +)`); await tapNode(plus); await sleepMs(1800); }
        else { log(`  (không thấy nút + của mục "${name}")`); await dbgDump(`plus-${service}`); }
      }
    }
    // Sheet chỉ có mục thu gọn (VIP 247: "Basic", Ultra Fast SA...) -> bấm + của mục đầu để hiện ô
    if (!explore && !slotsOf(await adb.dump()).length) {
      const ns = await adb.dump();
      const skipN = (flow.skipSections || []).map(norm);
      const cands = ns.filter((n) => n.clickable && n.w >= 55 && n.w <= 110 && n.h >= 55 && n.h <= 95 && n.x1 > 900 && n.y1 > 400 && n.y2 < 2100).sort((a, b) => a.y1 - b.y1)
        .map((p) => ({ p, h: ns.find((n) => n.x1 < 60 && n.y1 > 400 && !n.clickable && n.label && Math.abs(n.cy - p.cy) < 60) }))
        .filter(({ h }) => !h || !skipN.includes(norm(h.label)));
      const plus = cands[0]?.p, head = cands[0]?.h;
      if (plus) {
        log(`  Mở mục "${head?.label || '?'}" (nút +)`); await tapNode(plus); await sleepMs(2000);
        for (let t = Date.now(); Date.now() - t < 15000;) { if (slotsOf(await adb.dump()).length) break; await sleepMs(800); }
      }
    }
    if (process.env.DBG_SLOTS && !slotsOf(await adb.dump()).length) await dbgDump(`sheet-${service}`);
    const done = doneRef, out = [], usedPlain = new Set(), matchedPlain = new Set(), missedPlain = new Map();
    for (let guard = 0; guard < 40; guard++) {
      let nodes = await adb.dump();
      let s = slotsOf(nodes).find((x) => !done.has(x.id));
      if (!s) {
        const before = slotsOf(nodes).map((x) => x.id).join('|');
        await adb.swipe(540, 1700, 540, 1000, 500); await sleepMs(1200);
        nodes = await adb.dump();
        s = slotsOf(nodes).find((x) => !done.has(x.id));
        if (!s && slotsOf(nodes).map((x) => x.id).join('|') === before) break;
        if (!s) continue;
      }
      done.add(s.id);
      if (s.kind === 'input') {
        const v = pickValue(sel, 'so luong', s.section) || '1';
        if (!s.node.label) { await adb.tapAt(s.x, s.y); await sleepMs(500); await adb.type(String(v)); await sleepMs(500); await hideKeyboard(); }
        out.push({ section: s.section, title: 'Số lượng', key: 'so luong', kind: 'input', value: s.node.label || String(v) });
        continue;
      }
      let title = '';
      for (let i = 0; i < 3 && !title; i++) {
        await adb.tapAt(s.x, s.y);
        const t1 = Date.now();
        while (Date.now() - t1 < 6000) { const ns = await adb.dump(); const l = isListOpen(ns); if (l) { title = l.label; break; } await sleepMs(600); }
      }
      if (!title) { log(`  (${s.section}) có ô không mở được danh sách — bỏ qua`); continue; }
      const key = fieldKey(title);
      const options = explore ? await readAllOptions() : null;
      if (explore) { for (let i = 0; i < 4; i++) { await adb.swipe(540, 900, 540, 2000, 300); await sleepMs(500); } } // về đầu danh sách
      // giá trị: ưu tiên "mục / ô", sau đó "ô" (áp cho mọi mục có ô đó)
      const want = pickValue(sel, key, s.section);
      const firstUse = !usedPlain.has(key); usedPlain.add(key);
      let chosen = '';
      const pickFirst = async () => {
        const ns = await adb.dump();
        const it = ns.filter((n) => n.w > 800 && n.y1 > 380 && n.h >= 100 && n.label).sort((a, b) => a.y1 - b.y1)[0];
        if (!it) throw new StepError(`Danh sách "${prettyTitle(title)}" (${s.section}) trống trên app.`);
        await tapNode(it); return first(it);
      };
      if (want) {
        try { chosen = await pickFuzzy(want, title); matchedPlain.add(key); }
        catch (e) {
          // Giá trị ghi rõ "mục / ô" mà không có -> lỗi ngay. Giá trị chung theo ô: sheet nhiều mục (Oncall: Voice + Oncall)
          // có thể nằm ở mục sau -> chọn mục đầu ở đây, cuối sheet mới báo lỗi nếu không mục nào có.
          if (explore || pickValue(sel, key, s.section, true)) { if (!explore) throw e; }
          if (firstUse) missedPlain.set(key, e);
          // không vuốt xuống (sheet kéo-lên sẽ bị đóng) -> đóng danh sách, mở lại (về đầu) rồi chọn mục đầu
          await closeList(); await sleepMs(800); await adb.tapAt(s.x, s.y); await sleepMs(1800);
          chosen = await pickFirst();
        }
      } else chosen = await pickFirst();
      await sleepMs(1800);
      if (isListOpen(await adb.dump())) await closeList(); // mục đã chọn sẵn thì danh sách không tự đóng
      out.push({ section: s.section, title: prettyTitle(title), key, kind: 'list', value: chosen, ...(options ? { options } : {}) });
      log(`  ${s.section} › ${prettyTitle(title)}: ${chosen}`);
    }
    for (const [k, e] of missedPlain) if (!matchedPlain.has(k)) throw e; // không mục nào có giá trị cần chọn
    // Mục cần bỏ (vd "Triển khai" app mở sẵn) -> bấm thùng rác của mục đó
    if (!explore) {
      for (let k = 0; k < 6; k++) {
        const ns = await adb.dump();
        const heads = ns.filter((n) => n.x1 < 60 && n.w > 100 && n.w < 1000 && n.y1 > 400 && !n.clickable && n.h >= 35 && n.h < 80 && n.lines.length === 1 && n.cls === 'View' && !/\*\s*$/.test(n.label)).sort((a, b) => a.y1 - b.y1);
        let removed = false;
        for (const name of flow.removeSections || []) {
          // tiêu đề ngắn ("Voice") hẹp hơn 100px -> tìm riêng theo chữ, không lọc độ rộng
          const h = heads.find((x) => same(x.label, name)) || ns.find((n) => n.x1 < 60 && n.y1 > 400 && !n.clickable && n.lines.length === 1 && same(n.label, name));
          if (!h) continue;
          const nextH = heads.find((x) => x.y1 > h.y2);
          const trash = ns.find((n) => n.clickable && n.w >= 55 && n.w <= 95 && n.h >= 55 && n.h <= 95 && n.x1 > 940 && n.y1 > h.y2 - 5 && n.y2 < (nextH?.y1 ?? 2120));
          let tr = trash;
          if (!tr) { // icon thùng rác vẽ trong ImageView của mục (FPro, Oncall) -> bấm góc phải trên khối
            const blk = ns.find((n) => n.cls === 'ImageView' && n.clickable && n.x1 < 60 && n.w > 900 && n.y1 >= h.y2 - 10 && n.y1 < h.y2 + 120);
            if (blk) tr = { cx: blk.x2 - 33, cy: blk.y1 + 47, x1: blk.x2 - 66, y1: blk.y1 + 14, label: '' };
          }
          if (tr) {
            log(`  Bỏ mục "${name}" (thùng rác)`); await tapNode(tr); await sleepMs(1500); removed = true;
            const dlg = dialogOf(await adb.dump()); // app có thể hỏi xác nhận xoá
            const yes = dlg && (dlg.buttons['Đồng ý'] || dlg.buttons['Xác nhận'] || dlg.buttons['Xoá'] || dlg.buttons['Xóa']);
            if (yes) { await tapNode(yes); await sleepMs(1500); }
            break; // vị trí các mục đã đổi -> dump lại rồi xử lý mục tiếp theo
          }
        }
        if (!removed) { if (k === 0 && (flow.removeSections || []).some((nm) => ns.some((n) => same(n.label, nm)))) await dbgDump(`remove-${service}`); break; }
      }
    }
    await shot('sheet-dich-vu');
    if (!explore) {
      const { hit: ok } = await waitFor('Xác nhận', { pred: (n) => n.h < 200, what: 'nút Xác nhận của sheet dịch vụ' });
      await tapNode(ok[0]);
      await sleepMs(2000);
      const nodes = await adb.dump();
      const dlg = dialogOf(nodes);
      if (dlg) throw new StepError(`App báo: ${dlg.title} — ${dlg.message}`);
      if (!find(nodes, 'Chi tiết giỏ hàng').length) {
        const err = nodes.find((n) => n.h < 300 && /vui lòng|chưa chọn|bắt buộc|không/i.test(n.label) && n.y1 > 400);
        if (err) throw new StepError(`App báo: ${err.lines.join(' ')}`);
      }
    }
    return out;
  };
  // Chọn trong danh sách đang mở theo giá trị gần đúng ("3T" -> "Gói 3T (3T+0)")
  const pickFuzzy = async (want, title) => {
    let prev = '';
    const w = norm(want);
    for (let i = 0; i < 12; i++) {
      const nodes = await adb.dump();
      const items = nodes.filter((n) => n.w > 800 && n.y1 > 380 && n.y2 < 2300 && n.h >= 100 && n.label);
      const hit = items.find((n) => same(first(n), want))
        || items.find((n) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(norm(first(n))))
        || items.find((n) => norm(first(n)).replace(/[^a-z0-9]/g, '').includes(w.replace(/[^a-z0-9]/g, '')))
        // tên lấy từ API dài hơn tên trên app ("Gói V.VIP 1" ~ "V.VIP 1") -> mục dài nhất nằm trong giá trị cần chọn
        || items.filter((n) => { const a = norm(first(n)).replace(/[^a-z0-9]/g, ''); return a.length >= 3 && w.replace(/[^a-z0-9]/g, '').includes(a); })
          .sort((a, b) => first(b).length - first(a).length)[0];
      if (hit) { await tapNode(hit); return first(hit); }
      const sig = items.map((n) => n.label).join('|');
      if (sig === prev) break;
      prev = sig;
      await adb.swipe(540, 1900, 540, 900, 450); await sleepMs(1000);
    }
    throw new StepError(`Không thấy "${want}" trong danh sách "${prettyTitle(title)}" trên app.`);
  };

  // Tạo hợp đồng từ màn Chi tiết báo giá: 3 bước tự chạy → Định danh khách hàng → Hoàn tất → Mã hợp đồng.
  const A = { soTang: '1', nhaRieng: 'Nhà riêng', chiaPhong: 'Không', ...(flow.identityAnswers?.text || {}), ...(opts.identity || {}) };
  const contractFailure = (nodes) => {
    const head = nodes.find((n) => /^Đã có lỗi xảy ra/i.test(first(n)));
    if (!head) return null;
    const STEPS = ['Kiểm tra thông tin đơn hàng.', 'Tạo phiếu thông tin khách hàng.', 'Tạo hợp đồng.'];
    const steps = nodes.filter((n) => STEPS.some((t) => same(n.label, t)));
    const desc = nodes.find((n) => n.y1 > head.y2 - 5 && n.y2 < (steps[0]?.y1 ?? 9999) && n.label)?.label || '';
    // chi tiết lỗi nằm ngay dưới tên bước bị lỗi
    let stepName = '', detail = '';
    for (let i = 0; i < steps.length; i++) {
      const lo = steps[i].y2, hi = steps[i + 1]?.y1 ?? 2100;
      const det = nodes.find((n) => n.y1 >= lo - 5 && n.y2 <= hi + 5 && n.label && !steps.includes(n) && n.x1 > 150);
      if (det) { stepName = steps[i].label.replace(/\.$/, ''); detail = det.lines.join(' '); break; }
    }
    return `App báo: ${head.lines.join(' ')} — ${desc}${stepName ? ` | Lỗi ở bước "${stepName}": ${detail}` : ''}`;
  };
  const answer = async (nodes, qIndex, want) => {
    const qs = nodes.filter((n) => /^\d+\.\s/.test(first(n))).sort((a, b) => a.y1 - b.y1);
    const q = qs[qIndex], next = qs[qIndex + 1];
    if (!q) throw new StepError(`Không thấy câu hỏi định danh số ${qIndex + 1}.`);
    const inQ = (n) => n !== q && n.y1 >= q.y1 && (!next || n.y2 <= next.y1 + 5);
    const opt = nodes.find((n) => n.cls === 'RadioButton' && same(first(n), want) && inQ(n)) || nodes.find((n) => same(first(n), want) && inQ(n));
    if (!opt) throw new StepError(`Câu "${q.lines.join(' ')}" không có đáp án "${want}".`);
    await adb.tapAt(opt.x1 + 55, opt.cy); await sleepMs(600);
  };
  const makeContract = async () => {
    log('Tạo hợp đồng…');
    if (!find(await adb.dump(), 'Định danh khách hàng').length) {
      const { hit } = await waitFor('Tạo hợp đồng', { pred: (n) => n.cy > 2000, what: 'nút Tạo hợp đồng' });
      await tapNode(hit[0]);
    }
    const t0 = Date.now();
    let stage = 'run';
    while (Date.now() - t0 < 120000) {
      await sleepMs(1500);
      const nodes = await adb.dump();
      const fail = contractFailure(nodes);
      if (fail) {
        const back = find(nodes, 'Quay lại')[0];
        await shot('loi-hop-dong', true);
        if (back) { await tapNode(back); await sleepMs(1500); }
        throw new StepError(fail);
      }
      if (stage === 'run' && find(nodes, 'Định danh khách hàng').length && find(nodes, 'Hoàn tất').length) {
        log(`Định danh: ${A.soTang} tầng · ${A.nhaRieng} · chia phòng: ${A.chiaPhong}`);
        await answer(nodes, 0, A.soTang);
        await answer(await adb.dump(), 1, A.nhaRieng);
        await answer(await adb.dump(), 2, A.chiaPhong);
        await shot('dinh-danh');
        await tapNode(find(await adb.dump(), 'Hoàn tất')[0]);
        stage = 'done';
        continue;
      }
      const mhd = nodes.find((n) => n.lines.includes('Mã hợp đồng'));
      if (mhd) {
        const v = mhd.lines[mhd.lines.indexOf('Mã hợp đồng') + 1];
        if (v && !/^_/.test(v)) return v;
      }
      const dlg = await dialogOrRetry(nodes);
      if (dlg?.transient) continue;
      if (dlg && (dlg.buttons['Đóng'] || dlg.buttons['OK'] || dlg.buttons['Đồng ý'])) { await tapNode(dlg.buttons['Đóng'] || dlg.buttons['OK'] || dlg.buttons['Đồng ý']); continue; }
      if (dlg && dlg.buttons['Xác nhận']) { log(`Popup "${dlg.title}" → Xác nhận`); await tapNode(dlg.buttons['Xác nhận']); continue; }
      // màn kết quả sau Hoàn tất thường có nút "Đóng"/"Về trang chủ" full-width
      const closeBtn = nodes.find((n) => /^(Đóng|Xem chi tiết|Xem hợp đồng)$/i.test(n.label) && n.cy > 1900);
      if (stage === 'done' && closeBtn) { await tapNode(closeBtn); continue; }
    }
    throw new StepError('Quá 2 phút chưa thấy Mã hợp đồng.');
  };

  if (opts.contractOnly) {
    // Chỉ tạo HĐ cho đơn đang mở ở màn Chi tiết báo giá trên máy
    const nodes = await adb.dump();
    const ma = nodes.find((n) => same(first(n), 'Mã đơn hàng')) || (find(nodes, 'Định danh khách hàng').length ? { lines: ['', opts.orderCode || '?'] } : null);
    if (!ma) throw new Error('Máy không ở màn Chi tiết báo giá (không thấy Mã đơn hàng).');
    try { const c = await makeContract(); log(`✅ Mã hợp đồng: ${c}`); return { orderCode: ma.lines[1], contractCode: c }; }
    catch (e) { const er = new Error(e.message); er.appError = /^App báo:/.test(e.message); er.orderCode = ma.lines[1]; er.shot = await shot('LOI', true); throw er; }
  }

  try {
    let service = d.service || 'Internet', fields = [], cartItems = [];
    if (opts.sheetOnly) { service = d.service; return { fields: await fillServiceSheet(service, serviceSelections(d), { explore: true }) }; }
    if (opts.resume) {
      // Chạy tiếp từ màn Tạo báo giá đang mở trên máy (đã có địa chỉ + giỏ hàng), không mở lại app
      log('Chạy tiếp từ màn Tạo báo giá đang mở…');
      await waitFor('Tạo báo giá', { pred: (n) => n.cy < 260, what: 'màn Tạo báo giá' });
      const ns = await adb.dump();
      const svc = ns.find((n) => n.lines.length === 2 && /đ$/.test(n.lines[1]) && n.cy > 1800 && !/Thông tin đơn hàng|Giá cước/.test(n.lines[0]));
      if (svc) service = svc.lines[0];
      const item = ns.find((n) => n.cls === 'ImageView' && n.lines.length === 2 && /đ$/.test(n.lines[1]));
      if (item) fields = [{ kind: 'list', section: service, value: item.lines[0] }];
      // đọc đủ các dòng giỏ hàng (gói + thiết bị) qua nút "Chi tiết"
      const ct = ns.find((n) => same(n.label, 'Chi tiết') && n.cy > 2000);
      if (ct) {
        await tapNode(ct);
        try {
          await waitFor('Chi tiết', { pred: (n) => n.cy < 260, timeout: 10000 });
          await sleepMs(800);
          const cs = await adb.dump();
          cartItems = cs.filter((n) => n.y1 > 440 && n.y2 < 2150 && n.label && n.w > 900).map((n) => n.lines.filter((l) => !/^SL:/.test(l) && !same(l, service)).join(' ')).filter(Boolean);
          log(`Giỏ hàng: ${cartItems.join(' | ')}`);
        } finally {
          // về lại màn báo giá bằng nút Xác nhận của giỏ (BACK sẽ quay về màn chọn dịch vụ)
          const ok = find(await adb.dump(), 'Xác nhận', { pred: (n) => n.cy > 2000 })[0];
          if (ok) await tapNode(ok); else await adb.key('KEYCODE_BACK');
          await sleepMs(3000);
        }
      }
    } else {
      // 1) Về màn Theo dõi đơn hàng / Trang chủ bằng nút Back (không mở lại app). Không về được mới mở lại app.
      // Màn danh sách: tiêu đề "Theo dõi đơn hàng" ở trên cùng (cy<260). "Chi tiết đơn hàng" cũng có TAB cùng tên (cy~320) + nút Thanh toán đúng chỗ nút + -> loại trừ.
      const onTrack = (ns) => find(ns, 'Theo dõi đơn hàng').some((n) => n.cy < 260) && !find(ns, 'Chi tiết đơn hàng').length && !find(ns, 'Thanh toán').some((n) => n.cy > 2000) && !dialogOf(ns);
      const homeTile = (ns) => { const fav = find(ns, 'Tính năng ưa thích')[0]; return fav ? find(ns, 'Đơn hàng').find((n) => n.cy > fav.cy && n.cy < 2100) : null; };
      let atTrack = false, home = null;
      if (!opts.relaunch) {
        // App bị che (trình duyệt/trình cài đặt...) -> đưa app lên lại, KHÔNG force-stop
        const focus = async () => ((await adb.runText(['shell', 'dumpsys', 'window']).catch(() => '')).match(/mCurrentFocus=.*/) || [''])[0];
        if (!(await focus()).includes(flow.package)) { await adb.launch(flow.pkgActivity).catch(() => {}); await sleepMs(4000); }
        for (let i = 0; i < 8; i++) {
          const ns = await adb.dump().catch(() => []);
          if (onTrack(ns)) { atTrack = true; break; }
          if (homeTile(ns)) { home = ns; break; }
          const ql = find(ns, 'Quay lại', { pred: (n) => n.cy > 2000 })[0];
          if (ql) { await tapNode(ql); await sleepMs(2500); continue; }
          const dlg = dialogOf(ns);
          if (dlg) { // không bao giờ bấm "Cập nhật" (sẽ mở trình duyệt tải APK)
            const safe = Object.entries(dlg.buttons).filter(([k]) => !/cập nhật|update|tải/i.test(k));
            const pick = ['Đóng', 'Không', 'Hủy', 'Để sau', 'Bỏ qua', 'Xác nhận'].map((k) => safe.find(([x]) => x === k)?.[1]).find(Boolean) || safe[0]?.[1];
            if (pick) { await tapNode(pick); await sleepMs(1500); continue; }
          }
          await adb.key('KEYCODE_BACK'); await sleepMs(1800);
        }
      }
      if (atTrack) { await sleepMs(3000); const ns = await adb.dump(); if (!onTrack(ns)) { atTrack = false; if (homeTile(ns)) home = ns; } }
      if (atTrack) log('Back về màn Theo dõi đơn hàng (không mở lại app)');
      else if (home) log('Back về Trang chủ (không mở lại app)');
      else {
        log('Mở app SOP…');
        await relaunch();
        ({ nodes: home } = await retryStep('Trang chủ',
          () => waitFor('Đơn hàng', { timeout: 45000, what: 'Trang chủ tải xong (ô Đơn hàng)', pred: (n) => n.cy > 1300 && n.cy < 2100 }).then(async () => ({ nodes: await adb.dump() })),
          relaunch));
      }
      if (!atTrack) {
      await sleepMs(1200);
      await shot('home');
      const fav = find(home, 'Tính năng ưa thích')[0];
      const tile = find(home, 'Đơn hàng').find((n) => n.cy > (fav?.cy ?? 1300));
      if (!tile) throw new StepError('Không thấy ô "Đơn hàng" trong mục Tính năng ưa thích ở Trang chủ.');
      log('Trang chủ → Đơn hàng');
      // icon nằm ngay trên chữ; app vừa hiện xong đôi khi chưa nhận tap -> thử lại
      {
        let ok = false;
        for (let i = 0; i < 3 && !ok; i++) {
          // Popup "Cập nhật ứng dụng" che icon -> chạm vào chữ "Đơn hàng" bên dưới (không bấm Cập nhật)
          if (i === 0 && !dialogOf(await adb.dump())) await adb.tapAt(tile.cx, tile.y1 - 70); else await adb.tapAt(tile.cx, tile.cy);
          try { await waitFor('Theo dõi đơn hàng', { timeout: 10000 }); ok = true; } catch {
            const dlg = dialogOf(await adb.dump());
            if (dlg && /bảo trì|nâng cấp/i.test(`${dlg.title} ${dlg.message}`)) throw new StepError(`App báo: ${dlg.title} — ${dlg.message}`);
            if (dlg) { const b = dlg.buttons['Xác nhận'] || Object.values(dlg.buttons)[0]; await tapNode(b); await sleepMs(1500); }
          }
        }
        if (!ok) throw new StepError('Nhấn ô "Đơn hàng" 3 lần nhưng không vào được màn Theo dõi đơn hàng.');
      }
      }
      await sleepMs(1500); await shot('theo-doi-don-hang');

      // 2) Nút "+" → xử lý popup → màn Tạo báo giá
      log('Nhấn + tạo đơn mới');
      { const ns0 = await adb.dump(); if (find(ns0, 'Thanh toán').some((n) => n.cy > 2000) || find(ns0, 'Chi tiết đơn hàng').length) throw new StepError('Đang ở màn có nút Thanh toán — không bấm + (tránh thanh toán).'); }
      await tapFab();
      {
        const t0 = Date.now();
        let done = false, taps = 1;
        onTransient = async () => { await sleepMs(1500); await tapFab(); }; // lỗi tạm thời -> bấm + lại
        while (!done && Date.now() - t0 < 90000) {
          await sleepMs(1000);
          const nodes = await adb.dump();
          if (find(nodes, 'Theo dõi đơn hàng').length && !dialogOf(nodes) && Date.now() - t0 > 6000 * taps && taps < 3) { await tapFab(); taps++; continue; }
          if (find(nodes, 'Tạo báo giá').some((n) => n.cy < 260) && find(nodes, 'Thông tin địa chỉ').length) { done = true; break; }
          // KHÔNG BAO GIỜ thanh toán: lỡ chạm vào thẻ đơn mở màn thanh toán -> Back ngay, bấm + lại
          if (find(nodes, 'Thanh toán bằng QR Code').some((n) => n.cy < 300) || find(nodes, 'Thanh toán').some((n) => n.cy < 300)) { log('Lạc vào màn thanh toán → Back (không thanh toán)'); await adb.key('KEYCODE_BACK'); await sleepMs(3000); await tapFab(); continue; }
          if (find(nodes, 'Mua thêm dịch vụ').some((n) => n.cy < 260)) { log('Lạc vào màn "Mua thêm dịch vụ" → back và bấm + lại'); await adb.key('KEYCODE_BACK'); await sleepMs(2500); await tapFab(); continue; }
          const dlg = await dialogOrRetry(nodes);
          if (dlg?.transient) { if (typeof onTransient === 'function') await onTransient(); continue; }
          if (!dlg) continue;
          if (/chưa hoàn thành/i.test(dlg.message) && dlg.buttons['Không']) {
            log('Popup "đơn hàng trước đó chưa hoàn thành" → Không (tạo đơn mới)');
            await shot('popup-don-cu'); await tapNode(dlg.buttons['Không']);
          } else if (dlg.buttons['Xác nhận']) {
            log(`Popup "${dlg.title}" → Xác nhận`);
            await shot('popup-canh-bao'); await tapNode(dlg.buttons['Xác nhận']);
          } else throw new StepError(`App báo: ${dlg.title} — ${dlg.message}`);
        }
        onTransient = null;
        if (!done) throw new StepError('Nhấn + nhưng không vào được màn Tạo báo giá.');
      }
      await sleepMs(1000); await shot('tao-bao-gia');

      // 3) Địa chỉ: kính lúp → tab Nhập địa chỉ
      log(`Địa chỉ: ${d.loaiNha} · ${d.ward} · ${d.street} · số ${d.soNha}`);
      {
        await retryStep('Màn địa chỉ', async () => {
          const { hit } = await waitFor('Thông tin địa chỉ');
          const row = hit[0];
          await adb.tapAt(row.x2 - 50, row.cy);
          const { hit: tab } = await waitFor('Nhập địa chỉ', { timeout: 15000, what: 'tab Nhập địa chỉ' });
          await tapNode(tab[0]);
          await waitFor(/^Loại nhà/, { timeout: 30000, what: 'ô Loại nhà' });
        }, async () => {
          // back về Tạo báo giá (nếu đang ở màn địa chỉ)
          const ns = await adb.dump();
          if (find(ns, 'Nhập địa chỉ').length || find(ns, 'Tìm kiếm').length) { await adb.key('KEYCODE_BACK'); await sleepMs(2000); }
        });
      }
      // Loại nhà
      {
        let f = fieldNode(await adb.dump(), 'Loại nhà');
        if (!same(fieldValue(f), d.loaiNha)) {
          await adb.tapAt(f.cx, f.y2 - 55);
          await waitFor('Loại nhà', { pred: (n) => n.y1 === 0 && n.h > 2000, what: 'danh sách Loại nhà' });
          await pickFromList(d.loaiNha, 'Loại nhà');
          await sleepMs(1200);
          const nodes = await adb.dump();
          if (find(nodes, 'Loại nhà', { pred: (n) => n.y1 === 0 && n.h > 2000 }).length) { await adb.key('KEYCODE_BACK'); await sleepMs(800); }
          f = fieldNode(await adb.dump(), 'Loại nhà');
          if (!same(fieldValue(f), d.loaiNha)) throw new StepError(`Chọn Loại nhà "${d.loaiNha}" không được (đang là "${fieldValue(f)}").`);
        }
      }
      // Xã/Phường + Đường: sheet có ô tìm kiếm
      const searchPick = async (sheetTitle, value) => {
        const { nodes } = await waitFor(sheetTitle, { pred: (n) => n.y1 === 0 && n.h > 2000, what: `danh sách ${sheetTitle}`, timeout: 15000 });
        const box = nodes.find((n) => n.cls === 'EditText');
        if (!box) throw new StepError(`Không thấy ô tìm kiếm trong ${sheetTitle}.`);
        // chờ danh sách tải xong (có mục) trước khi gõ — gõ sớm sẽ ra "Không tìm thấy dữ liệu"
        const t0 = Date.now();
        while (Date.now() - t0 < 15000) {
          const ns = await adb.dump();
          if (ns.some((n) => n.w > 800 && n.y1 > 540 && n.h >= 100 && n.label)) break;
          await sleepMs(700);
        }
        await tapNode(box); await sleepMs(500);
        const q = value.replace(/^(phường|xã|thị trấn)\s+/i, '');
        const plain = norm(q).replace(/\b\w/g, (c) => c.toUpperCase());
        await typeVerified(plain, async () => (await adb.dump()).find((n) => n.cls === 'EditText')?.label ?? null);
        await sleepMs(1500);
        await hideKeyboard();
        const t1 = Date.now();
        while (Date.now() - t1 < 10000) {
          const ns = await adb.dump();
          const items = ns.filter((n) => n.w > 800 && n.y1 > 540 && n.h >= 100 && n.label);
          const hit = items.find((n) => same(first(n), value)) || items.find((n) => norm(first(n)).endsWith(norm(q)));
          if (hit) { await tapNode(hit); return; }
          if (ns.some((n) => /Không tìm thấy dữ liệu/i.test(n.label))) break;
          await sleepMs(800);
        }
        throw new StepError(`App không có "${value}" trong danh sách ${sheetTitle}.`);
      };
      {
        let f = fieldNode(await adb.dump(), 'Xã/Phường');
        if (!same(fieldValue(f), d.ward)) {
          await adb.tapAt(f.cx, f.y2 - 55);
          await searchPick('Xã/Phường', d.ward);
          await sleepMs(2000);
        }
        // App thường tự mở sheet Đường sau khi chọn phường
        let nodes = await adb.dump();
        f = fieldNode(nodes, 'Đường');
        if (!same(fieldValue(f), d.street)) {
          if (!find(nodes, 'Đường', { pred: (n) => n.y1 === 0 && n.h > 2000 }).length) {
            f = fieldNode(await adb.dump(), 'Đường');
            await adb.tapAt(f.cx, f.y2 - 55);
          }
          await searchPick('Đường', d.street);
          await sleepMs(2000);
        }
        nodes = await adb.dump();
        const w = fieldValue(fieldNode(nodes, 'Xã/Phường')), s = fieldValue(fieldNode(nodes, 'Đường'));
        if (!same(w, d.ward) && !norm(w).endsWith(norm(d.ward))) throw new StepError(`Xã/Phường đang là "${w}", không phải "${d.ward}".`);
        if (!same(s, d.street)) throw new StepError(`Đường đang là "${s}", không phải "${d.street}".`);
      }
      // Số nhà (ô nhập ngay dưới ô Đường)
      if (!same(d.loaiNha, 'Nhà không số') && d.soNha) {
        const nodes = await adb.dump();
        const duong = fieldNode(nodes, 'Đường');
        const et = nodes.filter((n) => n.cls === 'EditText' && n.y1 >= duong.y2 - 5).sort((a, b) => a.y1 - b.y1)[0];
        if (!et) throw new StepError('Không thấy ô Số nhà.');
        await adb.tapAt(et.cx, et.y2 - 55); await sleepMs(600);
        await typeVerified(String(d.soNha), async () => {
          const ns = await adb.dump();
          const du = fieldNode(ns, 'Đường');
          return ns.filter((n) => n.cls === 'EditText' && n.y1 >= du.y2 - 5).sort((a, b) => a.y1 - b.y1)[0]?.label ?? null;
        });
        await hideKeyboard();
      }
      await shot('dia-chi');
      await hideKeyboard();
      await adb.tap(...T.addrConfirm);
      let lastConfirm = Date.now();
      // lỗi tạm thời sau khi xác nhận địa chỉ -> vào lại màn địa chỉ (giữ nguyên thông tin) và Xác nhận lại
      onTransient = async () => {
        let ns = await adb.dump();
        if (!find(ns, 'Nhập địa chỉ').length) {
          const row = find(ns, 'Thông tin địa chỉ')[0];
          if (row) { await adb.tapAt(row.x2 - 50, row.cy); await sleepMs(3000); }
          ns = await adb.dump();
          const tab = find(ns, 'Nhập địa chỉ')[0];
          if (tab) { await tapNode(tab); await sleepMs(2500); }
        }
        log('  vào lại màn địa chỉ → Xác nhận');
        await hideKeyboard(); await adb.tap(...T.addrConfirm); await sleepMs(2000);
      };
      {
        const t0 = Date.now();
        let ok = false;
        while (Date.now() - t0 < 60000) {
          await sleepMs(1000);
          const nodes = await adb.dump();
          const addr = nodes.find((n) => n.cy < 700 && norm(n.label).includes(norm(d.street)) && n.lines.length === 1);
          if (find(nodes, 'Nhập địa chỉ').length && !dialogOf(nodes) && Date.now() - lastConfirm > 8000) {
            await hideKeyboard(); await adb.tap(...T.addrConfirm); lastConfirm = Date.now(); continue;
          }
          if (addr && find(nodes, 'Combo tùy chọn').length) {
            log(`Địa chỉ: ${addr.label}`);
            if (d.soNha && !same(d.loaiNha, 'Nhà không số') && !norm(addr.label).startsWith(norm(`${d.soNha} `))) throw new StepError(`Số nhà trên app là "${addr.label.split(' ')[0]}", không phải "${d.soNha}".`);
            ok = true; break;
          }
          const dlg = await dialogOrRetry(nodes);
          if (dlg?.transient) { if (typeof onTransient === 'function') await onTransient(); continue; }
          if (dlg) throw new StepError(`App báo: ${dlg.title} — ${dlg.message}`);
        }
        if (!ok) throw new StepError('Xác nhận địa chỉ nhưng app không quay về màn Tạo báo giá (kiểm tra thông tin bắt buộc).');
        onTransient = null;
      }
      await shot('dia-chi-xong');
      if (opts.stopAt === 'address') return { stopped: 'address' };

      // 4) Nhóm dịch vụ → điền sheet (generic: đọc tên ô = tiêu đề danh sách khi mở dropdown)
      service = d.service || 'Internet';
      const selections = serviceSelections(d);
      // Dịch vụ bắt buộc mua kèm (flow.mobileWith, vd VIP 247 cần Camera) -> thêm vào giỏ trước
      const withSvc = !opts.explore && Object.entries(flow.mobileWith || {}).find(([k]) => same(k, service))?.[1];
      if (withSvc) {
        const wsel = serviceSelections({ service: withSvc, servicePresets: d.servicePresets });
        log(`Mua kèm: ${withSvc} · ${Object.entries(wsel).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'mặc định'}`);
        await retryStep('Sheet dịch vụ mua kèm', () => fillServiceSheet(withSvc, wsel), async () => {
          for (let i = 0; i < 3; i++) {
            const ns = await adb.dump();
            if (find(ns, 'Combo tùy chọn').length && !find(ns, 'Xác nhận', { pred: (n) => n.h < 200 }).length) break;
            await adb.key('KEYCODE_BACK'); await sleepMs(1500);
          }
        });
        await sleepMs(1500);
      }
      log(`Dịch vụ: ${service} · ${Object.entries(selections).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'mặc định'}`);
      fields = await retryStep('Sheet dịch vụ', () => fillServiceSheet(service, selections, { explore: !!opts.explore }), async () => {
        // đóng list/sheet đang mở cho tới khi về màn Tạo báo giá
        for (let i = 0; i < 3; i++) {
          const ns = await adb.dump();
          if (find(ns, 'Combo tùy chọn').length && !find(ns, 'Xác nhận', { pred: (n) => n.h < 200 }).length) break;
          await adb.key('KEYCODE_BACK'); await sleepMs(1500);
        }
      });
      if (opts.explore) {
        // chỉ đọc lựa chọn: đóng sheet, không tạo đơn
        await adb.key('KEYCODE_BACK'); await sleepMs(800);
        return { explored: true, service, fields };
      }
      // 5) Giỏ hàng: kiểm tra đúng dịch vụ/gói
      {
        const { hit } = await waitFor('Chi tiết giỏ hàng', { timeout: 20000 });
        await tapNode(hit[0]);
        await waitFor(service, { timeout: 15000, what: `giỏ hàng có ${service}` });
        await sleepMs(1000);
        const nodes = await adb.dump();
        const items = nodes.filter((n) => n.y1 > 440 && n.y2 < 2150 && n.label && n.w > 900);
        log(`Giỏ hàng: ${items.map((n) => n.lines.join(' ')).join(' | ')}`);
      cartItems = items.map((n) => n.lines.filter((l) => !/^SL:/.test(l)).join(' ')).filter(Boolean);
        const v = fields.filter((f) => f.kind === 'list' && f.section === fields[0]?.section).map((f) => f.value).filter(Boolean);
        if (same(service, 'Internet') && v.length >= 2 && !items.some((n) => same(first(n), `${v[0]} (${v[1]})`))) {
          throw new StepError(`Giỏ hàng không có "${v[0]} (${v[1]})" — app đang hiện: ${items.map((n) => first(n)).join(', ')}`);
        }
        await shot('gio-hang');
        const { hit: ok } = await waitFor('Xác nhận', { pred: (n) => n.cy > 2000 });
        await tapNode(ok[0]);
      }
    }
    // 6) Chờ báo giá có giá (hoặc app báo lỗi chính sách)
    let total = '';
    // Giá 0đ: app tự chọn câu lệnh giá 0đ (vd Ultra Fast SA: UFSA.26050004 0k/1T) -> bấm icon bút ở dòng dịch vụ 0đ,
    // chọn câu lệnh giá đầu tiên khác 0đ trong "Danh sách câu lệnh giá".
    const fixZeroPrice = async () => {
      for (let tries = 0; tries < 3; tries++) {
        let ns = await adb.dump();
        const rows = ns.filter((n) => n.cls === 'ImageView' && n.clickable && n.lines.length >= 2 && /^0\s*đ$/.test(n.lines[1]) && n.y1 > 300 && n.y2 < 1950);
        if (!rows.length) { await adb.swipe(540, 1500, 540, 900, 400); await sleepMs(1200); continue; }
        const r = rows[0];
        log(`  Giá 0đ ở "${r.lines[0]}" → bấm icon sửa để chọn câu lệnh giá khác`);
        await adb.tapAt(r.x2 - 103, r.y1 + 33); await sleepMs(2500);
        for (let k = 0; k < 5; k++) {
          ns = await adb.dump();
          if (!find(ns, 'Danh sách câu lệnh giá').length && k) break;
          const opt = ns.filter((n) => n.clickable && n.lines[1] === 'Chọn' && /đ$/.test(n.lines[0] || '') && !/^0\s*đ$/.test(n.lines[0])).sort((a, b) => a.y1 - b.y1)[0];
          if (opt) {
            const code = ns.find((n) => n.y1 >= opt.y2 - 5 && n.y1 < opt.y2 + 90 && /^Mã chính sách/.test(n.label || ''));
            log(`  Chọn câu lệnh giá ${opt.lines[0]}${code ? ' · ' + code.label.replace(/^Mã chính sách:\s*/, '') : ''}`);
            await adb.tapAt(opt.x2 - 100, opt.cy); await sleepMs(3000); return true;
          }
          await adb.swipe(540, 2000, 540, 1300, 400); await sleepMs(1000); // cuộn trong danh sách (vuốt lên, không đóng sheet)
        }
        log('  (không có câu lệnh giá nào khác 0đ)');
        await adb.key('KEYCODE_BACK'); await sleepMs(1000); return false;
      }
      return false;
    };
    {
      let fixed = false, zeroSince = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 45000) {
        await sleepMs(1200);
        const nodes = await adb.dump();
        const dlg = await dialogOrRetry(nodes);
        if (dlg?.transient) { if (typeof onTransient === 'function') await onTransient(); continue; }
        if (dlg) { await shot('loi-app', true); throw new StepError(`App báo: ${dlg.title} — ${dlg.message}`); }
        const err = nodes.find((n) => /chính sách|không bán|không hợp lệ/i.test(n.label) && n.h < 600);
        if (err) { await shot('loi-app', true); throw new StepError(`App báo: ${err.lines.join(' ')}`); }
        const tt = nodes.find((n) => same(first(n), 'Thông tin đơn hàng'));
        if (tt && tt.lines[1] && !/^0\s*đ$/.test(tt.lines[1]) && find(nodes, 'Cập nhật').length) { total = tt.lines[1]; break; }
        // 0đ ổn định ~8s (app đã tính xong) -> thử chọn câu lệnh giá khác 1 lần
        if (tt && /^0\s*đ$/.test(tt.lines[1] || '') && find(nodes, 'Cập nhật').length) {
          zeroSince = zeroSince || Date.now();
          if (!fixed && Date.now() - zeroSince > 8000) { fixed = true; if (await fixZeroPrice()) zeroSince = 0; else break; }
        } else zeroSince = 0;
      }
      if (!total) { await shot('khong-co-gia', true); throw new StepError('Không lấy được giá báo giá (có thể gói không có chính sách tại địa chỉ này).'); }
      log(`Tổng tiền: ${total}`);
    }
    // 7) Thông tin khách hàng
    log(`Khách hàng: ${d.name} · ${d.phone}`);
    {
      const { hit } = await waitFor('Cập nhật');
      await tapNode(hit[0]);
      await waitFor('Xác nhận & Lưu', { timeout: 15000 });
      const ets = async () => (await adb.dump()).filter((n) => n.cls === 'EditText').sort((a, b) => a.y1 - b.y1);
      let e = await ets();
      if (e.length < 2) throw new StepError('Không thấy ô Họ tên / Số điện thoại.');
      await adb.tapAt(e[0].cx, e[0].y2 - 55); await sleepMs(500);
      await typeVerified(d.name, async () => (await ets())[0]?.label ?? null);
      e = await ets();
      await adb.tapAt(e[1].cx, e[1].y2 - 55); await sleepMs(500);
      await typeVerified(String(d.phone), async () => (await ets())[1]?.label ?? null);
      await hideKeyboard();
      // Nhóm bắt buộc email (Oncall): tìm ô có tiêu đề Email (cuộn xuống nếu khuất) rồi điền
      if ((flow.emailServices || []).some((x) => same(x, service))) {
        const email = d.email || 'qctest@example.com';
        let okE = false;
        for (let i = 0; i < 4 && !okE; i++) {
          const ns = await adb.dump();
          const ets2 = ns.filter((n) => n.cls === 'EditText').sort((a, b) => a.y1 - b.y1);
          const lab = ns.find((n) => n.cls !== 'EditText' && /^e-?mail/i.test(first(n) || ''));
          // ô Email = ô nhập thứ 3 (sau Họ tên, SĐT), chỉ có chữ gợi ý nên không đọc được tiêu đề
          const et = ets2.find((n) => /^e-?mail/i.test(n.label || '') || /@/.test(n.label || '')) || (lab && ets2.filter((n) => n.y2 >= lab.y1).sort((a, b) => Math.abs(a.cy - lab.cy) - Math.abs(b.cy - lab.cy))[0]) || ets2[2];
          if (et) {
            // bàn phím Telex đổi "ex" -> "ẽ": gõ bằng typeName (nhân đôi phím dấu) + kiểm tra lại, sai thì xoá gõ lại
            for (let k = 0; k < 2 && (await adb.dump()).filter((n) => n.cls === 'EditText').sort((a, b) => a.y1 - b.y1).find((n) => Math.abs(n.cy - et.cy) < 30)?.label !== email; k++) {
              await adb.tapAt(et.cx, et.y2 - 55); await sleepMs(500);
              await clearFocused(); await adb.typeName(email); await sleepMs(700);
            }
            await hideKeyboard();
            log(`  Email: ${email}`); okE = true; break;
          }
          if (i === 0) await dbgDump(`khach-hang-${service}`);
          await adb.swipe(540, 1800, 540, 1100, 400); await sleepMs(800);
        }
        if (!okE) log('  (không thấy ô Email trên form khách hàng)');
      }
      await shot('khach-hang');
      const { hit: save1 } = await waitFor('Xác nhận & Lưu');
      await tapNode(save1[0]);
      const t0 = Date.now();
      while (Date.now() - t0 < 20000) {
        await sleepMs(1000);
        const nodes = await adb.dump();
        if (find(nodes, 'Thông tin đơn hàng').length && !find(nodes, 'Xác nhận & Lưu').length) break;
        const dlg = await dialogOrRetry(nodes);
        if (dlg?.transient) { if (typeof onTransient === 'function') await onTransient(); continue; }
        if (dlg) { await shot('loi-app', true); throw new StepError(`App báo: ${dlg.title} — ${dlg.message}`); }
      }
    }
    // 8) Tạo báo giá (+ qua cảnh báo trùng đơn) → đọc mã đơn
    log('Tạo báo giá…');
    let orderCode = '', quotationUrl = '';
    {
      const { hit } = await waitFor('Tạo báo giá', { pred: (n) => n.cy > 2000, what: 'nút Tạo báo giá' });
      await tapNode(hit[0]);
      const t0 = Date.now();
      while (Date.now() - t0 < 60000) {
        await sleepMs(1200);
        const nodes = await adb.dump();
        const ma = nodes.find((n) => same(first(n), 'Mã đơn hàng'));
        if (ma) {
          orderCode = ma.lines[1] || '';
          quotationUrl = nodes.find((n) => /^https?:\/\//.test(n.label))?.label || '';
          break;
        }
        const dlg = await dialogOrRetry(nodes);
        if (dlg?.transient) { if (typeof onTransient === 'function') await onTransient(); continue; }
        if (!dlg) continue;
        if (dlg.buttons['Xác nhận'] && /trùng|cảnh báo/i.test(dlg.title + dlg.message)) {
          log(`Popup "${dlg.title}" → Xác nhận`); await shot('popup-trung-don'); await tapNode(dlg.buttons['Xác nhận']);
        } else { await shot('loi-app', true); throw new StepError(`App báo: ${dlg.title} — ${dlg.message}`); }
      }
      if (!orderCode) throw new StepError('Đã nhấn Tạo báo giá nhưng không thấy màn Chi tiết báo giá / Mã đơn hàng.');
      log(`✅ Mã đơn hàng: ${orderCode}`);
    }

    // 9) Hợp đồng (tuỳ chọn). Lỗi ở bước này KHÔNG làm mất đơn: đơn đã tạo, chỉ ghi contractError.
    let contractCode = '', contractError = '';
    if (opts.contract) {
      try {
        contractCode = await makeContract();
        log(`✅ Mã hợp đồng: ${contractCode}`);
      } catch (e) {
        contractError = e.message;
        log(`❌ Hợp đồng lỗi: ${e.message}`);
        await shot('loi-hop-dong', true);
      }
    }

    const resultShot = await shot('KET-QUA', true);
    const rec = save({
      createdAt: new Date().toISOString(), source: 'mobile', device: adb.serial,
      orderCode, contractCode, contractError, quotationUrl, name: d.name, phone: d.phone,
      totalVAT: Number(String(total).replace(/[^\d]/g, '')) || 0,
      package: `${service}: ${(cartItems.length ? cartItems : fields.filter((f) => f.kind === 'list').map((f) => f.value)).join(' · ')}`, address: `${d.soNha} ${d.street}, ${d.ward}`, loaiNha: d.loaiNha,
      status: 'Tạo từ app Mobile',
    });
    return { ...rec, device: adb.serial, data: d, contract: !!opts.contract, resultShot };
  } catch (e) {
    const p = await shot('LOI', true);
    const err = new Error(e.message);
    err.shot = p; err.appError = /^App báo:/.test(e.message);
    throw err;
  }
}

// Tên ô: tiêu đề danh sách bỏ tiền tố "Chọn"/"Lựa chọn" (vd "Chọn gói tính cước" -> "gói tính cước")
export const fieldKey = (title) => norm(title).replace(/^(lua chon|chon)\s+/, '');
const prettyTitle = (t) => { const s = String(t).replace(/^(Lựa chọn|Chọn)\s+/i, ''); return s.charAt(0).toUpperCase() + s.slice(1); };
// Lấy giá trị user chọn cho 1 ô: khớp theo key (không dấu), hoặc key chứa nhau ("thiet bi" vs "loai thiet bi" ưu tiên khớp đúng)
function pickValue(sel, key, section = '', qualifiedOnly = false) {
  const sec = norm(section);
  for (const [k, v] of Object.entries(sel)) {
    if (!v) continue;
    const m = String(k).split(/\s+\/\s+/);
    if (m.length === 2 && norm(m[0]) === sec && fieldKey(m[1]) === key) return v;
  }
  if (qualifiedOnly) return '';
  const hit = Object.entries(sel).find(([k, v]) => v && !/\s\/\s/.test(String(k)) && fieldKey(k) === key);
  return hit ? hit[1] : '';
}
// Lựa chọn cho sheet dịch vụ: Internet giữ 2 trường cũ; nhóm khác lấy d.fields hoặc preset trong config.
function serviceSelections(d) {
  const svc = d.service || 'Internet';
  if (d.fields && Object.keys(d.fields).length) return d.fields;
  if (same(svc, 'Internet')) return { 'gói dịch vụ': d.goiDichVu, 'gói tính cước': d.goiTinhCuoc };
  return (d.servicePresets && Object.entries(d.servicePresets).find(([k]) => same(k, svc))?.[1]) || {};
}

function clean(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '' && typeof v !== 'function') out[k] = v;
  return out;
}
