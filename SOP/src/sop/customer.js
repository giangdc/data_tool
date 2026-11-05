// Đối tượng khách hàng + thông tin KH trên màn Tạo báo giá (Sale Platform – Flutter).
// Khảo sát: khao-sat/KHAO_SAT.md (mục "Đối tượng khách hàng"), danh sách từ API order-info/get-sale-range-info.
//  - Ô "Đối tượng khách hàng" mở hộp thoại 2 cấp: nhóm (Tổ chức/Hộ kinh doanh, Cá nhân) -> loại (radio).
//    Bấm tên nhóm = chọn LOẠI ĐẦU của nhóm rồi đóng hộp; mở lại thì nhóm đang chọn được bung sẵn -> bấm loại cần.
//  - Đổi sang nhóm Tổ chức/Hộ kinh doanh: thông tin KH bị xoá, phải nhập form doanh nghiệp ("+ Cập nhật").
import { nodes, formFields, plainButtons, findNode, waitNode, sleep, typeInto, tapLabel } from './flutter.js';

// Toàn bộ loại trên portal (API order-info/get-sale-range-info). Hiện chỉ mở Cá nhân (Gia đình) + Doanh nghiệp;
// các loại khác bật sau (cần khảo sát thêm form: KH nước ngoài cần hộ chiếu/quốc tịch…) -> đổi enabled: true.
export const ALL_CUSTOMER_TYPES = [
  { group: 'Cá nhân', name: 'Gia đình', label: 'Cá nhân', default: true, enabled: true },
  { group: 'Cá nhân', name: 'Học sinh, sinh viên' },
  { group: 'Cá nhân', name: 'KH nước ngoài' },
  { group: 'Tổ chức/Hộ kinh doanh', name: 'Doanh nghiệp', label: 'Doanh nghiệp', enabled: true },
  { group: 'Tổ chức/Hộ kinh doanh', name: 'Cơ quan nhà nước' },
  { group: 'Tổ chức/Hộ kinh doanh', name: 'Đơn vị sự nghiệp' },
  { group: 'Tổ chức/Hộ kinh doanh', name: 'ĐSQ, Tổ chức phi chính phủ' },
  { group: 'Tổ chức/Hộ kinh doanh', name: 'Đại lý Internet' },
  { group: 'Tổ chức/Hộ kinh doanh', name: 'Hộ kinh doanh' },
];
/** Loại đang cho chọn trên giao diện / dòng lệnh. */
export const CUSTOMER_TYPES = ALL_CUSTOMER_TYPES.filter((t) => t.enabled);
export const DEFAULT_CUSTOMER_TYPE = 'Gia đình';
const ORG = 'Tổ chức/Hộ kinh doanh';

/** Tìm loại đang mở theo tên trên portal hoặc nhãn hiển thị ("Cá nhân" = Gia đình), không phân biệt hoa thường. */
export function findCustomerType(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return CUSTOMER_TYPES.find((t) => t.default);
  return CUSTOMER_TYPES.find((t) => t.name.toLowerCase() === key || t.label?.toLowerCase() === key) || null;
}
export const isOrgType = (name) => findCustomerType(name)?.group === ORG;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const exact = (s) => new RegExp(`^${esc(s)}$`, 'i');

async function scrollTop(app) {
  await app.mouse.move(720, 400);
  await app.mouse.wheel(0, -3000);
  await sleep(1000);
}

/** Các ô chọn trên màn báo giá theo thứ tự trên-xuống: [0] Đối tượng KH, [1] Phương thức thanh toán. */
export async function quoteGroups(app) {
  return (await nodes(app)).filter((n) => n.role === 'group' && n.y > 150 && n.y < 720 && n.h >= 40).sort((a, b) => a.y - b.y);
}

const dialogOpen = async (app) => (await nodes(app)).some((n) => n.role === 'group' && n.label === 'Đối tượng khách hàng');

/** Chọn đối tượng KH trên màn báo giá. Đang đúng loại thì không làm gì. Trả về tên loại đã chọn. */
export async function chooseCustomerType(app, typeName, onLog) {
  const type = findCustomerType(typeName);
  if (!type) throw new Error(`Không có đối tượng khách hàng "${typeName}" (có: ${CUSTOMER_TYPES.map((t) => t.name).join(', ')})`);
  // Màn báo giá vừa mở còn tải (spinner): chờ đủ 2 ô chọn (Đối tượng KH + PTTT). Chữ "Đối tượng khách hàng" không có trong semantics
  await scrollTop(app);
  const field = () => quoteGroups(app).then((g) => (g.length >= 2 ? g[0] : null));
  let cur = await field();
  let retries = 0;
  for (let end = Date.now() + 25000; !cur && Date.now() < end; ) {
    await sleep(500);
    // Stag tính giá quá giờ (get-price-quotation) -> hộp "Đã có lỗi xảy ra!" [Thử lại] -> bấm Thử lại, chờ thêm
    const retry = (await nodes(app)).find((n) => n.role === 'button' && /^Thử lại$/.test(n.label));
    if (retry && retries < 3) {
      retries += 1;
      onLog(`Portal lỗi khi tính giá gói (stag chậm) → Thử lại (${retries}/3)`);
      await app.mouse.click(retry.x, retry.y);
      await sleep(1500);
      end += 25000;
      continue;
    }
    cur = await field();
  }
  if (!cur) throw new Error('Không vào được màn báo giá sau khi chọn gói (không thấy ô Đối tượng khách hàng – xem ảnh trong output/debug)');
  if (exact(type.name).test(cur.label)) return type.name;
  onLog(`Đối tượng khách hàng: ${cur.label} → ${type.name}`);
  for (let i = 0; i < 3; i++) {
    if (!(await dialogOpen(app))) {
      await app.mouse.click(cur.x, cur.y);
      await sleep(2000);
    }
    const radio = (await nodes(app)).find((n) => n.role === 'radio' && exact(type.name).test(n.label) && n.y > 0 && n.y < 800);
    // Phải bấm đúng vòng tròn radio (mép phải dòng); bấm giữa dòng (chữ) không ăn
    if (radio) await app.mouse.click(radio.x + radio.w / 2 - 17, radio.y);
    else {
      // Nhóm chưa bung: bấm tên nhóm (app tự chọn loại đầu của nhóm + đóng hộp), vòng sau mở lại chọn đúng loại
      const head = await findNode(app, exact(type.group));
      if (!head) throw new Error(`Không thấy nhóm "${type.group}" trong hộp Đối tượng khách hàng`);
      await app.mouse.click(head.x, head.y);
    }
    await sleep(3000);
    if (await dialogOpen(app)) {
      // Hộp chưa tự đóng: bấm dấu X (nút không nhãn trên cùng của hộp)
      const x = (await plainButtons(app)).filter((b) => b.x < 520).sort((a, b) => a.y - b.y)[0];
      if (x) await app.mouse.click(x.x, x.y);
      await sleep(1500);
    }
    cur = await field();
    if (cur && exact(type.name).test(cur.label)) return type.name;
  }
  throw new Error(`Không chọn được đối tượng khách hàng "${type.name}" (đang là "${cur?.label || '?'}")`);
}

/** Cuộn tới ô nhập có tên khớp rồi gõ. Chỉ ép dựng lại semantics (chậm) khi chưa thấy ô. */
async function fillField(app, re, text, what) {
  let refresh = false;
  for (let i = 0; i < 8; i++) {
    const f = (await formFields(app, { refresh })).find((x) => re.test(x.name.split('\n')[0]));
    refresh = !f;
    if (f && f.y > 90 && f.y < 700) {
      if (f.value === text) return;
      if (await typeInto(app, f.x, f.y, text)) return;
      break;
    }
    await app.mouse.move(720, 400);
    await app.mouse.wheel(0, f ? f.y - 350 : 400);
    await sleep(600);
  }
  throw new Error(`Không nhập được ô "${what}" ở form thông tin khách hàng`);
}

/** Chờ node khớp xuất hiện (poll 250ms) – thay cho sleep cố định. */
async function waitFor(app, re, timeout) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(250)) {
    const n = await findNode(app, re);
    if (n) return n;
  }
  return null;
}

/**
 * Ô chọn ngày (bánh xe ngày / tháng / năm, mặc định hôm nay): mở ô có nhãn khớp, lùi bánh xe năm `yearsBack` nấc
 * (cuộn chuột trên cột năm) rồi Xác nhận.
 */
async function pickDate(app, re, yearsBack, what) {
  for (let i = 0; i < 8; i++) {
    const n = (await nodes(app)).find((x) => re.test(x.label));
    // Node gộp "Nhãn / ô chọn" (cao > 70px): bấm vào phần ô chọn ở dưới, giữa node là khoảng trống
    const y = n && (n.h > 70 ? n.y + n.h / 2 - 25 : n.y);
    if (n && y > 90 && y < 700) {
      await app.mouse.click(n.x, y);
      const ok = await waitFor(app, /^Xác nhận$/, 5000);
      if (!ok) break;
      await sleep(500); // hộp đang trượt lên
      // Cột năm là ô "adjustable" thứ 3 của bánh xe; không đọc được thì theo toạ độ (cách nút Xác nhận 147px)
      const wheels = (await formFields(app, { refresh: false })).filter((f) => !f.name && f.h > 100).sort((a, b) => a.x - b.x);
      const okNow = (await findNode(app, /^Xác nhận$/)) || ok;
      const year = wheels[2] || { x: 800, y: okNow.y - 147 };
      await app.mouse.move(year.x, year.y);
      for (let k = 0; k < yearsBack; k++) {
        await app.mouse.wheel(0, -40);
        await sleep(250);
      }
      await sleep(800); // bánh xe dừng hẳn
      await app.mouse.click(okNow.x, okNow.y);
      await sleep(900);
      return;
    }
    await app.mouse.move(720, 400);
    await app.mouse.wheel(0, n ? y - 400 : 400);
    await sleep(600);
  }
  throw new Error(`Không chọn được "${what}" ở form thông tin khách hàng`);
}

/**
 * Nhập form KH Tổ chức/Hộ kinh doanh (màn báo giá -> "+ Cập nhật") rồi Xác nhận & Lưu.
 * org: {company, taxCode, issuePlace, gpkdAddress, orgPhone, contactPhone, email, representative}
 */
export async function fillOrgCustomer(app, org, shot, onLog) {
  onLog(`Thông tin doanh nghiệp: ${org.company} · MST ${org.taxCode}`);
  await scrollTop(app);
  await tapLabel(app, /Cập nhật$/, [720, 462]);
  // Chờ form mở (có nút Xác nhận & Lưu) rồi dựng lại semantics 1 lần
  await waitFor(app, /^Xác nhận & Lưu$/, 8000);
  await formFields(app);
  await fillField(app, /^Tên Tổ chức/, org.company, 'Tên Tổ chức/Hộ kinh doanh');
  await fillField(app, /^Mã số thuế/, org.taxCode, 'Mã số thuế/Mã số ĐKKD');
  await pickDate(app, /^Chọn ngày cấp$/, 2, 'Ngày cấp');
  await fillField(app, /^Nhập nơi cấp$/, org.issuePlace, 'Nơi cấp');
  await pickDate(app, /^Chọn ngày thành lập$|^Ngày thành lập \* \/ Chọn ngày thành lập$/, 3, 'Ngày thành lập');
  await fillField(app, /^Địa chỉ trên GPKD/, org.gpkdAddress, 'Địa chỉ trên GPKD');
  await fillField(app, /^Số điện thoại Tổ chức/, org.orgPhone, 'SĐT Tổ chức/Hộ kinh doanh');
  await fillField(app, /^Số điện thoại Giao dịch/, org.contactPhone, 'SĐT giao dịch, liên hệ');
  if (org.email) await fillField(app, /^Email/, org.email, 'Email');
  await fillField(app, /^Họ tên|^Nhập họ tên/, org.representative, 'Họ tên người đại diện');
  await shot(app, 'form-doanh-nghiep');
  await tapLabel(app, /^Xác nhận & Lưu$/, [720, 766]);
  for (const end = Date.now() + 8000; Date.now() < end && (await findNode(app, /^Xác nhận & Lưu$/)); ) await sleep(400);
  await sleep(800);
  // Lưu được thì về màn báo giá (có lại ô Đối tượng KH); còn ở form = thiếu / sai ô
  if ((await nodes(app)).some((n) => /^Xác nhận & Lưu$/.test(n.label))) {
    const file = await shot(app, 'loi-form-doanh-nghiep');
    const hints = (await nodes(app)).map((n) => n.label).filter((l) => /vui lòng|không hợp lệ|bắt buộc|không được/i.test(l));
    throw new Error(`Form doanh nghiệp chưa lưu được${hints.length ? `: ${hints.join('; ')}` : ''} – xem ảnh ${file.split('/').pop()}`);
  }
}

/** Mã số thuế 10 số hợp lệ (đúng số kiểm tra) – dùng làm dữ liệu test mặc định. */
export function randomTaxCode() {
  const w = [31, 29, 23, 19, 17, 13, 7, 5, 3];
  for (;;) {
    const d = [0, 3, ...Array.from({ length: 7 }, () => Math.floor(Math.random() * 10))];
    const c = 10 - (d.reduce((s, x, i) => s + x * w[i], 0) % 11);
    if (c < 10) return d.join('') + c;
  }
}
