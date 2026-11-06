// Tạo đơn hàng loạt từ danh sách link gói (data/*.csv): chạy song song (giới hạn số luồng), dòng lỗi thì bỏ qua,
// xuất 1 file kết quả output/batch/<tên-file>-<thời gian>.csv = các cột gốc + Kết quả / Mã đơn / Số hợp đồng / ...
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, OUTPUT_DIR } from '../core/env.js';
import { readCatalog } from '../data/catalog.js';
import { mobilePhone } from '../data/random.js';

export const BATCH_DIR = path.join(OUTPUT_DIR, 'batch');
export const DEFAULT_CONCURRENCY = 10;
export const MAX_CONCURRENCY = 50;

/** Chế độ PTTT: cod = Thanh toán tại nhà nếu gói có (đơn xong ngay), không thì PTTT đầu tiên · first = PTTT đầu tiên của gói */
export const PAYMENT_MODES = { cod: ['COD'], first: [] };

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** Chạy fn trên từng phần tử, tối đa `limit` cùng lúc */
async function pool(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const PHONE_EXISTS = /PHONE_EXISTS|đã có tài khoản|đã tồn tại/i;

export class BatchRunner {
  constructor(orders) {
    this.orders = orders; // OrderService
    this.jobs = new Map(); // id -> job
  }

  /**
   * Bắt đầu 1 lượt (không chờ xong). opts: { file, rows?: [no], fullName, phone, randomPhone, address, pmMode: 'cod'|'first', concurrency, user }
   * -> job (xem toJSON)
   */
  start(opts = {}) {
    if ([...this.jobs.values()].some((j) => j.running)) throw Object.assign(new Error('Đang có 1 lượt tạo hàng loạt chạy – chờ xong rồi chạy tiếp'), { status: 409 });
    const cat = readCatalog(opts.file);
    const pick = opts.rows?.length ? new Set(opts.rows.map(Number)) : null;
    const rows = cat.rows.filter((r) => !pick || pick.has(r.no));
    if (!rows.length) throw Object.assign(new Error('Không có dòng nào để tạo đơn'), { status: 400 });
    const pmMode = PAYMENT_MODES[opts.pmMode] ? opts.pmMode : 'cod';
    const concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, parseInt(opts.concurrency, 10) || DEFAULT_CONCURRENCY));
    const job = {
      id: randomUUID().slice(0, 8),
      file: cat.file,
      header: cat.header,
      pmMode,
      concurrency,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      running: true,
      outFile: path.join(BATCH_DIR, `${cat.file.replace(/\.csv$/i, '')}-${stamp()}.csv`),
      rows: rows.map((r) => ({ ...r, state: 'pending' })),
    };
    this.jobs.set(job.id, job);
    // giữ tối đa 10 lượt gần nhất
    for (const id of [...this.jobs.keys()].slice(0, -10)) this.jobs.delete(id);
    job.done = this.#run(job, opts).catch((err) => { job.error = err.message; }).finally(() => {
      job.running = false;
      job.finishedAt = new Date().toISOString();
      this.#write(job);
    });
    return job;
  }

  async #run(job, opts) {
    const prefer = PAYMENT_MODES[job.pmMode];
    await pool(job.rows, job.concurrency, async (row) => {
      row.state = 'running';
      const t0 = Date.now();
      const base = {
        url: row.url,
        fullName: opts.fullName || config.defaults.fullName,
        phone: opts.randomPhone ? mobilePhone() : opts.phone || config.defaults.phone,
        address: opts.address,
        paymentPrefer: prefer,
        user: opts.user,
      };
      try {
        let r;
        try {
          r = await this.orders.create(base);
        } catch (err) {
          // Gói có FPT Play: SĐT đã có tài khoản -> thử lại 1 lần với SĐT ngẫu nhiên
          if (!PHONE_EXISTS.test(`${err.code} ${err.message}`)) throw err;
          r = await this.orders.create({ ...base, phone: mobilePhone() });
        }
        const s = r.summary;
        Object.assign(row, {
          state: 'ok', code: s.code, orderId: s.orderId, contractNo: s.contractNo || '', source: s.source || 'ECP', productName: s.productName,
          offerLabel: s.offerLabel, paymentName: s.paymentName, total: s.total, statusLabel: s.statusLabel, phone: s.phone, summary: s,
        });
      } catch (err) {
        Object.assign(row, { state: 'fail', error: err.message });
      } finally {
        row.seconds = Math.round((Date.now() - t0) / 100) / 10;
      }
    });
  }

  /** File kết quả: cột gốc của danh sách + kết quả từng dòng (BOM để Excel đọc đúng tiếng Việt) */
  #write(job) {
    mkdirSync(BATCH_DIR, { recursive: true });
    const extra = ['Kết quả', 'Mã đơn (order code)', 'Số hợp đồng', 'Order ID', 'Nguồn', 'Gói', 'Lựa chọn', 'PTTT', 'Trạng thái', 'Tổng tiền', 'SĐT', 'Lỗi', 'Thời gian (giây)'];
    const lines = [[...job.header, ...extra].map(csvCell).join(',')];
    for (const r of job.rows) {
      const ok = r.state === 'ok';
      lines.push([...job.header.map((_, i) => r.cells[i] ?? ''),
        ok ? 'Thành công' : r.state === 'fail' ? 'Lỗi' : 'Chưa chạy',
        r.code, r.contractNo, r.orderId, r.source, r.productName, r.offerLabel, r.paymentName, r.statusLabel, r.total, r.phone, r.error, r.seconds,
      ].map(csvCell).join(','));
    }
    writeFileSync(job.outFile, '﻿' + lines.join('\n') + '\n');
  }

  get(id) {
    const job = id ? this.jobs.get(id) : [...this.jobs.values()].at(-1);
    if (!job) throw Object.assign(new Error('Không có lượt tạo hàng loạt này (server đã khởi động lại?)'), { status: 404 });
    return job;
  }

  /** Dữ liệu gửi UI (không kèm summary đầy đủ trừ dòng thành công) */
  static view(job) {
    const count = (st) => job.rows.filter((r) => r.state === st).length;
    return {
      id: job.id, file: job.file, pmMode: job.pmMode, concurrency: job.concurrency, running: job.running, error: job.error || null,
      startedAt: job.startedAt, finishedAt: job.finishedAt, outFile: path.relative(OUTPUT_DIR, job.outFile),
      counts: { total: job.rows.length, ok: count('ok'), fail: count('fail'), running: count('running'), pending: count('pending') },
      rows: job.rows.map(({ cells, summary, ...r }) => ({ ...r, summary: r.state === 'ok' ? summary : undefined })),
    };
  }
}
