#!/usr/bin/env node
// FPT Play Order Tool - CLI.
//   node src/cli.js plans https://dev.fptplay.vn/dich-vu/v-vip2
//   node src/cli.js create v-vip2 --pm INTERNATIONAL --pay
//   node src/cli.js pay 1792403931-38297814
//   node src/cli.js status 1792403931-38297814
//   node src/cli.js detail 1792403931-38297814
//   node src/cli.js login [--phone 09..]
import { parseArgs } from 'node:util';
import { config } from './core/env.js';
import { log, color } from './core/logger.js';
import { OrderService } from './fpl/orders.js';
import { session } from './fpl/auth.js';
import { CARD_METHODS } from './fpl/payment.js';

const d = config.defaults;
const HELP = `
${color.bold('FPT Play Order Tool')} - mua nhanh gói FPT Play test trên ${config.webUrl} (môi trường: ${config.name})

Cách dùng:
  npm run plans -- [link gói]                 Xem kỳ hạn + PTTT của gói với tài khoản (bỏ trống link = ${d.url})
  npm run create -- [link gói] [tùy chọn]     Tạo giao dịch mua gói
  npm run pay -- <mã giao dịch> ...           Tự thanh toán bằng thẻ test trong .env (Thẻ tín dụng / ATM; thẻ 1 lỗi thì thử thẻ 2...)
  npm run status -- <mã giao dịch> ...        Trạng thái giao dịch (do tool tạo)
  npm run detail -- <mã giao dịch>            Chi tiết (JSON) + gói đang có của tài khoản
  npm run login -- [--phone ..] [--force]     Đăng nhập (OTP mặc định FPL_OTP trong .env), lưu token vào .cache/
  npm run ui                                  Giao diện web (khuyến nghị)

Tùy chọn:
      --phone <sđt>      Tài khoản FPT Play (mặc định: ${d.phone})
      --plan <plan_id>   Kỳ hạn (plan_id ở lệnh plans; mặc định kỳ hạn đầu tiên)
      --pm <mã>          PTTT: INTERNATIONAL, DOMESTIC, WALLET_MOMO... (mặc định PTTT đầu tiên)
      --coupon <mã>      Mã giảm giá
      --pay              Tạo xong tự thanh toán bằng thẻ test (chỉ ${CARD_METHODS.join(' | ')}; mở Chrome trên máy)
  -n, --count <n>        Số giao dịch cần tạo (mặc định 1)
      --force            (login) bỏ token cũ, đăng nhập lại
  -h, --help
`;

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    phone: { type: 'string' },
    plan: { type: 'string' },
    pm: { type: 'string' },
    coupon: { type: 'string' },
    count: { type: 'string', short: 'n' },
    pay: { type: 'boolean' },
    force: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const service = new OrderService();
const onStep = (t) => log.step(t);

async function cmdLogin() {
  const s = await session(args.phone || d.phone, { force: args.force, onStep });
  log.ok(`Tài khoản ${s.user.phoneMask} (user ${s.user.userId}) · ${s.fresh ? 'vừa đăng nhập' : 'dùng token đã lưu'}`);
}

async function cmdPlans([url = d.url]) {
  const r = await service.prepare({ url, phone: args.phone, onStep });
  log.ok(`${r.plan.name} (${r.plan.planType}) · tài khoản ${r.account.phoneMask}${r.account.benefit ? ` · đang có: ${r.account.benefit}` : ''}`);
  if (r.plan.note) log.info(r.plan.note);
  if (r.blocked) return log.error(r.blocked);
  console.log(color.bold('Kỳ hạn') + ' (--plan) · PTTT (--pm):');
  r.offers.forEach((o, i) => {
    console.log(`  ${i === 0 ? '*' : ' '} ${o.planId.padEnd(6)} ${o.label.padEnd(10)} ${o.priceText}${o.originalPrice ? ` (gốc ${o.originalPrice})` : ''}`);
    o.methods.forEach((m, j) => console.log(`        ${j === 0 ? '*' : ' '} ${m.code.padEnd(14)} ${m.name}${m.autoRenew ? ' · tự gia hạn' : ''}${m.autoPay ? color.green(' · tự thanh toán được') : ''}`));
  });
}

async function payOne(code) {
  const r = await service.pay(code, { onStep: (t) => log.info(`  ${code} · ${t}`) });
  (r.result === 'success' ? log.ok : log.error)(`  ${r.code} tự thanh toán (thẻ ${r.card}): ${r.result} – ${r.message} · trạng thái: ${r.status?.label ?? '?'} (${r.status?.status ?? ''})`);
  if (r.result !== 'success') process.exitCode = 1;
}

async function cmdCreate([url = d.url]) {
  if (args.pay && !CARD_METHODS.includes(args.pm?.toUpperCase() || 'INTERNATIONAL')) throw new Error(`--pay cần --pm ${CARD_METHODS.join(' | ')}`);
  const count = Math.min(20, Math.max(1, parseInt(args.count, 10) || 1));
  let ok = 0;
  for (let i = 1; i <= count; i++) {
    try {
      const r = await service.create({ url, phone: args.phone, planId: args.plan, paymentCode: args.pm, coupon: args.coupon, onStep: i === 1 ? onStep : undefined });
      const s = r.summary;
      log.ok(`[${i}/${count}] ${color.bold(s.code)} | ${s.planName} · ${s.offerLabel} | ${s.paymentName} | ${s.total.toLocaleString('vi-VN')}đ | ${s.statusLabel}`);
      if (r.payment.type === 'redirect' && args.pay) await payOne(s.code);
      else if (r.payment.type === 'redirect') log.info(`Trang thanh toán: ${r.payment.url}`);
      if (r.payment.type === 'qr') log.info('Thanh toán QR: mở giao diện web (npm run ui) -> Chi tiết để quét QR');
      ok++;
    } catch (err) {
      log.error(`[${i}/${count}] ${err.message}`);
    }
  }
  if (count > 1) log.info(`Hoàn tất ${ok}/${count}. Lưu ở output/orders.csv`);
  if (!ok) process.exitCode = 1;
}

async function cmdPay(codes) {
  for (const code of codes) {
    try {
      await payOne(code);
    } catch (err) {
      log.error(`${code}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

async function cmdStatus(codes) {
  for (const st of await service.statuses(codes)) {
    if (st.error) log.error(`${st.code}: ${st.error}`);
    else log.ok(`${st.code}: ${st.label} (${st.status})${st.amount ? ` · ${Number(st.amount).toLocaleString('vi-VN')}đ` : ''}`);
  }
}

async function cmdDetail([code]) {
  console.log(JSON.stringify(await service.detail(code), null, 2));
}

const commands = { login: cmdLogin, plans: cmdPlans, create: cmdCreate, pay: cmdPay, status: cmdStatus, detail: cmdDetail };
const NO_ARGS = ['login', 'plans', 'create'];
const [cmd, ...rest] = positionals;
if (args.help || !commands[cmd] || (!rest.length && !NO_ARGS.includes(cmd))) {
  console.log(HELP);
  process.exit(args.help ? 0 : 1);
}
commands[cmd](rest).catch((err) => {
  log.error(err.message);
  process.exit(1);
});
