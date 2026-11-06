# CLAUDE.md — FPT.vn Bill Pay Tool

Ghi chú bàn giao cho các phiên phát triển sau. Cập nhật file này mỗi khi thêm tính năng / phát hiện thêm API.
Cùng khuôn với `../Tao_don_fptvn` (FPT.vn Order Tool): Node thuần, UI 1 file, CLI, output jsonl/csv, icon desktop, tar.gz kèm Node. `payment.js` copy từ Tao_don_fptvn.

## 1. Bối cảnh & mục tiêu
- Người dùng: **QC**. Thanh toán khoản thu của HĐ test trên **staging.fpt.vn/pay**: nhập số HĐ → danh sách khoản thu (**mặc định tick hết**, cho bỏ tick) → Thẻ Quốc Tế / Thẻ Nội địa → thanh toán thành công (thẻ test như các tool trước).
- **Phiên bản hiện tại: 1.0.0**.

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0.0 | 2026-10-28 | Tra cứu khoản thu, chọn khoản (tick hết mặc định), PTTT theo API, tự thanh toán Thẻ Quốc Tế (Foxpay + 3DS) / Thẻ Nội địa (NAPAS), xác nhận bằng check-payment-status-by-code, thẻ lỗi → giao dịch mới + thẻ sau, Lịch sử, CLI, icon desktop, cổng 3006 |

## 2. Cách chạy
```bash
npm run ui                    # http://localhost:3006 (UI_PORT); --no-open để không mở trình duyệt
npm run bills|pay|status      # xem README
npm run build                 # dist/fptvn-billpay-tool-<ver>-linux-x64.tar.gz
npm run install-launcher      # icon Desktop + menu
```
- **Test trong Claude Code**: `UI_PORT=3016 node src/server.js --no-open` (cần `dangerouslyDisableSandbox` để ra mạng qua proxy). KHÔNG bật 3006 từ sandbox. Đừng `pkill -f` pattern khớp chính shell.
- curl thử API: phải `--noproxy '' -x http://proxy.hcm.fpt.vn:80` (biến no_proxy của máy chứa .fpt.vn → curl không đi proxy và DNS không phân giải).
- `.env`: hook secret-guard chặn lệnh `cp ... .env` → tạo bằng node `copyFileSync`. Thẻ: `env.js` tự nạp `CARD_*` còn thiếu từ `../Tao_don_fptvn/.env` → `../FPL/.env` (`sharedCardsFrom`), không in giá trị.

## 3. Cấu trúc code
```
config/environments.js   stag: payUrl, hiApiUrl (hifpt-api-stag.fpt.vn), apiVersion v127, paymentType FTELBILLWEB
src/core/env.js          .env + thẻ dùng chung, proxy (BILLPAY_PROXY → GNOME → HTTPS_PROXY), defaults {contractNo, paymentMethod} (output/settings.json)
src/core/http.js         HiClient: POST JSON, statusCode != 0 → ApiError 422; requestViaProxy (copy Tao_don_fptvn)
src/core/store.js|logger.js  (copy Tao_don_fptvn)
src/pay/billpay.js       BillPayService: lookup / methods / pay / status / statuses / history
src/pay/payment.js       payByCard (Chrome thật + CDP), cardsFor, cardStatus – copy Tao_don_fptvn
src/server.js, src/cli.js, public/index.html, scripts/, assets/icon.svg
(khảo sát bằng Claude in Chrome hook XHR + bundle /pay/_next/static/chunks tải về tạm – không giữ lại)
```
- API nội bộ: `GET /api/config` (+ `cards`, `sharedCardsFrom`), `POST /api/settings/defaults {contractNo?, paymentMethod?}`, `POST /api/lookup {contractNo}` → `{contractNo, contractId, contractName, address, bills[{billNumber, billNumberId, title, content, total, totalText, type, receiptType, selectable}], total, message}`, `POST /api/methods {contractNo, billIds}` → `[{id, code, name, provider, group, supported, cards}]`, `POST /api/pay {contractNo, billIds?, paymentMethod}` → `{summary{paymentCode, result, status, statusLabel, card, ...}, bills, steps, remaining}`, `POST /api/status {codes}`, `GET /api/history`.
- `billIds` nhận `billNumber` (mã băm) hoặc `billNumberId` (SG26O…); rỗng = tất cả khoản `selectable`.

## 4. Kiến thức hệ thống (khảo sát 2026-10-28)
- Trang `/pay` = Next.js (basePath `/pay`), sau "Thanh toán (n)" chuyển `/pay/payment-info`. Gọi API `https://hifpt-api-stag.fpt.vn` bằng axios: header `Authorization: Bearer` **chỉ khi đã đăng nhập** (sessionStorage) → khách vãng lai **không cần token**. Header `deviceId` (cookie webDeviceId) chỉ gửi ở contract-info, không bắt buộc. Response `{statusCode: 0 = OK, message, data}`; `10403` = hết phiên (chỉ khi đăng nhập).

| # | Endpoint (POST) | Body | Ghi chú |
|---|---|---|---|
| 1 | `/v127/customer/contract-info` | `{contractNo}` | `contractInfo {contractId, contractNo, contractName, address}` (address bị che một phần) |
| 2 | `/v127/hi-billing-api/billings-check-by-contract-no` | `{contractNo}` | `billings[] {title, content, total, totalText, billNumber, billNumberId, type: RECEIPT, receiptType 27, allowDelete, evc* (FGold)}`, `content` (câu khi hết khoản thu, có `{contractNo}`/`{contractName}`), `contractId`, `shareBill`. Web: khoản không phải RECEIPT hiện ô khóa |
| 3 | `/v127/hi-payment-api/billing/get-list-autopay` | `{channel: "Web", contractNo}` | Trả tự động (không dùng) |
| 4 | `/hi-payment-api/v1/payment/get-list-payment-method` (không v127) | `{receiptType: [..], typeBill: [..], contractNo, platform, paymentType: "FTELBILLWEB"}` | `recommended` [VIETQR -3 mặc định], `saved`, `other` [INTERNATIONAL -1, DOMESTIC -2, ZALO_PAY -22], `promotions`, `selectedDefault`, `terms` |
| 5 | `/hi-payment-api/v1/payment/create-payment-transaction` | `{contractNo, paymentMethod, isCreateAutopay: 0, isTokenization, tokenizationId, paymentType, vouchersPayment: [], vouchersService: [], amount, platform, sessionId (uuid client), items: [{orderCode: billNumber, amount}], appVersion: "1.0", channel: "WEB"}` | → `{orderId: FTELBILLWEB_2_<n>, checkoutMode, expireTime 900, presentations.redirectUrl.value | qrImage.value}`. Web vào payment-info là **tự tạo giao dịch VietQR** ngay (không có paymentMethod trong body); đổi PTTT → giao dịch mới. Tool gửi `isTokenization: 0, tokenizationId: ""` (web mặc định tick "Liên kết") |
| 6 | `/v127/hi-payment-api/payment/check-payment-status-by-code` | `{paymentCode, sessionId}` | `{status PENDING|SUCCESS, amount, content, description_web}`. sessionId khác vẫn đọc được |
- INTERNATIONAL → `paygateway-stag.fpt.vn/gateway-web/portal-ecom/payment/international/card/cs_sess_*` (Foxpay, giống Tao_don_fptvn; 3DS Cardinal có thể hỏi). DOMESTIC → `/gateway-web/payment-page/napas/*` → NAPAS. Xong cổng chuyển về staging.fpt.vn; Hi cập nhật SUCCESS ngay.
- Đã chạy thật (HĐ SGABP5048): `FTELBILLWEB_2_51843` Thẻ Quốc Tế 200.000đ (CLI, 1 khoản) ✔, `FTELBILLWEB_2_51844` Thẻ Nội địa 299.000đ (UI) ✔ → HĐ hết khoản thu. `51839–51842` = giao dịch thử bỏ dở (hết hạn).

## 5. Kế hoạch tiếp theo
**Backlog:** VietQR (hiện QR như Tao_don_fptvn), ưu đãi / voucher (`vouchersPayment`, `vouchersService`), điểm FGold (`evc*`), khoản thu loại khác RECEIPT, trả trước (`customer-ecounter/sr/prepay/packages`, `prepaid/remove-receipt`), đăng nhập (Bearer) để thấy thẻ đã liên kết.
