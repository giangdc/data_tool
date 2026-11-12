# CLAUDE.md — Tạo đơn TMĐT Tool (Don_TMDT)

Ghi chú bàn giao cho các phiên phát triển sau. Cập nhật file này mỗi khi thêm tính năng / phát hiện thêm API.
Cùng khuôn với `../Thanh_toan`, `../Tao_DH`: Node thuần, UI 1 file, CLI, output jsonl/csv, icon desktop, tar.gz kèm Node.

## 1. Bối cảnh & mục tiêu
- Người dùng: **QC**. Tạo đơn TMĐT (TikTok Shop / Shopee) theo **RefCode** trên **SPF Web Admin stag** (`https://saleplatform-stag.fpt.net/web-admin`), trang *Ecomercial → OrderECPlatform*. Phạm vi user chốt: **chỉ tạo đơn** (không thanh toán / không đẩy sau bán).
- Quy tắc user (2026-11-12): tra RefCode ở tab **Cập nhật chính sách** trước; **không có đơn thì qua tab Cập nhật địa chỉ/SDT** để tạo. Shopee giống TikTok, chỉ đổi nguồn.
- **Phiên bản hiện tại: 1.1.0**.

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.1.0 | 2026-11-12 | Quyết toán: nút Quyết toán ở bảng kết quả (PushCustomTask Tiktok_CompletedOrder / SPFShopeeCompletedOrder), CLI settle; lỗi HTTP SPF kèm lý do |
| 1.0.0 | 2026-11-12 | Đăng nhập Access Token (cookie phiên, tự login lại), Load RefCode (đơn trên sàn + đơn trên SPF + gợi ý hướng làm), tạo đơn: Thử lại đơn lỗi theo OrderId / tạo mới theo địa chỉ / ngắt kết nối đơn cũ rồi tạo lại, địa chỉ MasterData, ☆ mặc định, kết quả Lần này/Lịch sử + Chi tiết (queue), CLI, icon, cổng 3009 |

## 2. Cách chạy
```bash
npm run ui                    # http://localhost:3009 (UI_PORT); --no-open để không mở trình duyệt
npm run login|load|create|search|disconnect|status|history   # xem README
npm run build                 # dist/tmdt-order-tool-<ver>-linux-x64.tar.gz
```
- **Mạng**: `saleplatform-stag.fpt.net` (118.70.7.143) **gọi thẳng**, KHÔNG qua proxy (proxy.hcm.fpt.vn / proxy.fpt.vn trả 503 cho host này) → tool không dùng proxy.
- **Test trong Claude Code**: `UI_PORT=3019 node src/server.js --no-open` (cần `dangerouslyDisableSandbox` để ra mạng). Không bật cổng 3009 từ sandbox.
- Claude không tự đăng nhập: user tự dán Access Token. Khảo sát 2026-11-12 bằng Chrome thật + playwright-core (`../SOP/node_modules`), user tự thao tác, script ghi request (che token/cookie) – script ở scratchpad, không giữ lại; tóm tắt ở `khao-sat/KHAO_SAT.md`.

## 3. Cấu trúc code
```
config/environments.js   stag baseUrl/basePath; SOURCES: Tiktok {refSource 12, saleTeamId 129}, Shopee {refSource 0, saleTeamId 130}
src/core/env.js          .env + defaults {source, phone, locationId, districtId, wardId, streetId, addressNo} (output/settings.json đè)
src/core/spf.js          SpfClient: login(token) = GET /Account/Login lấy __RequestVerificationToken + cookie -> POST form AccessToken -> 302 /web-admin;
                         cookie jar tự viết; request(): POST form-urlencoded + x-requested-with; 302 về Login / trang login -> tự login lại 1 lần bằng token lưu;
                         {isSuccess:false} -> ApiError 422 (message.message). Token sai -> xoá token. Lưu .cache/session.json (0600)
src/core/store.js|logger.js  (copy Thanh_toan)
src/ecom/orders.js       EcomService: provinces (parse <select id=slLocation> của trang) / districts / wards / streets, ecomDetail, search, load(+plan),
                         create, disconnect/connect, status (search orderid + QueueTracking), history, saveDefaults
src/server.js, src/cli.js, public/index.html, scripts/, assets/icon.svg
```
- **Báo lỗi (user yêu cầu "lỗi thì báo lỗi")**: không nuốt lỗi. UI có thanh đỏ `#errBar` (lỗi chung, unhandledrejection, 401 → nhắc dán token), lỗi từng ô hiện tại chỗ (Load / địa chỉ / Tạo đơn); tạo đơn lỗi trả kèm `steps` (các bước đã chạy, vd đã ngắt đơn cũ); `status` trả `errors[]`; chỉ lỗi "mềm" (không thấy đơn trên sàn) mới làm tiếp (`softError`), 401 luôn ném. Server log mọi lỗi vào `output/ui-server.log`.
- API nội bộ: `GET /api/config` (+ `session {loggedIn, hasToken, loginAt}`), `POST /api/login {token}`, `POST /api/logout`, `POST /api/settings/defaults`, `GET /api/locations/{provinces,districts?locationId,wards?locationId&districtId,streets?…&wardId}`, `POST /api/load {source, refCode}` → `{ecom, orders[], plan{action: create|retry|exists, text}}`, `POST /api/search {source, value, by}`, `POST /api/orders {source, refCode, phone, address, disconnectOld}` → `{summary, steps, order}` (409 `ORDER_EXISTS` + `orders`), `POST /api/orders/disconnect|connect {orderId, saleTeamId}`, `POST /api/orders/status {source, orderIds}`, `GET /api/history`. Lỗi 401 = cần Access Token.

## 4. Kiến thức hệ thống (khảo sát 2026-11-12)
- SPF Web Admin = ASP.NET MVC + jQuery. Login: "Log in with IAM" hoặc form **AccessToken** (+ antiforgery). Sau login chỉ cần **cookie**, các AJAX không gửi antiforgery header.
- Trang `/Ecomercial/OrderECPlatform` có 2 tab:

| Tab | Endpoint (POST form) | Body | Ghi chú |
|---|---|---|---|
| Cập nhật chính sách | `/Ecomercial/OrderECPlatform` | `Type (1 OrderCode, 2 OrderID, 3 RefCode), Value, RefSource (12 Tiktok, 10 Momo, 0 Shopee), PageIndex, PageSize` | `{data:[{orderId, orderCode, regCode, contract, saleTeam, saleTeamID, refCode, phone, totalVat, paymentStatus, isRetryCreateOrder, isUpdateMarketplaceFee, isDisconnectOrder, isConnectOrder…}]}` |
| | `/Ecomercial/RetryOrderECPlatform` (nút Thử lại) | `OrderId, Phone, LocationId 0…, AddressNo "", Source` (RefCode không gửi) | chỉ khi `isRetryCreateOrder` |
| | `/Ecomercial/ConnectOrderEcom` | `OrderId, SaleTeamId, IsConnect false/true` | Ngắt / kết nối đơn với RefCode |
| | `/Ecomercial/UpdateMarketplaceFee {OrderId}`, `/Ecomercial/RetryReason {OrderId}` | | Settle fee, log retry (chưa dùng) |
| Cập nhật địa chỉ/SDT | `/Ecomercial/GetOrderDetailByEcom` | `refCode, source (Tiktok/Shopee)` | Load: `data {id, status, lineItems[{skuName, sellerSku, salePrice…}], recipientAddress{phoneNumber, address}, payment{totalAmount}}`; `data null` = không thấy |
| | `/MasterData/GetDistrict {locationId}` → `GetWard {districtId, locationId}` → `GetStreet {wardId, districtId, locationId}` | | Địa giới mới: "district" là phường (HCM 125 mục), ward trả `[{id, name:null}]` |
| | `/Ecomercial/RetryOrderECPlatform` | `Phone, RefCode, LocationId, DistrictId, WardId, StreetId, AddressNo, Source` | → `{code 200, data:{orderId, orderCode}}`; web chuyển `/order/detail?OrderId=` |
- **Quyết toán** (khảo sát 2026-11-12, user thao tác): trang *Queue → PushCustomTask*. `POST /queue/GetListTaskByActionCode {ActionCode, Instance}` (204 = không có task) → `POST /queue/PushCustomTask {TaskCode "1,2,3,4,5", ReferType 1 (Order), ReferId OrderId, ActionCode, Instance 1, IsRelicate 0|1}` → `true`. ActionCode: TikTok `Tiktok_CompletedOrder`, Shopee `SPFShopeeCompletedOrder` (Instance 1; Instance 0 rỗng). 5 task: 1 Cập nhật phí sàn · 2 Add phí hoa hồng (cha 1) · 3 Gạch nợ khoản thu online (cha 2) · 4 Tặng ZPlay (cha 3) · 5 Gạch nợ Order Trans (cha 1). Task con phải chọn kèm cha. Tool: nút **Quyết toán** ở bảng kết quả (user: không làm tab riêng) → dialog chọn task + bỏ check trùng + tiến độ; API `GET /api/settle/tasks?source`, `POST /api/settle {source, orderId, taskCodes?, replicate}`, `POST /api/settle/status`, `GET /api/settle/history`; CLI `settle`, `settle-tasks`; lưu `output/settle.{jsonl,csv}`.
- QueueTracking: `status` 200/2000 = xong, âm = lỗi; `status null` + `taskStatus 7` = đã đẩy chờ chạy, `201` = không áp dụng (suy ra từ dữ liệu, chưa xác nhận).
- Sau tạo: `/Order/QueueTracking {OrderId}` → các task (`Tiktok_CreateOrder`: Tạo PĐK & Hợp đồng, Tạo khoản thu online, Ghi nhận quà tặng… `status` 200 = xong; null = chưa chạy/không áp dụng). `/order/ordertracking`, `/order/orderprogress` (HTML), `/Order/GetOrderTransaction?orderId=` (khoản thu), `/DocumentDigital/GetDocumentDigitalV2`.
- Lỗi đã gặp: `-110 "Đơn hàng đã tồn tại trong hệ thống."` (RefCode còn gắn đơn → ngắt kết nối); `-110 "Đã xảy ra lỗi trong quá trình kiểm tra thông tin chính sách."` (RefCode 584972625322673904 – Sky F1 1T trả sau; cùng địa chỉ với RefCode camera thì OK → do SKU/chính sách, không phải địa chỉ).
- Đã tạo thật (user thao tác tay): TikTok RefCode `584542458320094402` (1 Camera IQ4S) → **HCMUW0026VN0** (OrderId 3680172), SĐT 0868650892, Huỳnh Tấn Phát / P. Phú Thuận / HCM. Shopee: user báo lỗi phía hệ thống, chưa bắt được request.

## 5. Kế hoạch tiếp theo
- **Chưa chạy thật qua tool** (chưa có token trong phiên phát triển): đã kiểm login lỗi (token sai → "Token không hợp lệ.") + replay giả lập 4 nhánh khớp request thật. Lần đầu user chạy cần xác nhận: login token thật, Load, tạo đơn, Shopee.
- Backlog: xem log retry, tạo nhiều RefCode 1 lần trên UI (CLI đã có), tự lấy token (thử token Sale Platform như `../App_SOP` – cần user đồng ý).
