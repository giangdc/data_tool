#!/usr/bin/env node
// Dòng lệnh: node src/cli.js <lệnh> ... (xem "help")
import { parseArgs } from 'node:util';
import { log, color } from './core/logger.js';
import { saveRun } from './core/store.js';
import { closeBrowser } from './core/browser.js';
import { runFlow, TARGETS } from './flow.js';

const HELP = `GH Vendor Tool – cập nhật tình trạng phiếu giao hàng NCU (Fox ERP → Quản lý NCU → Giao hàng, triển khai NCU)

  node src/cli.js run <mã đơn hàng[,mã khác]> [--until ${Object.keys(TARGETS).join('|')}]
                      [--invoice <số HĐ NCU>] [--date dd-MM-yyyy] [--ftel <số HĐ FTEL>] [--file <tệp hoá đơn>]

  --until    chạy tới tình trạng nào (mặc định done):
${Object.entries(TARGETS).map(([k, v]) => `               ${k.padEnd(9)} ${v}`).join('\n')}
  --invoice  Hoá đơn NCU (mặc định theo INVOICE_NCU trong .env, {code} = mã đơn hàng)
  --date     Ngày HĐ NCU (mặc định hôm nay)
  --ftel     Hoá đơn FTEL (mặc định theo INVOICE_FTEL)
  --file     Tệp hoá đơn điện tử (mặc định tool tự tạo 1 file PDF test)

Trình duyệt sẽ hiện lên; chưa đăng nhập Fox ERP thì đăng nhập trong cửa sổ đó (hoặc khai báo tài khoản trong .env).`;

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      until: { type: 'string' }, invoice: { type: 'string' }, date: { type: 'string' }, ftel: { type: 'string' },
      file: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, ...args] = positionals;
  const onLog = (msg) => log.step(msg);

  if (cmd === 'run' && args.length) {
    let out;
    try {
      out = await runFlow({
        codes: args.join(','), target: values.until, invoiceNcu: values.invoice, invoiceDate: values.date,
        invoiceFtel: values.ftel, invoiceFile: values.file,
      }, onLog, () => {}, (r) => saveRun(r));
    } catch (err) {
      out = err.record;
      process.exitCode = 1;
      if (!out) throw err;
      log.error(err.message);
    }
    log.ok(color.bold('Kết quả'));
    for (const r of out.results) {
      console.log(`   ${r.orderCode.padEnd(16)} ${r.pghCode || ''}  ${r.statusBefore || '?'} → ${r.status || '?'}${r.error ? color.red('  ✖ ' + r.error) : ''}`);
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
