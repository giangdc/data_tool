#!/usr/bin/env node
// FPT.vn Order Tool - CLI.
//   node src/cli.js methods https://staging.fpt.vn/internet/goi-giga
//   node src/cli.js create https://staging.fpt.vn/internet/goi-giga --pm COD -n 2
//   node src/cli.js create --pm INTERNATIONAL --pay      (tự thanh toán bằng thẻ test trong .env)
//   node src/cli.js pay 0000N5CS6VJ4
//   node src/cli.js repay 0000N5CS6VJ4 --pm DOMESTIC --pay   (đổi PTTT đơn chờ thanh toán + thanh toán lại)
//   node src/cli.js status 0000N1X5O1MO
//   node src/cli.js detail 0000N1X5O1MO
import { parseArgs } from 'node:util';
import { config } from './core/env.js';
import { log, color } from './core/logger.js';
import { OrderService } from './ecp/orders.js';
import { CARD_METHODS } from './ecp/payment.js';

const d = config.defaults;
const HELP = `
${color.bold('FPT.vn Order Tool')} - tạo nhanh đơn hàng test trên ${config.webUrl} (môi trường: ${config.name})

Cách dùng:
  npm run methods -- [link gói]               Xem gói + PTTT khả dụng (theo địa chỉ)
  npm run create -- [link gói] [tùy chọn]     Tạo đơn hàng (bỏ trống link = ${d.url})
  npm run pay -- <mã đơn> ...                 Tự thanh toán đơn chờ thanh toán (Thẻ tín dụng / ATM, thẻ test trong .env; thẻ 1 lỗi thì thử thẻ 2...)
  npm run repay -- <mã đơn> --pm <mã> [--pay] Đơn còn chờ thanh toán: đổi PTTT online (INTERNATIONAL, DOMESTIC, VIETQR...) + thanh toán lại
  npm run status -- <mã đơn> ...              Trạng thái đơn (đơn do tool tạo)
  npm run detail -- <mã đơn>                  Chi tiết đơn (JSON)
  npm run ui                                  Giao diện web (khuyến nghị)

Tùy chọn (create / methods):
      --pm <mã>          PTTT: COD, INTERNATIONAL, DOMESTIC, VIETQR, MOMO... (mặc định: PTTT đầu tiên của gói)
      --name <họ tên>    Mặc định: ${d.fullName}
      --phone <sđt>      Mặc định: ${d.phone}
      --province <tên>   Mặc định: ${d.province}
      --ward <tên>       Mặc định: ${d.ward}
      --street <tên>     Mặc định: ${d.street}
      --no <số nhà>      Mặc định: ${d.addressNo}
      --apartment        Chung cư (mặc định nhà riêng) + --building <tên|id> (mặc định "${d.building}", phường không có thì "Nơi khác") --block <tòa> --floor <tầng> --room <phòng> (bỏ trống = ngẫu nhiên)
      --offer <stt>      Thông tin sản phẩm theo số thứ tự ở lệnh methods (mặc định 1 = cái đầu tiên)
      --extras <sku,..>  Dịch vụ/thiết bị bổ sung (sku ở lệnh methods; mặc định không chọn)
      --note <ghi chú>   Mặc định: ${d.note}
      --pay              Tạo xong tự thanh toán bằng thẻ test (chỉ --pm INTERNATIONAL | DOMESTIC; mở Chrome trên máy)
  -n, --count <n>        Số đơn cần tạo (mặc định 1)
  -h, --help
`;

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    pm: { type: 'string' },
    name: { type: 'string' },
    phone: { type: 'string' },
    province: { type: 'string' },
    ward: { type: 'string' },
    street: { type: 'string' },
    no: { type: 'string' },
    note: { type: 'string' },
    apartment: { type: 'boolean' },
    building: { type: 'string' },
    block: { type: 'string' },
    floor: { type: 'string' },
    room: { type: 'string' },
    offer: { type: 'string' },
    extras: { type: 'string' },
    count: { type: 'string', short: 'n' },
    pay: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const service = new OrderService();
const address = () => ({
  province: args.province, ward: args.ward, street: args.street, addressNo: args.no,
  houseType: args.apartment ? 'apartment' : 'private', building: args.building, block: args.block, floor: args.floor, room: args.room,
});
const extras = () => (args.extras || '').split(',').map((x) => x.trim()).filter(Boolean);
// --offer <stt> -> key của lựa chọn (cần tải danh sách theo địa chỉ trước)
async function offerKey(url) {
  if (!args.offer) return undefined;
  const r = await service.prepare({ url, address: address() });
  const o = r.offers[Number(args.offer) - 1];
  if (!o) throw new Error(`--offer ${args.offer} không hợp lệ (có ${r.offers.length} lựa chọn, xem: npm run methods -- ${url})`);
  return o.key;
}

async function cmdMethods([url = d.url]) {
  let r = await service.prepare({ url, address: address(), extras: extras() });
  if (args.offer) r = { product: r.product, ...(await service.update({ checkoutId: r.checkoutId, address: address(), offerKey: r.offers[Number(args.offer) - 1]?.key, extras: extras() })) };
  log.ok(`${r.product.name} (${r.product.code}) · địa chỉ: ${r.address.text}`);
  if (!r.policy.ok) return log.error(r.policy.message);
  console.log(color.bold('Thông tin sản phẩm') + ' (--offer):');
  r.offers.forEach((o, i) => console.log(`  ${o.key === r.offerKey ? '*' : ' '} ${String(i + 1).padStart(2)}. ${o.billingTypeName.padEnd(9)} ${o.label} · ${o.priceText}${o.gifts.length ? ` · 🎁 ${o.gifts.join(', ')}` : ''}`));
  console.log(color.bold('Dịch vụ/Thiết bị bổ sung') + ' (--extras):');
  r.extras.forEach((e) => console.log(`  ${r.selectedExtras.includes(String(e.skuId)) ? '*' : ' '} ${String(e.skuId).padStart(6)}  ${e.name} · ${e.priceText}`));
  console.log(color.bold('PTTT') + ' (--pm):');
  r.methods.forEach((m, i) => console.log(`  ${i === 0 ? '*' : ' '} ${m.code.padEnd(14)} ${m.name} (${m.method})`));
  log.info(`Tạm tính: ${r.total?.finalText}`);
}

async function cmdCreate([url = d.url]) {
  if (args.pay && !CARD_METHODS.includes(args.pm?.toUpperCase())) throw new Error(`--pay cần --pm ${CARD_METHODS.join(' | ')}`);
  const count = Math.min(50, Math.max(1, parseInt(args.count, 10) || 1));
  let ok = 0;
  const key = await offerKey(url);
  for (let i = 1; i <= count; i++) {
    try {
      const r = await service.create({
        url, fullName: args.name ?? d.fullName, phone: args.phone ?? d.phone, address: address(), note: args.note, paymentCode: args.pm, offerKey: key, extras: extras(),
      });
      const s = r.summary;
      log.ok(`[${i}/${count}] ${color.bold(s.code)} (id ${s.orderId}) | ${s.productName} · ${s.offerLabel}${s.extras ? ` + ${s.extras}` : ''} | ${s.paymentName} | ${s.total?.toLocaleString('vi-VN')}đ | ${s.statusLabel}`);
      if (r.payment.type === 'redirect' && args.pay) await payOne(s.code);
      else if (r.payment.type === 'redirect') log.info(`Trang thanh toán: ${r.payment.url}`);
      if (r.payment.type === 'qr') log.info('Thanh toán VietQR: mở giao diện web (npm run ui) -> Chi tiết đơn để quét QR');
      ok++;
    } catch (err) {
      log.error(`[${i}/${count}] ${err.message}`);
    }
  }
  if (count > 1) log.info(`Hoàn tất ${ok}/${count} đơn. Lưu ở output/orders.csv`);
  if (!ok) process.exitCode = 1;
}

async function payOne(code) {
  const r = await service.pay(code, { onStep: (t) => log.info(`  ${code} · ${t}`) });
  (r.result === 'success' ? log.ok : log.error)(`  ${code} tự thanh toán (thẻ ${r.card}): ${r.result} – ${r.message} · trạng thái: ${r.order.label} (${r.order.status})`);
  if (r.result !== 'success') process.exitCode = 1;
}

async function cmdPay(codes) {
  for (const code of codes) {
    try {
      await payOne(code.toUpperCase());
    } catch (err) {
      log.error(`${code}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

async function cmdRepay(codes) {
  if (!args.pm) throw new Error('repay cần --pm <mã PTTT> (xem PTTT của gói: npm run methods)');
  for (const code of codes.map((c) => c.toUpperCase())) {
    try {
      const r = await service.repay(code, { paymentCode: args.pm });
      log.ok(`${code}: đổi PTTT -> ${r.summary.paymentName} · ${r.view.label}`);
      if (r.payment.type === 'redirect' && args.pay && r.canAutoPay) await payOne(code);
      else if (r.payment.type === 'redirect') log.info(`Trang thanh toán: ${r.payment.url}`);
      if (r.payment.type === 'qr') log.info('Thanh toán VietQR: mở giao diện web (npm run ui) -> Chi tiết đơn để quét QR');
    } catch (err) {
      log.error(`${code}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

async function cmdStatus(codes) {
  for (const st of await service.statuses(codes.map((c) => c.toUpperCase()))) {
    if (st.error) log.error(`${st.code}: ${st.error}`);
    else log.ok(`${st.code}: ${st.label} (${st.status}) · ${st.total?.toLocaleString('vi-VN')}đ`);
  }
}

async function cmdDetail([code]) {
  const { qr, ...rest } = await service.detail(code.toUpperCase());
  console.log(JSON.stringify(rest, null, 2));
}

const commands = { methods: cmdMethods, create: cmdCreate, pay: cmdPay, repay: cmdRepay, status: cmdStatus, detail: cmdDetail };
const [cmd, ...rest] = positionals;
if (args.help || !commands[cmd] || !rest.length) {
  console.log(HELP);
  process.exit(args.help ? 0 : 1);
}
commands[cmd](rest).catch((err) => {
  log.error(err.message);
  process.exit(1);
});
