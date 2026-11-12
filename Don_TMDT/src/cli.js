#!/usr/bin/env node
// CLI: npm run <lệnh> -- <tham số>. Xem README.
import { parseArgs } from 'node:util';
import { config } from './core/env.js';
import { color, log } from './core/logger.js';
import { EcomService } from './ecom/orders.js';

const svc = new EcomService();
const [cmd, ...rest] = process.argv.slice(2);
const { values: o, positionals: args } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    source: { type: 'string', short: 's' },
    phone: { type: 'string', short: 'p' },
    location: { type: 'string' },
    district: { type: 'string' },
    ward: { type: 'string' },
    street: { type: 'string' },
    no: { type: 'string' },
    by: { type: 'string' },
    disconnect: { type: 'boolean', default: false },
    tasks: { type: 'string' },
    replicate: { type: 'boolean', default: false },
    token: { type: 'string' },
  },
});

const HELP = `Tạo đơn TMĐT Tool – SPF Web Admin (${config.baseUrl})
  login [--token <AccessToken>]          đăng nhập (bỏ trống = SPF_ACCESS_TOKEN trong .env / token đã lưu)
  load <RefCode> [-s Tiktok|Shopee]      xem đơn trên sàn + đơn đã có trên SPF
  create <RefCode>... [-s Tiktok|Shopee] [-p SĐT] [--location 8 --district .. --ward .. --street .. --no ..] [--disconnect]
  search <giá trị> [--by refcode|ordercode|orderid] [-s ..]
  disconnect <OrderId> [-s ..]           ngắt kết nối đơn khỏi RefCode
  status <OrderId>...                    trạng thái + tiến độ queue
  settle <OrderId>... [-s ..] [--tasks 1,2,5] [--replicate]
                                         quyết toán: đẩy task Tiktok_CompletedOrder / SPFShopeeCompletedOrder (mặc định tất cả task;
                                         --replicate = bỏ qua check trùng)
  settle-tasks [-s ..]                   xem danh sách task quyết toán
  history                                đơn đã tạo bằng tool
Mặc định: nguồn ${config.defaults.source}, SĐT ${config.defaults.phone}, địa chỉ id ${config.defaults.locationId}/${config.defaults.districtId}/${config.defaults.wardId}/${config.defaults.streetId} "${config.defaults.addressNo}"`;

const need = (n = 1) => {
  if (args.length < n) {
    console.log(HELP);
    process.exit(1);
  }
};

const printOrders = (rows) => {
  if (!rows.length) return log.info('Không có đơn nào');
  for (const r of rows) {
    const acts = [r.canRetry && 'thử lại', r.canDisconnect && 'ngắt kết nối', r.canConnect && 'kết nối'].filter(Boolean).join(', ') || '-';
    console.log(`  ${color.bold(r.orderCode)} (OrderId ${r.orderId}) · ${r.saleTeam} · PĐK ${r.regCode || '-'} · HĐ ${r.contract || '-'} · ${r.totalText} · ${r.paymentStatus} · ${r.createdDate} · thao tác: ${acts}`);
  }
};

try {
  switch (cmd) {
    case 'login':
      await svc.login(o.token);
      log.ok('Đã đăng nhập SPF Web Admin');
      break;
    case 'load': {
      need();
      const r = await svc.load(o.source, args[0]);
      if (r.ecom.error) log.warn(r.ecom.error);
      else {
        log.ok(`${r.source} ${r.refCode} · ${r.ecom.status} · ${r.ecom.totalText} · SĐT ${r.ecom.phone}`);
        for (const i of r.ecom.items) console.log(`  - ${i.skuName} (${i.sellerSku})`);
        console.log(`  Địa chỉ trên sàn: ${r.ecom.address}`);
      }
      log.info('Đơn đã có trên SPF:');
      printOrders(r.orders);
      log.step(r.plan.text);
      break;
    }
    case 'create':
      need();
      for (const ref of args) {
        try {
          const r = await svc.create({
            source: o.source, refCode: ref, phone: o.phone, disconnectOld: o.disconnect,
            address: { locationId: o.location, districtId: o.district, wardId: o.ward, streetId: o.street, addressNo: o.no },
            onStep: (t) => log.step(t),
          });
          log.ok(`${r.summary.orderCode} (OrderId ${r.summary.orderId}) · ${r.summary.detailUrl}`);
        } catch (e) {
          log.error(`${ref}: ${e.message}`);
          if (e.orders) printOrders(e.orders);
          process.exitCode = 1;
        }
      }
      break;
    case 'search':
      need();
      printOrders(await svc.search(o.source, args[0], o.by || 'refcode'));
      break;
    case 'disconnect': {
      need();
      const row = (await svc.search(o.source, args[0], 'orderid'))[0];
      if (!row) throw new Error(`Không tìm thấy OrderId ${args[0]} (nguồn ${o.source || config.defaults.source})`);
      await svc.disconnect(row.orderId, row.saleTeamId);
      log.ok(`Đã ngắt kết nối ${row.orderCode}`);
      break;
    }
    case 'status':
      need();
      for (const s of await svc.statuses(args, o.source)) {
        if (s.error) {
          log.error(`${s.orderId}: ${s.error}`);
          continue;
        }
        const r = s.order;
        log.ok(`${r?.orderCode || s.orderId} · PĐK ${r?.regCode || '-'} · HĐ ${r?.contract || '-'} · ${r?.paymentStatus || '-'} · ${s.detailUrl}`);
        for (const er of s.errors || []) log.warn(er);
        for (const t of s.tasks) console.log(`  ${t.done ? color.green('✔') : color.yellow('…')} ${t.name} (status ${t.status ?? '-'})`);
      }
      break;
    case 'settle-tasks': {
      const r = await svc.settleTasks(o.source);
      log.info(`${r.actionCode} (Instance ${r.instance}):`);
      for (const t of r.tasks) console.log(`  ${t.taskCode}. ${t.name}${t.parentTaskCode ? ` (task cha ${t.parentTaskCode})` : ''}`);
      break;
    }
    case 'settle':
      need();
      for (const id of args) {
        try {
          const r = await svc.settle({ source: o.source, orderId: id, taskCodes: o.tasks?.split(',').map((x) => x.trim()).filter(Boolean), replicate: o.replicate });
          log.ok(`${r.summary.orderCode} (OrderId ${id}) · đã đẩy ${r.summary.actionCode} task ${r.summary.taskCodes} · xem tiến độ: npm run status -- ${id}`);
        } catch (e) {
          log.error(`${id}: ${e.message}`);
          process.exitCode = 1;
        }
      }
      break;
    case 'history':
      for (const h of svc.history().slice(0, 30)) {
        const s = h.summary;
        console.log(`${s.time.slice(0, 19).replace('T', ' ')} · ${s.source} ${s.refCode} · ${s.orderCode} (${s.orderId}) · ${s.mode} · ${s.phone}`);
      }
      break;
    default:
      console.log(HELP);
  }
} catch (e) {
  log.error(e.message);
  process.exitCode = 1;
}
