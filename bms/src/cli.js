#!/usr/bin/env node
// FTMS Data Tool - CLI.
//   node src/cli.js                    -> menu tương tác
//   node src/cli.js login --user giangdc2
//   node src/cli.js services
//   node src/cli.js create-opp --user giangdc2 --group "Cloud partner" --type "Azure" --count 3
//   node src/cli.js approve --user chuyennt5 CH00086386 CH00086387
//   node src/cli.js survey --user chuyennt5 CH00086403
//   node src/cli.js contract --user giangdc2 CH00086386
//   node src/cli.js approve-contract --user chuyennt5 CH00086386
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { config } from './core/env.js';
import { getBmsToken, getSmToken } from './core/auth.js';
import { ApiClient, ApiError } from './core/http.js';
import { log, color } from './core/logger.js';
import { saveRecord } from './core/store.js';
import { BmsMasterData } from './bms/masterData.js';
import { createOpportunity, toOpportunityRecord } from './bms/opportunity.js';
import { approveOpportunity } from './bms/approval.js';
import {
  createContractRequest, toContractRecord, CONTRACT_CSV_COLUMNS,
  approveContractRequest, toContractApprovalRecord, CONTRACT_APPROVAL_CSV_COLUMNS,
} from './bms/contract.js';
import { createSurvey, toSurveyRecord, SURVEY_CSV_COLUMNS } from './bms/survey.js';

const HELP = `
${color.bold('FTMS Data Tool')} - tạo nhanh dữ liệu test (môi trường: ${config.name})

Cách dùng:
  npm start                                  Menu tương tác (khuyến nghị)
  npm run login -- --user <tk>               Đăng nhập trước & lưu phiên
  npm run services -- --user <tk>            Xem danh sách Nhóm / Loại dịch vụ
  npm run create-opp -- [tùy chọn]           Tạo cơ hội trên BMS
  npm run approve -- -u <tk> <mã CH> ...     Duyệt cơ hội (tk cần quyền duyệt, vd admin)
  npm run survey -- -u <tk> <mã CH> ...      Khảo sát dịch vụ LeasedLine (BMS + SM) trước khi tạo HĐ
  npm run contract -- -u <tk> <mã CH> ...    Tạo yêu cầu HĐ cho cơ hội đã duyệt (tk AM hoặc admin)
  npm run approve-contract -- -u <tk> <mã CH> ...  BGĐ duyệt yêu cầu HĐ (tk BGĐ của cơ hội hoặc admin)

Tùy chọn:
  -u, --user <tk>      Tài khoản đăng nhập (vd: giangdc2). Mặc định: FTMS_USER trong .env
  -g, --group <x>      Nhóm dịch vụ (tên hoặc id)
  -t, --type <x>       Loại dịch vụ (tên hoặc id)
  -n, --count <n>      Số cơ hội cần tạo (mặc định 1)
      --am <tk>        AM phụ trách (mặc định: BMS_AM = ${config.defaultAm})
      --tpp <tk>       TPP đánh giá (bỏ trống = ngẫu nhiên theo AM)
      --bgd <tk>       BGĐ phê duyệt (bỏ trống = ngẫu nhiên theo AM)
      --relogin        Bỏ qua phiên đã lưu, đăng nhập lại
  -h, --help
`;

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    user: { type: 'string', short: 'u' },
    group: { type: 'string', short: 'g' },
    type: { type: 'string', short: 't' },
    count: { type: 'string', short: 'n' },
    am: { type: 'string' },
    tpp: { type: 'string' },
    bgd: { type: 'string' },
    relogin: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

let rl;
const prompt = () => (rl ??= createInterface({ input: stdin, output: stdout }));

async function ask(question, defaultValue = '') {
  const suffix = defaultValue ? color.gray(` (${defaultValue})`) : '';
  const answer = (await prompt().question(`${color.cyan('?')} ${question}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function choose(question, items, label) {
  items.forEach((it, i) => console.log(`  ${color.gray(String(i + 1).padStart(2))}. ${label(it)}`));
  for (;;) {
    const answer = await ask(question);
    const idx = Number(answer) - 1;
    if (Number.isInteger(idx) && items[idx]) return items[idx];
    const byName = items.find((it) => label(it).toLowerCase() === answer.toLowerCase());
    if (byName) return byName;
    log.warn('Lựa chọn không hợp lệ, nhập số thứ tự trong danh sách.');
  }
}

async function connectBms(user, force = args.relogin) {
  const token = await getBmsToken(user, { force });
  const api = new ApiClient(config.bmsApiUrl, token);
  // SM (tool LeasedLine) chỉ đăng nhập khi cần: khảo sát, khai cước HĐ LeasedLine
  const getSm = async (smForce = false) => new ApiClient(config.smApiUrl, await getSmToken(user, { force: smForce }));
  return { api, master: new BmsMasterData(api), getSm };
}

async function resolveUser() {
  return args.user || config.defaultUser || (await ask('Tài khoản đăng nhập'));
}

async function cmdLogin() {
  await getBmsToken(await resolveUser(), { force: true });
}

async function cmdServices() {
  const { master } = await connectBms(await resolveUser());
  for (const g of await master.serviceGroups()) {
    const types = await master.serviceTypes(g.id);
    console.log(`${color.bold(g.serviceGroupName)} ${color.gray(`[${g.id}]`)}`);
    console.log('   ' + types.map((t) => `${t.serviceTypeName.trim()} ${color.gray(`[${t.id}]`)}`).join(', '));
  }
}

async function cmdCreateOpportunity({ interactive }) {
  const user = await resolveUser();
  let { api, master } = await connectBms(user);

  let group, type;
  if (args.group && args.type) {
    ({ group, type } = await master.resolveService(args.group, args.type));
  } else {
    console.log(color.bold('\nNhóm dịch vụ:'));
    group = await choose('Chọn nhóm dịch vụ', await master.serviceGroups(), (g) => g.serviceGroupName);
    console.log(color.bold(`\nLoại dịch vụ (${group.serviceGroupName}):`));
    type = await choose('Chọn loại dịch vụ', await master.serviceTypes(group.id), (t) => t.serviceTypeName.trim());
  }

  const am = args.am || (interactive ? await ask('AM phụ trách', config.defaultAm) : config.defaultAm);
  const countRaw = args.count || (interactive ? await ask('Số cơ hội cần tạo', '1') : '1');
  const count = Math.max(1, Number.parseInt(countRaw, 10) || 1);

  log.info(`Tạo ${count} cơ hội | ${group.serviceGroupName} / ${type.serviceTypeName.trim()} | AM: ${am} | KH: mới`);
  const created = [];
  for (let i = 1; i <= count; i++) {
    try {
      let result;
      try {
        result = await createOpportunity(api, master, { group, type, am, tpp: args.tpp, bgd: args.bgd, prefix: config.dataPrefix });
      } catch (err) {
        // token hết hạn giữa chừng -> đăng nhập lại 1 lần rồi thử tiếp
        if (!(err instanceof ApiError && err.status === 401)) throw err;
        log.warn('Phiên hết hạn, đăng nhập lại...');
        ({ api, master } = await connectBms(user, true));
        result = await createOpportunity(api, master, { group, type, am, tpp: args.tpp, bgd: args.bgd, prefix: config.dataPrefix });
      }
      const { code, payload } = result;
      const csv = saveRecord('opportunities', toOpportunityRecord({ env: config.name, user, group, type, code, payload }));
      created.push(code);
      log.ok(
        `[${i}/${count}] ${color.bold(code)}  ${payload.customer.fullName}  ` +
          color.gray(`TPP: ${payload.approval.tppCanApproval} | BGĐ: ${payload.approval.usersCanApproval}`),
      );
      if (i === count) log.info(`Đã lưu vào ${csv}`);
    } catch (err) {
      log.error(`[${i}/${count}] ${err.message}`);
    }
  }
  log.info(`Hoàn tất: ${created.length}/${count} cơ hội. ${created.join(', ')}`);
  return created.length === count;
}

async function cmdApprove({ interactive }) {
  const user = await resolveUser();
  let codes = positionals.slice(1);
  if (!codes.length && interactive) codes = (await ask('Mã cơ hội cần duyệt (cách nhau bởi dấu phẩy)')).split(/[\s,;]+/);
  codes = codes.map((c) => c.trim()).filter(Boolean);
  if (!codes.length) throw new Error('Chưa nhập mã cơ hội cần duyệt');

  log.warn(`Duyệt bằng tài khoản ${user} – tài khoản phải có quyền duyệt (TPP/BGĐ của cơ hội hoặc admin)`);
  let { api } = await connectBms(user);
  let ok = 0;
  for (const code of codes) {
    try {
      let result;
      try {
        result = await approveOpportunity(api, code);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 401)) throw err;
        ({ api } = await connectBms(user, true));
        result = await approveOpportunity(api, code);
      }
      ok++;
      log.ok(`${color.bold(result.code)} đã duyệt ${color.gray(`(${result.steps.join(' → ')})`)}`);
    } catch (err) {
      log.error(err.message);
    }
  }
  log.info(`Hoàn tất: duyệt ${ok}/${codes.length} cơ hội`);
  return ok === codes.length;
}

async function cmdContract({ interactive }) {
  const user = await resolveUser();
  let codes = positionals.slice(1);
  if (!codes.length && interactive) codes = (await ask('Mã cơ hội đã duyệt cần tạo HĐ (cách nhau bởi dấu phẩy)')).split(/[\s,;]+/);
  codes = codes.map((c) => c.trim()).filter(Boolean);
  if (!codes.length) throw new Error('Chưa nhập mã cơ hội cần tạo HĐ');

  log.info(`Tạo YC HĐ bằng tài khoản ${user} (ghi chú giai đoạn → báo giá 1đ → gửi YC HĐ)`);
  let { api, getSm } = await connectBms(user);
  let ok = 0;
  for (const code of codes) {
    try {
      let result;
      try {
        result = await createContractRequest(api, code, { getSm });
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 401)) throw err;
        if (err.baseUrl === config.smApiUrl) await getSm(true);
        else ({ api, getSm } = await connectBms(user, true));
        result = await createContractRequest(api, code, { getSm });
      }
      saveRecord('contracts', toContractRecord({ env: config.name, user, result }), CONTRACT_CSV_COLUMNS);
      ok++;
      log.ok(`${color.bold(result.code)} ${result.state.label} ${color.gray(`(${result.steps.join(' → ')})`)}`);
    } catch (err) {
      log.error(err.message);
    }
  }
  log.info(`Hoàn tất: tạo YC HĐ ${ok}/${codes.length} cơ hội`);
  return ok === codes.length;
}

async function cmdSurvey({ interactive }) {
  const user = await resolveUser();
  let codes = positionals.slice(1);
  if (!codes.length && interactive) codes = (await ask('Mã cơ hội cần khảo sát (cách nhau bởi dấu phẩy)')).split(/[\s,;]+/);
  codes = codes.map((c) => c.trim()).filter(Boolean);
  if (!codes.length) throw new Error('Chưa nhập mã cơ hội cần khảo sát');

  log.info(`Khảo sát bằng tài khoản ${user} (BMS công việc KS → SM phiếu KS → kết quả Thành công)`);
  let { api, getSm } = await connectBms(user);
  let ok = 0;
  for (const code of codes) {
    try {
      let result;
      try {
        result = await createSurvey(api, await getSm(), code, { user });
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 401)) throw err;
        if (err.baseUrl === config.smApiUrl) await getSm(true);
        else ({ api, getSm } = await connectBms(user, true));
        result = await createSurvey(api, await getSm(), code, { user });
      }
      saveRecord('surveys', toSurveyRecord({ env: config.name, user, result }), SURVEY_CSV_COLUMNS);
      ok++;
      log.ok(`${color.bold(result.code)} ${result.state.label} ${color.gray(`(${result.steps.join(' → ') || 'đã có sẵn'} | phiếu ${result.registrationCode})`)}`);
    } catch (err) {
      log.error(err.message);
    }
  }
  log.info(`Hoàn tất: khảo sát ${ok}/${codes.length} cơ hội`);
  return ok === codes.length;
}

async function cmdApproveContract({ interactive }) {
  const user = await resolveUser();
  let codes = positionals.slice(1);
  if (!codes.length && interactive) codes = (await ask('Mã cơ hội có YC HĐ chờ BGĐ duyệt (cách nhau bởi dấu phẩy)')).split(/[\s,;]+/);
  codes = codes.map((c) => c.trim()).filter(Boolean);
  if (!codes.length) throw new Error('Chưa nhập mã cơ hội cần duyệt YC HĐ');

  log.warn(`Duyệt YC HĐ bằng tài khoản ${user} – cần BGĐ của cơ hội hoặc admin`);
  let { api } = await connectBms(user);
  let ok = 0;
  for (const code of codes) {
    try {
      let result;
      try {
        result = await approveContractRequest(api, code);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 401)) throw err;
        ({ api } = await connectBms(user, true));
        result = await approveContractRequest(api, code);
      }
      saveRecord('contract-approvals', toContractApprovalRecord({ env: config.name, user, result }), CONTRACT_APPROVAL_CSV_COLUMNS);
      ok++;
      const st = result.state;
      log.ok(`${color.bold(result.code)} ${st.label} ${color.gray(`(số HĐ: ${st.contractNo ?? '–'} | mã ĐK: ${st.regCode ?? '–'})`)}`);
    } catch (err) {
      log.error(err.message);
    }
  }
  log.info(`Hoàn tất: duyệt YC HĐ ${ok}/${codes.length} cơ hội`);
  return ok === codes.length;
}

async function interactiveMenu() {
  console.log(color.bold(`\n=== FTMS Data Tool (${config.name}) ===`));
  const actions = [
    { label: 'BMS - Tạo cơ hội (khách hàng mới)', run: () => cmdCreateOpportunity({ interactive: true }) },
    { label: 'BMS - Duyệt cơ hội (nhập mã)', run: () => cmdApprove({ interactive: true }) },
    { label: 'BMS/SM - Khảo sát dịch vụ LeasedLine (nhập mã cơ hội đã duyệt)', run: () => cmdSurvey({ interactive: true }) },
    { label: 'BMS - Tạo yêu cầu HĐ (nhập mã cơ hội đã duyệt)', run: () => cmdContract({ interactive: true }) },
    { label: 'BMS - BGĐ duyệt yêu cầu HĐ (nhập mã cơ hội)', run: () => cmdApproveContract({ interactive: true }) },
    { label: 'Xem danh sách Nhóm / Loại dịch vụ', run: cmdServices },
    { label: 'Đăng nhập lại', run: cmdLogin },
  ];
  const action = await choose('Chọn chức năng', actions, (a) => a.label);
  return action.run();
}

async function main() {
  if (args.help) return console.log(HELP);
  const commands = {
    login: cmdLogin,
    services: cmdServices,
    'create-opp': () => cmdCreateOpportunity({ interactive: !(args.group && args.type) }),
    approve: () => cmdApprove({ interactive: positionals.length < 2 }),
    survey: () => cmdSurvey({ interactive: positionals.length < 2 }),
    contract: () => cmdContract({ interactive: positionals.length < 2 }),
    'approve-contract': () => cmdApproveContract({ interactive: positionals.length < 2 }),
  };
  const cmd = positionals[0];
  if (cmd && !commands[cmd]) {
    console.log(HELP);
    throw new Error(`Lệnh không hợp lệ: ${cmd}`);
  }
  const ok = await (cmd ? commands[cmd]() : interactiveMenu());
  if (ok === false) process.exitCode = 1;
}

main()
  .catch((err) => {
    log.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => rl?.close());
