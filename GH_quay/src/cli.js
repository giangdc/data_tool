#!/usr/bin/env node
// Dòng lệnh: node src/cli.js <lệnh> ... (xem "help")
import { parseArgs } from 'node:util';
import { config } from './core/env.js';
import { log, color } from './core/logger.js';
import { saveRun } from './core/store.js';
import { closeBrowser } from './core/browser.js';
import { runFlow, STOP_POINTS } from './flow.js';
import { pushStatus, GHTK_STATUSES } from './systems/ghtk.js';

const HELP = `GH quầy Tool – chạy luồng Giao hàng tại quầy (Fox ERP → SCM → Fox ERP → GHTK lab)

  node src/cli.js run <số HĐ> [--until ${Object.keys(STOP_POINTS).join('|')}] [--status <mã GHTK>]
                              [--stock <kho>] [--phone <SĐT kho>]
  node src/cli.js ghtk <mã vận đơn[,mã khác]> <mã trạng thái>

  --until   chạy tới đâu thì dừng (mặc định done):
${Object.entries(STOP_POINTS).map(([k, v]) => `              ${k.padEnd(8)} ${v}`).join('\n')}
  --status  trạng thái GHTK đẩy ở bước cuối (mặc định ${config.ghtkStatus}):
${Object.entries(GHTK_STATUSES).map(([k, v]) => `              ${k.padStart(2)}  ${v}`).join('\n')}

Trình duyệt sẽ hiện lên; hệ thống nào chưa đăng nhập thì đăng nhập trong cửa sổ đó (hoặc khai báo tài khoản trong .env).`;

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      until: { type: 'string' }, status: { type: 'string' }, stock: { type: 'string' }, phone: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, ...args] = positionals;
  const onLog = (msg) => log.step(msg);

  if (cmd === 'run' && args[0]) {
    try {
      const record = await runFlow({
        contract: args[0], until: values.until, ghtkStatus: values.status, stock: values.stock, phone: values.phone,
      }, onLog);
      saveRun(record);
      log.ok(color.bold('Kết quả'));
      for (const [k, v] of Object.entries(record)) console.log(`   ${k.padEnd(15)} ${Array.isArray(v) ? v.join('\n                   ') : v}`);
    } catch (err) {
      if (err.record) saveRun(err.record);
      throw err;
    }
  } else if (cmd === 'ghtk' && args[0] && args[1]) {
    await pushStatus(args[0], args[1], onLog);
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
