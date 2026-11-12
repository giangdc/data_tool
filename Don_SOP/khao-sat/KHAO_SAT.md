# Khảo sát app – luồng tạo đơn

## 1. Thông tin app
| Hạng mục | Giá trị |
|---|---|
| Package | `vn.fpt.ftel.sop.stg` (bản staging) |
| Thiết bị | Điện thoại Android thật cắm USB (adb), app cài sẵn |
| Môi trường | staging |

## 2. Đăng nhập
- Kiểu đăng nhập: (user/pass, OTP, SSO?)
- API lấy token:

## 3. Luồng tạo đơn (các màn hình)
| Bước | Màn hình | API gọi | Ghi chú |
|---|---|---|---|

## 4. API tìm được trong bundle
| Method | URL | Body chính | Dùng ở bước |
|---|---|---|---|

## 7. CHỐT: luồng auth + ký request (2026-11-05) — ĐÃ CHẠY ĐƯỢC

App SOP (RN+Flutter webview) tạo đơn qua **cùng API Sale Platform của bản web** `/ban-hang` → gọi thẳng API, không cần mở app/web.

### Auth (3 bước, `src/core/sp.js` → `login()`)
1. `POST gateway-sop-stg.fpt.vn/auth-service/api/auth-service/sign-in/basic-auth` body `{username,password,remember}` → `data.access_token`.
2. `GET gateway-sop-stg.fpt.vn/auth-service/api/auth-service/sdk/refresh-access-key-desktop` (Bearer access_token) → `data.sc_sdk_token` (64 ký tự).
3. `POST sapi.fpt.vn/saleplatform-gateway-api-staging/gateway/auth/api/v3/authentication/token` (ký, xem dưới) body:
   `{GrantType:"one_time_password_2", Token:<sc_sdk_token>, Platform:"Desktop", Device:"Desktop", ClientApp:"sdk-desktopapp", OldVersion:"4.17.1.1", CurrentVersion:"4.18.1.0", Bundle:"1:749060201862:web:5b1ffe0e84fd1da52b6007", PsId:<emp_id>, RedirectUrl/AccountName/Password:""}`
   → `Data.Result.{AccessToken, RefreshToken, InstanceVer, PublicInstanceVer, Version...}`. **InstanceVer** thay vào `{instanceVer}` ở các path sale/d2d.

### Ký request Sale Platform (bắt buộc, `signHeaders()`)
- keyId = `sdk-desktopapp`; basicPass (23 ký tự) + secret (36 ký tự) lấy từ `main.dart.js` class `A.aRU` (clientApp "SOP"), lưu `.cache/sp-keys.json`.
- `Digest = base64(HMAC_SHA256(secret, JSON.stringify(body)))`
- token string = login: `Basic base64(keyId:basicPass)`; API khác: `Bearer <AccessToken>`
- `signature = base64(HMAC_SHA256(secret, "keyId="+keyId+",digest="+Digest+",created="+created+",token="+tokenString))`
- Header: `CheckSum: keyId=..,created=<epoch giây>,signature=..` · `Digest: ..` · `Authorization: Basic ..` (login) hoặc `authorization: Bearer <AccessToken>` (API khác).
- Lỗi hay gặp: `invalid_header_checksum` (sai định dạng header), `error_signature` (sai chuỗi ký), Platform/version/Bundle rỗng → điền đủ như trên.

### Lấy version thật: `khao-sat/capture-token.mjs`
Mở Chrome (profile ../SOP), đăng nhập basic-auth, vào `/ban-hang`, bắt body request `authentication/token`. Dùng lại khi FPT đổi version.

## 8. CÒN LẠI: map body các API tạo đơn
Danh sách path: `khao-sat/sp-api-paths.txt`. Luồng dự kiến (theo ../SOP + tên API):
1. Địa chỉ: `order-info/get-sale-range-info`, `order-info/check-address(-2)`, `order-info/validate-address`, `get-master-data`, `get-district/ward/street`, `googleapis/geocode`.
2. Gói: `group-code/packages`, `products/quote`, `products/companions`.
3. Giỏ/giá: `cart/quote`, `cart/validate`, `order-info/get-price-quotation`, `order-info/get-method-pay-charges` (PTTT).
4. KH + tạo báo giá: `orders/validate-customer`, `orders/validate`, `orders/create`.
5. Hợp đồng: `contract/validate`, `contract/create`, `contract/get-question-list`, `contract/update-contract-identify`.
**Cách làm tiếp (user đã chọn "bắt request thật)**: chạy 1 đơn thật, ghi full body+response từng bước (mở rộng `capture-token.mjs` bắt mọi path `gateway/sale/`), rồi replay trong `src/app/order.js`.

## 9. ĐÃ DỰNG XONG TOOL (2026-11-05) — tạo đơn qua API chạy thật
- Luồng tạo đơn bắt được: `khao-sat/capture/order-flow.jsonl` (42 request). Khuôn replay: `config/order-template.json` (validateNet, validateServiceInfo, priceQuotation, orderValidate, orderUpdate).
- `src/app/order.js`: `session()` (cache token `.cache/sp-session.json`, InstanceVer=mảng→'v1', LifeTime phút), `createQuote({phone,name,addressNo,paymentType})` phát lại chuỗi → `order/update` ra **OrderCode** + `quotation/detail` ra link báo giá. Lưu `output/orders.{jsonl,csv}`.
- `src/server.js` cổng 3008: GET / (UI), /api/defaults, /api/history, POST /api/create. `public/index.html` form + bảng kết quả.
- `src/cli.js`: `create [--name --phone --no -n]`, `history`.
- Đã tạo thật: HCMUP0026V14 (tay), V15/V18 (tool). order/validate Confirm:1 để bỏ cảnh báo trùng đơn.
- CÒN THIẾU: đổi địa chỉ/gói tùy ý (hiện dùng địa chỉ+gói Giga theo mẫu; muốn tùy biến phải chạy thêm get-district/street + net/packages + dựng lại ServiceDetail); bước tạo HỢP ĐỒNG (contract/create cần ảnh CMND + câu hỏi định danh) chưa làm.

## 10. Tạo đơn trên app Mobile (máy thật qua USB) — 2026-11-06
- App SOP **lộ chữ qua `uiautomator dump`** (text/content-desc) → driver `src/app/order-mobile.js` tìm nút THEO CHỮ, kiểm tra từng màn; toạ độ chỉ còn dùng cho nút "+" và 2 dropdown gói (không có chữ).
- Luồng: Trang chủ → ô "Đơn hàng" (dưới "Tính năng ưa thích") → Theo dõi đơn hàng → "+" → popup:
  - "Bạn đang có một đơn hàng trước đó chưa hoàn thành…" → **Không** (tạo mới)
  - "Cảnh báo!!! … phiếu chưa nhập cọc / chưa xác nhận OTP…" → **Xác nhận**
- Nhập địa chỉ: **Loại nhà** (Nhà phố / C.Cư… / Nhà không số) → Xã/Phường (search) → Đường (sheet tự mở, phải chờ list tải xong mới gõ) → Số nhà → Xác nhận.
- Gói: Internet → Gói dịch vụ / Gói tính cước (chọn theo tên, list cuộn được). List gói tính cước trên app có thể khác API (vd có "Gói 3T (2T+1)").
- Giỏ hàng đọc được "Giga (Gói 6T (6T+0))"; báo giá đọc được tổng tiền; màn kết quả đọc được **Mã đơn hàng** + link báo giá.
- Bàn phím Telex đổi "test"→"tét": driver đọc lại ô nhập, sai thì gõ lại kiểu chống Telex.
- Kiểm tra chính sách trước khi chạy máy: `checkPrice()` (validate + get-price-quotation, không tạo đơn). Giá thật ở `ServiceDetail[].Price[Default=1].TotalVAT + ExtendedServices`. Không có chính sách → trả nguyên thông báo hệ thống ("Không tìm được chính sách phù hợp…").
- Đã tạo: HCMUQ0026V1W (tay), V1X (Giga 6T), V1Z (Meta F1 6T) — 55 Huỳnh Tấn Phát, Phường Phú Thuận.
- CHƯA kiểm chứng: Loại nhà "C.Cư…" (có thể cần thêm ô toà nhà), "Nhà không số", bước tạo HĐ (`--contract`, còn theo toạ độ cũ).

## 11. Desktop: nhóm dịch vụ khác Internet qua API — 2026-11-06
- Ghi request Portal bằng `khao-sat/service-record.mjs <tên>` (Chrome có cổng điều khiển 127.0.0.1:3099) → `khao-sat/capture/portal-services.jsonl`.
- Mẫu mỗi nhóm trong `config/service-templates.json`: `validateService` (validate-<nhóm>-service-info), `priceQuotation` (request get-price-quotation), `options` (API danh sách gói/thiết bị), `default`, `extKey` (ExtendedProperties: FPTCameraBundle / FPTPlaySA / FPTPlay → PhoneNumber).
- `_customer`: thông tin KH có ảnh giấy tờ (ImageIDCard, IDCardType 1, Gender, FoxpayAgree) lấy từ đơn Portal HCMUQ0026V4C — dùng chung, thiếu thì validate báo "ngày sinh / loại giấy tờ / quốc tịch".
- Dòng chi tiết của order/validate = dòng request báo giá + trường chính sách lấy từ `Price[Default=1]` (giữ ServiceCode gốc) + `ExtendedServices` thành dòng riêng (`buildValidate` trong src/app/order.js, đã so khớp 100% với body Portal).
- Đã tạo thật qua API: FPT Play V4E/SGABP5847 · FPT Camera V4F/SGABP5848 · Play Stand Alone V4I/SGABP5849 · Sản phẩm khác V4K/SGABP5851.
- FPT Camera Only: Portal báo "Hiện tại không có thông tin chính sách dịch vụ" tại địa chỉ mẫu → chưa có mẫu.

## 12. Desktop: dựng thẳng từ API (không cần ghi Portal) — 2026-11-10
- Mục có `gen` trong `config/service-templates.json`: `pkgs` (API gói, [0] = gói chọn trên UI, [1..] = gói kèm), `devs` (API thiết bị; `line` = API lấy biến thể khi nhóm không có gói, vd Smart Home), `validate`, `extKey` (ExtendedProperties.<key>.PhoneNumber), `extProps`, `email`, `with` (dịch vụ bắt buộc mua kèm: `{template}` hoặc `{id,name,pkgs,netDevice}`).
- Dòng chi tiết dựng theo khuôn dòng của FPT Camera (`genTemplate` trong src/app/order.js). Kiểm tra không tạo đơn: `createServiceQuote({service, validateOnly:true})` (chạy order/validate, không order/update).
- order/validate OK: Camera Only (FPTCameraOTT), Oncall (CustomerInfo.Email), Smart Home (smarthome/device + smarthome/property), Ultra Fast SA / VIP 247 (group-code: ServiceId + SubServiceTypeId), FPro (fpro/remote), FSafe Go (FSafeGo), Camera B2B (license + cloud + device, FPTCameraB2B). VIP 247 mua kèm FPT Camera.
- CHƯA được: VioEdu (bắt buộc Internet gói Sky; order/validate báo "Phương thức thanh toán đã chọn không hợp lệ" với mọi PaymentType 1–12) · SIM data (sim/get-device: không có chính sách) · Ultra Fast, FPT AI Wi-Fi (không có chính sách tại địa chỉ mẫu) · Pay Wifi, HyperFast, FPT Play SME, Prepaid 3 (get-sub-service-type: "Không có thông tin dịch vụ").
