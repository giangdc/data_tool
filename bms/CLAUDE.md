# CLAUDE.md — FTMS Data Tool

Ghi chú bàn giao cho các phiên phát triển sau. Cập nhật file này mỗi khi thêm tính năng / phát hiện thêm API.

## 1. Bối cảnh & mục tiêu

- Người dùng: **QC** test hệ thống **FTMS** (nhiều tool liên quan dữ liệu với nhau).
- Luồng nghiệp vụ: **Tạo cơ hội → phê duyệt (BMS) → lên hợp đồng (CM) → đẩy đi triển khai ở các tool khác** (tool nào quản lý dựa vào **Nhóm dịch vụ + Loại dịch vụ**).
- Vấn đề: muốn test 1 tool phía sau phải tạo data từ đầu rất lâu → tool này tạo data nhanh.
- **Phiên bản hiện tại: 1.5.0** (`version` trong `package.json`, tên gói `dist/ftms-data-tool-1.5.0-linux-x64.tar.gz`). Mã nguồn trên GitHub: `https://github.com/giangdc/ToolFTMS` (public). Bản tiếp theo: xem mục 8.

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-10-14 | BMS – **Tạo cơ hội**: chọn Nhóm DV + Loại DV (+ AM/TPP/BGĐ), còn lại random hợp lệ. UI web, CLI, icon desktop, bản đóng gói Linux (gói khi đó đánh số 0.1.0) |
| 1.1 | 2026-10-15 | BMS – **Duyệt cơ hội**: cột Trạng thái + nút Duyệt ở bảng kết quả, card nhập mã để duyệt cơ hội của người khác, CLI `approve`. Sửa: báo lỗi ngay khi nhập sai tài khoản; token cũ hết hạn trong `.cache` gây 401 |
| 1.2 | 2026-10-15 | BMS – **Tạo yêu cầu HĐ**: nút Tạo HĐ ở bảng (cơ hội đã duyệt, chưa có YC HĐ) + pill trạng thái HĐ, card nhập mã, CLI `contract`. Tự ghi chú giai đoạn + báo giá 1đ (không gói riêng – phát hành cùng 1.3) |
| 1.3 | 2026-10-15 | **Giao diện mới**: đăng nhập chuyển lên header (chấm xanh + tên khi đã đăng nhập, ô OTP hiện trên header nếu máy chưa có), 3 tab **Tạo cơ hội / Duyệt cơ hội / Tạo yêu cầu HĐ** (nhớ tab cuối), bảng Kết quả bên phải dùng chung cho cả 3 tab |
| 1.4 | 2026-10-15 | BMS – **BGĐ duyệt yêu cầu HĐ**: tab 4 "Duyệt yêu cầu HĐ", nút **BGĐ duyệt** ở bảng (YC HĐ đang chờ BGĐ), hiện **Số HĐ** dưới trạng thái, CLI `approve-contract`. Kết quả: BMS cấp số HĐ + mã đăng ký CMR…, chuyển "Chờ DEM duyệt" |
| 1.5 | 2026-10-16 | **Khảo sát LeasedLine (BMS + SM)**: dịch vụ Kênh truyền bị chặn "cần khảo sát trước khi lên yêu cầu Hợp đồng" → tab 3 "Khảo sát", nút **Tạo KS** ở bảng (pill "KS: …"), CLI `survey`. YC HĐ LeasedLine tự lấy địa chỉ đã KS + khai cước trên SM. Đăng nhập SM dùng chung phiên SSO (`getSmToken`). Đưa mã nguồn lên GitHub, cài bằng `git clone` |

- Quy ước: tính năng mới → tăng số giữa (1.4.0…), chỉ sửa lỗi → tăng số cuối (1.3.1…). Cập nhật bảng trên mỗi lần phát hành.
- **Checklist phát hành:** sửa code → test thật trên stag (UI chạy cổng phụ `UI_PORT=3010 node src/server.js --no-open` để không đụng server 3000 của user; tắt bằng **PID của chính tiến trình đó** – KHÔNG `pkill -f "src/server.js"` vì server 3000 của user cùng command line, 2026-10-16 đã lỡ tắt) → tăng `version` trong `package.json` → thêm dòng vào bảng trên + mục 7 → `npm run build` → báo user đường dẫn tar.gz. Chạy thật Nhóm/Loại DV mới → cập nhật bảng **Độ phủ** bên dưới.

### Độ phủ Nhóm / Loại dịch vụ đã chạy thật (cập nhật 2026-10-16, v1.5.0)
**Mỗi Nhóm/Loại DV có thể có rule riêng ở bước lên HĐ** (vd LeasedLine bắt khảo sát + khai cước trên SM). Tool chỉ **đảm bảo** cho các loại đã chạy thật dưới đây; loại khác tạo cơ hội + duyệt thường vẫn được, nhưng **Tạo HĐ có thể vướng rule chưa biết** → khi user báo lỗi mới: khảo sát theo mục 6, thêm nhánh xử lý, rồi cập nhật bảng này.

| Nhóm DV [id] | Loại DV [id] | Tạo CH | Duyệt | Khảo sát | Tạo YC HĐ | BGĐ duyệt HĐ | Rule riêng / ghi chú | Mã test |
|---|---|---|---|---|---|---|---|---|
| Cloud partner [2000] | Azure [2002] | ✔ | ✔ | không cần | ✔ | ✔ | Không – luồng chuẩn (báo giá 1đ) | CH00086392, CH00086405 |
| Cloud partner [2000] | Windows 365 [2003] | ✔ | ✔ | không cần | ✔ | – chưa thử | Không | CH00086388, CH00086393 |
| Điện toán đám mây [6000] | Hosting/Email | ✔ | ✔ | không cần | ✔ | – chưa thử | Không | CH00086394 |
| An toàn thông tin [1000] | SSL [1001] | ✔ | – chưa thử | ? | – chưa thử | – | Chưa biết | (3 cơ hội đầu tiên) |
| **Kênh truyền [11000]** | **Truyền số liệu - MPLS [11004]** | ✔ | ✔ | **✔ bắt buộc** | ✔ | ✔ | **LeasedLine (tool SM "LC")**: (1) BMS chặn "cần khảo sát trước khi lên yêu cầu Hợp đồng" → `survey.js`; (2) gửi YC HĐ thẳng bị "Giá trị LeasedLine không đồng bộ" → nháp + khai cước SM. Số HĐ dạng `SGLC…`/`HNLC…` | CH00086403, CH00086404, CH00086406 |

- **Đã biết nhưng chưa làm**: các loại khác trong nhóm Kênh truyền 11000 (P2P 11002, SDWAN 11020…) cùng tool LC → *nhiều khả năng* chạy được như MPLS nhưng **chưa test** (SDWAN/Cloud Connect có form KS khác: băng thông khóa, CSP…). Dịch vụ tích hợp tool khác (`integrated-settings`): **SMS / FTI-MES** (12001, 12002 – KS ở `/mes/iframe/survey`, YC HĐ check `check-service-integrate` "feasible"), **VOICE / ivoice** (Đầu số thoại 1, 2, 3, 8, 3001–3004) → tool báo "chưa hỗ trợ" ở bước Tạo KS. Nhóm 15000 dùng `typeContract: 2`. Book rack (công việc loại 5) – chưa làm.
- Xem nhanh 1 cơ hội có cần KS không: `GET /api/works/opportunity-service?oppId=` (có `surveys[]` = cần) hoặc `can-create-registration`.

### Quyết định đã chốt với user (2026-10-14)
| Hạng mục | Quyết định |
|---|---|
| Đăng nhập | Tài khoản + **OTP mặc định dùng chung** (lưu `.env`, nhập qua UI lần đầu). Người dùng chỉ nhập tên tk |
| Khách hàng | **Luôn tạo KH mới** mỗi cơ hội (không đụng data người khác). Sau này có thể thêm option chọn KH có sẵn |
| AM / TPP / BGĐ | UI: AM = ô chọn có tìm kiếm (mặc định `giangdc2`); TPP đánh giá + BGĐ phê duyệt = dropdown nạp theo AM, **chọn sẵn ngẫu nhiên 1 người, cho chọn lại**. CLI: `--am/--tpp/--bgd`, bỏ trống tpp/bgd = random |
| Cơ hội | 1 cơ hội = 1 dịch vụ, **không** tạo dự án, **không** đính kèm file |
| Tiêu chí | Dễ thao tác, cài được trên nhiều máy, dễ phát triển thêm |
| Phân phối | Máy đích **Ubuntu/Linux x64**, đã có **Chrome/Edge** → 1 file tar.gz kèm Node portable |
| Được phép | Tạo data thoải mái trên **stag** |
| Tạo YC HĐ (2026-10-15) | Báo giá nhập **1đ** (không vượt hạn mức → không cần duyệt giá). Tạo bằng tk đang đăng nhập (AM hoặc admin). Chỉ gửi YC HĐ, **chưa** làm bước BGĐ duyệt YC HĐ |
| Duyệt YC HĐ (2026-10-15) | Theo khuôn Duyệt cơ hội: duyệt bằng **tk đang đăng nhập** (BGĐ được chọn hoặc admin chuyennt5), ý kiến cố định "AUTO-QC duyệt YC HĐ tự động". Chưa làm Từ chối |
| Duyệt cơ hội (2026-10-15) | Duyệt bằng **tài khoản đang đăng nhập** (không có ô tk duyệt riêng) + dòng cảnh báo về quyền; nút Duyệt ở bảng **chỉ hiện khi đang chờ duyệt**; tk admin (chuyennt5) duyệt được mọi phiếu |

## 2. Cách chạy

```bash
npm run setup                 # lần đầu: npm install (playwright-core, dùng Chrome/Edge có sẵn)
cp .env.example .env          # tùy chọn: điền FTMS_OTP (hoặc nhập trên UI lần đầu)
npm run ui                    # giao diện web http://localhost:3000 (khuyến nghị)
npm run build                 # đóng gói dist/ftms-data-tool-<ver>-linux-x64.tar.gz
npm run install-launcher      # tạo icon Desktop + menu ứng dụng (Ubuntu/GNOME)
npm start                     # menu dòng lệnh
npm run create-opp -- -u giangdc2 -g "Cloud partner" -t "Azure" -n 3
npm run services -- -u giangdc2   # in danh sách Nhóm/Loại DV + id
npm run approve -- -u chuyennt5 CH00086386 CH00086387   # duyệt cơ hội (tk cần quyền duyệt)
npm run survey -- -u chuyennt5 CH00086403               # khảo sát dịch vụ LeasedLine (BMS + SM) trước khi tạo HĐ
npm run contract -- -u giangdc2 CH00086386               # tạo yêu cầu HĐ cho cơ hội đã duyệt
npm run approve-contract -- -u chuyennt5 CH00086386      # BGĐ duyệt yêu cầu HĐ
```

- Icon desktop gọi `scripts/launch-ui.sh`: bật server ngầm (nohup, PID ở `.cache/ui-server.pid`, log `output/ui-server.log`) nếu chưa chạy, rồi `xdg-open` UI. Action chuột phải "Tắt FTMS Data Tool" = `launch-ui.sh stop`. Thứ tự tìm `node`: `runtime/node/bin/node` (bản đóng gói) → `node` trong PATH → nvm (launcher desktop không nạp `.bashrc`).
- Server web mặc định bind `127.0.0.1`, cổng `UI_PORT` (mặc định 3000). **Chế độ server** (hướng A, 2026-10-15): `UI_HOST` khác 127.0.0.1/localhost/::1 → bắt buộc `UI_AUTH=user:pass` (HTTP Basic, thiếu thì thoát), khóa `POST /api/settings` (403, `config.settingsLocked` → UI ẩn Đổi OTP), không tự mở trình duyệt. Hướng dẫn triển khai: `DEPLOY-SERVER.md` + `scripts/ftms-data-tool.service` (systemd). Chỉ dùng trong mạng nội bộ – ai qua được basic auth là thao tác được dưới tên bất kỳ tk (OTP dùng chung). Hướng B (mỗi người login OTP riêng, phiên gắn cookie) chưa làm.
- **Sửa code `src/` xong phải khởi động lại server** (`bash scripts/launch-ui.sh stop` rồi chạy lại `bash scripts/launch-ui.sh`): `public/index.html` được đọc mới mỗi request nhưng API thì không → UI mới + API cũ sẽ thiếu nút/tính năng (đã gặp 2026-10-15: không thấy nút BGĐ duyệt).

### Đóng gói / phân phối (Ubuntu/Linux x64)
- `npm run build` → `scripts/build-package.sh` → `dist/ftms-data-tool-<ver>-linux-x64.tar.gz` (~46MB): mã nguồn + `node_modules` (npm ci --omit=dev) + Node portable `runtime/node/bin/node` (tải từ nodejs.org, kiểm SHA256, cache ở `dist/downloads/`). KHÔNG chứa `.env`, `.cache`, `output`.
- Hướng dẫn cho người dùng cuối: **`INSTALL.md`** (đóng gói kèm). Lệnh cài 1 dòng tự `find` file tar.gz mới nhất trong `~`, `/media`, `/mnt` → giải nén cố định vào `~/ftms-data-tool` → `install.sh`. Giải nén đè giữ `.env`/`.cache`/`output` (đã test với HOME giả 2026-10-15).
- Máy đích: giải nén → `bash install.sh` (tạo icon + mở UI) → nhập OTP trên UI lần đầu. `launch-ui.sh` ưu tiên Node trong `runtime/`.
- **Phát hành bản mới:** sửa code → test → tăng `version` trong `package.json` → `npm run build` → gửi file tar.gz. Máy đích giải nén đè/thư mục mới rồi `bash install.sh` lại (icon trỏ theo đường dẫn thư mục; `.env` cũ không bị đóng gói nên copy sang nếu giải nén vào thư mục mới, hoặc nhập lại OTP).
- Mạng: 2 domain stag là IP public 118.70.7.183, truy cập được từ Internet ngoài (đã kiểm tra) → thường không cần VPN.
- Lưu ý khi test trong Claude Code: sandbox đi qua proxy (`HTTPS_PROXY`); chạy với `env -i` mà bỏ biến proxy thì Chrome bị chặn mạng → trang BMS treo sau login. Không phải lỗi tool.

## 3. Cấu trúc code

```
config/environments.js   URL theo môi trường (hiện chỉ có stag) – thêm env mới tại đây
src/core/env.js          nạp .env (process.loadEnvFile), config, toEmail()
src/core/auth.js         Login SSO+OTP bằng Playwright -> token BMS (getBmsToken) / SM (getSmToken, cùng phiên SSO); cache token & storageState theo user
src/core/http.js         ApiClient (Bearer, bóc {data,success,errors}; SM: {data,success,error}), ApiError(status, baseUrl – để biết 401 của BMS hay SM)
src/core/store.js        Lưu output/<kind>.jsonl (full payload) + .csv (BOM, mở Excel)
src/core/logger.js       log màu cho CLI
src/data/random.js       Bộ sinh dữ liệu random (tên VN, công ty, MST, SĐT, email, ngày...)
src/bms/masterData.js    Master data BMS (cache trong bộ nhớ): nhóm/loại DV, tỉnh/phường, sale, TPP, BGĐ
src/bms/customer.js      buildNewCustomer(), toValidatePayload()
src/bms/opportunity.js   buildOpportunityPayload(), createOpportunity(), toOpportunityRecord()
src/bms/approval.js      getApprovalState(), approveOpportunity() – duyệt cơ hội (TPP đánh giá -> BGĐ)
src/bms/contract.js      getContractState(), createContractRequest() – YC HĐ (ghi chú giai đoạn -> báo giá 1đ -> [LeasedLine: nháp + cước SM] -> đăng ký HĐ); approveContractRequest() – BGĐ duyệt YC HĐ
src/bms/survey.js        getSurveyState(), createSurvey() – khảo sát LeasedLine: công việc KS (BMS) -> phiếu KS + kết quả Thành công (SM)
src/cli.js               CLI (parseArgs + readline menu)
src/server.js            HTTP server (node:http, không framework) + API nội bộ cho UI
public/index.html        UI 1 file (HTML/CSS/JS thuần, dark mode, localStorage nhớ lựa chọn + tab). Header = đăng nhập; tab `[data-tab]` ↔ card `[data-panel]` (showTab); bảng Kết quả bên phải dùng chung
scripts/launch-ui.sh     Bật/tắt server + mở trình duyệt (dùng cho icon)
scripts/build-package.sh     Đóng gói tar.gz kèm Node portable
install.sh               Cài trên máy đích (icon + mở UI)
scripts/install-launcher.sh  Tạo file .desktop (~/.local/share/applications + Desktop, gio trusted)
assets/icon.svg          Icon
assets/quotation-sample.pdf  File PDF mẫu đính kèm báo giá (BMS kiểm tra PDF thật – tạo bằng Chrome page.pdf())
```

- Dependency duy nhất: **playwright-core 1.62.0** (exact). Login mở trình duyệt có sẵn theo thứ tự Chrome → Edge → Chromium (`launchBrowser()` trong auth.js, ép bằng `BROWSER=chrome|msedge|chromium`). Node >= 20.12 (dùng `process.loadEnvFile`).
- OTP: nếu `.env` chưa có → UI hiện ô nhập OTP, `POST /api/settings {otp}` ghi vào `.env` (`saveEnvValue`, quyền 600, lấy `.env.example` làm khung).
- Code ESM (`"type": "module"`), comment tiếng Việt, không TypeScript, không framework.
- API nội bộ của UI (`src/server.js`): `GET /api/config` (có `otpConfigured`), `POST /api/settings {otp}`, `POST /api/login {user, force}`, `GET /api/services?user=`, `GET /api/sales?user=` (gộp sales + sales/all), `GET /api/approvers?user=&am=` → `{am, tpp[], bgd[]}` (đã loại AM), `POST /api/opportunities {user, groupId, typeId, am, tpp?, bgd?}` (tạo **1** cơ hội/request – UI gọi lặp để hiện tiến độ), `POST /api/opportunities/status {user, codes[]}` → trạng thái duyệt từng mã, `POST /api/approve {user, code}` (duyệt 1 mã/request, bằng tk đang đăng nhập), `POST /api/surveys {user, code}` (khảo sát LeasedLine 1 mã/request; lưu `output/surveys.*`), `POST /api/contracts {user, code}` (tạo YC HĐ 1 mã/request; lưu `output/contracts.*`), `POST /api/contracts/approve {user, code}` (BGĐ duyệt YC HĐ; lưu `output/contract-approvals.*`). `opportunities/status` kèm `contract: {requested, label, waitingBgd, regCode, contractNo, ...}` cho mã đã duyệt, và `survey: {required, done, label, workId}` khi chưa gửi YC HĐ, `GET /api/history` (200 bản ghi gần nhất từ jsonl).
- Phiên BMS trong server: `Map` theo username; gặp 401 thì tự login lại 1 lần (`withSession`) – 401 của SM (`err.baseUrl === config.smApiUrl`) thì chỉ login lại SM. CLI cũng retry 401 tương tự. SM chỉ đăng nhập khi cần (`getSm()` trong session), token cache `.cache/token-sm-stag-<email>.json`.

### Biến `.env`
| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `FTMS_ENV` | stag | key trong `config/environments.js` |
| `FTMS_OTP` | – | OTP dùng chung (bắt buộc; nhập qua UI được) |
| `FTMS_EMAIL_DOMAIN` | fpt.com | ghép vào tên tk |
| `FTMS_USER` | – | tk mặc định |
| `BMS_AM` | giangdc2 | AM mặc định |
| `DATA_PREFIX` | AUTO-QC | tiền tố tên cơ hội/KH |
| `HEADLESS` | true | `false` để xem trình duyệt khi debug login |
| `UI_PORT` | 3000 | cổng UI |
| `UI_HOST` | 127.0.0.1 | địa chỉ lắng nghe; khác loopback = chế độ server |
| `UI_AUTH` | – | `user:pass` (≥8 ký tự) – basic auth, bắt buộc ở chế độ server |
| `BROWSER` | auto | auto / chrome / msedge / chromium |

## 4. Kiến thức hệ thống (đã khảo sát thực tế trên stag)

### URL
- FTMS: `https://ftms-stag.fpt.net/` · BMS web: `https://ftms-stag.fpt.net/bmsv2/` · Tạo cơ hội: `/bmsv2/opportunity/create`
- BMS API base: `https://ftisapi-stag.fpt.net/bms-service` (header `Authorization: Bearer <token>`). Response chuẩn: `{ data, success, errors, meta }`.
- FTMS portal API: `https://ftms-stag.fpt.net/api/bam` (chưa dùng).

### Đăng nhập (SSO kiểu CAS)
1. `https://ftms-stag.fpt.net/id/login?service=<url BMS>` → màn "Chọn phương thức xác thực": *FPT Corporation* / **"Sử dụng mật khẩu một lần (OTP)"**.
2. Chọn OTP → input `#username` (email, vd `giangdc2@fpt.com`) → nút **TIẾP THEO** → ô OTP (selector dò: `input[type=password]`, `input[name*=otp]`...) → Enter.
3. CAS redirect về BMS kèm `?ticket=` → BMS gọi `POST /api/auth/sso {token: ticket, service}` → lưu token vào cookie **`BMS_access_token`** (JWT, sống ~1h, claims: UserName, FullName, DepartmentName, exp...).
4. Tool đọc cookie này từ Playwright context. Lưu `storageState` để lần sau CAS tự redirect (bỏ qua OTP). Lỗi login → ảnh chụp ở `output/debug/login-fail-*.png`.
- Ô OTP thực tế: `input[type=password][name=password]`, placeholder "Vui lòng nhập xác thực đã được gửi qua email". Login rất nhanh (<1s) – redirect về `/bmsv2/` xảy ra ngay khi Enter, nên `waitForURL` dùng `waitUntil: 'commit'`.
- Nhập sai: SSO hiện thông báo trong `label.error-mess` (vd "Tài khoản đăng nhập không chính xác. Vui lòng thử lại!", "Email không đúng định dạng..."). `waitOrSsoError()` trong auth.js chờ song song bước tiếp theo / thông báo này → ném `LoginError` (status 400, không chụp ảnh), UI hiện ngay (~1s thay vì chờ timeout 20s). Áp dụng cả bước OTP (chưa test thực tế OTP sai).
- Có thêm `POST /api/auth/sign-in` (user/pass) nhưng không dùng.

### Form "Tạo cơ hội" (3 bước) → API
| Bước | Trường | API |
|---|---|---|
| 1. Thông tin cơ hội | Tên*, Nhóm DV*, Loại DV* (có "Thêm dịch vụ"), Mô tả*, Doanh thu kỳ vọng* (kỳ: Năm), Ngân sách, Khả năng thành công %*, Dự kiến kết thúc*, Độ ưu tiên (mặc định Trung bình), Tạo dự án* (Không), Tài liệu | `GET /api/master-data/service-groups` → `[{id, serviceGroupName}]`; `GET /api/master-data/service-types?serviceGroupId=` → `[{id, serviceTypeName, serviceGroupId, servicePackCode, isActive}]` |
| 2. Thông tin KH | Tìm KH có sẵn **hoặc** "Nhập thông tin khách hàng mới" (Tổ chức/Cá nhân; Phân loại, MST*, Tên*, Tỉnh*, Phường*, Địa chỉ*, Quốc gia*, Mã quốc gia*, Mã nhóm*, SĐT*, Email*, Người đại diện*, Chức vụ*...) | `GET /api/customners/search?KeyWord=&PageNumber=&PageSize=` (lưu ý chính tả *customners*), `GET /api/customners/cm/{customerId}`, `GET /api/bam/provinces`, `GET /api/bam/communes?provinceId=`, `GET /api/customners/countries`, `GET /api/customners/group-companies` (`[{code:"Anonymous"}]`), `GET /api/customners/code-details?cmCode=` |
| 3. Chọn người duyệt | AM*, TPP đánh giá* (multi), BGĐ phê duyệt* (multi), Gửi thông báo | AM: `GET /api/bam/sales` (**rỗng với tk sale** → fallback `GET /api/bam/sales/all`). **TPP** = `GET /api/bam/employees/{amEmail}/department-managers`. **BGĐ** = `GET /api/bam/employees/{amEmail}/central-managers` |
| Submit | | `POST /api/opportunities/validate` rồi `POST /api/opportunities` → `data: "CH000xxxxx"` |

- Khác: `/api/opportunities/draft`, `/api/opportunities/search`, `/api/opportunities/{id}/...` (progress, stages, contracts, close...), `/api/accounts/me`.

### Payload tạo cơ hội (đã kiểm chứng)
```jsonc
// POST /api/opportunities/validate
{ "customerId": null, "customer": { "id": null, "identity": "<MST>", "fullName": "...", "type": 3, "location": <provinceId>, "district": null, "ward": <communeId>, "budgetRelationCode": null } }

// POST /api/opportunities
{
  "customerId": null, "leadId": null, "leadDescription": null,
  "opportunity": { "name", "description", "expectedRevenue": 100000000, "expectedRevenuePeriod": 1 /*Năm*/,
    "expectedBudget": null, "successRate": 50, "endDate": "yyyy-MM-dd", "priority": 2 /*Trung bình*/,
    "numberRack": null, "services": [{ "serviceGroup": 2000, "serviceType": 2004, "servicePackCode": null }], "documents": null },
  "approval": { "saleName": "Giangdc2" /*userName đúng hoa thường*/, "tppCanApproval": ["datlt45"],
    "usersCanApproval": ["anhdc4"], "userReceiveNotification": null, "campaignId": null },
  "customer": { "id": null, "fullName", "nickName": "1", "identity", "address", "fullAddress", "phone", "email",
    "location", "ward", "type": 3 /*Tổ chức*/, "typeCusMain": 2 /*DN trong nước*/, "country": "Viet Nam",
    "countryCode": "VNM", "groupCode": "Anonymous", "representativeName", "representativePosition", ... (null còn lại) }
}
```
- Chưa xác minh mã các giá trị khác của `priority`, `expectedRevenuePeriod`, `type` (Cá nhân), `typeCusMain` → nếu cần random thì bắt payload từ UI trước.
- Danh sách BGĐ có thể chứa chính AM → tool loại AM khỏi TPP/BGĐ.

### Duyệt cơ hội (khảo sát 2026-10-15, bundle chunk `ApproveNewOppModal.*.js`, `ApprovalOppEndpoints.*.js`)
- Cơ hội tool tạo nằm ở trang **Duyệt cơ hội > tab "Đánh giá"** (`requestType` 4 = "Yêu cầu đánh giá cơ hội", 6 = mở lại; 5/7 = "Yêu cầu phê duyệt đánh giá" (bước BGĐ)). Tab "Cơ hội mới" (`approve-new-opportunity`) dành cho cơ hội từ lead – **chưa hỗ trợ**.
- Trạng thái: `GET /api/opportunities/{CH}` → `approvalStatus` (1 = Đã duyệt, 2 = Chờ duyệt), `requestType`. Sale và admin đều đọc được. Mã sai → 400 "Cơ hội không tồn tại".
- **TPP đánh giá:** `GET /api/evaluation-opportunities/criteria?opportunityId=&isFromConfig=true` (tk không có quyền → `data: null`) → `PUT /api/evaluation-opportunities/evaluate {opportunityId, note, criteria:[{criteriaId, id, criteria, requirement, description, evaluation: 1 /*Đạt; 2 Không đạt*/, note}]}` → `{isDuplicated, duplicatedOppt}`.
- **Đánh giá Đạt hết → BMS tự phê duyệt** ("Hệ thống tự động phê duyệt", requestType → 1, approvalStatus → 1), thường không cần bước BGĐ.
- **BGĐ:** `PUT /api/evaluation-opportunities/bgd-approve {opportunityId, bgdApprovalStatus: 3 /*duyệt; 4 từ chối*/, reason}`. Gọi trên cơ hội đã duyệt vẫn trả 200 → tool **tự kiểm tra trạng thái trước** để báo "đã duyệt". Nhánh requestType 5/7 trong tool chưa gặp thực tế (API đã gọi thử OK).
- Danh sách: `POST /api/approval-opportunities/evaluation-opportunity {keyword, approvalStatus /*bắt buộc*/, pageIndex, pageSize}`; row có `isViewBtnEvaluatedOpp`, `isManager`, `waitingApproval`. `GET /api/approval-opportunities/count-tabs`.
- Quyền: chuyennt5 (role FTIBMS.ADMIN) đánh giá + duyệt được mọi phiếu; giangdc2 (sale) → 403.

### Yêu cầu tạo HĐ (khảo sát 2026-10-15, chunk `index.Biy4pwDM.js` = trang create-registration, `index.DUClnxOA.js` = chi tiết cơ hội)
- UI: chi tiết cơ hội `/bmsv2/opportunity/detail/{CH}` → nút **"Yêu cầu tạo HĐ"** → chọn dịch vụ → `/opportunity/create-registration?refCode={CH}_{registrationId}` (3 bước: Thông tin chung / Thông tin dịch vụ / Xác nhận).
- Mỗi dịch vụ của cơ hội có sẵn 1 `registrationId` (nháp rỗng): `GET /api/opportunities/{CH}/registration-services` (chỉ liệt kê dịch vụ **chưa** gửi YC HĐ). Trạng thái: `GET /api/opportunities/{CH}/contracts` → `statusRegistName` ("Chờ BGĐ duyệt"), `bgdApprovalStatus` (2 = chờ), `contractNo`, `cmApprovalStatus`.
- Kiểm tra: `GET /api/opportunities/{CH}/can-create-registration?serviceGroup=&serviceType=&servicePackCode=` → `{canCreate, message}`. Chặn theo thứ tự: (1) "Vui lòng nhập ghi chú cho các giai đoạn chưa hoàn thành." (2) "Vui lòng tạo Yêu cầu báo giá trước…" (**mọi** loại DV trên stag đều cần báo giá). `canCreate: true` kèm message = câu xác nhận, bỏ qua.
- Ghi chú giai đoạn: `GET /api/opportunities/{CH}/stages` → `items[{id, planEndDate, actualEndDate, note}]`; `PUT /api/opportunities/{CH}/stages/{id} {opportunityId, id, planEndDate: "yyyy-MM-dd", note}` (chỉ sửa ghi chú, không chuyển giai đoạn).
- Báo giá: `GET /api/quotation/services/{CH}` → `{services:[{serviceGroupId, serviceTypeId, servicePackCode}]}`; `POST /api/quotation/check-approval-limit {services:[{...,value}]}` (`data: []` = không vượt hạn mức); `POST /api/quotation` **multipart**: `opportunityId, description, totalValue, services[i].serviceGroup/serviceType/servicePackCode/servicePackId/value, quotationDocuments` (file; server kiểm tra PDF hợp lệ – PDF tự viết tay bị từ chối "không phải PDF hợp lệ").
- Gửi YC HĐ: `GET /api/registration/{regId}` (chi tiết + customer) · `GET /api/master-data/locations-for-regist` (Vùng miền: 8 HCM, 4 HN) · `POST /api/registration/{regId}`:
```jsonc
{ "registration": { "typeDocContract": 1 /*HĐ; 3 = phụ lục*/, "typeContract": 1 /*HĐ dịch vụ; nhóm 15000 -> 2*/, "paymentMethod": 2 /*Trả sau*/,
    "location": 8, "feeContract": 1, "monthlyFeeContract": 1, "dateContractMonth": 1, "contractValue": 2, "contractValueCurrency": "VND",
    "paymentTerm": 1, "effectiveContractDate": "2026-10-15T00:00:00", "limitCreditDay": 30, "description", "saleName", "serviceId", "contractNo": "", "packServiceIds": [] },
  "listBillingContact": [{ "contactName","contactEmail","contactPhone","location","locationName","district": <wardId> /*form thu cước để phường ở district*/,"districtName","address","country","fullAddress" }],
  "listTechContact": [{ "name","email","phone" }],
  "listDeployAddress": [{ ...như trên nhưng "ward","wardName","idOfServiceTypeInPack": null }],
  "isUpdateTemp": false /*true = lưu nháp*/, "appCodeInsert": "FTIBMS", "opportunityId",
  "listEContractDocument": [], "listCooperationAgreementDocument": [], "listMember": [{ "name","position": 1 /*AM; 2 Co-sale*/,"contractRate": 100 }] }
```
  → `data: regId`, trạng thái "Chờ BGĐ duyệt". Bắt buộc ≥1 liên hệ thu cước, ≥1 liên hệ kỹ thuật, ≥1 địa chỉ triển khai. Thành viên: `GET /api/opportunities/{CH}/members`.
- Quyền: AM (giangdc2) và admin (chuyennt5) đều tạo được.

### BGĐ duyệt yêu cầu HĐ (khảo sát 2026-10-15, chunk `index.ghVMeDUI.js` / `index.BYQ7OTsu.js`, endpoint trong `ApprovalOppEndpoints.*.js`)
- UI BMS: Duyệt cơ hội > tab đăng ký HĐ, chi tiết `/bmsv2/approval-opportunity/regist-detail`. Modal "Phê duyệt đăng ký HĐ" bắt buộc nhập Lý do/Ý kiến.
- Danh sách: `POST /api/approval-opportunities/registration-opportunity {keyword /*mã CH*/, approvalStatus /*2 chờ; 0 tất cả?*/, pageIndex, pageSize}` → `{totalCount, data:[{opportunityId, registrationId, bgdApprovalStatus, usersCanApproval /*BGĐ được chọn*/, contractValue, ...}]}`. Chi tiết: `GET /api/approval-opportunities/registration-detail?refCode={CH}_{registrationId}`.
- **Duyệt:** `POST /api/approval-opportunities/approve-registration {registrationId, approvalStatus: 1 /*2 = từ chối*/, reason}` → `data: true`.
- Sau khi duyệt: `bgdApprovalStatus` 2 → 1, "BGĐ phê duyệt" → **vài giây sau** (BMS đẩy sang CM bất đồng bộ) có `regCode` (mã đăng ký `CMR…`), `contractNo` (số HĐ, vd `SGSE22506` – tiền tố theo vùng SG/HN), `cmApprovalStatus: 2`, `statusRegistName: "Chờ DEM duyệt"`. Tool chờ tối đa ~12s để lấy số HĐ.
- Lỗi: tk sale → 403 "Forbidden" (tool đổi thành câu tiếng Việt); sale không phải AM của cơ hội → 400 "Bạn không có quyền thực hiện thao tác này" (ngay ở `/contracts`); duyệt lần 2 → 400 BUSINESS_ERROR "Bản ghi đăng ký đã được phê duyệt.". Mã lỗi khác trong bundle: `SALE_NO_IBB`, `CM_VALIDATION_FAILED`, `INVALID_STATUS`, `CANCELED`.
- Bước sau (**DEM duyệt** trên CM, `cmApprovalStatus`/`cmStatus`) **chưa khảo sát**. chuyennt5 thuộc phòng "DEM - Quản lý công nợ (MN)" → có thể là người duyệt được. Còn: `PUT /api/registration/sub-contract/{no}/waiting-bgd` (phụ lục), chunk `registrationStatusApi.*.js`.

### Khảo sát dịch vụ LeasedLine – BMS + SM (khảo sát 2026-10-16, bundle BMS `work-status.enum.*.js`, SM `/sm/v2/assets/index.BTYA_gMl.js`, `index.B5Rbb4gQ.js`, `index.B8zEvEz-.js`)
- Dịch vụ tích hợp tool (`GET /api/registration/integrated-settings` → `settings.{LC,SMS,VOICE}.listServiceType`): **LC** = LeasedLine (nhóm Kênh truyền 11000), SMS = FTI-MES, VOICE = ivoice. Tool chỉ hỗ trợ **LC**.
- Chặn ở `can-create-registration`: "… (LeasedLine) cần khảo sát trước khi lên yêu cầu Hợp đồng" → có công việc KS nhưng chưa có kết quả: "… hiện có công việc khảo sát cần cập nhật kết quả …".
- **BMS – Công việc khảo sát:** `GET /api/works/opportunity-service?oppId=` → `{surveys:[{serviceId, serviceTypeId, serviceGroupId, displayName, toolCode:"LC", urlCreateWork}], bookRacks}` – **null khi đã có công việc KS** (hoặc dịch vụ không cần KS). `GET /api/works/members?oppId=` → `["Hainm17"]` (người thực hiện). `POST /api/works {name, opportunityId, description, priority:2, executiveName, deadline:"yyyy-MM-ddTHH:mm:ss", type:4 /*KS; 5 = book rack*/, serviceTypeId, serviceGroupId, serviceId, idOfServiceTypeInPack, servicePackId, attachedFileIds:[]}` → `{workId, redirectUrl /*SM /ll/surveys/bms/{workId}*/}`. Danh sách: `GET /api/works/by-opportunity?OpportunityId=&PageIndex=&PageSize=` → `result` ("Đã tạo phiếu khảo sát" → "Khảo sát thành công"), `codeIntegrate` (PKSBMS…), `workStatus` (5 = Đã thực hiện). Chi tiết `GET /api/works/{id}` có `toolCode`.
- **SM (Service Management):** web `https://ftms-stag.fpt.net/sm/v2/`, API `https://ftisapi-stag.fpt.net/sm/v2/ll/api/v1` (token riêng: cookie **`access_token_smp`**, JWT ~4h; mở `/sm/v2/auth` → SSO CAS → `POST /sm/v2/api/auth/sso/login {ticket, serviceUrl}`). Response `{data, success, code, error:{code,message}}` – lỗi nghiệp vụ trả **HTTP 200 + success:false**.
  - Lookup: `/lookups/regions` (HN id 7, HCM id 9), `/lookups/branches?regionId=`, `/lookups/provinces` (HCM 8), `/lookups/communes?provinceId=`, `/lookups/survey-channel-types` (6100 ONNET, 6101/6102 OFFNET), `/lookups/fti-tech-supporters`.
  - Phiếu KS theo workId: `GET /registrations/by-work-id/{workId}` (`exists`, `registrationCode` HCMDK…, `bmsSurveyCode` PKSBMS…), `GET …/integrated-info` (KH, saleMan, refCode `CH_regId`, serviceTypeCode). Tạo: `POST /registration-addresses/bulk {workId, saleMan, priorityWork, bmsOpportunity, bmsRefCode, regionCode, emails[], serviceTypeId, isConnectHA…:null, domesticAddresses:[{regionCode, branchCode, wardId, provinceId, street, address, building, contactName, contactPhone, contactEmail, isMainAddress, mainAddressNote, isNeedSolution, surveyPlanDate, deployPlanDate /*yyyy-MM-dd*/, channelTypeCode:6100, hirePartnerCode, bandwidth, internationalBandwidth}], internationalAddresses:[], dcAddresses:[]}`.
  - Phiếu theo địa chỉ: `GET /surveys?search=<PKSBMS…>&pageNumber=&pageSize=` → `id`, `finalStatusCode` (202 chưa KS, 203 đang KS, **204 thành công**, 205 không thành công, 208 từ chối). Chi tiết `GET /surveys/{id}` → `survey.{subscriptionId, accessId, coreId, *StatusCode}`.
  - Chốt kết quả `PUT /surveys/{id}/final-status {finalStatusCode:"204", ftiTechFollow}` – báo **SURVEY_DETAIL_NOT_ASSIGNED** nếu chưa đủ 3 phần: **Thuê bao** `POST /surveys/{id}/subscription {subscriptionCode:"611" /*Hạ tầng FTI – tự Thành công; 602 TIN, 603 PNC, 604 ISP khác, 609 FTEL IDC*/, note, surveyFinalDate, surveyDate}`; **Access** `POST /surveys/{id}/access {accessCode:"607" /*FTI; 605 INF*/, survey*Date, statusCode:"204", constructionPlans:[{popPlus, ring, switchOlt, portInfo, expectedCost, approveDate, images:null}] /*bắt buộc ≥1*/}`; **Core** (NOC) `POST /surveys/{id}/core {survey*Date, statusCode:"204", mPopSdhNode, interfaceCode, deliveryCustomerDate, returnDate, constructionPlans:[{images:null}]}`. Chốt xong SM báo về BMS ngay (~1s): công việc "Khảo sát thành công".
  - chuyennt5 làm được tất cả các bước trên (quyền admin SM). Chưa thử tk sale.
- **YC HĐ LeasedLine** (sau khi KS): `POST /api/registration/deploy-address-by-service-type {opportunityId, registrationId, serviceGroup, serviceType}` → `listDeployment` (địa chỉ đã KS: cityId/districtId/wardId, `refCodeIntegrated`), `urlCreateRegist` (SM `/ll/bms/charge-details`). Gửi YC HĐ thẳng → 400 "**Giá trị LeasedLine không đồng bộ. Vui lòng cập nhật triển khai dịch vụ.**" Phải: lưu nháp YC HĐ (`isUpdateTemp: true`, `listDeployAddress` = listDeployment + `isAddressOfIntegrated/isSelected: true`) → SM `GET /bms-charge-details?refCode=CH_regId&serviceGroupId&serviceTypeId` (`contractValue` lấy từ nháp BMS, `paymentTypeCode` 3902 hàng tháng / 3901 trả trước, `rows[].registrationCode`) → `POST /bms-charge-details {refCode, serviceTypeId, serviceGroupId, isIntergratedService:false, chargeCurrentDetails:[{paymentTypeCode, registrationCode, initialFee, totalAmt, totalMonth}]}` (tổng initialFee+totalAmt phải = giá trị HĐ, sai → BMS_CHARGE_TOTAL_MISMATCH) → gửi YC HĐ. BGĐ duyệt như cũ → số HĐ dạng `SGLC…`/`HNLC…`.

### Master data tham khảo (stag, 2026-10-14)
An toàn thông tin [1000]: SSL 1001, DDOS 1002, Pentest 1003, test1 1005 · Cloud partner [2000]: Office 365 2001, Azure 2002, Windows 365 2003, Google Workspace 2004, GCP 2005, Cloudflare 2006, AI 2007, BytePlus 2008, Alibaba Cloud 2009, Cloud GPU 2010 · Đầu số thoại [1]: Cố định 1, 1800 2, 1900 3, CSKH 8 · Dịch vụ điện tử [4000] · SaaS [5000] · Điện toán đám mây [6000] · ... (dùng `npm run services` để xem đầy đủ).

## 5. Dữ liệu sinh ra
- Tên cơ hội `[AUTO-QC] <Loại DV> - MMdd-HHmm-ss-xxx`; KH `CÔNG TY ... AUTO-QC xxxx`; email `autoqc.xxxxxx@example.com` → lọc/dọn theo `AUTO-QC` (đổi bằng `DATA_PREFIX`).
- Doanh thu 10tr–500tr, % thành công 10–90 (bước 5), kết thúc +15..180 ngày, MST 10 số random (không checksum – BMS stag chấp nhận).
- Kết quả: `output/opportunities.csv` + `.jsonl`.
- YC HĐ: ghi chú giai đoạn `AUTO-QC`, báo giá 1đ (mô tả `AUTO-QC báo giá tự động`, file `AUTO-QC-bao-gia.pdf`), HĐ dịch vụ trả sau, cước 1đ + 1đ/tháng × 1 tháng = 2đ, kỳ hạn TT 1 tháng, hiệu lực hôm nay, công nợ 30 ngày, vùng miền random HCM/HN, 3 loại liên hệ = người đại diện + địa chỉ KH. Kết quả: `output/contracts.csv` + `.jsonl`.

## 6. Cách khảo sát khi làm bước mới
- Dùng Claude in Chrome trên phiên user đã đăng nhập: hook `XMLHttpRequest`/`fetch` trong trang để bắt URL/body, **thao tác UI thật 1 lần** để lấy payload chuẩn, rồi tái hiện bằng API.
- Extension chặn in token/cookie/query string → in key/shape thay vì giá trị; mask email (`@` → `[at]`).
- Bundle JS BMS (`/bmsv2/assets/index.*.js`) tải công khai được → grep endpoint (RTK Query `injectEndpoints`).
- Không tự nhập mật khẩu/OTP thay user; OTP chỉ nằm trong `.env` của user.

## 7. Lịch sử / trạng thái
- 2026-10-14: v1.0 hoàn thành, user xác nhận "tạm ổn". CLI + UI web + icon desktop.
- Data test đã tạo trên stag khi phát triển: CH00086371 (tạo tay qua UI), CH00086373 (payload tool qua browser), CH00086374, CH00086375, CH00086379 (qua UI tool), CH00086380 (bản đóng gói) – chờ duyệt. User tự tạo thêm qua tool (xem `output/opportunities.csv`, `output/contracts.csv`).
- Bug đã sửa: tk sale nhận `/api/bam/sales` rỗng → fallback `/sales/all`.
- 2026-10-14: AM/TPP/BGĐ thành dropdown (TPP/BGĐ chọn sẵn ngẫu nhiên, đổi AM thì nạp lại). tpp/bgd truyền vào phải thuộc danh sách hợp lệ của AM (`pickApprover` trong opportunity.js), logic danh sách ở `master.approvers(am)`. Test: CH00086379.
- 2026-10-14: Bug token hết hạn: storageState trong `.cache/sso-*.json` giữ cả cookie `BMS_access_token` cũ → login lại đọc nhầm token cũ (401 liên tục). Sửa: `clearCookies({name})` trước khi login + chỉ nhận token có `exp` còn hạn.
- 2026-10-14: Báo lỗi ngay khi nhập sai tài khoản (đọc thông báo SSO `label.error-mess`).
- 2026-10-14: Đóng gói Linux (tar.gz + Node portable), dùng Chrome/Edge có sẵn, nhập OTP trên UI. Test bản đóng gói: CH00086380.
- 2026-10-15: v1.1 Duyệt cơ hội (`src/bms/approval.js`, cột Trạng thái + nút Duyệt, CLI `approve`). Test: CH00086385, CH00086386, CH00086387 (đã duyệt bằng chuyennt5).
- 2026-10-15: v1.2 Tạo yêu cầu HĐ (`src/bms/contract.js`, nút Tạo HĐ + pill "HĐ: …" ở bảng, CLI `contract`). User chốt: báo giá **1đ**. Test: CH00086387 (submit qua UI BMS thật để bắt payload), CH00086386 (tk giangdc2), CH00086392 (tạo → duyệt → Tạo HĐ qua UI tool) – đều "Chờ BGĐ duyệt". `ApiClient` nhận `FormData` (multipart), `saveRecord(kind, record, columns)` có cột CSV riêng.
- 2026-10-15: v1.4 BGĐ duyệt YC HĐ (`approveContractRequest` trong contract.js, tab 4, nút Duyệt HĐ, CLI `approve-contract`). Test: CH00086387 → SGSE22506/CMR2615586, CH00086386 → HNCP01669/CMR2615587 (qua module), CH00086392 → SGCP01926/CMR2615588 (nút Duyệt HĐ trên UI tool) – đều "Chờ DEM duyệt". CH00086393/94 (user tự tạo) còn "Chờ BGĐ duyệt", không đụng.
- 2026-10-15: v1.3 Giao diện tab (chỉ sửa `public/index.html`). Đã test trên Chrome: đăng nhập header, chuyển tab, bảng Lịch sử + nút Duyệt/Tạo HĐ.

- 2026-10-16: Dọn repo (xóa gói cũ, ảnh debug), README viết lại cho bản clone, `install.sh` tự `npm ci` khi chưa có node_modules; push lên GitHub `giangdc/ToolFTMS` (user tự push, máy dev chưa có credential GitHub).
- 2026-10-16: v1.5 Khảo sát LeasedLine (`src/bms/survey.js`, tab 3 Khảo sát, nút Tạo KS, CLI `survey`) + YC HĐ LeasedLine (nháp → cước SM → gửi). Test: CH00086403 (khảo sát bằng script từng bước – work 36143, phiếu HCMDK004443 → YC HĐ → BGĐ duyệt: HNLC01883/CMR2615591), **CH00086404** (trọn luồng trên UI tool: Duyệt CH → Tạo KS → Tạo HĐ → BGĐ duyệt: SGLC02073/CMR2615592), CH00086405 (Azure – hồi quy luồng cũ, "Chờ BGĐ duyệt"). User tự chạy thêm **CH00086406** (MPLS, vùng HN) qua tool → HNLC01884/CMR2615593 – OK.
- 2026-10-15: Chế độ server dùng chung (hướng A): `UI_HOST` + `UI_AUTH` basic auth, khóa đổi OTP, giới hạn body 1MB, `DEPLOY-SERVER.md`. Đã test cổng phụ: thiếu UI_AUTH → thoát; không/sai mk → 401; đúng mk OK; settings → 403; chế độ local không đổi. Chưa tăng version.

### Trạng thái nút ở bảng Kết quả (logic `rowAction()` trong index.html)
| Trạng thái cơ hội | Pill | Nút |
|---|---|---|
| Chờ TPP đánh giá / Chờ BGĐ phê duyệt | vàng | **Duyệt CH** |
| Đã duyệt, dịch vụ LeasedLine chưa KS xong | xanh + vàng "KS: Cần khảo sát / Đang khảo sát" | **Tạo KS** |
| Đã duyệt, chưa có YC HĐ (không cần KS hoặc "KS: thành công") | xanh "Đã duyệt" | **Tạo HĐ** |
| Đã duyệt, YC HĐ chờ BGĐ | xanh + vàng "HĐ: Chờ BGĐ duyệt" | **BGĐ duyệt** |
| YC HĐ đã BGĐ duyệt | xanh + vàng "HĐ: Chờ DEM duyệt" + dòng "Số HĐ …" | – |
`POST /api/opportunities/status` trả `{approved, waiting, label, contract?: {requested, label}, survey?: {required, done, label}}` – thêm bước mới thì mở rộng object này + `statusPill()`/`rowAction()`.

## 8. Kế hoạch phiên bản tiếp theo
**Đề xuất 1.6.0 (chưa chốt với user – hỏi lại trước khi làm):**
1. **DEM duyệt (CM)** – YC HĐ đang dừng ở "Chờ DEM duyệt" (`cmApprovalStatus` 2). Chưa khảo sát: có thể nằm trên hệ thống CM (khác BMS) → cần URL/API CM, có thể cần token riêng (`src/cm/...`). Khảo sát theo mục 6; thử tk chuyennt5 (phòng DEM).
2. Pipeline "1 click": tạo cơ hội → duyệt → tạo YC HĐ → BGĐ duyệt HĐ liên tiếp (chạy bằng tk admin), lưu chuỗi mã (CH, số HĐ, CMR) vào output.

**Việc khác (backlog):**
- Khảo sát: các tool khác (SMS/FTI-MES, VOICE/ivoice), book rack (công việc loại 5); option kênh OFFNET / nhiều địa chỉ / vùng HN (hiện cố định 1 địa chỉ ONNET ở HCM, băng thông 100).
- YC HĐ: option nhập cước / thời hạn / vùng miền (hiện cố định 1đ, 1 tháng, vùng random HCM/HN); hủy YC HĐ (`POST /api/registration/{id}/cancel`); BGĐ **từ chối** YC HĐ (`approvalStatus: 2`).
- Option KH: tạo mới / chọn KH có sẵn (`customners/search`, lọc KH đủ MST + địa chỉ vì có KH thiếu dữ liệu).
- Duyệt: thêm Từ chối / đánh giá Không đạt; hỗ trợ tab "Cơ hội mới" (`POST /api/approval-opportunities/approve-new-opportunity {opportunityId, approvalStatus: 1 /*5 = từ chối*/, reason, isActiveOpp}`).
- Bảng Kết quả riêng từng tab (vd tab Duyệt chỉ hiện cơ hội chờ duyệt) – đã đề xuất với user, chưa yêu cầu.
- Đẩy sang các tool triển khai theo Nhóm/Loại DV: mỗi tool 1 module, tái dùng `getBmsToken` + `ApiClient`.
- Thêm môi trường khác trong `config/environments.js`; launcher Windows nếu team dùng Windows.

**Cách thêm 1 chức năng mới (khuôn đã dùng cho 1.1–1.3):**
1. Module nghiệp vụ `src/bms/<x>.js` (hoặc `src/cm/...`): hàm `getXState(api, code)` + `doX(api, code)` ném `XError` (status 400) với câu tiếng Việt cho user; 401 ném nguyên để server/CLI tự login lại.
2. Server `src/server.js`: route `POST /api/<x> {user, code}` bọc `withSession`, lưu `saveRecord('<x>', record, COLUMNS)`.
3. UI `public/index.html`: nút tab `<button data-tab="x">` + card `<div class="card panel disabled-block" data-panel="x">` (gỡ `disabled-block` trong `login()`), nút thao tác ở bảng qua `rowAction()`.
4. CLI `src/cli.js`: `cmdX` + thêm vào `commands`, menu, HELP; script trong `package.json`.
5. Cập nhật CLAUDE.md (bảng phiên bản, mục 4 API, mục 7).
