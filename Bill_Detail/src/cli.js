#!/usr/bin/env node
// Bill Detail Tool - CLI.
//   node src/cli.js login
//   node src/cli.js bills  sgh835870 [--year 2024] [--month 6]
//   node src/cli.js detail sgh835870 U24SG00103292     (lưu HTML vào output/)
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config, OUTPUT_DIR } from './core/env.js';
import { login, logout } from './core/auth.js';
import { log, color } from './core/logger.js';
import { findContracts, listBills, billDetail } from './inside/bills.js';

const HELP = `
${color.bold('Bill Detail Tool')} - tra cứu hóa đơn theo số hợp đồng (inside ${config.name})

Cách dùng:
  npm run login                                   Đăng nhập inside bằng INSIDE_USER / INSIDE_PASSWORD trong .env
  npm run bills  -- <số HĐ> [--year 2024] [--month 6]
                                                  Danh sách hóa đơn của hợp đồng
  npm run detail -- <số HĐ> <số hóa đơn> [--year ..]
                                                  Lưu HTML chi tiết hóa đơn vào output/
  node src/cli.js logout                          Xóa phiên đã lưu

Tùy chọn:
  -y, --year <năm>     Lọc theo năm (nhanh hơn nhiều so với toàn bộ)
  -m, --month <tháng>  Lọc theo tháng (1-12)
  -h, --help
`;

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    year: { type: 'string', short: 'y' },
    month: { type: 'string', short: 'm' },
    help: { type: 'boolean', short: 'h' },
  },
});
const [command, contractNo, billNumber] = positionals;
const filter = { year: Number(args.year) || 0, month: Number(args.month) || 0 };

async function resolveContract(no) {
  if (!no) throw new Error('Thiếu số hợp đồng');
  const found = await findContracts(no);
  if (!found.length) throw new Error(`Không tìm thấy hợp đồng ${no}`);
  if (found.length > 1) log.warn(`Có ${found.length} hợp đồng khớp, dùng hợp đồng đầu tiên (${found[0].contract})`);
  const c = found[0];
  log.info(`${c.contract} – ${c.name} – ${c.status || ''} (ObjID ${c.objId})`);
  return c;
}

const fmt = (n) => (n ?? 0).toLocaleString('vi-VN');

async function main() {
  switch (command) {
    case 'login':
      await login();
      break;
    case 'logout':
      logout();
      log.ok('Đã xóa phiên đăng nhập');
      break;
    case 'bills': {
      const c = await resolveContract(contractNo);
      const started = Date.now();
      const rows = await listBills(c.objId, filter);
      log.ok(`${rows.length} hóa đơn (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      console.table(rows.map((r) => ({
        'Hóa đơn': r.billNumber, 'Ngày PH': r.billDate, 'Nội dung': r.content, 'Số tiền': fmt(r.amount), 'Đã TT': fmt(r.paidTotal), 'Ghi chú': r.note,
      })));
      break;
    }
    case 'detail': {
      if (!billNumber) throw new Error('Thiếu số hóa đơn');
      const c = await resolveContract(contractNo);
      const bill = (await listBills(c.objId, filter)).find((r) => r.billNumber === billNumber.trim());
      if (!bill) throw new Error(`Hợp đồng ${c.contract} không có hóa đơn ${billNumber}${filter.year ? ` trong năm ${filter.year}` : ''}`);
      const { html, found } = await billDetail(bill.detail);
      mkdirSync(OUTPUT_DIR, { recursive: true });
      const file = path.join(OUTPUT_DIR, `bill-${bill.billNumber}.html`);
      writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>${bill.billNumber}</title>${html}`);
      (found ? log.ok : log.warn)(`${found ? 'Đã lưu' : 'inside không trả chi tiết, đã lưu thông báo'}: ${file}`);
      break;
    }
    default:
      console.log(HELP);
  }
}

main().catch((err) => {
  log.error(err.message);
  process.exit(1);
});
