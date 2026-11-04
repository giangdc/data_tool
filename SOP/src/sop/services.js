// Các dịch vụ trong "Combo tùy chọn" của màn Tạo báo giá (khảo sát: khao-sat/KHAO_SAT.md, mục "Dịch vụ khác").
// Mỗi dịch vụ mở 1 form riêng, nhưng ô nhập nào cũng có tên (aria-label) trong semantics -> dùng chung 1 bộ điền form,
// không cần toạ độ riêng từng dịch vụ. Xác nhận form = thêm vào giỏ ("Dịch vụ được mua"), rồi Chi tiết giỏ hàng -> Xác nhận -> màn báo giá.
import path from 'node:path';
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

/** Chọn trong sheet đang mở: khớp `want` (tên đầy đủ, hoặc 1 phần), trống = dòng đầu. Trả về nhãn đã chọn, '' nếu sheet rỗng. */
async function pickOption(app, want) {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 10; i++) {
    const list = (await nodes(app)).filter((n) => n.role === 'button' && n.label && n.y > 120 && n.label !== 'Xác nhận');
    const visible = list.filter((n) => n.y < 790);
    const hit = want
      ? visible.find((n) => norm(n.label) === norm(want)) || visible.find((n) => norm(n.label).includes(norm(want)))
      : visible[0];
    if (hit) {
      await app.mouse.click(hit.x, hit.y);
      await sleep(2200);
      return hit.label;
    }
    if (!want || !list.length) return '';
    await app.mouse.move(720, 600);
    await app.mouse.wheel(0, 250);
    await sleep(600);
  }
  return '';
}

/**
 * Điền form dịch vụ: lần lượt mọi ô còn trống (ô Số lượng gõ 1, còn lại mở sheet chọn).
 * prefs: { 'Gói dịch vụ': 'Max', 'Gói tính cước': '6T', ... } – không có thì lấy dòng đầu.
 * Ô đã điền đổi nhãn thành chính giá trị (value luôn rỗng), ô Số lượng đã điền biến khỏi danh sách
 * -> ô còn trống = ô có nhãn chưa từng chọn, chưa thử ở vị trí đó. Trả về các lựa chọn { tên ô: giá trị }.
 */
async function fillForm(app, prefs) {
  const chosen = {};
  const picked = new Set();
  const tried = new Set();
  const key = (f) => `${f.name}@${Math.round(f.y / 10)}`;
  for (let i = 0; i < 40; i++) {
    const pending = (list) => list.find((x) => x.name && !tried.has(key(x)) && !picked.has(x.name) && !/^SL:/.test(x.name));
    let f = pending(await formFields(app));
    if (!f) {
      // Sheet vừa đóng, cây semantics có lúc chưa kịp có ô: đọc lại 1 lần cho chắc
      await sleep(1500);
      f = pending(await formFields(app));
    }
    if (!f) return chosen;
    // Ô khuất sau nút Xác nhận / tiêu đề form -> cuộn form
    if (f.y > BOTTOM || f.y < 150) {
      await app.mouse.move(720, 400);
      await app.mouse.wheel(0, f.y - 350);
      await sleep(900);
      const again = (await formFields(app)).find((x) => x.name === f.name);
      if (!again || again.y > BOTTOM || again.y < 150) { tried.add(key(f)); continue; }
      Object.assign(f, again);
    }
    tried.add(key(f)); // mỗi ô điền 1 lần (không điền được thì để portal báo khi Xác nhận)
    if (/số lượng/i.test(f.name)) {
      const qty = String((!chosen[f.name] && prefs[f.name]) || 1);
      await app.mouse.click(f.x - 40, f.y);
      await sleep(1800);
      await app.keyboard.press('Control+A');
      await app.keyboard.type(qty, { delay: 80 });
      await sleep(800);
      chosen[f.name] = qty;
      continue;
    }
    await app.mouse.click(f.x, f.y);
    await sleep(2300);
    // Ô trùng tên ở mục sau (Thiết bị, Extra…) có danh sách khác -> lựa chọn của người dùng chỉ áp cho ô đầu tiên
    const label = await pickOption(app, chosen[f.name] ? '' : prefs[f.name]);
    if (label) {
      chosen[f.name] ??= label;
      picked.add(label);
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
  const prefs = input.fields || {};
  onLog(`Mở dịch vụ ${service.name}`);
  await openForm(app, service, codes, shot);
  for (const title of service.sections || []) await expandSection(app, title);
  // Form chưa có ô nào = các mục đều thu gọn -> mở mục đầu tiên
  if (!(await formFields(app)).length) {
    const plus = (await plainButtons(app)).find((b) => b.x > 950 && b.y > 150 && b.y < 700);
    if (plus) await app.mouse.click(plus.x, plus.y);
    await sleep(2000);
  }
  const chosen = await fillForm(app, prefs);
  if (service.unnamed) {
    const f = (await formFields(app)).filter((x) => !x.name).at(-1); // ô Số lượng đã điền cũng mất tên -> lấy ô cuối
    if (f) {
      await app.mouse.click(f.x, f.y);
      await sleep(2300);
      const label = await pickOption(app, service.unnamed);
      if (label) chosen[service.unnamed] = label;
    }
  }
  await failOnDialog(app, service.name, codes, shot, 'chọn gói');
  onLog(`Đã chọn: ${Object.values(chosen).join(' · ') || '(không có ô nào)'}`);
  await shot(app, 'form-dich-vu');
  for (let i = 0; i < 3; i++) {
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
  app.off('response', onResponse);
  return options;
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
  await sleep(3000);
  await failOnDialog(app, 'Giỏ hàng', codes, shot, 'xác nhận giỏ');
}
