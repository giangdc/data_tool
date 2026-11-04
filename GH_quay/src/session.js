// Đăng nhập / đăng xuất cùng lúc cả 3 hệ thống (Fox ERP, SCM, GHTK lab) trong cửa sổ trình duyệt của tool.
import { ACCOUNT_KEYS, config } from './core/env.js';
import { getContext, clearSiteData, sleep } from './core/browser.js';
import * as erp from './systems/erp.js';
import * as scm from './systems/scm.js';
import * as ghtk from './systems/ghtk.js';

const SYSTEMS = { erp, scm, ghtk };

// Trạng thái biết được sau lần đăng nhập/đăng xuất gần nhất: true | false | null (chưa rõ)
export const sessions = { erp: null, scm: null, ghtk: null };

/** Đăng nhập song song cả 3 hệ thống; hệ thống chưa lưu tài khoản thì chờ đăng nhập tay trong cửa sổ trình duyệt. */
export async function loginAll(onLog) {
  const missing = Object.entries(ACCOUNT_KEYS).filter(([, k]) => !config[k.user] || !config[k.pass]).map(([, k]) => k.name);
  if (missing.length) onLog(`Chưa lưu tài khoản ${missing.join(', ')} → đăng nhập tay trong cửa sổ trình duyệt`);
  const results = await Promise.allSettled(Object.entries(SYSTEMS).map(async ([key, sys]) => {
    await sys.login(onLog);
    sessions[key] = true;
    onLog(`✔ ${ACCOUNT_KEYS[key].name}: đã đăng nhập`);
  }));
  const failed = results.map((r, i) => r.status === 'rejected' && `${Object.values(ACCOUNT_KEYS)[i].name}: ${r.reason.message}`).filter(Boolean);
  if (failed.length) throw new Error(`Đăng nhập chưa xong – ${failed.join(' | ')}`);
  return { ...sessions };
}

/** Đăng xuất cả 3 hệ thống (xoá phiên trong trình duyệt của tool) rồi mở lại để chắc chắn đã về màn đăng nhập. */
export async function logoutAll(onLog) {
  const ctx = await getContext();
  await clearSiteData(Object.values(SYSTEMS).flatMap((sys) => sys.session.origins()));
  onLog('Đã xoá phiên đăng nhập Fox ERP (cả IAM), SCM, GHTK lab – kiểm tra lại...');

  const results = await Promise.all(Object.entries(SYSTEMS).map(async ([key, sys]) => {
    const page = await ctx.newPage();
    try {
      await page.goto(sys.session.checkUrl(), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await sleep(3000); // SPA chuyển sang trang đăng nhập sau khi tải xong
      const out = sys.session.isLoginPage(page.url());
      sessions[key] = !out;
      onLog(out ? `✔ ${ACCOUNT_KEYS[key].name}: đã đăng xuất` : `⚠ ${ACCOUNT_KEYS[key].name}: vẫn vào được, chưa đăng xuất hẳn`);
      return out;
    } finally {
      await page.close().catch(() => {});
    }
  }));
  if (results.includes(false)) throw new Error('Có hệ thống chưa đăng xuất hẳn (xem nhật ký)');
  return { ...sessions };
}
