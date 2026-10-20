#!/usr/bin/env node
// CRM Data Tool - CLI.
//   node src/cli.js login  -u stag_hoangnv75
//   node src/cli.js sample -u stag_hoangnv75 [--sample CH2610160004]
//   node src/cli.js run    -u stag_hoangnv75 [-n 2] [--until order|select|quote|opp]
//   node src/cli.js create-opp -u stag_hoangnv75 [-n 3]
//   node src/cli.js quote|select|order|status -u stag_hoangnv75 CH2610190003 ...
import { parseArgs } from 'node:util';
import { config } from './core/env.js';
import { openSession, withRelogin } from './core/auth.js';
import { log, color } from './core/logger.js';
import { saveRecord } from './core/store.js';
import {
  loadTemplate, describeTemplate, resolveOpportunityId, createOpportunity, toOpportunityRecord, OPPORTUNITY_CSV_COLUMNS,
} from './crm/opportunity.js';
import { createQuote, selectVersion, checkQuoteItems, toQuoteRecord, QUOTE_CSV_COLUMNS } from './crm/quote.js';
import { getFlowState, waitUntilOrderable } from './crm/flow.js';
import { createOrder, toOrderRecord, ORDER_CSV_COLUMNS } from './crm/order.js';

const HELP = `
${color.bold('CRM Data Tool')} - tạo nhanh dữ liệu test trên CRM (môi trường: ${config.name})

Cách dùng:
  npm run login -- -u <tk>                    Đăng nhập & lưu phiên (mật khẩu: CRM_PASSWORD trong .env)
  npm run sample -- -u <tk> [--sample <CH>]   Xem cơ hội mẫu tool sẽ copy
  npm run run-flow -- -u <tk> [-n 2] [--until order]
                                              Chạy cả luồng: cơ hội → báo giá → đánh dấu version → chờ → đơn hàng
  npm run create-opp -- -u <tk> [-n 3]        Chỉ tạo cơ hội
  npm run quote  -- -u <tk> <mã CH> ...       Tạo báo giá theo báo giá mẫu
  npm run select -- -u <tk> <mã CH> ...       Đánh dấu version KH chọn (version mới nhất)
  npm run order  -- -u <tk> <mã CH> ...       Chờ chính sách ban hành rồi tạo đơn hàng
  npm run status -- -u <tk> <mã CH> ...       Xem trạng thái luồng

Tùy chọn:
  -u, --user <tk>      Tài khoản (vd: stag_hoangnv75). Mặc định: CRM_USER trong .env
  -n, --count <n>      Số lượng (mặc định 1)
      --sample <x>     Cơ hội mẫu: mã CH / link / id (mặc định: ${config.sampleOpportunity})
      --until <bước>   run: dừng sau bước opp | quote | select | order (mặc định order)
      --no-wait        order: không chờ chính sách ban hành
      --relogin        Bỏ phiên đã lưu, đăng nhập lại
  -h, --help
`;

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    user: { type: 'string', short: 'u' },
    count: { type: 'string', short: 'n' },
    sample: { type: 'string' },
    until: { type: 'string' },
    'no-wait': { type: 'boolean' },
    relogin: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command, ...codes] = positionals;
const user = args.user || config.defaultUser;
const count = Math.max(1, Number(args.count) || 1);
const prefix = config.dataPrefix;
const waitMs = config.orderWaitMinutes * 60_000;

async function session() {
  if (!user) throw new Error('Thiếu tài khoản: thêm -u <tk> hoặc đặt CRM_USER trong .env');
  const s = await openSession(user, { force: Boolean(args.relogin) });
  log.ok(`Đăng nhập: ${s.profile?.fullName ?? ''} (${s.email})`);
  return s;
}

const template = async (api) => {
  const tpl = await loadTemplate(api, args.sample || config.sampleOpportunity);
  const warn = checkQuoteItems(tpl.quote.items);
  if (warn) log.warn(warn);
  return tpl;
};

function printTemplate(tpl) {
  const t = describeTemplate(tpl);
  console.log(`${color.bold(t.sample.code)} · ${t.sample.name}`);
  console.log(color.gray(`  AM ${t.amName} (${t.am}) · Duyệt ${t.approver} · ${t.channel}`));
  t.services.forEach((s) => console.log(`  • ${s}`));
  console.log(color.gray(`  Báo giá mẫu ${t.sample.quoteCode} ${t.sample.versionName}:`));
  t.items.forEach((i) => console.log(`    ${i.name} (${i.type}) ${i.quantity} × ${i.price.toLocaleString('vi-VN')}`));
  console.log(`  Tổng (chưa VAT): ${color.bold(t.total.toLocaleString('vi-VN'))}`);
}

const stateLine = (st) =>
  `${color.bold(st.code)} | ${st.label}${st.quote ? ` | BG ${st.quote.code} ${st.version?.name ?? ''}` : ''}${st.version?.policyId ? ` CS ${st.version.policyId}` : ''}${st.order ? ` | ĐH ${color.green(st.order.code)}` : ''}`;

async function doCreateOpp(api, tpl) {
  const result = await createOpportunity(api, tpl, { prefix });
  saveRecord('opportunities', toOpportunityRecord({ env: config.name, user, tpl, result }), OPPORTUNITY_CSV_COLUMNS);
  log.ok(`Tạo cơ hội ${color.bold(result.code)} – ${result.payload.name}`);
  return result.id;
}

async function doQuote(api, oppId, tpl) {
  const result = await createQuote(api, oppId, tpl, { prefix });
  const st = await getFlowState(api, oppId);
  if (!result.existed) saveRecord('quotes', toQuoteRecord({ env: config.name, user, oppCode: st.code, result }), QUOTE_CSV_COLUMNS);
  log.ok(`${st.code}: ${result.existed ? 'đã có' : 'tạo'} báo giá ${result.code}`);
}

async function doSelect(api, oppId) {
  const r = await selectVersion(api, oppId);
  log.ok(`${r.already ? 'Đã đánh dấu từ trước' : 'Đánh dấu'} ${r.quote.code} ${r.version.name}`);
}

async function doOrder(api, oppId) {
  if (!args['no-wait']) {
    const st = await waitUntilOrderable(api, oppId, {
      timeoutMs: waitMs,
      onTick: (s, ms) => log.step(`${s.code}: chờ chính sách "${s.label}" (${Math.round(ms / 1000)}s)`),
    });
    if (st.step === 'issuing') throw new Error(`${st.code}: chính sách vẫn "${st.label}" sau ${config.orderWaitMinutes} phút`);
  }
  log.step('Tạo đơn hàng (lần đầu tải danh sách đường ~30–40s)…');
  const result = await createOrder(api, oppId, { prefix });
  if (!result.existed) saveRecord('orders', toOrderRecord({ env: config.name, user, result }), ORDER_CSV_COLUMNS);
  log.ok(`${result.existed ? 'Đã có' : 'Tạo'} đơn hàng: ${stateLine(result.state)}${result.orderStatus ? ` (${result.orderStatus})` : ''}`);
}

const STEPS = ['opp', 'quote', 'select', 'order'];

const commands = {
  login: async () => {
    await session();
  },
  sample: async () => {
    const s = await session();
    printTemplate(await withRelogin(s, template));
  },
  'create-opp': async () => {
    const s = await session();
    await withRelogin(s, async (api) => {
      const tpl = await template(api);
      for (let i = 0; i < count; i++) await doCreateOpp(api, tpl);
    });
  },
  run: async () => {
    const until = STEPS.indexOf(args.until || 'order');
    if (until < 0) throw new Error(`--until phải là ${STEPS.join(' | ')}`);
    const s = await session();
    await withRelogin(s, async (api) => {
      const tpl = await template(api);
      printTemplate(tpl);
      for (let i = 1; i <= count; i++) {
        console.log(color.cyan(`\n— ${i}/${count} —`));
        try {
          const oppId = await doCreateOpp(api, tpl);
          if (until >= 1) await doQuote(api, oppId, tpl);
          if (until >= 2) await doSelect(api, oppId);
          if (until >= 3) await doOrder(api, oppId);
        } catch (err) {
          log.error(err.message);
        }
      }
    });
  },
};

// Lệnh nhận danh sách mã cơ hội
const perCode = {
  quote: async (api, oppId, tpl) => doQuote(api, oppId, tpl),
  select: async (api, oppId) => doSelect(api, oppId),
  order: async (api, oppId) => doOrder(api, oppId),
  status: async (api, oppId) => console.log(stateLine(await getFlowState(api, oppId))),
};

async function main() {
  if (args.help || !command) return console.log(HELP);
  if (commands[command]) return commands[command]();
  if (!perCode[command]) {
    console.log(HELP);
    throw new Error(`Lệnh không hợp lệ: ${command}`);
  }
  if (!codes.length) throw new Error('Nhập ít nhất 1 mã cơ hội');
  const s = await session();
  await withRelogin(s, async (api) => {
    const tpl = command === 'quote' ? await template(api) : null;
    for (const code of codes) {
      try {
        await perCode[command](api, await resolveOpportunityId(api, code), tpl);
      } catch (err) {
        log.error(`${code}: ${err.message}`);
      }
    }
  });
}

main().catch((err) => {
  log.error(err.message);
  process.exitCode = 1;
});
