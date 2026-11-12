#!/usr/bin/env node
// CLI: node src/cli.js create [--name ..] [--phone ..] [--no 1283] [-n 3]
import { createQuote, createContract, listPackages, listServices, checkPrice } from './app/order.js';
import { history } from './core/store.js';
import { createMobileOrder } from './app/order-mobile.js';
// Node chỉ đọc NODE_USE_ENV_PROXY lúc khởi động -> nếu máy có proxy mà chưa bật thì chạy lại chính nó với biến này.
if (!process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy)) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
}
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

if (cmd === 'create') {
  const n = Number(flag('-n', 1)) || 1;
  const opts = { name: flag('--name'), phone: flag('--phone'), addressNo: flag('--no') };
  for (let i = 0; i < n; i++) {
    try { const r = await createQuote(opts); console.log(`✅ ${r.orderCode}  ${r.name}  ${r.phone}  ${r.totalVAT.toLocaleString('vi-VN')}đ  ${r.quotationUrl}`); }
    catch (e) { console.error('❌', e.message); }
  }
} else if (cmd === 'services') {
  for (const s of await listServices()) console.log(`${String(s.serviceId).padStart(3)}  ${s.name}`);
} else if (cmd === 'packages') {
  const g = await listPackages({ ward: flag('--ward'), street: flag('--street') });
  for (const [grp, list] of Object.entries(g)) { console.log(`\n[${grp}]`);
    for (const p of list) console.log(`  ${p.name} (id ${p.subServiceId}) — chu kỳ: ${p.prepaids.map((x) => x.label).join(' | ')}`); }
} else if (cmd === 'contract') {
  const orderId = Number(flag('--order') || args[1]);
  if (!orderId) { console.error('Cần --order <orderId>'); process.exit(1); }
  try { const c = await createContract(orderId); console.log(`✅ HĐ ${c.contractCode}  (đơn ${c.orderCode})`); }
  catch (e) { console.error('❌', e.message); }
} else if (cmd === 'history') {
  for (const o of history(Number(flag('-n', 20)))) console.log(`${o.createdAt}  ${o.orderCode}  ${o.name}  ${o.phone}  ${o.quotationUrl}`);
} else if (cmd === 'mobile') {
  // Tạo đơn Mobile bằng điều khiển UI app trên máy Android thật qua adb.
  const { readFileSync } = await import('node:fs');
  const flow = JSON.parse(readFileSync(new URL('../config/mobile-flow.json', import.meta.url), 'utf8'));
  const opts = { ...flow.defaults };
  const set = (k, f) => { const v = flag(f); if (v) opts[k] = v; };
  set('loaiNha', '--loai'); set('ward', '--ward'); set('street', '--street'); set('soNha', '--no');
  set('goiDichVu', '--goi'); set('goiTinhCuoc', '--cuoc'); set('name', '--name'); set('phone', '--phone'); set('service', '--dv');
  if (!flag('--phone')) delete opts.phone; // để driver lấy SĐT riêng theo dịch vụ (nếu có) hoặc mặc định
  if (opts.service && opts.service !== 'Internet') { delete opts.goiDichVu; delete opts.goiTinhCuoc; }
  opts.serial = flag('--serial'); opts.contract = args.includes('--contract'); opts.shots = args.includes('--shots'); opts.resume = args.includes('--tiep');
  if (!args.includes('--no-check') && !opts.resume && (opts.service || 'Internet') === 'Internet') {
    console.log(`Kiểm tra chính sách: ${opts.goiDichVu} · ${opts.goiTinhCuoc} tại ${opts.soNha} ${opts.street}, ${opts.ward}…`);
    const c = await checkPrice({ ward: opts.ward, street: opts.street, addressNo: opts.soNha, package: opts.goiDichVu, prepaidLabel: opts.goiTinhCuoc });
    if (!c.ok) { console.error('❌', c.error.replace(/^Lấy báo giá lỗi:\s*/, '')); process.exit(1); }
    console.log(`   OK — ${c.totalVAT.toLocaleString('vi-VN')}đ · ${c.policyName}`);
  }
  try {
    const r = await createMobileOrder(opts);
    console.log(`\n✅ Mã đơn hàng: ${r.orderCode}${r.contractCode ? '  ·  HĐ ' + r.contractCode : ''}  (${r.device})`);
    if (r.contractError) console.log(`❌ Hợp đồng lỗi: ${r.contractError}`);
    console.log(`   ${r.package} · ${r.totalVAT.toLocaleString('vi-VN')}đ · KH ${r.name}/${r.phone} · ${r.address}`);
    if (r.quotationUrl) console.log(`   Báo giá: ${r.quotationUrl}`);
    if (r.resultShot) console.log(`   📸 ${r.resultShot}`);
  } catch (e) { console.error('❌', e.message); if (e.shot) console.error('   📸', e.shot); process.exit(1); }
} else {
  console.log('Dùng: node src/cli.js services | packages\n      node src/cli.js create [--name ..] [--phone ..] [--no <số nhà>] [-n <số đơn>]\n      node src/cli.js contract --order <orderId>\n      node src/cli.js history [-n 20]\n      node src/cli.js mobile [--loai "Nhà phố"] [--ward ..] [--street ..] [--no ..] [--goi Giga] [--cuoc "Gói 6T (6T+0)"] [--name ..] [--phone ..] [--contract] [--shots] [--serial ..]');
}
