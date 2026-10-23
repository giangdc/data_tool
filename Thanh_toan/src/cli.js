#!/usr/bin/env node
// Dòng lệnh: node src/cli.js <lệnh> ... (xem "help")
import { parseArgs } from 'node:util';
import { config } from './core/env.js';
import { log, color } from './core/logger.js';
import { saveRun } from './core/store.js';
import { closeBrowser } from './core/browser.js';
import { runFlow } from './flow.js';

const HELP = `Thanh toán Tool – thanh toán hoá đơn HĐ trên ${config.payUrl} bằng thẻ quốc tế / nội địa (Foxpay)

  node src/cli.js pay <số HĐ[,HĐ khác]> [--method intl|domestic] [--phone <SĐT chủ thẻ>]
                      [--card <số thẻ>] [--name <tên>] [--date MM/YY] [--cvv <cvv>] [--otp <otp>]

  --method   intl = Thẻ Quốc Tế (mặc định), domestic = Thẻ Nội địa
  --date     thẻ quốc tế: hiệu lực; thẻ nội địa: ngày phát hành
  Mặc định thẻ / SĐT lấy từ .env (CARD_*, DOMESTIC_CARD_*, PHONE). Tool tích TẤT CẢ khoản thu của HĐ rồi thanh toán.
  Sau khi thanh toán tool tra lại HĐ: không còn khoản thu = thành công, còn khoản thu = lỗi.`;

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      method: { type: 'string' }, card: { type: 'string' }, name: { type: 'string' }, date: { type: 'string' }, cvv: { type: 'string' },
      otp: { type: 'string' }, phone: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, ...args] = positionals;
  const onLog = (msg) => log.step(msg);

  if (cmd === 'pay' && args.length) {
    let out;
    try {
      out = await runFlow({
        contracts: args.join(','), method: values.method, phone: values.phone,
        card: { number: values.card, name: values.name, date: values.date, cvv: values.cvv, otp: values.otp },
      }, onLog, () => {}, (r) => saveRun(r));
    } catch (err) {
      out = err.record;
      process.exitCode = 1;
      if (!out) throw err;
      log.error(err.message);
    }
    log.ok(color.bold('Kết quả'));
    for (const r of out.results) {
      console.log(`   ${r.contract.padEnd(12)} ${(r.method || '').padEnd(12)} ${r.amount || ''}  ${r.status || ''}  ${r.gatewayOrder || ''}  ${r.remaining || ''}${r.error ? color.red('  ✖ ' + r.error) : ''}`);
    }
  } else {
    console.log(HELP);
    if (cmd && cmd !== 'help' && !values.help) process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    log.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => closeBrowser());
