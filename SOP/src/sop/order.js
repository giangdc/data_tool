// Luồng tạo đơn (Internet / dịch vụ khác) + hợp đồng trên Portal SOP (khảo sát: khao-sat/KHAO_SAT.md).
//  1. Portal (React): Khách hàng của tôi -> tìm theo SĐT -> chi tiết KH -> tab Đơn hàng -> Thêm đơn hàng -> Bán mới
//  2. Tab mới /ban-hang/order/create = app Sale Platform (Flutter): địa chỉ (tìm kiếm) -> combo -> PTTT -> lưu KH
//     -> Tạo báo giá (bỏ qua cảnh báo trùng đơn) -> Tạo hợp đồng -> khảo sát Định danh KH
//     Dịch vụ khác: thay combo bằng form dịch vụ + giỏ hàng (services.js), có thể mua kèm combo Internet
// Mã đơn / mã HĐ / link báo giá / bookport đọc từ response API của app (màn Flutter không có chữ trong DOM).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { config, OUTPUT_DIR } from '../core/env.js';
import { getContext, openPortal } from '../core/browser.js';
import { sleep, nodes, findNode, waitNode, tapLabel, shooter, clickUntilChange, clickUntilNode, typeInto } from './flutter.js';
import { findService, addService, openCart, readServiceOptions } from './services.js';
import { findCustomerType, isOrgType, chooseCustomerType, fillOrgCustomer, randomTaxCode, quoteGroups, DEFAULT_CUSTOMER_TYPE, CUSTOMER_TYPES } from './customer.js';

const LIST_PATH = '/quan-ly-khach-hang/khach-hang/danh-sach';

// Nhận diện mã trong response
const ORDER_RE = /^[A-Z]{5}\d{4}[0-9A-Z]{3}$/; // HCMSF0026TIZ, HCMSI0026TMZ, HCMUO0026UQG
const CONTRACT_RE = /^[A-Z]{5}\d{3,}$/; // SGABP5146
const QUOTE_RE = /^https?:\/\/[^/]*fpt\.vn\/shop\/bao-gia\/\w+$/;
const BOOKPORT_RE = /^[A-Z]{3}P\d{3}\.\d{3,}\/\w+$/; // HCMP005.0315/HU

/** Thông báo lỗi trong response API (nếu có). Chữ trong hộp cảnh báo của app không đọc được từ semantics. */
export function apiMessage(json) {
  // Rule chặn của portal nằm ở Data.Result.Reason (vd order/validate: "Số phone … đã được kích hoạt dịch vụ FPT Play cho hợp đồng …")
  const reason = json?.Data?.Result?.Reason;
  const reasons = (Array.isArray(reason) ? reason : [reason]).filter((r) => typeof r === 'string' && r.trim());
  if (json?.Data?.Result?.IsValid === false && reasons.length) {
    const m = json?.Message;
    const head = typeof m === 'string' ? m : m?.Message || m?.Vi || '';
    return `${head ? head.trim() + ' ' : ''}Lý do: ${reasons.join('; ')}`;
  }
  for (const m of [json?.Data?.Message, json?.Message, json?.Data?.Error?.Message]) {
    if (typeof m === 'string' && m && !/success|thành công|^ok\.?$/i.test(m)) return m.trim();
    if (m && typeof m === 'object' && typeof (m.Vi || m.vi || m.Message) === 'string') return (m.Vi || m.vi || m.Message).trim();
  }
  return '';
}

/** Gom các giá trị dạng mã trong response JSON của app (kèm đường dẫn key) theo từng giai đoạn. */
export function codeCollector(page) {
  const found = [];
  const messages = [];
  const okEndpoints = new Set(); // endpoint đã trả Code 200 (vd khảo sát Định danh đã lưu)
  const traceLines = [];
  let phase = 'init';
  const walk = (o, keyPath, endpoint) => {
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) walk(o[k], keyPath ? `${keyPath}.${k}` : k, endpoint);
    } else if (typeof o === 'string' && (ORDER_RE.test(o) || CONTRACT_RE.test(o) || QUOTE_RE.test(o) || BOOKPORT_RE.test(o))) {
      found.push({ phase, endpoint, keyPath, value: o });
    }
  };
  const t0 = Date.now();
  const timing = [];
  if (process.env.SOP_API_TIMING) {
    page.on('requestfinished', (q) => {
      if (!q.url().includes('sapi.fpt.vn')) return;
      const t = q.timing();
      timing.push({ phase, endpoint: q.url().split('?')[0].split('/api/').pop(), at: Math.round((t.startTime - t0) / 100) / 10, ms: Math.round(t.responseEnd) });
    });
  }
  page.on('response', async (r) => {
    if (!r.url().includes('sapi.fpt.vn')) return;
    const endpoint = r.url().split('?')[0].split('/api/').pop();
    try {
      const json = await r.json();
      if (process.env.SOP_API_TRACE && (phase === 'quote' || process.env.SOP_API_TRACE === 'all')) {
        const mask = (k, v) => (/token|auth|pass|secret|cookie|otp/i.test(k) ? '***' : v);
        const req = r.request().postData() || '';
        let body = req;
        try { body = JSON.parse(req, mask); } catch { /* không phải JSON */ }
        traceLines.push(JSON.stringify({ phase, method: r.request().method(), url: r.url().replace(/([?&][^=]*(token|key|auth)[^=]*=)[^&]*/gi, '$1***'), headerNames: Object.keys(r.request().headers()), endpoint, status: r.status(), request: body, response: JSON.parse(JSON.stringify(json), mask) }));
      }
      walk(json, '', endpoint);
      if (r.status() === 200 && json?.Code === 200) okEndpoints.add(endpoint);
      const msg = apiMessage(json);
      if (msg) messages.push(msg);
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
    trace: () => traceLines,
    ok: (re) => [...okEndpoints].some((e) => re.test(e)),
    timing: () => timing,
    found,
    lastMessage: () => messages.at(-1) || '',
    orderCode: () => pick(ORDER_RE, ['quote', 'contract'], /order/i),
    contractCode: () => pick(CONTRACT_RE, ['contract'], /contract/i),
    quoteLink: () => pick(QUOTE_RE, ['quote', 'contract']),
    bookport: () => pick(BOOKPORT_RE, ['quote', 'contract']),
  };
}

/** Chờ 1 response của app có endpoint khớp (không có thì thôi, chờ đủ timeout). */
const waitApi = (page, re, timeout = 15000) =>
  page.waitForResponse((r) => r.url().includes('sapi.fpt.vn') && re.test(r.url()), { timeout }).catch(() => null);

/** Request sapi.fpt.vn đang chạy dở của trang (gắn 1 lần / trang): Map request -> {endpoint, start}. */
const inflightMap = new WeakMap();
function inflight(page) {
  if (!inflightMap.has(page)) {
    const m = new Map();
    const done = (r) => m.delete(r);
    page.on('request', (r) => {
      if (r.url().includes('sapi.fpt.vn')) m.set(r, { endpoint: r.url().split('?')[0].split('/api/').pop(), start: Date.now() });
    });
    page.on('requestfinished', done);
    page.on('requestfailed', done);
    inflightMap.set(page, m);
  }
  return inflightMap.get(page);
}

/** Chờ app hết request sapi đang chạy (form phủ loading). Trả về danh sách endpoint còn treo khi hết giờ. */
async function waitIdle(page, timeout = 45000, onLog = () => {}) {
  const m = inflight(page);
  let logged = false;
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(500)) {
    // Request không bao giờ báo xong (> 90s) thì bỏ, không chờ theo
    for (const [r, v] of m) if (Date.now() - v.start > 90000) m.delete(r);
    if (!m.size) return [];
    const slow = [...m.values()].filter((v) => Date.now() - v.start > 8000).map((v) => v.endpoint);
    if (slow.length && !logged) {
      onLog(`Chờ portal xử lý: ${[...new Set(slow)].join(', ')}`);
      logged = true;
    }
  }
  return [...new Set([...m.values()].map((v) => v.endpoint))];
}

export async function openCustomer(page, phone, onLog) {
  onLog(`Tìm khách hàng ${phone} trong "Khách hàng của tôi"`);
  await openPortal(page, config.sopUrl + LIST_PATH, onLog);
  await page.getByText(/^Tất cả/).first().click().catch(() => {});
  const row = () => page.locator('.ant-table-tbody tr', { hasText: phone }).first();
  // Bảng tải chậm: chờ dòng của KH xuất hiện trước khi chuyển sang ô tìm kiếm
  await row().waitFor({ timeout: 10000 }).catch(() => {});
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
  await page.getByText('Đơn hàng', { exact: true }).first().waitFor({ timeout: 15000 }).catch(() => {});
  onLog(`Mở chi tiết KH: ${name}`);
  return name;
}

export async function openNewSale(page, shot, onLog) {
  await page.getByText('Đơn hàng', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Thêm đơn hàng' }).click({ timeout: 15000 });
  // Hộp "Lựa chọn hình thức bán" có hiệu ứng mở: bấm lúc đang mở có thể không ăn -> chờ 1 nhịp, không ra tab mới thì bấm lại
  const saleNew = page.getByText('Bán mới', { exact: true });
  await saleNew.waitFor({ timeout: 10000 }).catch(() => {});
  await sleep(500);
  let app = null;
  for (let i = 0; i < 3 && !app; i++) {
    const opened = page.context().waitForEvent('page', { timeout: i < 2 ? 6000 : 30000 }).catch(() => null);
    await saleNew.click({ timeout: 5000 }).catch(() => {});
    app = await opened;
  }
  if (!app) throw new Error('Bấm "Bán mới" không mở được màn Tạo báo giá (Sale Platform)');
  onLog('Bán mới → mở màn Tạo báo giá (Sale Platform)');
  await app.setViewportSize({ width: 1440, height: 813 });
  await app.bringToFront();
  await waitApi(app, /get-permission-services/, 40000);
  await sleep(1500);
  // App tải xong khi thấy "Combo tùy chọn" (Internet, FPT Play…).
  // Lượt trước dừng giữa chừng (hoặc Tải gói) để lại đơn nháp -> hộp thoại "đơn hàng trước đó chưa hoàn thành,
  // tiếp tục tạo đơn đó?" [Không | Xác nhận] (có khi hiện muộn) -> Không (tạo đơn mới)
  let errorSeen = 0; // số lần liên tiếp thấy hộp chỉ có [Xác nhận]
  let readySeen = 0; // hộp đơn nháp / cảnh báo cọc có khi hiện muộn -> phải thấy màn sẵn sàng 2 lần (cách 1s)
  for (const end = Date.now() + 90000; ; await sleep(readySeen ? 1000 : 400)) {
    const list = await nodes(app);
    const ready = list.some((n) => /^Internet$/.test(n.label)) && !list.some((n) => n.role === 'button' && /^Xác nhận$/.test(n.label));
    readySeen = ready ? readySeen + 1 : 0;
    if (readySeen >= 2) break;
    if (ready) continue;
    const button = (re) => list.find((n) => n.role === 'button' && re.test(n.label));
    const no = button(/^Không$/);
    if (no && button(/^Xác nhận$/)) {
      onLog('Có đơn nháp chưa hoàn thành → Không (tạo đơn mới)');
      await app.mouse.click(no.x, no.y);
      await sleep(3000);
      continue;
    }
    // Rule Sale Platform: tài khoản còn phiếu chưa nhập cọc / chưa xác nhận OTP -> "Cảnh báo!!! (0xb462392144)
    // ... Bạn có muốn đi tiếp không?" [Hủy | Xác nhận] -> Xác nhận (đi tiếp)
    const yes = button(/^Xác nhận$/);
    if (yes && button(/^Hủy$/)) {
      onLog('Cảnh báo còn phiếu chưa nhập cọc / chưa xác nhận OTP → Xác nhận (đi tiếp)');
      await app.mouse.click(yes.x, yes.y);
      await sleep(3000);
      continue;
    }
    // Chỉ có [Xác nhận] = hộp thoại lỗi ("Đã có lỗi xảy ra" – backend Sale Platform stag lỗi).
    // Phải thấy 2 lần liên tiếp: hộp cảnh báo cọc/OTP có khi hiện nút Xác nhận trước, nút Hủy sau 1 nhịp
    errorSeen = yes ? errorSeen + 1 : 0;
    const failed = errorSeen >= 2;
    if (failed || Date.now() > end) {
      const file = path.basename(await shot(app, 'mo-ban-moi-loi'));
      throw new Error(failed
        ? `Sale Platform báo lỗi khi mở Bán mới (stag lỗi / chậm) – thử lại sau. Ảnh: ${file}`
        : `Màn Tạo báo giá không tải xong sau 1,5 phút. Ảnh: ${file}`);
    }
  }
  return app;
}

/** Toạ độ "lat, lng" trong response place-detail (Google); stag hay bị OVER_QUERY_LIMIT -> rỗng. */
async function placeCoords(res) {
  const j = await res?.json().catch(() => null);
  const loc = j?.Data?.Result?.result?.geometry?.location;
  return Number.isFinite(loc?.lat) && Number.isFinite(loc?.lng) ? `${loc.lat}, ${loc.lng}` : '';
}

/** Số nhà = phần đầu địa chỉ (trước dấu phẩy) nếu có chữ số, vd "123, Trương Định, …" -> "123". */
const houseNumber = (address) => {
  const first = address.split(',')[0].trim();
  return /\d/.test(first) && first.length <= 20 ? first : '';
};

/**
 * Khu vực bán (góc phải trên) phải khớp địa chỉ, sai thì app báo "không thể bán hàng trong khu vực đã chọn".
 * App nhớ khu vực dùng lần trước -> đổi theo phần cuối địa chỉ; tên không có trong danh sách thì giữ nguyên.
 */
async function chooseRegion(app, address, onLog) {
  const region = address.split(',').at(-1).trim();
  const current = (await nodes(app)).find((n) => n.role === 'button' && n.label && n.y < 50 && n.x > 1200);
  if (!region || !current || current.label === region) return;
  await app.mouse.click(current.x, current.y);
  if (!(await waitNode(app, /^Lựa chọn địa điểm$/, 8000))) return;
  await typeInto(app, 743, 94, region);
  await sleep(1500);
  const hit = (await nodes(app)).find((n) => n.role === 'button' && n.label === region);
  if (hit) {
    onLog(`Đổi khu vực bán: ${current.label} → ${region}`);
    await app.mouse.click(hit.x, hit.y);
    await sleep(3000);
  }
  // Chọn trúng thì tự về màn trước; không có tên / khu vực đang chọn thì phải đóng tay
  if ((await nodes(app)).some((n) => /^Lựa chọn địa điểm$/.test(n.label))) await app.mouse.click(34, 28);
  await sleep(2000);
}

export async function chooseAddress(app, address, coords, shot, onLog) {
  inflight(app);
  await chooseRegion(app, address, onLog);
  onLog(`Chọn địa chỉ: ${address}`);
  const fail = async (what) => {
    await shot(app, 'dia-chi-ket');
    const pending = [...new Set([...inflight(app).values()].map((v) => v.endpoint))];
    throw new Error(`Màn địa chỉ không phản hồi ở bước "${what}"${pending.length ? ` (portal còn đang chờ API: ${pending.join(', ')})` : ''} (xem ảnh trong output/debug)`);
  };
  const is = (role, re) => (n) => n.role === role && re.test(n.label);
  if (!(await clickUntilNode(app, 1399, 96, is('tab', /^Nhập địa chỉ$/)))) await fail('mở Thông tin địa chỉ'); // kính lúp
  // App nhớ tab dùng lần trước: đang ở "Nhập địa chỉ" thì về tab "Tìm kiếm" (bản đồ)
  const searchTab = (await nodes(app)).find(is('tab', /^Tìm kiếm$/));
  if (searchTab) {
    await app.mouse.click(searchTab.x, searchTab.y);
    await sleep(1200);
  }
  // Ô tìm kiếm trên bản đồ -> màn "Tìm kiếm địa chỉ" (có nút Tìm kiếm ở đáy)
  if (!(await clickUntilNode(app, 720, 164, is('button', /^Tìm kiếm$/)))) await fail('mở ô tìm kiếm');
  if (!(await typeInto(app, 700, 95, address))) await fail('nhập địa chỉ tìm kiếm');
  const search = waitApi(app, /autocomplete-search|geocode/);
  await tapLabel(app, /^Tìm kiếm$/, [720, 774]);
  await search;
  await sleep(800);
  // Google stag chập chờn -> "Không có kết quả phù hợp!" [Nhập thủ công | Thử lại] dù địa chỉ đúng -> Thử lại
  for (let i = 0; i < 4; i++) {
    const retry = (await nodes(app)).find((n) => n.role === 'button' && /^Thử lại$/.test(n.label));
    if (!retry) break;
    onLog(`Tìm địa chỉ không có kết quả (Google stag chập chờn) → Thử lại (${i + 1})`);
    // "Thử lại" chỉ đóng hộp, không tự tìm lại -> bấm lại nút Tìm kiếm ở đáy
    await app.mouse.click(retry.x, retry.y);
    await sleep(1500);
    const again = waitApi(app, /autocomplete-search|geocode/);
    await tapLabel(app, /^Tìm kiếm$/, [720, 774]);
    await again;
    await sleep(3000);
  }
  if ((await nodes(app)).some((n) => n.role === 'button' && /^Thử lại$/.test(n.label))) {
    await shot(app, 'ket-qua-dia-chi');
    throw new Error(`Tìm địa chỉ "${address}" vẫn "Không có kết quả phù hợp" sau 4 lần thử lại (Google stag lỗi / địa chỉ sai) – chạy lại sau`);
  }
  await shot(app, 'ket-qua-dia-chi');
  const detail = waitApi(app, /place-detail/);
  await app.mouse.click(300, 159); // dòng kết quả đầu tiên
  const detailRes = await detail;
  if (!detailRes) throw new Error(`Không tìm thấy địa chỉ "${address}" (Tìm kiếm không có kết quả)`);
  await sleep(1000); // bản đồ dời tới điểm (bước sau tự bấm lại nếu màn chưa đổi)
  const convert = waitApi(app, /get-address-convert|check-address/, 20000);
  // Thanh địa chỉ dưới bản đồ -> form "Nhập địa chỉ" tự điền Xã/Đường (+ Số nhà, toạ độ nếu Google trả được)
  if (!(await clickUntilChange(app, 400, 769))) await fail('chọn địa chỉ trên bản đồ');
  await convert;
  await sleep(500);
  await waitIdle(app, 45000, onLog);
  await sleep(400);
  // Google trên stag hay hết hạn mức (OVER_QUERY_LIMIT) -> form thiếu Số nhà + toạ độ -> tự điền (điền đè cũng không sao)
  const house = houseNumber(address);
  const latLng = coords || (await placeCoords(detailRes));
  if (house && !(await typeInto(app, 720, 517, house))) await fail('nhập Số nhà');
  if (latLng && !(await typeInto(app, 700, 625, latLng))) await fail('nhập Toạ độ');
  if (!latLng) onLog('⚠ Không có toạ độ (Google không trả, chưa nhập ô Toạ độ) – portal có thể không nhận địa chỉ');
  await shot(app, 'form-dia-chi');
  // Xác nhận -> về màn Tạo báo giá, có combo gợi ý (API package-view/list)
  const packages = waitApi(app, /package-view\/list/, 30000);
  if (!(await clickUntilNode(app, 720, 769, (n) => /^Internet$/.test(n.label), { wait: 6000 }))) await fail('Xác nhận địa chỉ');
  const list = parsePackages(await (await packages)?.json().catch(() => null));
  await shot(app, 'combo');
  if (!list.length) throw new Error('Không có gói cước nào ở địa chỉ này (Combo gợi ý trống – xem ảnh trong output/debug)');
  return list;
}

/** Danh sách gói từ response package-view/list, đúng thứ tự thẻ trên hàng "Combo gợi ý cho bạn". */
export function parsePackages(json) {
  const list = json?.Data?.Result?.Packages;
  return Array.isArray(list) ? list.map((p) => ({
    group: p.PackageGroupTypeName, index: p.PackageIndex, name: p.PackageName,
    monthly: p.MonthlyFee, setup: p.ExtraFee, total: p.Total, products: p.ProductListName || '', services: p.ServiceListName || '',
  })) : [];
}

const CARD_W = 229; // bề rộng 1 thẻ gói trên hàng combo (cuộn ngang)
const pkgKey = (p) => `${p.name}|${p.total}`;
// Nhãn thẻ: "Giga F1 - 1T / 210.000 đ/ 1 tháng / Phí lắp đặt / 399.000 đ / Tổng / 399.000 đ"
const cardKey = (label) => {
  const parts = label.split(' / ');
  return `${parts[0].trim()}|${parts.at(-1).replace(/\D/g, '')}`;
};

/**
 * Chọn gói (nhóm combo + thứ tự trong nhóm, như API package-view/list).
 * Hàng thẻ là 1 danh sách ngang liền mạch cho mọi nhóm (tab chỉ cuộn tới đầu nhóm) -> đọc các thẻ đang hiện,
 * dò vị trí của chúng trong danh sách gói, cuộn ngang tới thẻ cần rồi bấm.
 */
export async function choosePackage(app, packages, combo, index, onLog) {
  const t = packages.findIndex((p) => p.group === combo && p.index === index);
  if (t < 0) {
    const groups = [...new Set(packages.map((p) => p.group))].join(', ');
    throw new Error(`Không có gói "${combo}" thứ ${index} ở địa chỉ này. Nhóm hiện có: ${groups} – bấm "Tải gói" để lấy lại danh sách`);
  }
  const target = packages[t];
  onLog(`Chọn gói ${target.name} (${combo} #${index}) – tổng ${target.total.toLocaleString('vi-VN')}đ`);
  const tab = await findNode(app, new RegExp(`^${combo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  if (tab) {
    await app.mouse.click(tab.x, tab.y);
    await sleep(1200);
  }
  let expect = packages.findIndex((p) => p.group === combo);
  for (let i = 0; i < 10; i++) {
    const cards = (await nodes(app))
      .filter((n) => n.role === 'group' && / \/ Tổng \/ /.test(n.label) && n.y > 450 && n.y < 720)
      .sort((a, b) => a.x - b.x);
    // Vị trí s trong danh sách gói mà dãy thẻ đang hiện khớp, gần chỗ dự đoán nhất
    let s = -1;
    for (let k = 0; k + cards.length <= packages.length; k++) {
      if (cards.length && cards.every((c, j) => cardKey(c.label) === pkgKey(packages[k + j])) && (s < 0 || Math.abs(k - expect) < Math.abs(s - expect))) s = k;
    }
    if (s >= 0) {
      const card = cards[t - s];
      if (card && card.w >= CARD_W - 10) {
        if (await openQuote(app, card, onLog)) return target;
        break;
      }
      // Cuộn để thẻ cần chọn nằm thứ 3 từ trái
      const delta = (t - s - 2) * CARD_W;
      await app.mouse.move(720, 577);
      await app.mouse.wheel(delta, 0);
      expect = s + Math.round(delta / CARD_W);
    }
    await sleep(1500);
  }
  throw new Error(`Không chọn được gói ${target.name} trên màn combo (xem ảnh trong output/debug)`);
}

const ERROR_RE = /Đã có lỗi xảy ra|Thời gian phản hồi quá lâu/;

/**
 * Bấm thẻ gói rồi chờ sang màn báo giá (hết hàng thẻ combo). Stag chậm hay báo "Thời gian phản hồi quá lâu"
 * -> đóng hộp lỗi, bấm lại (tối đa 3 lần).
 */
async function openQuote(app, card, onLog) {
  for (let i = 0; i < 3; i++) {
    await app.mouse.click(card.x, card.y);
    for (const end = Date.now() + 45000; Date.now() < end; await sleep(600)) {
      const ns = await nodes(app);
      if (ns.some((n) => ERROR_RE.test(n.label))) {
        onLog('Sale Platform báo lỗi/chậm khi chọn gói – đóng thông báo, thử lại');
        const ok = ns.find((n) => /^Xác nhận$/.test(n.label));
        if (ok) await app.mouse.click(ok.x, ok.y);
        await sleep(3000);
        break;
      }
      if (!ns.some((n) => n.role === 'group' && / \/ Tổng \/ /.test(n.label))) return true;
    }
  }
  return false;
}

export /** Trả về phương thức đã dùng. Danh sách khác nhau theo dịch vụ -> không có phương thức đã chọn thì giữ mặc định của portal. */
async function choosePayment(app, payment, onLog) {
  onLog(`Phương thức thanh toán: ${payment}`);
  // Màn báo giá: có đủ ô Đối tượng KH + ô PTTT (nhãn ô đối tượng đổi theo loại KH: Gia đình, Doanh nghiệp…)
  let current = null;
  for (const end = Date.now() + 20000; !current && Date.now() < end; await sleep(400)) {
    if ((await quoteGroups(app)).length >= 2) current = true;
  }
  if (!current) throw new Error('Không vào được màn báo giá sau khi chọn gói (xem ảnh trong output/debug)');
  await app.mouse.move(720, 400);
  await app.mouse.wheel(0, -3000);
  await sleep(500);
  // Ô phương thức thanh toán = ô chọn thứ 2 trên màn (sau Đối tượng KH); vị trí đổi theo đối tượng KH
  const pay = (await quoteGroups(app))[1];
  await app.mouse.click(720, pay ? pay.y : 640);
  const re = new RegExp(`^${payment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  // Danh sách PTTT mở ra (chờ tối đa 3s thấy tên PTTT)
  for (const end = Date.now() + 3000; Date.now() < end && !(await findNode(app, re)); ) await sleep(300);
  for (let i = 0; i < 12; i++) {
    const n = await findNode(app, re);
    if (n && n.y > 150 && n.y < 790) {
      // Chọn PTTT -> app tính lại giá (order/validate-price + order/total) -> chờ API xong thay vì chờ cố định
      const total = waitApi(app, /order\/total/, 6000);
      await app.mouse.click(n.x, n.y);
      await total;
      await sleep(400);
      return payment;
    }
    await app.mouse.move(720, 500);
    await app.mouse.wheel(0, 250);
    await sleep(700);
  }
  const list = (await nodes(app)).filter((n) => n.role === 'button' && n.label);
  if (!list.length) throw new Error(`Không thấy phương thức thanh toán "${payment}" trong danh sách`);
  const first = list[0];
  onLog(`⚠ Dịch vụ này không có "${payment}" (có: ${list.map((n) => n.label).join(', ')}) → dùng ${first.label}`);
  await app.mouse.click(first.x, first.y);
  await sleep(2000);
  return first.label;
}

export async function saveCustomer(app, onLog) {
  onLog('Lưu thông tin khách hàng (Họ tên + SĐT)');
  await app.mouse.move(720, 400);
  await app.mouse.wheel(0, -3000);
  await sleep(500);
  await tapLabel(app, /^Cập nhật$/, [1387, 411], 300);
  // Form KH mở (get-master-data) -> có nút "Xác nhận & Lưu"
  await waitNode(app, /^Xác nhận & Lưu$/, 6000);
  await sleep(500);
  const saved = waitApi(app, /validate-customer-info/, 8000);
  await tapLabel(app, /^Xác nhận & Lưu$/, [720, 766], 0);
  await saved;
  await sleep(800);
}

async function createQuote(app, codes, shot, onLog) {
  onLog('Tạo báo giá');
  codes.setPhase('quote');
  await tapLabel(app, /^Tạo báo giá$/, [1072, 759]);
  // Chữ trong hộp thoại không có trong semantics, chỉ có nút: [Hủy + Xác nhận] = cảnh báo trùng đơn, [Xác nhận] = lỗi
  // Kiểm tra mỗi 1,5s (trước: chờ cố định 4s/vòng). Hộp chỉ có [Xác nhận] phải thấy 2 lần liên tiếp mới coi là lỗi
  // (hộp cảnh báo trùng đơn có lúc hiện nút Xác nhận trước, nút Hủy sau)
  let errorSeen = 0;
  for (const end = Date.now() + 32000; Date.now() < end; ) {
    await sleep(700);
    const list = await nodes(app);
    if (list.some((n) => /^Tạo hợp đồng$/.test(n.label))) return;
    const ok = list.find((n) => n.role === 'button' && /^Xác nhận$/.test(n.label));
    const cancel = list.find((n) => n.role === 'button' && /^Hủy$/.test(n.label));
    if (ok && cancel) {
      onLog('Cảnh báo trùng đơn (địa chỉ/SĐT test dùng chung) → Xác nhận');
      await app.mouse.click(ok.x, ok.y);
      errorSeen = 0;
      await sleep(1000);
      continue;
    }
    errorSeen = ok ? errorSeen + 1 : 0;
    if (errorSeen >= 2) {
      const file = await shot(app, 'loi-bao-gia');
      const why = codes.lastMessage();
      throw new Error(`Portal báo lỗi khi tạo báo giá${why ? `: ${why}` : ''} – xem ảnh ${path.basename(file)}`);
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
  let hdErrorSeen = 0;
  let surveyRetries = 0;
  for (const end = Date.now() + 150000; Date.now() < end; await sleep(700)) {
    const list = await nodes(app);
    const has = (re) => list.find((n) => re.test(n.label));
    if (has(/^Thanh toán$/)) return;
    // Khảo sát Định danh đã lưu thành công + đã có mã HĐ = xong; không chờ app tải lại chi tiết đơn/báo giá
    // để hiện màn "Thanh toán" (quotation/detail + order/detail trên stag có lúc mất 10-15s)
    if (surveyed && codes.contractCode() && codes.ok(/update-contract-identify/)) {
      // Bookport chỉ có trong order/detail app gọi ~1-2s sau khảo sát -> chờ thêm tối đa 4s, quá thì bỏ qua
      for (const stop = Date.now() + 4000; !codes.bookport() && Date.now() < stop; ) await sleep(300);
      return;
    }
    // Màn "Cảnh báo!!! / Đã có lỗi xảy ra! (mã)" + bước bị lỗi + nút "Quay lại" = backend từ chối tạo HĐ -> báo luôn lý do
    // (có lúc chữ cảnh báo không vào semantics, màn chỉ còn mỗi nút "Quay lại") -> lý do lấy từ response API
    if (has(/^Quay lại$/) && (has(/^(Cảnh báo|Đã có lỗi xảy ra)/) || list.length <= 2)) {
      const file = await shot(app, 'loi-hop-dong');
      const why = [...new Set(list.filter((n) => /không hợp lệ|Đã xảy ra lỗi/i.test(n.label)).map((n) => n.label))].join(' – ') || codes.lastMessage();
      throw new Error(`Portal báo lỗi khi tạo hợp đồng: ${why || 'không rõ lý do'} – báo giá đã tạo, xem ảnh ${path.basename(file)}`);
    }
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
        await sleep(400);
      }
      await shot(app, 'khao-sat-da-chon');
      await tapLabel(app, /^Hoàn tất$/, [720, 774]);
      surveyed = true;
      continue;
    }
    const ok = list.find((n) => n.role === 'button' && /^Xác nhận$/.test(n.label));
    hdErrorSeen = ok && !has(/^Hủy$/) ? hdErrorSeen + 1 : 0;
    // Lỗi khi gửi khảo sát Định danh (API update-contract-identify stag hay quá giờ) – HĐ đã tạo: đóng hộp, gửi lại khảo sát
    if (hdErrorSeen >= 2 && surveyed && surveyRetries < 2) {
      surveyRetries += 1;
      onLog(`Portal lỗi khi lưu khảo sát Định danh (stag chậm) → gửi lại (${surveyRetries}/2)`);
      await shot(app, 'loi-khao-sat');
      await app.mouse.click(ok.x, ok.y);
      await sleep(1500);
      await tapLabel(app, /^Hoàn tất$/, [720, 774]);
      hdErrorSeen = 0;
      continue;
    }
    if (hdErrorSeen >= 2) {
      const hd = codes.contractCode();
      if (hd && surveyed) {
        const file = await shot(app, 'loi-khao-sat');
        throw new Error(`Đã tạo HĐ ${hd} nhưng portal lỗi khi lưu khảo sát Định danh KH (đã thử lại 2 lần) – vào HĐ làm lại khảo sát. Ảnh ${path.basename(file)}`);
      }
      const file = await shot(app, 'loi-hop-dong');
      throw new Error(`Portal báo lỗi khi tạo hợp đồng – xem ảnh ${path.basename(file)} trong output/debug`);
    }
  }
  const file = await shot(app, 'hd-cho-lau');
  writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify(await nodes(app), null, 1));
  throw new Error('Tạo hợp đồng chưa xong sau 2,5 phút (xem ảnh trong output/debug)');
}

function orderOptions(input) {
  const d = config.defaults;
  const opts = {
    phone: String(input.phone || d.phone).trim(),
    address: String(input.address || d.address).trim(),
    coords: String(input.coords ?? d.coords).trim(),
    combo: String(input.combo || d.combo).trim(),
    comboIndex: Number(input.comboIndex) || d.comboIndex,
    payment: String(input.payment || d.payment).trim(),
    contract: input.contract !== false,
    service: String(input.service || 'internet'),
    fields: input.fields && typeof input.fields === 'object' ? input.fields : {},
    withInternet: Boolean(input.withInternet),
    customerType: String(input.customerType || DEFAULT_CUSTOMER_TYPE).trim(),
    org: input.org && typeof input.org === 'object' ? input.org : {},
  };
  const ctype = findCustomerType(opts.customerType);
  if (!ctype) {
    throw Object.assign(new Error(`Không có đối tượng khách hàng "${opts.customerType}" (có: ${CUSTOMER_TYPES.map((t) => t.name).join(', ')})`), { status: 400 });
  }
  opts.customerType = ctype.name;
  if (ctype.group !== 'Cá nhân') {
    for (const k of ['orgPhone', 'contactPhone']) {
      if (opts.org[k] && !/^0\d{9}$/.test(String(opts.org[k]).trim())) throw Object.assign(new Error('SĐT doanh nghiệp / liên hệ cần 10 số, bắt đầu bằng 0'), { status: 400 });
    }
    if (opts.org.taxCode && !/^\d{10}(-\d{3})?$/.test(String(opts.org.taxCode).trim())) {
      throw Object.assign(new Error('Mã số thuế dạng 10 số (hoặc 10 số-3 số chi nhánh)'), { status: 400 });
    }
  }
  if (opts.service !== 'internet' && !findService(opts.service)) throw Object.assign(new Error(`Không có dịch vụ "${opts.service}"`), { status: 400 });
  // Nhiều dịch vụ trong 1 đơn: services = [{ id, fields }], thêm lần lượt vào giỏ. Không có thì lấy service/fields (1 dịch vụ như cũ)
  const list = Array.isArray(input.services) && input.services.length ? input.services
    : opts.service !== 'internet' ? [{ id: opts.service, fields: opts.fields }] : [];
  opts.services = list.map((x) => {
    const id = String(typeof x === 'string' ? x : x?.id || '').trim();
    if (!findService(id)) throw Object.assign(new Error(`Không có dịch vụ "${id}"`), { status: 400 });
    const fields = x?.fields && typeof x.fields === 'object' ? x.fields : {};
    return { id, fields };
  });
  if (opts.services.length > 8) throw Object.assign(new Error('Tối đa 8 dịch vụ trong 1 đơn'), { status: 400 });
  if (opts.services.length > 1 || Array.isArray(input.services)) opts.service = opts.services.map((x) => x.id).join('+') || 'internet';
  if (!/^0\d{9}$/.test(opts.phone)) throw Object.assign(new Error('SĐT khách hàng cần 10 số, bắt đầu bằng 0'), { status: 400 });
  if (opts.coords && !/^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(opts.coords)) {
    throw Object.assign(new Error('Toạ độ dạng "vĩ độ, kinh độ", vd 10.7733664, 106.6944494'), { status: 400 });
  }
  return opts;
}

/** Trang portal để chạy: đóng các tab Tạo báo giá của lượt trước (không để dồn tab khi chạy ngầm). */
export async function portalPage(headless) {
  const ctx = await getContext({ headless });
  for (const p of ctx.pages()) if (p.url().includes('/ban-hang/')) await p.close().catch(() => {});
  return ctx.pages().find((p) => p.url() === 'about:blank' || p.url().includes('portal-sop')) || (await ctx.newPage());
}

/**
 * Lấy danh sách gói (Combo gợi ý) ở 1 địa chỉ: mở Bán mới cho KH -> chọn địa chỉ -> đọc API package-view/list.
 * Không tạo gì trên portal (đóng tab Tạo báo giá khi xong). input: { phone, address, coords, headless }
 */
export async function fetchPackages(input, onLog = () => {}) {
  const opts = orderOptions(input);
  const shot = shooter(`goi-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`);
  const page = await portalPage(input.headless);
  let app = null;
  try {
    await openCustomer(page, opts.phone, onLog);
    app = await openNewSale(page, shot, onLog);
    const packages = await chooseAddress(app, opts.address, opts.coords, shot, onLog);
    onLog(`✔ ${packages.length} gói ở địa chỉ này`);
    return { address: opts.address, packages };
  } catch (err) {
    await shot(app || page, 'loi');
    throw err;
  } finally {
    await app?.close().catch(() => {});
  }
}

/** Danh sách KH trong "Khách hàng của tôi" (tab Tất cả, mọi trang): [{ name, phone }] */
export async function fetchCustomers(input = {}, onLog = () => {}) {
  const page = await portalPage(input.headless);
  onLog('Đọc danh sách "Khách hàng của tôi"');
  await openPortal(page, config.sopUrl + LIST_PATH, onLog);
  await page.getByText(/^Tất cả/).first().click().catch(() => {});
  await sleep(2000);
  const list = [];
  for (let i = 0; i < 30; i++) {
    // Cột "Tên khách hàng": dòng 1 tên, dòng 2 SĐT
    for (const cell of await page.locator('.ant-table-tbody tr td:nth-child(2)').allInnerTexts()) {
      const [name = '', phone = ''] = cell.split('\n').map((x) => x.trim()).filter(Boolean);
      if (/^0\d{9}$/.test(phone) && !list.some((c) => c.phone === phone)) list.push({ name, phone });
    }
    const next = page.locator('.ant-pagination-next').first();
    if (!(await next.count()) || (await next.getAttribute('aria-disabled')) === 'true' || /disabled/.test((await next.getAttribute('class')) || '')) break;
    await next.click();
    await sleep(2000);
  }
  onLog(`✔ ${list.length} khách hàng`);
  return list;
}

/** Danh sách gói + chu kỳ cước của 1 dịch vụ (API của form dịch vụ, theo địa chỉ). Không tạo gì trên portal. */
export async function fetchServiceOptions(input, onLog = () => {}) {
  const opts = orderOptions(input);
  const service = findService(opts.service);
  if (!service) throw Object.assign(new Error('Chọn dịch vụ trước'), { status: 400 });
  const shot = shooter(`dv-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`);
  const page = await portalPage(input.headless);
  let app = null;
  try {
    await openCustomer(page, opts.phone, onLog);
    app = await openNewSale(page, shot, onLog);
    await chooseAddress(app, opts.address, opts.coords, shot, onLog);
    const { options, form } = await readServiceOptions(app, service, codeCollector(app), shot, onLog);
    onLog(`✔ ${options.length} gói ${service.name}`);
    return { id: service.id, options, form };
  } catch (err) {
    await shot(app || page, 'loi');
    throw err;
  } finally {
    await app?.close().catch(() => {});
  }
}

/**
 * Tạo 1 đơn (+ hợp đồng) cho KH có sẵn.
 * input: { phone, address, coords, payment, contract (bool, mặc định true), headless (bool: chạy ngầm / hiện cửa sổ),
 *          service ('internet' hoặc id trong SERVICES), combo (nhóm gói), comboIndex (thứ tự gói trong nhóm),
 *          fields ({ tên ô form dịch vụ: giá trị }), withInternet (dịch vụ mua kèm combo Internet) }
 * onPackages(address, packages): nhận danh sách gói đọc được ở địa chỉ này (để lưu lại cho giao diện)
 */
export async function createOrder(input, onLog = () => {}, onPackages = () => {}) {
  const opts = orderOptions(input);
  const services = opts.services.map((x) => ({ ...x, service: findService(x.id) }));
  const needInternet = !services.length || opts.withInternet || services.some((x) => x.service.needsInternet);
  const runId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const shot = shooter(runId);
  const record = {
    runId, startedAt: new Date().toISOString(), ...opts, serviceName: [needInternet && services.length ? 'Internet' : '', ...services.map((x) => x.service.name)].filter(Boolean).join(' + ') || 'Internet', packageName: '', customer: '', orderCode: '', contractCode: '', quoteLink: '', bookport: '', error: '',
  };
  const page = await portalPage(input.headless);
  let app = null;
  let codes = null;
  try {
    record.customer = await openCustomer(page, opts.phone, onLog);
    app = await openNewSale(page, shot, onLog);
    codes = codeCollector(app);
    await shot(app, 'tao-bao-gia');
    const packages = await chooseAddress(app, opts.address, opts.coords, shot, onLog);
    onPackages(opts.address, packages);
    const combo = needInternet ? (await choosePackage(app, packages, opts.combo, opts.comboIndex, onLog)).name : '';
    record.packageName = combo;
    if (services.length) {
      if (needInternet) {
        // Chọn combo nhảy thẳng sang màn báo giá -> quay lại để thêm dịch vụ vào giỏ (combo vẫn trong giỏ)
        await waitNode(app, /^Đối tượng khách hàng$|^Gia đình$/, 20000);
        await sleep(3000); // màn báo giá còn tải (spinner) thì nút quay lại chưa ăn
        if (!(await clickUntilNode(app, 23, 25, (n) => /^Internet$/.test(n.label), { wait: 6000 }))) throw new Error('Không quay lại được màn chọn dịch vụ sau khi chọn combo');
      }
      // Mỗi dịch vụ: mở ô dịch vụ -> điền form -> Xác nhận (vào giỏ, vẫn ở màn chọn dịch vụ) -> dịch vụ tiếp theo
      const details = [];
      for (const [i, x] of services.entries()) {
        if (services.length > 1) onLog(`Dịch vụ ${i + 1}/${services.length}: ${x.service.name}`);
        const { chosen } = await addService(app, x.service, x, codes, shot, onLog);
        details.push(`${x.service.name}: ${Object.values(chosen).slice(0, 2).join(' · ')}`);
        record.packageName = [combo, ...details].filter(Boolean).join(' + ');
      }
      await openCart(app, codes, shot, onLog);
    }
    await shot(app, 'man-bao-gia');
    record.customerType = await chooseCustomerType(app, opts.customerType, onLog);
    if (isOrgType(opts.customerType)) {
      // Doanh nghiệp / tổ chức: thông tin KH bị xoá khi đổi đối tượng -> nhập form doanh nghiệp (ô trống = dữ liệu test)
      const o = opts.org;
      const org = {
        company: String(o.company || 'Công ty TNHH QC Test').trim(),
        taxCode: String(o.taxCode || randomTaxCode()).trim(),
        issuePlace: String(o.issuePlace || 'Sở KH&ĐT TP.HCM').trim(),
        gpkdAddress: String(o.gpkdAddress || opts.address).trim(),
        orgPhone: String(o.orgPhone || opts.phone).trim(),
        contactPhone: String(o.contactPhone || opts.phone).trim(),
        email: String(o.email || '').trim(),
        representative: String(o.representative || record.customer || 'QC Test').trim(),
      };
      record.company = org.company;
      record.taxCode = org.taxCode;
      await fillOrgCustomer(app, org, shot, onLog);
      record.payment = await choosePayment(app, opts.payment, onLog);
    } else {
      record.payment = await choosePayment(app, opts.payment, onLog);
      await saveCustomer(app, onLog);
    }
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
    if (codes?.timing().length) writeFileSync(path.join(OUTPUT_DIR, 'debug', `${runId}-api-timing.json`), JSON.stringify(codes.timing(), null, 1));
    if (codes?.trace().length) writeFileSync(path.join(OUTPUT_DIR, 'debug', `${runId}-api-trace.jsonl`), codes.trace().join('\n'));
  }
}
