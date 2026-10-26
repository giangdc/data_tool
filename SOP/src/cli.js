#!/usr/bin/env node
// Dòng lệnh: npm run order -- --phone 0964633310 [--address "..."] [--combo GigaF1] [--index 1] [--payment Napas] [--no-contract]
import { parseArgs } from 'node:util';
import { config } from './core/env.js';
import { log } from './core/logger.js';
import { saveRun } from './core/store.js';
import { closeBrowser } from './core/browser.js';
import { createInternetOrder } from './sop/order.js';

const { values: a } = parseArgs({
  options: {
    phone: { type: 'string', short: 'p' },
    address: { type: 'string', short: 'a' },
    combo: { type: 'string', short: 'c' },
    index: { type: 'string', short: 'i' },
    payment: { type: 'string' },
    'no-contract': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (a.help || !(a.phone || config.defaults.phone)) {
  console.log(`Tạo đơn Internet (+ hợp đồng) trên Portal SOP ${config.name}
  npm run order -- --phone <SĐT KH có sẵn> [--address "${config.defaults.address}"]
                   [--combo ${config.defaults.combo}] [--index ${config.defaults.comboIndex}] [--payment ${config.defaults.payment}] [--no-contract]`);
  process.exit(a.help ? 0 : 1);
}

try {
  const r = await createInternetOrder({
    phone: a.phone, address: a.address, combo: a.combo, comboIndex: a.index, payment: a.payment, contract: !a['no-contract'],
  }, (m) => log.step(m));
  saveRun(r);
  log.ok(`Mã đơn: ${r.orderCode || '?'} | Mã HĐ: ${r.contractCode || '-'} | Bookport: ${r.bookport || '-'}`);
  if (r.quoteLink) log.info(`Link báo giá: ${r.quoteLink}`);
} catch (err) {
  if (err.record) saveRun(err.record);
  log.error(err.message);
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
