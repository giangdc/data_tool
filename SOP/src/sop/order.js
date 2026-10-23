// Luồng tạo đơn Internet + hợp đồng trên Portal SOP (khảo sát: khao-sat/KHAO_SAT.md).
//  1. Portal (React): Khách hàng của tôi -> tìm theo SĐT -> chi tiết KH -> tab Đơn hàng -> Thêm đơn hàng -> Bán mới
//  2. Tab mới /ban-hang/order/create = app Sale Platform (Flutter): địa chỉ (tìm kiếm) -> combo -> PTTT -> lưu KH
//     -> Tạo báo giá (bỏ qua cảnh báo trùng đơn) -> Tạo hợp đồng -> khảo sát Định danh KH
// Mã đơn / mã HĐ / link báo giá / bookport đọc từ response API của app (màn Flutter không có chữ trong DOM).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { config, OUTPUT_DIR } from '../core/env.js';
import { getContext, openPortal } from '../core/browser.js';
import { sleep, nodes, findNode, waitNode, tapLabel, shooter, clickUntilChange, clickUntilNode } from './flutter.js';

const LIST_PATH = '/quan-ly-khach-hang/khach-hang/danh-sach';

// Combo gợi ý: toạ độ tab (y=423) và thẻ gói (y=500) trên màn Tạo báo giá
export const COMBOS = { GigaF1: 69, GigaF2: 163, MetaF1: 256, MetaF2: 351, SkyF1: 441, SkyF2: 539 };
const CARD_X = [125, 355, 584, 813, 1042, 1271];

// Nhận diện mã trong response
const ORDER_RE = /^[A-Z]{3}SF[0-9A-Z]{4,}$/; // HCMSF0026TIZ
const CONTRACT_RE = /^[A-Z]{5}\d{3,}$/; // SGABP5146
const QUOTE_RE = /^https?:\/\/[^/]*fpt\.vn\/shop\/bao-gia\/\w+$/;
const BOOKPORT_RE = /^[A-Z]{3}P\d{3}\.\d{3,}\/\w+$/; // HCMP005.0315/HU

/** Gom các giá trị dạng mã trong response JSON của app (kèm đường dẫn key) theo từng giai đoạn. */
function codeCollector(page) {
  const found = [];
  let phase = 'init';
  const walk = (o, keyPath, endpoint) => {
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) walk(o[k], keyPath ? `${keyPath}.${k}` : k, endpoint);
    } else if (typeof o === 'string' && (ORDER_RE.test(o) || CONTRACT_RE.test(o) || QUOTE_RE.test(o) || BOOKPORT_RE.test(o))) {
      found.push({ phase, endpoint, keyPath, value: o });
    }
  };
  page.on('response', async (r) => {
    if (!r.url().includes('sapi.fpt.vn')) return;
    const endpoint = r.url().split('?')[0].split('/api/').pop();
    try {
      walk(await r.json(), '', endpoint);
    } catch {
      // không phải JSON
    }
  });
  const pick = (re, phases, prefer = /./) => {
    const list = found.filter((f) => re.test(f.value) && phases.includes(f.phase));
    return (list.find((f) => prefer.test(f.keyPath)) || list[0])?.value || '';
  };
  return {
    setPhase: (p) => { phase = p; },
    found,
    orderCode: () => pick(ORDER_RE, ['quote', 'contract'], /order/i),
    contractCode: () => pick(CONTRACT_RE, ['contract'], /contract/i),
    quoteLink: () => pick(QUOTE_RE, ['quote', 'contract']),
    bookport: () => pick(BOOKPORT_RE, ['quote', 'contract']),
  };
}

/** Chờ 1 response của app có endpoint khớp (không có thì thôi, chờ đủ timeout). */
const waitApi = (page, re, timeout = 15000) =>
  page.waitForResponse((r) => r.url().includes('sapi.fpt.vn') && re.test(r.url()), { timeout }).catch(() => null);

async function openCustomer(page, phone, onLog) {
  onLog(`Tìm khách hàng ${phone} trong "Khách hàng của tôi"`);
  await openPortal(page, config.sopUrl + LIST_PATH, onLog);
  await page.getByText(/^Tất cả/).first().click().catch(() => {});
  await sleep(1500);
  const row = () => page.locator('.ant-table-tbody tr', { hasText: phone }).first();
  if (!(await row().count())) {
    const search = page.locator('.ant-select-selection-search-input').first();
    await search.click();
    await page.keyboard.type(phone, { delay: 30 });
    await page.keyboard.press('Enter');
    await sleep(3000);
  }
  if (!(await row().count())) throw new Error(`Không thấy khách hàng có SĐT ${phone} trong "Khách hàng của tôi" của tài khoản này`);
  const name = (await row().locator('td').nth(1).innerText()).split('\n')[0].trim();
  await row().getByText(name, { exact: true }).first().click();
  await page.waitForURL(/chi-tiet/, { timeout: 20000 });
  await sleep(3000);
  onLog(`Mở chi tiết KH: ${name}`);
  return name;
}

async function openNewSale(page, onLog) {
  await page.getByText('Đơn hàng', { exact: true }).first().click();
  await sleep(2000);
  await page.getByRole('button', { name: 'Thêm đơn hàng' }).click();
  await sleep(1500);
  const [app] = await Promise.all([
    page.context().waitForEvent('page', { timeout: 30000 }),
    page.getByText('Bán mới', { exact: true }).click(),
  ]);
  onLog('Bán mới → mở màn Tạo báo giá (Sale Platform)');
  await app.setViewportSize({ width: 1440, height: 813 });
  await app.bringToFront();
  await waitApi(app, /get-permission-services/, 40000);
  await sleep(4000);
  return app;
}

async function chooseAddress(app, address, shot, onLog) {
  onLog(`Chọn địa chỉ: ${address}`);
  const fail = async (what) => {
    await shot(app, 'dia-chi-ket');
    throw new Error(`Màn địa chỉ không phản hồi ở bước "${what}" (xem ảnh trong output/debug)`);
  };
  const is = (role, re) => (n) => n.role === role && re.test(n.label);
  // App tải xong khi thấy "Combo tùy chọn" (Internet, FPT Play…)
  if (!(await waitNode(app, /^Internet$/, 40000))) await fail('tải màn Tạo báo giá');
  if (!(await clickUntilNode(app, 1399, 96, is('tab', /^Nhập địa chỉ$/)))) await fail('mở Thông tin địa chỉ'); // kính lúp
  // Ô tìm kiếm trên bản đồ -> màn "Tìm kiếm địa chỉ" (có nút Tìm kiếm ở đáy)
  if (!(await clickUntilNode(app, 720, 164, is('button', /^Tìm kiếm$/)))) await fail('mở ô tìm kiếm');
  await app.mouse.click(700, 95);
  await sleep(800);
  await app.keyboard.type(address, { delay: 60 });
  await sleep(800);
  const search = waitApi(app, /autocomplete-search|geocode/);
  await tapLabel(app, /^Tìm kiếm$/, [720, 774]);
  await search;
  await sleep(2500);
  await shot(app, 'ket-qua-dia-chi');
  const detail = waitApi(app, /place-detail/);
  await app.mouse.click(300, 159); // dòng kết quả đầu tiên
  if (!(await detail)) throw new Error(`Không tìm thấy địa chỉ "${address}" (Tìm kiếm không có kết quả)`);
  await sleep(3000);
  const convert = waitApi(app, /get-address-convert|check-address/, 20000);
  // Thanh địa chỉ dưới bản đồ -> form "Nhập địa chỉ" tự điền + toạ độ
  if (!(await clickUntilChange(app, 400, 769))) await fail('chọn địa chỉ trên bản đồ');
  await convert;
  await sleep(5000);
  await shot(app, 'form-dia-chi');
  // Xác nhận -> về màn Tạo báo giá, có combo gợi ý
  if (!(await clickUntilNode(app, 720, 769, (n) => /^Internet$/.test(n.label), { wait: 6000 }))) await fail('Xác nhận địa chỉ');
  await sleep(2000);
  await shot(app, 'combo');
}

async function chooseCombo(app, combo, index, onLog) {
  const tabX = COMBOS[combo];
  if (!tabX) throw new Error(`Combo "${combo}" không hỗ trợ. Có: ${Object.keys(COMBOS).join(', ')}`);
  const cardX = CARD_X[index - 1];
  if (!cardX) throw new Error('Số thứ tự gói chỉ từ 1 đến 6');
  onLog(`Chọn combo ${combo}, gói thứ ${index}`);
  await app.mouse.click(tabX, 423);
  await sleep(2500);
  if (!(await clickUntilChange(app, cardX, 500, { wait: 4000 }))) throw new Error('Không chọn được gói (combo trống? xem ảnh trong output/debug)');
  await sleep(2000);
}

async function choosePayment(app, payment, onLog) {
  onLog(`Phương thức thanh toán: ${payment}`);
  const current = await waitNode(app, /^Gia đình$|Đối tượng khách hàng/, 20000);
  if (!current) throw new Error('Không vào được màn báo giá sau khi chọn gói (xem ảnh trong output/debug)');
  await app.mouse.move(720, 400);
  await app.mouse.wheel(0, -3000);
  await sleep(1000);
  await app.mouse.click(720, 640); // ô phương thức thanh toán (mặc định FRT Thu Hộ)
  await sleep(2000);
  const re = new RegExp(`^${payment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  for (let i = 0; i < 12; i++) {
    const n = await findNode(app, re);
    if (n && n.y > 150 && n.y < 790) {
      await app.mouse.click(n.x, n.y);
      await sleep(2000);
      return;
    }
    await app.mouse.move(720, 500);
    await app.mouse.wheel(0, 250);
    await sleep(700);
  }
  throw new Error(`Không thấy phương thức thanh toán "${payment}" trong danh sách`);
}

async function saveCustomer(app, onLog) {
  onLog('Lưu thông tin khách hàng (Họ tên + SĐT)');
  await app.mouse.move(720, 400);
  await app.mouse.wheel(0, -3000);
  await sleep(800);
  await tapLabel(app, /^Cập nhật$/, [1387, 411]);
  await sleep(2500);
  await tapLabel(app, /^Xác nhận & Lưu$/, [720, 766]);
  await sleep(3500);
}

async function createQuote(app, codes, shot, onLog) {
  onLog('Tạo báo giá');
  codes.setPhase('quote');
  await tapLabel(app, /^Tạo báo giá$/, [1072, 759]);
  // Chữ trong hộp thoại không có trong semantics, chỉ có nút: [Hủy + Xác nhận] = cảnh báo trùng đơn, [Xác nhận] = lỗi
  for (let i = 0; i < 8; i++) {
    await sleep(4000);
    const list = await nodes(app);
    if (list.some((n) => /^Tạo hợp đồng$/.test(n.label))) return;
    const ok = list.find((n) => n.role === 'button' && /^Xác nhận$/.test(n.label));
    const cancel = list.find((n) => n.role === 'button' && /^Hủy$/.test(n.label));
    if (ok && cancel) {
      onLog('Cảnh báo trùng đơn (địa chỉ/SĐT test dùng chung) → Xác nhận');
      await app.mouse.click(ok.x, ok.y);
      continue;
    }
    if (ok) {
      const file = await shot(app, 'loi-bao-gia');
      throw new Error(`Portal báo lỗi khi tạo báo giá – xem ảnh ${path.basename(file)} trong output/debug`);
    }
  }
  await shot(app, 'bao-gia-cho-lau');
  if (!(await waitNode(app, /^Tạo hợp đồng$/, 30000))) throw new Error('Không thấy màn Chi tiết báo giá sau khi tạo (xem ảnh trong output/debug)');
}

async function createContract(app, codes, shot, onLog) {
  onLog('Tạo hợp đồng');
  codes.setPhase('contract');
  await tapLabel(app, /^Tạo hợp đồng$/, [720, 766]);
  // Màn "Đang tạo hợp đồng" (Kiểm tra đơn -> Tạo phiếu KH -> Tạo HĐ) rồi khảo sát "Định danh khách hàng"
  let surveyed = false;
  for (const end = Date.now() + 150000; Date.now() < end; await sleep(3000)) {
    const list = await nodes(app);
    const has = (re) => list.find((n) => re.test(n.label));
    if (has(/^Thanh toán$/)) return;
    const done = has(/^Đóng$/);
    if (done) {
      await app.mouse.click(done.x, done.y);
      continue;
    }
    if (!surveyed && (has(/^Hoàn tất$/) || has(/tầng|Nhà riêng/))) {
      onLog('Khảo sát Định danh KH: 1 tầng, Nhà riêng, không cho thuê phòng');
      await shot(app, 'khao-sat-dinh-danh');
      // Bấm vào ô tròn bên trái (x=36) ở đúng hàng của nhãn; node nhãn rộng cả hàng nên bấm giữa node không chọn được
      for (const [re, y] of [[/^1$/, 134], [/^Nhà riêng$/, 389], [/^Không$/, 515]]) {
        const n = list.find((m) => re.test(m.label));
        await app.mouse.click(36, n ? n.y : y);
        await sleep(700);
      }
      await shot(app, 'khao-sat-da-chon');
      await tapLabel(app, /^Hoàn tất$/, [720, 774]);
      surveyed = true;
      continue;
    }
    const ok = list.find((n) => n.role === 'button' && /^Xác nhận$/.test(n.label));
    if (ok && !has(/^Hủy$/)) {
      const file = await shot(app, 'loi-hop-dong');
      throw new Error(`Portal báo lỗi khi tạo hợp đồng – xem ảnh ${path.basename(file)} trong output/debug`);
    }
  }
  await shot(app, 'hd-cho-lau');
  throw new Error('Tạo hợp đồng chưa xong sau 2,5 phút (xem ảnh trong output/debug)');
}

/**
 * Tạo 1 đơn Internet (+ hợp đồng) cho KH có sẵn.
 * input: { phone, address, combo, comboIndex, payment, contract (bool, mặc định true) }
 */
export async function createInternetOrder(input, onLog = () => {}) {
  const d = config.defaults;
  const opts = {
    phone: String(input.phone || d.phone).trim(),
    address: String(input.address || d.address).trim(),
    combo: input.combo || d.combo,
    comboIndex: Number(input.comboIndex) || d.comboIndex,
    payment: String(input.payment || d.payment).trim(),
    contract: input.contract !== false,
  };
  if (!/^0\d{9}$/.test(opts.phone)) throw Object.assign(new Error('SĐT khách hàng cần 10 số, bắt đầu bằng 0'), { status: 400 });

  const runId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const shot = shooter(runId);
  const record = { runId, startedAt: new Date().toISOString(), ...opts, customer: '', orderCode: '', contractCode: '', quoteLink: '', bookport: '', error: '' };
  const ctx = await getContext();
  const page = ctx.pages().find((p) => p.url() === 'about:blank') || (await ctx.newPage());
  let app = null;
  let codes = null;
  try {
    record.customer = await openCustomer(page, opts.phone, onLog);
    app = await openNewSale(page, onLog);
    codes = codeCollector(app);
    await shot(app, 'tao-bao-gia');
    await chooseAddress(app, opts.address, shot, onLog);
    await chooseCombo(app, opts.combo, opts.comboIndex, onLog);
    await shot(app, 'man-bao-gia');
    await choosePayment(app, opts.payment, onLog);
    await saveCustomer(app, onLog);
    await shot(app, 'truoc-tao-bao-gia');
    await createQuote(app, codes, shot, onLog);
    Object.assign(record, { orderCode: codes.orderCode(), quoteLink: codes.quoteLink(), bookport: codes.bookport() });
    onLog(`✔ Đã tạo báo giá${record.orderCode ? ': ' + record.orderCode : ''}`);
    await shot(app, 'chi-tiet-bao-gia');
    if (opts.contract) {
      await createContract(app, codes, shot, onLog);
      Object.assign(record, {
        orderCode: record.orderCode || codes.orderCode(), contractCode: codes.contractCode(),
        quoteLink: record.quoteLink || codes.quoteLink(), bookport: record.bookport || codes.bookport(),
      });
      onLog(`✔ Đã tạo hợp đồng${record.contractCode ? ': ' + record.contractCode : ''}`);
      await shot(app, 'hop-dong');
    }
    if (!record.orderCode || (opts.contract && !record.contractCode)) {
      onLog('⚠ Chưa đọc được đủ mã từ API – xem màn Chi tiết báo giá / tab Đơn hàng của KH');
    }
    return record;
  } catch (err) {
    record.error = err.message;
    // Lỗi giữa chừng vẫn ghi lại mã đã tạo được (vd HĐ đã tạo nhưng kẹt ở khảo sát)
    if (codes) {
      for (const [k, get] of [['orderCode', codes.orderCode], ['contractCode', codes.contractCode], ['quoteLink', codes.quoteLink], ['bookport', codes.bookport]]) {
        record[k] ||= get();
      }
    }
    if (app) await shot(app, 'loi');
    else await shot(page, 'loi');
    throw Object.assign(err, { record });
  } finally {
    record.finishedAt = new Date().toISOString();
    // Ghi lại nơi tìm thấy mã (key path + giá trị mã, không có dữ liệu khác) để tinh chỉnh khi app đổi API
    if (codes?.found.length) writeFileSync(path.join(OUTPUT_DIR, 'debug', `${runId}-codes.json`), JSON.stringify(codes.found, null, 2));
  }
}
