#!/usr/bin/env node
// Giao diện web chạy trên máy: npm run ui -> http://localhost:3009
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { SOURCES } from '../config/environments.js';
import { config, ROOT_DIR } from './core/env.js';
import { log } from './core/logger.js';
import { EcomService } from './ecom/orders.js';

const PORT = Number(process.env.UI_PORT) || 3009;
// Chỉ nghe trên máy này (phiên SPF nằm ở server)
const HOST = '127.0.0.1';
const PAGE = path.join(ROOT_DIR, 'public', 'index.html');
const svc = new EcomService();

// Các thao tác ghi (tạo / ngắt kết nối) chạy tuần tự
let chain = Promise.resolve();
const serial = (fn) => {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
};

const routes = {
  'GET /api/config': async () => ({
    env: config.name, baseUrl: config.baseUrl + config.basePath, defaults: config.defaults, sources: SOURCES, session: svc.session(),
  }),
  'POST /api/login': async ({ body }) => svc.login(body.token),
  'POST /api/logout': async () => svc.logout(),
  'POST /api/settings/defaults': async ({ body }) => svc.saveDefaults(body),

  'GET /api/locations/provinces': async () => svc.provinces(),
  'GET /api/locations/districts': async ({ q }) => svc.districts(q.get('locationId')),
  'GET /api/locations/wards': async ({ q }) => svc.wards(q.get('locationId'), q.get('districtId')),
  'GET /api/locations/streets': async ({ q }) => svc.streets(q.get('locationId'), q.get('districtId'), q.get('wardId')),

  'POST /api/load': async ({ body }) => svc.load(body.source, body.refCode),
  'POST /api/search': async ({ body }) => svc.search(body.source, body.value, body.by),
  'POST /api/orders': async ({ body }) =>
    serial(() => svc.create({ ...body, onStep: (t) => log.info(`${body.source} ${body.refCode} · ${t}`) })),
  'POST /api/orders/disconnect': async ({ body }) => serial(() => svc.disconnect(body.orderId, body.saleTeamId)),
  'POST /api/orders/connect': async ({ body }) => serial(() => svc.connect(body.orderId, body.saleTeamId)),
  'POST /api/orders/status': async ({ body }) => svc.statuses([].concat(body.orderIds || []), body.source),
  'GET /api/history': async () => svc.history(),

  'GET /api/settle/tasks': async ({ q }) => svc.settleTasks(q.get('source')),
  'POST /api/settle': async ({ body }) => serial(() => svc.settle(body)),
  'POST /api/settle/status': async ({ body }) => svc.settleStatus(body.source, body.orderId),
  'GET /api/settle/history': async () => svc.settleHistory(),
};

const send = (res, status, data, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, await readFile(PAGE, 'utf8'), 'text/html; charset=utf-8');
    }
    if (url.pathname === '/icon.svg') return send(res, 200, await readFile(path.join(ROOT_DIR, 'assets', 'icon.svg'), 'utf8'), 'image/svg+xml');
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return send(res, 404, { error: 'Not found' });
    let body = {};
    if (req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      body = raw ? JSON.parse(raw) : {};
    }
    send(res, 200, await route({ body, q: url.searchParams }));
  } catch (e) {
    const status = e.status || 500;
    if (e instanceof SyntaxError && !e.status) return send(res, 400, { error: 'Dữ liệu gửi lên không phải JSON hợp lệ' });
    log.error(`${req.method} ${url.pathname} → ${status}: ${e.message}`);
    send(res, status, { error: e.message, code: e.code, orders: e.orders, steps: e.steps });
  }
});

server.on('error', (e) => {
  log.error(e.code === 'EADDRINUSE' ? `Cổng ${PORT} đang bận – tool đã chạy rồi, hoặc đổi UI_PORT trong .env` : e.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const link = `http://localhost:${PORT}`;
  log.ok(`Tạo đơn TMĐT Tool (${config.name}) → ${link}`);
  log.info(`SPF Web Admin: ${config.baseUrl}${config.basePath} · phiên: ${svc.session().loggedIn ? 'đã có' : 'chưa đăng nhập (nhập Access Token trên UI)'}`);
  if (!process.argv.includes('--no-open')) spawn('xdg-open', [link], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
});
