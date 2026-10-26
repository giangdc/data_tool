# CLAUDE.md — FPT Play Order Tool

Ghi chú bàn giao cho các phiên phát triển sau. Cập nhật file này mỗi khi thêm tính năng / phát hiện thêm API.
Tool "anh em" của **FPT.vn Order Tool** (`../Tao_DH`) và **FTMS Data Tool** (`../bms`) – cùng khuôn: Node thuần, UI 1 file, CLI, output jsonl/csv, icon desktop, tar.gz kèm Node.

## 1. Bối cảnh & mục tiêu
- Người dùng: **QC**. Cần mua nhanh gói FPT Play test trên **dev.fptplay.vn**: nhập link gói (vd `https://dev.fptplay.vn/dich-vu/v-vip2?from_source=main`) → đăng nhập → tạo giao dịch → thanh toán thẻ test thành công → xem gói đã lên.
- **Phiên bản hiện tại: 1.0.0** (`version` trong `package.json`).

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0.0 | 2026-10-19 | Tải gói từ link (đăng nhập SĐT + OTP mặc định qua API, cache token), kỳ hạn + PTTT theo tài khoản, mã giảm giá, tạo giao dịch payment hub, tự thanh toán thẻ test (Foxpay/NAPAS – `payment.js` chuyển từ Tao_DH, thẻ lỗi → giao dịch mới + thẻ sau), check trạng thái, Chi tiết (gói trên tài khoản), Lịch sử, CLI, icon desktop |

- Quy ước version: tính năng mới → tăng số giữa, sửa lỗi → tăng số cuối.

### Quyết định đã chốt với user (2026-10-19)
| Hạng mục | Quyết định |
|---|---|
| Tài khoản | Mặc định SĐT **0964633310**, OTP = **OTP mặc định dev** (`FPL_OTP` trong .env, user tự điền – **không đọc/in giá trị**) |
| Thanh toán | Giống fpt.vn: thẻ test tự thanh toán (cùng cổng Foxpay) |
| Thiết kế | Như các tool còn lại (UI web local + CLI + icon) |

## 2. Cách chạy
```bash
npm run ui                    # http://localhost:3002 (UI_PORT); --no-open để không mở trình duyệt
npm run login|plans|create|pay|status|detail   # xem README §3
npm run build                 # dist/fpl-order-tool-<ver>-linux-x64.tar.gz
npm run install-launcher      # icon Desktop + menu (Ubuntu/GNOME)
```
- Không dependency. Tự thanh toán cần Google Chrome (CDP qua WebSocket có sẵn Node 22).
- **Test trong Claude Code**: `UI_PORT=3012 node src/server.js --no-open`. KHÔNG bật 3002 từ sandbox – để user bấm icon. Đừng `pkill -f 'src/server.js'` trong cùng lệnh bash (pattern khớp chính shell → tự giết).
- Proxy: giống Tao_DH (`FPL_PROXY` → GNOME → `HTTPS_PROXY`), `requestViaProxy` CONNECT tự viết.

## 3. Cấu trúc code
```
config/environments.js   dev: webUrl, apiUrl, signSalt + clientId (hằng FE công khai), feVersion, paymentVersion
src/core/env.js          nạp .env, config, defaults (url, phone), defaultOtp(), saveDefaults() (output/settings.json)
src/core/http.js         FplClient: ký URL st/e, X-Did, Bearer; ApiError (lỗi nghiệp vụ -> 422)
src/core/store.js|logger.js  (copy Tao_DH)
src/fpl/auth.js          session(phone): token cache .cache/token-dev-<sđt>.json (600, TTL 12h rồi check user/info), login OTP
src/fpl/orders.js        OrderService: prepare / checkCoupon / create / pay / statuses / detail / history
src/fpl/payment.js       payByCard (copy Tao_DH, đổi host return)
src/server.js, src/cli.js, public/index.html, scripts/, assets/icon.svg
khao-sat/                KHAO_SAT.md + script Playwright (explore-fpl.cjs, login-full.cjs đọc .env, không in OTP) + ảnh
```
- API nội bộ: `GET /api/config` (+ `cards`, `otp: bool`), `POST /api/settings/defaults`, `POST /api/settings/otp {otp}` (ghi FPL_OTP vào .env), `POST /api/session {phone, force?, logout?}`, `POST /api/prepare {url, phone}` → `{phone, account{userId, phoneMask, benefit}, plan{planType, name, icon, note}, offers[{planId, label, priceText, price, methods[{slug, code, name, autoRenew, displayMode, autoPay}]}], blocked}`, `POST /api/coupon {phone, planId, coupon}`, `POST /api/orders {url, phone, planId?, paymentCode?, coupon?}` → `{summary, payment{type redirect|qr|none, url|qrImage, expireAt}, canAutoPay}`, `POST /api/orders/pay {code}` → `{code, codes[], card, result, message, steps[], status}`, `POST /api/orders/status {codes}`, `POST /api/orders/detail {code}` → `{summary, payment, status, owned[], subscriptions[]}`, `GET /api/history`.

## 4. Kiến thức hệ thống (khảo sát 2026-10-19, chi tiết `khao-sat/KHAO_SAT.md`)
- Web Next.js; trang gói `/dich-vu/<plan_type>` **bắt đăng nhập** (popup Quyền riêng tư → SĐT → OTP Zalo).
- API `https://api-staging.fptplay.net/api/v7.1_w/<path>` – mọi request query `st` = base64url(md5(signSalt + e + "/api/v7.1_w/" + path)), `e` = now+3600, `device`, `drm=1`, `version` (8.9.3); `paymentgw|customergw` thêm `payment_version=25`. Header `X-Did`, `Authorization: Bearer`. Body POST JSON thường (không mã hóa).
- Đăng nhập: `account/otp/validate_user {phone, client_id, type:"login_fpl", mode:"interactive"}` → `verify_token, login_type:"otp"` → `account/otp/send {type_otp:"login_fpl", verify_token, method_otp:"zns"}` → `account/otp/verify {otp_code, method_otp:"zns"}` → `verify_token` → `account/user/login {verify_token, push_reg_id:""}` → `access_token`. OTP mặc định chỉ dùng được cho SĐT test (số khác: "Mã OTP không đúng" error_code 1).
- `GET paymentgw/packages/detail {from_source, plan_type, X-Agent:web-playfpt, is_wap:0}` (401 nếu chưa login) → `msg_data.data_display.plan_detail[] {plan_id, display_value, price, payment_gateway[] {slug, payment_gateway_code, is_paymenthub_gateway, display_mode.displayMode, is_auto_pay}}`, `is_internet`, `type_display`. v-vip2: plan 7859 (1 tháng 160.000₫), PTTT `INTERNATIONAL` (foxpay_credit) + `WALLET_MOMO`.
- `POST paymentgw/payment_hub/create_transaction {plan_id, payment_gateway_code, display_mode, return_url: <web>/dich-vu/thanh-toan/<slug>, coupon_code, ...}` → `msg_data {trans_id, display_mode, value_display (link Foxpay cs_sess_*), expire_time (unix)}`.
- `GET paymentgw/payment_hub/check_transaction {trans_id, payment_gateway_code}` → `status_code` PENDING → SUCCESS (cập nhật ngay sau cổng báo thành công), `amount` = số tiền thực (có trừ phần gói cũ còn lại: 80.000 thay vì 160.000).
- Xác nhận gói: `payment/get_user_packages` (dateleft, expired_date), `paymentgw/subscription/user_subscriptions` (tự gia hạn), `customergw/fetch_user_benefits` (gói hiện tại).
- Web còn có popup khảo sát `paymentgw/survey` ("THÔNG TIN ĐĂNG KÝ" – upsell Internet) chặn nút Thanh toán; không cần cho API.
- Cổng PTTT cũ (không qua hub): `paymentgw/foxpay/{credit,atm,vietqr,qr}/create` + `foxpay/check`, momo/zalo/vnpay/shopeepay… – tool chưa dùng (chỉ hub).
- Giao dịch test: 1792404081-38297814 (CLI, SUCCESS), 1792404474-38297814 (UI, SUCCESS, gia hạn tới 19/12/2026).

## 5. Kế hoạch tiếp theo
**Backlog:** gói `is_internet` (địa chỉ lắp đặt / location_id), PTTT không qua hub, gói trả sau (`postpaid/register_service` + OTP verify payment), xuất hóa đơn (is_invoice_required), QR (VietQR nếu gói có), hủy tự gia hạn (`subscription/user_unsubscribe`), nhiều SĐT test.
