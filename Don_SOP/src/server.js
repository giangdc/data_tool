// Giao diện web tạo đơn + API. Cổng mặc định 3008 (UI_PORT trong .env).
import http from 'node:http';
import fs from 'node:fs';
import { createQuote, createContract, listWards, listStreets, listPackages, checkPrice, desktopServices, serviceTemplateInfo, createServiceQuote, servicePackages, serviceDevices } from './app/order.js';
import { createMobileOrder, HOUSE_TYPES } from './app/order-mobile.js';
import { searchContracts, contractInfo, crossServices, createCrossSell, crossSellContractFor } from './app/cross-sell.js';
import { Adb } from './core/adb.js';
import { history } from './core/store.js';

const ROOT = new URL('../', import.meta.url);
const env = (() => { try { return Object.fromEntries(fs.readFileSync(new URL('.env', ROOT), 'utf8').split('\n').map((l) => l.match(/^(\w+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()])); } catch { return {}; } })();
const PORT = Number(process.env.UI_PORT || env.UI_PORT || 3008);
// Node chỉ đọc NODE_USE_ENV_PROXY lúc khởi động -> nếu máy có proxy mà chưa bật thì chạy lại chính nó với biến này.
if (!process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy)) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
}

let mobileJob = null;
// Danh sách lựa chọn của từng ô trong sheet dịch vụ, đọc từ app (chế độ explore) và lưu lại.
const OPT_FILE = new URL('output/service-options.json', ROOT);
const readOpts = () => { try { return JSON.parse(fs.readFileSync(OPT_FILE, 'utf8')); } catch { return {}; } };
const saveOpts = (service, fields) => {
  const all = readOpts();
  all[service] = { at: new Date().toISOString(), fields: (fields || []).filter((f) => f.kind === 'list').map((f) => ({ section: f.section, title: f.title, value: f.value, options: f.options || [] })) };
  fs.mkdirSync(new URL('output/', ROOT), { recursive: true });
  fs.writeFileSync(OPT_FILE, JSON.stringify(all, null, 2));
};
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type + '; charset=utf-8' }); res.end(body); };
const readBody = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && ['/', '/index.html'].includes(req.url.split('?')[0])) {
      return send(res, 200, fs.readFileSync(new URL('public/index.html', ROOT)), 'text/html');
    }
    if (req.method === 'GET' && req.url === '/api/defaults') {
      return send(res, 200, JSON.stringify({ phone: env.DEFAULT_PHONE || '', name: env.DEFAULT_NAME || '', address: [env.DEFAULT_ADDRESS, env.DEFAULT_WARD, env.DEFAULT_PROVINCE].filter(Boolean).join(', ') }));
    }
    if (req.method === 'GET' && req.url === '/api/history') {
      return send(res, 200, JSON.stringify(history()));
    }
    if (req.method === 'POST' && req.url === '/api/contract') {
      const { orderId } = JSON.parse((await readBody(req)) || '{}');
      try {
        // Đơn bán thêm: cập nhật vào HĐ gốc (contract/cross-selling/...), không tạo HĐ mới
        const row = history(1e9).find((r) => r.orderId === orderId);
        const c = row?.crossSellOf ? await crossSellContractFor(orderId, row.crossSellOf) : await createContract(orderId);
        if (row && !c.orderCode) c.orderCode = row.orderCode;
        return send(res, 200, JSON.stringify({ ok: true, contract: c }));
      }
      catch (e) { return send(res, 200, JSON.stringify({ ok: false, error: e.message })); }
    }
    // ---- Tạo đơn trên app Mobile (máy Android thật qua USB) ----
    const u = new URL(req.url, 'http://x');
    const J = (o) => send(res, 200, JSON.stringify(o));
    if (req.method === 'GET' && u.pathname === '/api/mobile/options') {
      const flow = JSON.parse(fs.readFileSync(new URL('config/mobile-flow.json', ROOT), 'utf8'));
      return J({ houseTypes: HOUSE_TYPES, defaults: flow.defaults, services: ['Internet', ...Object.keys(flow.servicePresets || {})], servicePresets: flow.servicePresets || {}, servicePhones: flow.servicePhones || {}, mobileDefaults: flow.mobileDefaults || {}, busy: mobileJob?.running || false });
    }
    if (req.method === 'GET' && u.pathname === '/api/mobile/device') {
      try { const a = new Adb(); const s = await a.pickDevice(); return J({ ok: !!s, serial: s }); }
      catch (e) { return J({ ok: false, error: e.message }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/mobile/wards') {
      try { return J({ ok: true, list: await listWards() }); } catch (e) { return J({ ok: false, error: e.message }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/mobile/streets') {
      try { return J({ ok: true, list: await listStreets({ ward: u.searchParams.get('ward') }) }); } catch (e) { return J({ ok: false, error: e.message }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/mobile/packages') {
      try {
        const g = await listPackages({ ward: u.searchParams.get('ward'), street: u.searchParams.get('street') });
        return J({ ok: true, list: (g.Net || Object.values(g).flat()).map((p) => ({ name: p.name, prepaids: p.prepaids.map((x) => x.label) })) });
      } catch (e) { return J({ ok: false, error: e.message }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/desktop/services') {
      return J({ ok: true, list: desktopServices().map((s) => serviceTemplateInfo(s)) });
    }
    if (req.method === 'GET' && u.pathname === '/api/desktop/svc-packages') {
      try { return J({ ok: true, list: await servicePackages(u.searchParams.get('service')) }); } catch (e) { return J({ ok: false, error: e.message }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/desktop/svc-devices') {
      try {
        const seen = new Set(), full = u.searchParams.get('full') === '1';
        const list = (await serviceDevices(u.searchParams.get('service'), u.searchParams.get('pkg'), u.searchParams.get('prepaid'))).filter((d) => !seen.has(d.label) && seen.add(d.label));
        // full=1 (tab Mobile): kèm các trường để chọn đúng ô trên sheet dịch vụ của app
        return J({ ok: true, list: full ? list.map((d) => ({ label: d.label, ParentName: d.ParentName, SubServiceName: d.SubServiceName, StatusName: d.StatusName, RevokeName: d.RevokeName, DeployTypeName: d.DeployTypeName })) : list.map((d) => d.label) });
      }
      catch (e) { return J({ ok: false, error: e.message }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/desktop/svc-check') {
      const o = JSON.parse((await readBody(req)) || '{}');
      try { return J(await createServiceQuote({ ...o, dryRun: true })); } catch (e) { return J({ ok: false, error: e.message.replace(/^App báo:\s*/, '') }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/desktop/check') {
      const o = JSON.parse((await readBody(req)) || '{}');
      return J(await checkPrice({ addressNo: o.soNha, package: o.goiDichVu, prepaidLabel: o.goiTinhCuoc }));
    }
    if (req.method === 'POST' && u.pathname === '/api/mobile/check') {
      const o = JSON.parse((await readBody(req)) || '{}');
      return J(await checkPrice({ ward: o.ward, street: o.street, addressNo: o.soNha, package: o.goiDichVu, prepaidLabel: o.goiTinhCuoc }));
    }
    if (req.method === 'POST' && u.pathname === '/api/mobile/create') {
      if (mobileJob?.running) return J({ ok: false, error: 'Máy đang chạy 1 đơn khác, đợi xong rồi chạy tiếp.' });
      const o = JSON.parse((await readBody(req)) || '{}');
      const isNet = !o.service || /^internet$/i.test(o.service);
      let first = `Dịch vụ: ${o.service || 'Internet'}`;
      if (isNet) {
        const c = await checkPrice({ ward: o.ward, street: o.street, addressNo: o.soNha, package: o.goiDichVu, prepaidLabel: o.goiTinhCuoc });
        if (!c.ok) return J({ ok: false, appError: true, error: c.error });
        first = `Chính sách OK — ${c.totalVAT.toLocaleString('vi-VN')}đ · ${c.policyName}`;
        delete o.fields;
      }
      mobileJob = { running: true, logs: [first], result: null, error: null };
      const job = mobileJob;
      createMobileOrder({ ...o, onLog: (m) => job.logs.push(m) })
        .then((r) => { job.result = r; })
        .catch((e) => { job.error = e.message; job.appError = e.appError; job.shot = e.shot; })
        .finally(() => { job.running = false; });
      return J({ ok: true, started: true });
    }
    if (req.method === 'GET' && u.pathname === '/api/mobile/service-options') {
      return J({ ok: true, ...(readOpts()[u.searchParams.get('service')] || { fields: [] }) });
    }
    if (req.method === 'POST' && u.pathname === '/api/mobile/explore') {
      if (mobileJob?.running) return J({ ok: false, error: 'Máy đang chạy 1 việc khác, đợi xong rồi chạy tiếp.' });
      const o = JSON.parse((await readBody(req)) || '{}');
      mobileJob = { running: true, kind: 'explore', logs: [`Đọc danh sách lựa chọn của "${o.service}" từ app (không tạo đơn)…`], result: null, error: null };
      const job = mobileJob;
      createMobileOrder({ ...o, contract: false, explore: true, onLog: (m) => job.logs.push(m) })
        .then((r) => { saveOpts(o.service, r.fields); job.result = { explored: true, service: o.service }; job.logs.push('✅ Đã lưu danh sách lựa chọn.'); })
        .catch((e) => { job.error = e.message; job.appError = e.appError; })
        .finally(() => { job.running = false; });
      return J({ ok: true, started: true });
    }
    if (req.method === 'GET' && u.pathname === '/api/mobile/status') {
      return J(mobileJob ? { running: mobileJob.running, logs: mobileJob.logs, result: mobileJob.result, error: mobileJob.error, appError: mobileJob.appError } : { running: false, logs: [] });
    }
    // Bán thêm vào hợp đồng có sẵn (FPT Play, Play SA, Thiết bị lẻ, ...)
    if (u.pathname.startsWith('/api/cross/')) {
      const sp = u.searchParams;
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {};
      try {
        if (u.pathname === '/api/cross/services') return J({ ok: true, list: crossServices() });
        if (u.pathname === '/api/cross/search') return J({ ok: true, list: await searchContracts(sp.get('q')) });
        if (u.pathname === '/api/cross/info') return J({ ok: true, info: await contractInfo({ objId: sp.get('objId'), contract: sp.get('contract') }) });
        if (u.pathname === '/api/cross/check') return J(await createCrossSell({ ...body, dryRun: true }));
        if (u.pathname === '/api/cross/create') return J({ ok: true, order: await createCrossSell({ ...body, dryRun: false }) });
      } catch (e) { return J({ ok: false, error: e.message.replace(/^App báo:\s*/, '') }); }
    }
    if (req.method === 'POST' && req.url === '/api/create') {
      const opts = JSON.parse((await readBody(req)) || '{}');
      try {
        if (opts.service && opts.service !== 'Internet') return send(res, 200, JSON.stringify({ ok: true, order: await createServiceQuote(opts) }));
        const rec = await createQuote(opts);
        if (opts.contract) { try { rec.contractCode = (await createContract(rec.orderId)).contractCode; } catch (e) { rec.contractError = e.message; } }
        return send(res, 200, JSON.stringify({ ok: true, order: rec }));
      } catch (e) {
        return send(res, 200, JSON.stringify({ ok: false, error: e.message }));
      }
    }
    send(res, 404, JSON.stringify({ error: 'not found' }));
  } catch (e) { send(res, 500, JSON.stringify({ error: e.message })); }
});
server.listen(PORT, () => console.log(`Đơn SOP Order Tool: http://localhost:${PORT}`));
