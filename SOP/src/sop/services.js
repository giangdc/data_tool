// Các dịch vụ trong "Combo tùy chọn" của màn Tạo báo giá (khảo sát: khao-sat/KHAO_SAT.md, mục "Dịch vụ khác").
// Mỗi dịch vụ mở 1 form riêng, nhưng ô nhập nào cũng có tên (aria-label) trong semantics -> dùng chung 1 bộ điền form,
// không cần toạ độ riêng từng dịch vụ. Xác nhận form = thêm vào giỏ ("Dịch vụ được mua"), rồi Chi tiết giỏ hàng -> Xác nhận -> màn báo giá.
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { sleep, nodes, formFields, plainButtons, waitNode } from './flutter.js';

/** group: nhóm trên thanh menu; unnamed: giá trị chọn cho ô không có tên (vd Hình thức nạp code); sections: mục phải bấm + mới hiện ô;
 *  note/detail: đang vướng gì trên stag (khảo sát 30/10/2026) – vẫn cho chọn, stag cấu hình xong là chạy. */
export const SERVICES = [
  { id: 'fpt-play', name: 'FPT Play', group: 'Truyền hình' },
  { id: 'fpt-play-sa', name: 'FPT Play Stand Alone', group: 'Truyền hình', unnamed: 'Gửi SMS' },
  { id: 'fpt-play-sme', name: 'FPT Play SME', group: 'Truyền hình', note: 'không mở form', detail: 'Bấm ô dịch vụ trên stag không có phản hồi (không form, không cảnh báo) – chưa tạo được đơn.' },
  { id: 'fpt-camera', name: 'FPT Camera', group: 'Camera' },
  { id: 'fpt-camera-only', name: 'FPT Camera Only', group: 'Camera', sections: ['Cloud'], note: 'stag thiếu chính sách', detail: 'Portal báo "Hiện tại không có thông tin chính sách dịch vụ" – dữ liệu stag chưa cấu hình, tool sẽ dừng ở bước mở dịch vụ.' },
  { id: 'fpt-camera-b2b', name: 'FPT Camera B2B', group: 'Camera', note: 'thiếu bước', detail: 'Form yêu cầu thêm "Chọn thiết bị triển khai" – tool chưa làm bước này, sẽ dừng ở bước xác nhận gói.' },
  { id: 'ultra-fast', name: 'Ultra Fast', group: 'Tốc độ & Wi-Fi', sections: ['Basic'], note: 'stag thiếu chính sách', detail: 'Portal báo "Hiện tại không có thông tin chính sách dịch vụ" – dữ liệu stag chưa cấu hình, tool sẽ dừng ở bước mở dịch vụ.' },
  { id: 'ultra-fast-sa', name: 'Ultra Fast Stand Alone', group: 'Tốc độ & Wi-Fi', sections: ['Basic Ultra Fast Stand Alone'] },
  { id: 'hyperfast', name: 'HyperFast', group: 'Tốc độ & Wi-Fi', note: 'không mở form', detail: 'Bấm ô dịch vụ trên stag không có phản hồi (không form, không cảnh báo) – chưa tạo được đơn.' },
  { id: 'ai-wifi', name: 'FPT AI Wi-Fi', group: 'Tốc độ & Wi-Fi', note: 'stag thiếu chính sách', detail: 'Portal báo "Hiện tại không có thông tin chính sách dịch vụ" – dữ liệu stag chưa cấu hình, tool sẽ dừng ở bước mở dịch vụ.' },
  { id: 'pay-wifi', name: 'Pay Wifi', group: 'Tốc độ & Wi-Fi', sections: ['Basic'], note: 'không mở form', detail: 'Bấm ô dịch vụ trên stag không có phản hồi (không form, không cảnh báo) – chưa tạo được đơn.' },
  { id: 'oncall', name: 'Tổng đài Oncall', group: 'Dịch vụ khác', sections: ['Oncall'], note: 'stag thiếu chính sách', detail: 'Portal báo "Hiện tại không có thông tin chính sách dịch vụ" – dữ liệu stag chưa cấu hình, tool sẽ dừng ở bước mở dịch vụ.' },
  { id: 'fpro', name: 'FPro', group: 'Dịch vụ khác', sections: ['IT Outsource'] },
  { id: 'fsafe-go', name: 'FSafe Go', group: 'Dịch vụ khác', sections: ['Basic'], note: 'stag thiếu chính sách', detail: 'Portal báo "Hiện tại không có thông tin chính sách dịch vụ" – dữ liệu stag chưa cấu hình, tool sẽ dừng ở bước mở dịch vụ.' },
  { id: 'vioedu-sa', name: 'VioEdu Stand Alone', group: 'Dịch vụ khác', needsInternet: true },
  { id: 'vip-247', name: 'VIP 247', group: 'Dịch vụ khác', sections: ['Basic'], needsInternet: true },
  { id: 'sim-data', name: 'SIM data', group: 'Dịch vụ khác', sections: ['Gói data'], note: 'stag thiếu chính sách', detail: 'Portal báo "Hiện tại không có thông tin chính sách dịch vụ" – dữ liệu stag chưa cấu hình, tool sẽ dừng ở bước mở dịch vụ.' },
  { id: 'smart-home', name: 'FPT Smart Home', group: 'Dịch vụ khác', sections: ['Thiết bị'], note: 'stag thiếu chính sách', detail: 'Portal báo "Hiện tại không có thông tin chính sách dịch vụ" – dữ liệu stag chưa cấu hình, tool sẽ dừng ở bước mở dịch vụ.' },
  { id: 'retail', name: 'Sản phẩm khác', group: 'Dịch vụ khác' },
];

export const findService = (id) => SERVICES.find((s) => s.id === id);

const BOTTOM = 700; // dưới mức này bị nút Xác nhận che

const dialogOk = (list) => list.find((n) => n.role === 'button' && /^Xác nhận$/.test(n.label) && n.y < 640); // hộp cảnh báo (nút giữa màn)
const inCart = (list) => list.some((n) => /^Chi tiết giỏ hàng$/.test(n.label)); // form đã đóng, giỏ có hàng

/** Cuộn màn Tạo báo giá tới ô dịch vụ rồi bấm. */
async function openTile(app, name) {
  await app.mouse.move(720, 500);
  await app.mouse.wheel(0, -4000);
  await sleep(800);
  for (let i = 0; i < 20; i++) {
    const n = (await nodes(app)).find((m) => m.label === name);
    // Hàng cuối chỉ cuộn được tới sát mép dưới, ô bị cắt bớt: h nhỏ hơn nhưng vẫn bấm được
    if (n && n.y > 60 && n.y < 760 && n.h >= 30) {
      await sleep(1000); // chờ hết quán tính cuộn rồi đọc lại vị trí
      const m = (await nodes(app)).find((x) => x.label === name) || n;
      await app.mouse.click(m.x, m.y);
      return;
    }
    await app.mouse.wheel(0, 120);
    await sleep(500);
  }
  throw new Error(`Không thấy dịch vụ "${name}" trong Combo tùy chọn (tài khoản không có quyền bán?)`);
}

/** Hộp cảnh báo đang mở -> đóng lại, báo lỗi kèm ảnh (chữ cảnh báo không có trong semantics). */
async function failOnDialog(app, name, codes, shot, what) {
  const ok = dialogOk(await nodes(app));
  if (!ok) return;
  const file = path.basename(await shot(app, 'loi-dich-vu'));
  await app.mouse.click(ok.x, ok.y);
  await sleep(1500);
  const why = codes?.lastMessage();
  throw new Error(`${name}: portal cảnh báo khi ${what}${why ? `: ${why}` : ''} – xem ảnh ${file}`);
}

/** Bấm nút + của mục (nút không nhãn cùng hàng với tiêu đề mục). */
async function expandSection(app, title) {
  await formFields(app); // cập nhật cây semantics của form vừa mở
  const head = (await nodes(app)).find((n) => n.label === title);
  if (!head) return false;
  const plus = (await plainButtons(app)).find((b) => Math.abs(b.y - head.y) < 14 && b.x > 950);
  if (!plus) return false;
  await app.mouse.click(plus.x, plus.y);
  await sleep(2000);
  return true;
}

/** Cuộn form dịch vụ (hộp thoại giữa màn) lên đầu / xuống 1 đoạn. */
async function scrollForm(app, dy) {
  await app.mouse.move(720, 400);
  await app.mouse.wheel(0, dy);
  await sleep(900);
}

// Nút cột phải của form: + ở tiêu đề mục (~40x25, x≈998); thùng rác nhỏ hơn (~25x25). Chữ tiêu đề mục KHÔNG có trong semantics.
const isHead = (b) => b.x > 960 && b.w >= 34 && b.h <= 30;

/** Các mục của form theo thứ tự (kể cả phần khuất): [{ i, x, y, empty }]; empty = không có ô nào tới mục sau = mục thu gọn (Extra, Box 2…). */
async function formSections(app) {
  const fields = await formFields(app);
  const heads = (await plainButtons(app)).filter(isHead).sort((a, b) => a.y - b.y);
  return heads.map((h, k) => {
    const next = heads[k + 1]?.y ?? Infinity;
    return { i: k + 1, x: h.x, y: h.y, empty: !fields.some((f) => f.y > h.y && f.y < next) };
  });
}
const sectionNo = (heads, y) => heads.filter((h) => h.y < y).length; // 0 = trước nút mục đầu tiên

/** Bấm + mở các mục thu gọn số `want` (all = mở hết, dùng khi đọc form). Trả về số các mục đã mở. */
async function openSections(app, want = [], all = false) {
  const opened = [];
  await scrollForm(app, -5000);
  for (let k = 0; k < 8; k++) {
    const target = (await formSections(app)).find((x) => x.empty && !opened.includes(x.i) && (all || want.includes(x.i)));
    if (!target) break;
    opened.push(target.i);
    let t = target;
    if (t.y > BOTTOM || t.y < 150) {
      await scrollForm(app, t.y - 400);
      t = (await formSections(app)).find((x) => x.i === target.i) || t;
    }
    await app.mouse.click(t.x, t.y);
    await sleep(2000);
  }
  await scrollForm(app, -5000);
  return opened;
}

/** Tên mục đoán theo ô bên trong (portal không cho đọc chữ tiêu đề). */
const sectionTitle = (names, i, serviceName, collapsed) =>
  names.includes('Loại thiết bị') ? (collapsed ? 'Thiết bị thêm' : 'Thiết bị')
  : names.includes('Đơn vị triển khai') ? 'Triển khai'
  : collapsed ? 'Gói thêm (Extra)'
  : i <= 1 ? serviceName : `Mục ${i}`;

// Dòng lựa chọn của sheet đang mở (form dịch vụ chỉ có 1 nút có nhãn là "Xác nhận" -> có nút nhãn khác = sheet đang mở)
const sheetOpts = (list) => list.filter((n) => n.role === 'button' && n.label && n.y > 120 && n.label !== 'Xác nhận');

/** Chờ sheet mở (open = true) / đóng (false) thay vì chờ cố định; trả về true nếu đạt trong timeout. */
async function waitSheet(app, open, timeout = 4000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(150)) {
    if ((sheetOpts(await nodes(app)).length > 0) === open) return true;
  }
  return false;
}

/** Bấm ô Số lượng rồi chờ có ô nhập thật (Flutter chỉ tạo <input> khi focus). */
async function focusInput(app, x, y, timeout = 3000) {
  await app.mouse.click(x, y);
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(150)) {
    if (await app.evaluate(() => /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '')).catch(() => false)) return;
  }
}

/** Đọc hết lựa chọn trong sheet đang mở (cuộn xuống tới khi không thêm dòng mới), rồi cuộn về đầu. */
async function readSheetOptions(app) {
  const seen = [];
  for (let i = 0; i < 12; i++) {
    const list = (await nodes(app)).filter((n) => n.role === 'button' && n.label && n.y > 120 && n.y < 790 && n.label !== 'Xác nhận');
    let added = 0;
    for (const n of list) if (!seen.includes(n.label)) { seen.push(n.label); added++; }
    if (!added && i > 0) break;
    await app.mouse.move(720, 600);
    await app.mouse.wheel(0, 300);
    await sleep(350);
  }
  await app.mouse.move(720, 600);
  await app.mouse.wheel(0, -5000);
  await sleep(400);
  return seen;
}

/** Chọn trong sheet đang mở: khớp `want` (tên đầy đủ, hoặc 1 phần), trống = dòng đầu. Trả về nhãn đã chọn, '' nếu sheet rỗng. */
async function pickOption(app, want) {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 10; i++) {
    const list = sheetOpts(await nodes(app));
    const visible = list.filter((n) => n.y < 790);
    const hit = want
      ? visible.find((n) => norm(n.label) === norm(want)) || visible.find((n) => norm(n.label).includes(norm(want)))
      : visible[0];
    if (hit) {
      await app.mouse.click(hit.x, hit.y);
      await waitSheet(app, false, 5000);
      await sleep(300);
      return hit.label;
    }
    if (!want || !list.length) return '';
    await app.mouse.move(720, 600);
    await app.mouse.wheel(0, 250);
    await sleep(400);
  }
  return '';
}

/**
 * Điền form dịch vụ theo thứ tự trên màn hình (ô Số lượng gõ số, còn lại mở sheet chọn).
 * prefs: { '1.Gói dịch vụ': 'An Tâm 7', '1.Gói tính cước': 'Gói 3T (3T+0)', '2.Thiết bị': 'FCAM-Play 4', '2.Số lượng': 1, … }
 *   – khoá = "<số mục>.<tên ô>" (mục đếm theo nút + bên phải, kể cả mục thu gọn chưa mở; trùng tên trong 1 mục thêm "#2");
 *     khoá chỉ có tên ô (kiểu cũ) = ô đầu tiên có tên đó. Không có = dòng đầu (ô portal đã điền sẵn thì giữ nguyên).
 * Ô đã điền đổi nhãn thành chính giá trị -> nhớ tên thật theo id semantics (id giữ nguyên khi đổi giá trị) lúc ô còn trống.
 * survey: mảng nhận mô tả từng ô { key, name, section, qty | options, value } (đọc form cho giao diện).
 * onlyEmpty: chỉ điền ô còn trống (lượt điền bù khi Xác nhận chưa qua). Trả về { khoá: giá trị đã chọn }.
 */
async function fillForm(app, prefs, { survey = null, state = { real: new Map() }, onlyEmpty = false } = {}) {
  const chosen = {};
  const tried = new Set();
  const occ = new Map();
  const { real } = state;
  const read = async () => {
    const list = await formFields(app);
    for (const f of list) if (f.id && !real.has(f.id) && f.name && !/^SL:/.test(f.name)) real.set(f.id, f.name);
    return list;
  };
  const pending = (list) => list.find((x) => real.has(x.id) && !tried.has(x.id) && x.name && !/^SL:/.test(x.name)
    && (!onlyEmpty || x.name === real.get(x.id)));
  for (let i = 0; i < 50; i++) {
    let f = pending(await read());
    // Sheet vừa đóng / chọn gói xong form tải lại (vd FPT Play đổi gói -> ô Số lượng, Thiết bị Box hiện lại sau): đọc lại vài lần cho chắc
    for (let k = 0; !f && k < 2; k++) {
      await sleep(1000);
      f = pending(await read());
    }
    if (!f) return chosen;
    tried.add(f.id); // mỗi ô điền 1 lần (không điền được thì để portal báo khi Xác nhận)
    const name = real.get(f.id);
    const section = sectionNo((await plainButtons(app)).filter(isHead), f.y);
    const first = !occ.has(name);
    const n = (occ.get(`${section}.${name}`) || 0) + 1;
    occ.set(name, true);
    occ.set(`${section}.${name}`, n);
    const k = `${section}.${name}${n > 1 ? '#' + n : ''}`;
    const raw = prefs[k] ?? (first ? prefs[name] : undefined);
    const want = raw != null && raw !== '' ? String(raw) : '';
    const filled = f.name !== name; // portal đã điền sẵn (vd Tình trạng = Mới)
    // Không chọn gì + portal đã điền sẵn -> giữ nguyên
    if (!survey && !want && filled) continue;
    // Ô khuất sau nút Xác nhận / tiêu đề form -> cuộn form
    if (f.y > BOTTOM || f.y < 150) {
      await scrollForm(app, f.y - 350);
      const again = (await read()).find((x) => x.id === f.id);
      if (!again || again.y > BOTTOM || again.y < 150) continue;
      Object.assign(f, again);
    }
    if (/số lượng/i.test(name)) {
      const qty = want || '1';
      survey?.push({ key: k, name, section, qty: true });
      await focusInput(app, f.x - 40, f.y);
      await sleep(200);
      await app.keyboard.press('Control+A');
      await app.keyboard.type(qty, { delay: 40 });
      await sleep(500);
      chosen[k] = qty;
      continue;
    }
    await app.mouse.click(f.x, f.y);
    // Chờ sheet hiện dòng lựa chọn (sheet tải danh sách qua API) – sheet rỗng thì hết giờ rồi đóng như cũ
    if (await waitSheet(app, true)) await sleep(400);
    if (survey) survey.push({ key: k, name, section, options: await readSheetOptions(app), ...(filled ? { value: f.name } : {}) });
    const label = await pickOption(app, want || (filled ? f.name : ''));
    if (label) {
      chosen[k] = label;
    } else {
      // Sheet rỗng (không có lựa chọn) -> đóng, bỏ qua ô này
      const close = (await plainButtons(app)).find((b) => b.x < 460 && b.w < 40);
      if (close) await app.mouse.click(close.x, close.y);
      await sleep(1200);
    }
  }
  return chosen;
}

/** Chờ form dịch vụ mở: stag có lúc > 15s; bấm hụt thì bấm lại ô dịch vụ (ô không tìm lại được = form đang mở dần, chờ tiếp). */
async function openForm(app, service, codes, shot) {
  for (let i = 0; i < 2; i++) {
    if (i === 0) await openTile(app, service.name);
    else await openTile(app, service.name).catch(() => {});
    for (const end = Date.now() + 25000; Date.now() < end; await sleep(800)) {
      await failOnDialog(app, service.name, codes, shot, 'mở dịch vụ');
      if ((await formFields(app)).length || (await nodes(app)).some((n) => /^Xác nhận$/.test(n.label))) return;
    }
  }
  const file = path.basename(await shot(app, 'khong-mo-form'));
  throw new Error(`${service.name}: bấm ô dịch vụ không mở được form – xem ảnh ${file}`);
}

/**
 * Thêm 1 dịch vụ vào giỏ: bấm ô dịch vụ -> điền form -> Xác nhận.
 * input: { fields: { tên ô: giá trị muốn chọn } }. Trả về { name, chosen }.
 */
export async function addService(app, service, input, codes, shot, onLog) {
  const { __open: open = [], ...prefs } = input.fields || {};
  const state = { real: new Map() };
  onLog(`Mở dịch vụ ${service.name}`);
  await openForm(app, service, codes, shot);
  for (const title of service.sections || []) await expandSection(app, title);
  if (open.length) {
    onLog(`Mở thêm mục số: ${open.join(', ')}`);
    await openSections(app, open.map(Number));
  }
  // Form chưa có ô nào = các mục đều thu gọn -> mở mục đầu tiên
  if (!(await formFields(app)).length) {
    const plus = (await plainButtons(app)).find((b) => b.x > 950 && b.y > 150 && b.y < 700);
    if (plus) await app.mouse.click(plus.x, plus.y);
    await sleep(2000);
  }
  const chosen = await fillForm(app, prefs, { state });
  if (service.unnamed) {
    const f = (await formFields(app)).filter((x) => !x.name).at(-1); // ô Số lượng đã điền cũng mất tên -> lấy ô cuối
    if (f) {
      await app.mouse.click(f.x, f.y);
      if (await waitSheet(app, true)) await sleep(400);
      const label = await pickOption(app, service.unnamed);
      if (label) chosen[service.unnamed] = label;
    }
  }
  await failOnDialog(app, service.name, codes, shot, 'chọn gói');
  onLog(`Đã chọn: ${Object.values(chosen).join(' · ') || '(không có ô nào)'}`);
  await shot(app, 'form-dich-vu');
  for (let i = 0; i < 3; i++) {
    if (i > 0) {
      // Bấm Xác nhận mà form chưa đóng = còn ô trống (portal tô đỏ) -> điền tiếp các ô còn trống (lựa chọn dòng đầu) rồi bấm lại
      const more = await fillForm(app, {}, { state, onlyEmpty: true });
      for (const [k, v] of Object.entries(more)) chosen[k] ??= v;
      if (Object.keys(more).length) onLog(`Điền thêm: ${Object.values(more).join(' · ')}`);
    }
    const ok = (await nodes(app)).find((n) => n.role === 'button' && /^Xác nhận$/.test(n.label));
    if (ok) await app.mouse.click(ok.x, ok.y);
    await sleep(4000);
    const list = await nodes(app);
    if (inCart(list)) return { name: service.name, chosen };
    await failOnDialog(app, service.name, codes, shot, 'xác nhận gói');
  }
  throw new Error(`${service.name}: form chưa xác nhận được (còn ô chưa chọn?) – xem ảnh trong output/debug`);
}

/** Gom dòng gói trong các response [{ SubServiceName, PrePaid: [{ Value }] }] của form dịch vụ. */
export function parseServiceOptions(json) {
  const list = json?.Data?.Result;
  if (!Array.isArray(list)) return [];
  return list.filter((p) => p?.SubServiceName && Array.isArray(p.PrePaid) && p.PrePaid.length).map((p) => ({
    section: p.SubServiceTypeName || '', name: p.SubServiceName, terms: p.PrePaid.map((t) => t.Value),
  }));
}

/** Mở form dịch vụ để đọc danh sách gói từ API rồi đóng form, không thêm vào giỏ. */
export async function readServiceOptions(app, service, codes, shot, onLog) {
  const options = [];
  const onResponse = async (r) => {
    if (!r.url().includes('sapi.fpt.vn')) return;
    for (const o of parseServiceOptions(await r.json().catch(() => null))) {
      if (!options.some((x) => x.section === o.section && x.name === o.name)) options.push(o);
    }
  };
  app.on('response', onResponse);
  onLog(`Mở dịch vụ ${service.name}`);
  await openForm(app, service, codes, shot);
  for (const title of service.sections || []) await expandSection(app, title);
  {
    // Ghi cây semantics của form (nhãn + nút không nhãn + ô nhập) để chỉnh bộ đọc form khi portal đổi bố cục
    const file = await shot(app, 'form-goc');
    writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify({ nodes: await nodes(app), buttons: await plainButtons(app), fields: await formFields(app) }, null, 1));
  }
  onLog('Đọc các mục của form (mở hết mục thu gọn)');
  const state = { real: new Map() };
  await formFields(app).then((list) => list.forEach((f) => f.id && f.name && state.real.set(f.id, f.name)));
  const opened = await openSections(app, [], true);
  onLog('Đọc từng ô + danh sách lựa chọn (chọn dòng đầu để hiện ô phụ thuộc)');
  const fields = [];
  await fillForm(app, {}, { survey: fields, state });
  app.off('response', onResponse);
  await shot(app, 'doc-form');
  const count = Math.max(0, ...fields.map((f) => f.section), ...opened);
  const sections = Array.from({ length: count + 1 }, (_, i) => {
    const names = fields.filter((f) => f.section === i).map((f) => f.name);
    // Tên mục thật lấy từ API gói (SubServiceTypeName: Cloud, Extra, Triển khai CMR Combo…) qua ô Gói dịch vụ của mục
    const pkgs = fields.find((f) => f.section === i && f.name === 'Gói dịch vụ')?.options || [];
    const api = options.find((o) => pkgs.includes(o.name))?.section;
    return { i, title: api || sectionTitle(names, i, service.name, opened.includes(i)), collapsed: opened.includes(i) };
  }).filter((x) => x.collapsed || fields.some((f) => f.section === x.i));
  onLog(`✔ Form ${service.name}: ${fields.length} ô, ${opened.length} mục thu gọn`);
  return { options, form: { fields, sections } };
}

/** Từ màn Tạo báo giá có giỏ hàng -> Chi tiết giỏ hàng -> Xác nhận -> màn báo giá. */
export async function openCart(app, codes, shot, onLog) {
  onLog('Mở chi tiết giỏ hàng');
  const cart = await waitNode(app, /^Chi tiết giỏ hàng$/, 8000);
  await app.mouse.click(cart ? cart.x : 1072, cart ? cart.y : 766);
  const detail = await waitNode(app, /^Xác nhận$/, 15000);
  if (!detail) {
    const file = path.basename(await shot(app, 'gio-hang-loi'));
    throw new Error(`Không mở được Chi tiết giỏ hàng – xem ảnh ${file}`);
  }
  await shot(app, 'gio-hang');
  await app.mouse.click(detail.x, detail.y);
  // Màn báo giá tính chính sách giá sau khi vào (vd "Không tìm được chính sách phù hợp…") -> chờ thấy ô Đối tượng KH hoặc cảnh báo
  let asked = 0;
  for (const end = Date.now() + 30000; Date.now() < end; await sleep(1000)) {
    // Hộp hỏi [Hủy | Xác nhận] (vd "Chính sách giá hiện tại đã không còn phù hợp. Bạn có muốn tìm chính sách giá mới nhất?") -> Xác nhận, đi tiếp
    const list = await nodes(app);
    const ok = dialogOk(list);
    if (ok && asked < 3 && list.some((n) => n.role === 'button' && /^Hủy$/.test(n.label) && Math.abs(n.y - ok.y) < 20)) {
      asked++;
      onLog(`Portal hỏi: ${codes?.lastMessage() || '(hộp Hủy / Xác nhận)'} → Xác nhận`);
      await app.mouse.click(ok.x, ok.y);
      await sleep(3000);
      continue;
    }
    await failOnDialog(app, 'Giỏ hàng', codes, shot, 'xác nhận giỏ (thường do gói chưa có chính sách giá trên stag – chọn gói khác)');
    if ((await nodes(app)).some((n) => /^Đối tượng khách hàng$/.test(n.label))) {
      await sleep(1500);
      await failOnDialog(app, 'Giỏ hàng', codes, shot, 'xác nhận giỏ (thường do gói chưa có chính sách giá trên stag – chọn gói khác)');
      return;
    }
  }
}
