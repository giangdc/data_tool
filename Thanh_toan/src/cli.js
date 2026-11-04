#!/usr/bin/env node
// CLI: npm run <lệnh> -- <tham số>
//   bills  <số HĐ>                                   danh sách khoản thu
//   pay    <số HĐ> [--pm INTERNATIONAL|DOMESTIC] [--bills SG26O6108691,...]   thanh toán (mặc định tất cả khoản thu)
//   status <mã giao dịch> ...                         trạng thái giao dịch (FTELBILLWEB_2_xxx)
import { parseArgs } from 'node:util';
import { config, sharedCardsFrom } from './core/env.js';
import { log, color } from './core/logger.js';
import { BillPayService, formatVnd } from './pay/billpay.js';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    pm: { type: 'string' },
    bills: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});
const [cmd, ...args] = positionals;
const svc = new BillPayService();

const HELP = `FPT.vn Bill Pay Tool (${config.name}) – thanh toán khoản thu trên ${config.payUrl}
  npm run bills  -- <số HĐ>
  npm run pay    -- <số HĐ> [--pm INTERNATIONAL|DOMESTIC] [--bills <mã khoản thu,...>]
  npm run status -- <mã giao dịch> ...`;

function printBills(c) {
  log.ok(`${color.bold(c.contractNo)} ${c.contractName ? `– ${c.contractName}` : ''}`);
  if (!c.bills.length) return log.warn(c.message);
  for (const b of c.bills) {
    console.log(`  ${b.selectable ? '☑' : '☐'} ${b.billNumberId.padEnd(14)} ${b.title} · ${b.content}  ${color.bold(b.totalText)}`);
  }
  console.log(`  Tổng: ${color.bold(formatVnd(c.total))}`);
}

try {
  const contract = args[0] || config.defaults.contractNo;
  switch (cmd) {
    case 'bills':
      printBills(await svc.lookup(contract));
      break;
    case 'pay': {
      if (sharedCardsFrom) log.info(`Thẻ test lấy từ ${sharedCardsFrom}`);
      const billIds = opts.bills?.split(',').map((s) => s.trim()).filter(Boolean);
      const r = await svc.pay({ contractNo: contract, billIds, paymentMethod: opts.pm, onStep: (t) => log.step(t) });
      const s = r.summary;
      (s.result === 'success' ? log.ok : log.error)(`${s.paymentCode} | ${s.paymentName} ${s.amountText} (${s.billCount} khoản, thẻ ${s.card}): ${s.statusLabel} – ${s.message}`);
      if (r.remaining) printBills(r.remaining);
      process.exitCode = s.result === 'success' ? 0 : 1;
      break;
    }
    case 'status':
      for (const s of await svc.statuses(args)) console.log(`${s.paymentCode}: ${s.statusLabel}${s.amount ? ` · ${formatVnd(s.amount)}` : ''}${s.description ? ` – ${s.description}` : ''}`);
      break;
    default:
      console.log(HELP);
  }
} catch (err) {
  log.error(err.message);
  process.exitCode = 1;
}
