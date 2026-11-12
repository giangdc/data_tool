// adb.js — helper điều khiển thiết bị Android qua adb, bền với USB chập chờn.
// Dùng cho tool tạo đơn Mobile bằng cách điều khiển UI app SOP (app Flutter
// không dump được uiautomator nên phải thao tác theo toạ độ + chụp ảnh xác minh).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const pexec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findAdb() {
  if (process.env.ADB) return process.env.ADB;
  const cands = [
    join(homedir(), 'Android/Sdk/platform-tools/adb'),
    '/usr/bin/adb',
    '/usr/local/bin/adb',
  ];
  for (const c of cands) if (existsSync(c)) return c;
  return 'adb'; // hy vọng có trong PATH
}

export class Adb {
  constructor(serial = null, { base = [1080, 2460] } = {}) {
    this.bin = findAdb();
    this.serial = serial;
    this.base = base; // [w,h] của máy lúc GHI macro
    this.size = null; // [w,h] thực tế của máy đang chạy
  }

  _args(extra) {
    return this.serial ? ['-s', this.serial, ...extra] : extra;
  }

  // Chạy 1 lệnh adb, tự khởi động lại server + retry khi USB rớt.
  async run(extra, { retries = 2, timeout = 30000 } = {}) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try {
        const { stdout } = await pexec(this.bin, this._args(extra), { timeout, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' });
        return stdout;
      } catch (e) {
        lastErr = e;
        await this.reconnect();
        // USB rớt: chờ máy hiện lại (tối đa 60s) rồi thử tiếp
        if (/not found|no devices|offline/i.test(String(e.stderr || e.message))) {
          const t0 = Date.now();
          while (Date.now() - t0 < 60000) {
            try { const { stdout } = await pexec(this.bin, ['devices'], { timeout: 10000 }); if (this.serial && new RegExp(`^${this.serial}\\s+device`, 'm').test(stdout)) break; } catch {}
            await sleep(2000);
          }
        }
      }
    }
    throw lastErr;
  }

  async runText(extra, opts) {
    return (await this.run(extra, opts)).toString('utf8').replace(/\r/g, '');
  }

  async reconnect() {
    try { await pexec(this.bin, ['kill-server'], { timeout: 10000 }); } catch {}
    await sleep(800);
    try { await pexec(this.bin, ['start-server'], { timeout: 15000 }); } catch {}
    await sleep(2500);
  }

  // Trả về serial của máy thật đầu tiên (device), bỏ qua emulator nếu có máy thật.
  async pickDevice() {
    const out = await this.runText(['devices', '-l']);
    const rows = out.split('\n').slice(1)
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('*'))
      .map((l) => ({ serial: l.split(/\s+/)[0], state: l.split(/\s+/)[1], emu: l.includes('emulator') || /sdk_gphone|emu64/.test(l) }))
      .filter((r) => r.state === 'device');
    if (!rows.length) return null;
    const real = rows.find((r) => !r.emu) || rows[0];
    this.serial = real.serial;
    return real.serial;
  }

  async waitDevice(timeoutMs = 60000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const s = await this.pickDevice();
      if (s) return s;
      await this.reconnect();
    }
    throw new Error('Không thấy thiết bị adb (kiểm tra cáp + mở khoá máy + Allow USB debugging).');
  }

  async screenSize() {
    const out = await this.runText(['shell', 'wm', 'size']);
    const m = out.match(/Override size:\s*(\d+)x(\d+)/) || out.match(/Physical size:\s*(\d+)x(\d+)/);
    if (m) this.size = [Number(m[1]), Number(m[2])];
    return this.size || this.base;
  }

  // Chuyển toạ độ GHI (theo base) sang toạ độ máy thật hiện tại.
  _map(x, y) {
    const [bw, bh] = this.base;
    const [w, h] = this.size || this.base;
    return [Math.round((x / bw) * w), Math.round((y / bh) * h)];
  }

  async tap(x, y) {
    const [mx, my] = this._map(x, y);
    await this.run(['shell', 'input', 'tap', String(mx), String(my)]);
  }

  async key(code) { await this.run(['shell', 'input', 'keyevent', code]); }

  // Gõ text qua adb. KHÔNG dùng cho tên có dấu. Tránh lỗi Telex ở hàm typeName.
  async type(text) {
    const esc = String(text).replace(/ /g, '%s').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/&/g, '\\&');
    await this.run(['shell', 'input', 'text', esc]);
  }

  // Gõ tên tránh bàn phím Telex đổi chữ (s/f/r/x/j = dấu; aa/ee/oo/dd/w = biến âm).
  // Mẹo: gõ ký tự kích hoạt 2 lần -> ra ký tự literal.
  async typeName(text) {
    const toneOrMod = new Set(['s', 'f', 'r', 'x', 'j', 'w']);
    let out = '';
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      const lc = c.toLowerCase();
      out += c;
      // double tone/mod keys -> literal
      if (toneOrMod.has(lc)) out += c;
      // double-vowel/dd trigger: nếu ký tự này trùng ký tự trước (aa/ee/oo/dd) thì thêm 1 lần nữa
      else if (i > 0 && lc === s[i - 1].toLowerCase() && 'aeod'.includes(lc)) out += c;
    }
    await this.type(out);
  }

  async clearField(n = 20) {
    await this.key('KEYCODE_MOVE_END');
    for (let i = 0; i < n; i++) await this.key('KEYCODE_DEL');
  }

  async screencap(outPath) {
    const buf = await this.run(['exec-out', 'screencap', '-p']);
    if (!buf || buf.length === 0) throw new Error('screencap rỗng (USB vừa rớt?)');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(outPath, buf);
    return outPath;
  }

  // Ảnh thô RGBA (header 16 byte) để đọc pixel không cần thư viện PNG.
  async frame() {
    const buf = await this.run(['exec-out', 'screencap']);
    const w = buf.readUInt32LE(0), h = buf.readUInt32LE(4);
    const off = buf.length - w * h * 4;
    if (off < 12) throw new Error('screencap thô không hợp lệ');
    const px = (x, y) => { const i = off + (y * w + x) * 4; return [buf[i], buf[i + 1], buf[i + 2]]; };
    return { w, h, px };
  }

  // Đếm pixel "xanh đậm" (màu icon app) trong hộp [x1,y1,x2,y2] theo toạ độ base.
  async countBlue(box, f = null) {
    f = f || await this.frame();
    const [x1, y1] = this._map(box[0], box[1]);
    const [x2, y2] = this._map(box[2], box[3]);
    let n = 0;
    for (let y = y1; y < y2; y += 3) for (let x = x1; x < x2; x += 3) {
      const [r, g, b] = f.px(x, y);
      if (b > 180 && r < 100 && g < 140) n++;
    }
    return n;
  }

  // Tỉ lệ pixel khác nhau giữa 2 frame (lưới thưa, bỏ thanh trạng thái).
  static diff(a, b) {
    let d = 0, t = 0;
    for (let y = Math.round(a.h * 0.06); y < a.h * 0.9; y += 20) for (let x = 0; x < a.w; x += 20) {
      const p = a.px(x, y), q = b.px(x, y); t++;
      if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) > 60) d++;
    }
    return d / t;
  }

  // Tap rồi chờ màn hình đổi rõ rệt; thử lại `tries` lần, không đổi thì báo lỗi.
  async tapExpectChange(x, y, { label = '', tries = 2, waitMs = 6000, minDiff = 0.15 } = {}) {
    for (let i = 0; i < tries; i++) {
      const before = await this.frame();
      await this.tap(x, y);
      const t0 = Date.now();
      while (Date.now() - t0 < waitMs) {
        await sleep(1000);
        if (Adb.diff(before, await this.frame()) >= minDiff) return true;
      }
    }
    throw new Error(`Tap "${label}" không làm màn hình chuyển — app đang ở sai màn hình?`);
  }

  // Đọc cây giao diện (uiautomator). App SOP lộ chữ qua text/content-desc nên tìm nút theo chữ được.
  // Trả mảng node {cls, label, lines[], x1,y1,x2,y2, cx, cy, h} (toạ độ thật của máy).
  async dump() {
    let xml = '';
    for (let i = 0; i < 3 && !xml.includes('<hierarchy'); i++) {
      try {
        await this.run(['shell', 'uiautomator', 'dump', '/sdcard/sop-ui.xml'], { retries: 0, timeout: 20000 });
        xml = await this.runText(['shell', 'cat', '/sdcard/sop-ui.xml']);
      } catch { await sleep(800); }
    }
    const un = (s) => s.replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const out = [];
    for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
      const a = m[1];
      const g = (k) => (a.match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1] || '';
      const b = g('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
      if (!b) continue;
      const [x1, y1, x2, y2] = b.slice(1).map(Number);
      const label = un(g('text') || g('content-desc'));
      out.push({ cls: g('class').split('.').pop(), label, clickable: g('clickable') === 'true', lines: label.split('\n').map((s) => s.trim()).filter(Boolean),
        x1, y1, x2, y2, cx: (x1 + x2) >> 1, cy: (y1 + y2) >> 1, h: y2 - y1, w: x2 - x1 });
    }
    return out;
  }

  // Tap theo toạ độ THẬT (từ dump), không co giãn.
  async tapAt(x, y) { await this.run(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]); }

  async swipe(x1, y1, x2, y2, ms = 400) { await this.run(['shell', 'input', 'swipe', ...[x1, y1, x2, y2, ms].map(String)]); }

  async currentFocus() {
    const out = await this.runText(['shell', 'dumpsys', 'window']);
    const m = out.match(/mCurrentFocus=Window\{[^}]*\s(\S+)\}/);
    return m ? m[1] : '';
  }

  async launch(pkgActivity) { await this.run(['shell', 'am', 'start', '-n', pkgActivity]); }
}

export const sleepMs = sleep;
