#!/usr/bin/env node
// Giao diện web chạy trên máy: npm run ui -> http://localhost:3001
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { config, ROOT_DIR, saveDefaults } from './core/env.js';
import { log } from './core/logger.js';
import { OrderService } from './ecp/orders.js';
import { cardStatus } from './ecp/payment.js';
import { BatchRunner, DEFAULT_CONCURRENCY, MAX_CONCURRENCY } from './ecp/batch.js';
import { listFiles, readCatalog, addRow } from './data/catalog.js';
import { parseProductUrl } from './ecp/product.js';

const PORT = Number(process.env.UI_PORT) || 3001;
// Chỉ nghe trên máy này (tool không có đăng nhập, ai vào được trang là tạo đơn được)
const HOST = '127.0.0.1';
const PAGE = path.join(ROOT_DIR, 'public', 'index.html');
// Phiên bản hiện tại (package.json) – hiện trên header UI; lịch sử cập nhật = CHANGELOG.md
const VERSION = JSON.parse(await readFile(path.join(ROOT_DIR, 'package.json'), 'utf8')).version;

const orders = new OrderService();
const batch = new BatchRunner(orders);

const routes = {
  'GET /api/config': async () => ({ version: VERSION, env: config.name, webUrl: config.webUrl, defaults: config.defaults, cards: cardStatus() }),

  // Đặt mặc định mới cho SĐT / link gói (lưu output/settings.json)
  'POST /api/settings/defaults': async ({ body }) => {
    if (body.phone && !/^0\d{9}$/.test(String(body.phone).trim())) {
      throw Object.assign(new Error('Số điện thoại cần 10 số, bắt đầu bằng 0'), { status: 400 });
    }
    return saveDefaults(body);
  },

  // Danh mục địa chỉ cho các ô chọn
  'GET /api/locations/provinces': async () => orders.locations.provinces(),
  'GET /api/locations/wards': async ({ query }) => orders.locations.wards(query.get('provinceId')),
  'GET /api/locations/streets': async ({ query }) => orders.locations.streets(query.get('wardId')),
  'GET /api/locations/buildings': async ({ query }) => orders.locations.buildings(query.get('wardId')),

  // Link gói + địa chỉ -> chính sách, sản phẩm, dịch vụ bổ sung, PTTT, giá (tạo sẵn 1 checkout)
  'POST /api/prepare': async ({ body }) => orders.prepare(body),

  // Đổi địa chỉ / sản phẩm / dịch vụ bổ sung -> cập nhật lại các lựa chọn + PTTT + giá
  'POST /api/prepare/update': async ({ body }) => orders.update(body),

  // Tạo 1 đơn / request
  'POST /api/orders': async ({ body }) => {
    const r = await orders.create(body);
    log.ok(`${r.summary.code} | ${r.summary.productName} | ${r.summary.paymentName} | ${r.summary.statusLabel}`);
    return r;
  },

  // Tự thanh toán bằng thẻ test (mở Chrome trên máy, chờ tới khi cổng báo kết quả ~30-60s)
  'POST /api/orders/pay': async ({ body }) => {
    const r = await orders.pay(body.code, { onStep: (t) => log.info(`${body.code} · ${t}`) });
    (r.result === 'success' ? log.ok : log.error)(`${r.code} | tự thanh toán ${r.paymentCode} (thẻ ${r.card}): ${r.result} – ${r.message}`);
    return r;
  },

  // Đơn còn chờ thanh toán: đổi PTTT (online) + hoàn tất lại -> link/QR thanh toán mới
  'POST /api/orders/repay': async ({ body }) => {
    const r = await orders.repay(body.code, { paymentCode: body.paymentCode });
    log.ok(`${r.summary.code} | đổi PTTT -> ${r.summary.paymentName}`);
    return r;
  },

  'POST /api/orders/status': async ({ body }) => orders.statuses(body.codes || []),
  'POST /api/orders/detail': async ({ body }) => orders.detail(body.code || ''),
  'GET /api/history': async () => orders.history(),
  'GET /api/changelog': async () => ({ version: VERSION, text: await readFile(path.join(ROOT_DIR, 'CHANGELOG.md'), 'utf8').catch(() => '') }),

  // Danh sách link gói (data/*.csv) cho ô "Chọn gói" + chế độ tạo hàng loạt
  'GET /api/catalog': async ({ query }) => {
    const { file, header, rows } = readCatalog(query.get('file') || undefined);
    return { files: listFiles(), file, header, rows: rows.map(({ cells, ...r }) => r), concurrency: { default: DEFAULT_CONCURRENCY, max: MAX_CONCURRENCY } };
  },

  // Thêm gói vào danh sách: kiểm tra link là gói thật (ECP/FCP/Shop) rồi ghi cuối file. force = bỏ qua kiểm tra (gói tạm lỗi trên staging)
  'POST /api/catalog/add': async ({ body }) => {
    const group = String(body.group || '').trim();
    let name = String(body.name || '').trim();
    const raw = String(body.url || '').trim();
    if (!group) throw Object.assign(new Error('Nhập Tên nhóm'), { status: 400 });
    if (!/^https?:\/\//i.test(raw)) throw Object.assign(new Error('Link cần dạng đầy đủ, vd https://staging.fpt.vn/internet/goi-giga'), { status: 400 });
    const { sourceUrl } = parseProductUrl(raw, config.webUrl); // đúng môi trường + lấy được mã gói
    let found = null;
    if (!body.force) {
      try {
        found = await orders.identify(sourceUrl);
      } catch (err) {
        throw Object.assign(new Error(`Không kiểm tra được gói: ${err.message}`), { status: 422, code: 'PACKAGE_CHECK_FAILED' });
      }
    }
    if (!name) name = found?.name || sourceUrl.split('/').pop();
    const row = addRow(body.file, { group, type: body.type, name, url: sourceUrl });
    log.ok(`Thêm gói vào data/${body.file || 'listgoi.csv'}: #${row.no} ${row.name} (${found?.source || 'chưa kiểm tra'})`);
    const { cells, ...added } = row;
    return { row: added, source: found?.source || null, checked: Boolean(found) };
  },

  // Tạo hàng loạt: chạy song song trên server, UI hỏi tiến độ bằng GET /api/batch?id=
  'POST /api/batch': async ({ body }) => {
    const job = batch.start(body);
    log.info(`Hàng loạt ${job.id}: ${job.rows.length} dòng từ data/${job.file}, ${job.concurrency} luồng, PTTT ${job.pmMode}`);
    job.done.then(() => {
      const v = BatchRunner.view(job);
      log.ok(`Hàng loạt ${job.id} xong: ${v.counts.ok}/${v.counts.total} thành công → output/${v.outFile}`);
    });
    return BatchRunner.view(job);
  },
  'GET /api/batch': async ({ query }) => BatchRunner.view(batch.get(query.get('id'))),
};

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw Object.assign(new Error('Request quá lớn'), { status: 413 });
  }
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, await readFile(PAGE, 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/icon.svg') {
      return send(res, 200, await readFile(path.join(ROOT_DIR, 'assets', 'icon.svg'), 'utf8'), 'image/svg+xml');
    }
    if (req.method === 'GET' && url.pathname === '/api/batch/download') {
      const job = batch.get(url.searchParams.get('id'));
      if (job.running) return send(res, 409, { error: 'Lượt này đang chạy – chờ xong mới tải file' });
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${path.basename(job.outFile)}"`,
        'Cache-Control': 'no-store',
      });
      return res.end(await readFile(job.outFile));
    }
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { error: 'Không tìm thấy' });
    const body = req.method === 'POST' ? await readBody(req) : {};
    send(res, 200, await handler({ body, query: url.searchParams }));
  } catch (err) {
    log.error(err.message);
    send(res, err.status >= 400 && err.status < 500 ? err.status : 500, { error: err.message, code: err.code });
  }
});

function openBrowser(target) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]]
    : process.platform === 'darwin' ? ['open', [target]]
    : ['xdg-open', [target]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

server.listen(PORT, HOST, () => {
  const target = `http://localhost:${PORT}`;
  log.ok(`FPT.vn Order Tool v${VERSION} (${config.name}) đang chạy: ${target}  — Ctrl+C để dừng`);
  const p = config.proxy;
  log.info(p ? `Gọi API ECP qua proxy ${new URL(p.url).host} – ${p.source}` : 'Gọi API ECP trực tiếp (không proxy)');
  if (!process.argv.includes('--no-open')) openBrowser(target);
});
