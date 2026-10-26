# CLAUDE.md — FPT.vn Order Tool

Ghi chú bàn giao cho các phiên phát triển sau. Cập nhật file này mỗi khi thêm tính năng / phát hiện thêm API.
Tool "anh em" của **FTMS Data Tool** (`../bms`) – cùng khuôn: Node thuần, UI 1 file, CLI, output jsonl/csv, icon desktop, tar.gz kèm Node.

## 1. Bối cảnh & mục tiêu

- Người dùng: **QC**. Cần tạo nhanh đơn hàng test trên **fpt.vn staging**: nhập link màn hình chi tiết gói (vd `https://staging.fpt.vn/internet/goi-giga`) → tạo đơn → thanh toán thành công → có màn hình xem thông tin đơn đã lên.
- **Phiên bản hiện tại: 1.7.0** (`version` trong `package.json`).

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.7.0 | 2026-10-22 | **Gói catalog mới FCP** (vd `/internet/PRD_NET_001`, `PRD_NET_003`): `packages/get` không có gói → `channel/public/v1/products/content {slug}` (`source: "FCP"`) → tool tự đi luồng v2 (create/address/calculate/payment-methods/customer/payment), voucher/complete/get vẫn v1. "Thông tin sản phẩm" = option nhóm `CORE_BUNDLE` của `products/quote` (trả sau / trả trước N tháng). Slug giữ nguyên hoa/thường. UI chỉ thêm nhãn "catalog FCP"; dịch vụ đi kèm (FSafe, Camera) chưa hỗ trợ |
| 1.6.0 | 2026-10-20 | **Gói thiết bị / camera** (vd `/camera/combo-2-camera-fcam-play-4-iq-4s`): chính sách không có chu kỳ → "Thông tin sản phẩm" = **chu kỳ gói lưu trữ** (An Tâm 7 - Max 1/6/12 tháng, mặc định cái đầu), calculate gửi `products` (thiết bị + gói lưu trữ kèm số tháng) + **phí triển khai** từng camera (= Hỗ trợ lắp đặt, mặc định). UI: nhóm radio **"Hình thức lắp đặt"** (đầu mục bổ sung): *Hỗ trợ lắp đặt* (mặc định, ghi tổng phí triển khai N thiết bị) / *Tôi muốn tự lắp đặt* (= gửi sku gói giao hàng như 1 bổ sung, bỏ phí triển khai, mất COD); CLI vẫn là `--extras <sku gói giao hàng>`. Giá cước gói thiết bị không ghi "/tháng". Không đổi bố cục UI |
| 1.5.0 | 2026-10-19 | **Nhiều thẻ test**: `CARD_<PTTT>_NUMBER2..5` (+ `<Ô>2` nếu khác, thiếu thì dùng ô thẻ 1) – thẻ trước bị từ chối thì tạo link mới (cùng PTTT) và thử thẻ sau. **Đổi PTTT & thanh toán lại** đơn còn chờ thanh toán (chỉ PTTT online, cùng mã đơn, link/QR mới): UI dòng "Thanh toán lỗi? [PTTT] ↻ Đổi PTTT & thanh toán lại" ở hộp thanh toán + Chi tiết (thẻ có sẵn thì tự thanh toán luôn), CLI `repay <mã> --pm X [--pay]`, API `POST /api/orders/repay`. Tự thanh toán lần 2+ tự lấy link mới (link cũ đã dùng/hết hạn) |
| 1.4.0 | 2026-10-19 | **Tự thanh toán thẻ test** (Thẻ tín dụng / Thẻ ATM): `src/ecp/payment.js` mở Chrome thật (đi proxy), tự nhập thẻ + OTP từ `.env` `CARD_*`, chờ cổng báo kết quả. UI: ô "Tự thanh toán bằng thẻ test" (mặc định bật khi có thẻ) + nút 💳 Tự thanh toán ở hộp thanh toán / Chi tiết; CLI `create --pay`, `pay <mã>`. Kết quả lưu `output/payments.{jsonl,csv}`; staging lỗi (ECP vẫn `recompleting`) → trạng thái hiện "Đã thanh toán (cổng) · ECP chưa cập nhật". pay-recorder: mặc định cả 2 thẻ, báo khi tới màn nhập, tự ghi `.env` |
| 1.3.1 | 2026-10-17 | Chung cư: **Tên chung cư mặc định "Tòa nhà VP 55 Nam Kỳ Khởi Nghĩa"** (id 1000982132, P. Bến Thành – có chính sách, 8 PTTT); phường không có thì "Nơi khác". `DEFAULT_BUILDING`, áp dụng cả UI + CLI/API (`resolve` dùng `fallback.building`) |
| 1.3 | 2026-10-17 | **Mặc định tải gói** `/internet/goi-giga` khi mở tool (sửa được; `DEFAULT_URL`), **nút ☆ Đặt mặc định** cho SĐT + link gói (lưu `output/settings.json`, ưu tiên hơn .env, CLI dùng chung; bỏ nhớ SĐT/link lần trước ở localStorage), màn Tạo đơn chia **3 bước xếp ngang** (1 Thông tin khách hàng · 2 Thông tin sản phẩm · 3 Thanh toán, <1100px xếp dọc), bảng **Kết quả dời xuống cuối** màn hình. CLI bỏ trống link = link mặc định |
| 1.2 | 2026-10-16 | Chung cư: **Tòa nhà / Số tầng / Số phòng mặc định điền ngẫu nhiên** (tòa A1..E3, tầng 2..30, phòng = tầng + 2 số), nút 🎲 sinh lại, tạo xong đơn chung cư thì tự đổi căn hộ mới; CLI/API bỏ trống cũng sinh ngẫu nhiên (`apartmentUnit()` trong random.js) |
| 1.1.1 | 2026-10-16 | Sửa: máy user (mạng công ty) báo `fetch failed` khi tải gói – DNS nội bộ không phân giải `apis-stag.fpt.vn`, Chrome đi qua proxy hệ thống `proxy.fpt.vn:80` còn Node thì không. Tool tự dùng proxy: `ECP_PROXY` (.env) → proxy GNOME (gsettings, tôn trọng ignore-hosts) → `HTTPS_PROXY`; CONNECT tunnel tự viết trong `src/core/http.js` (không cần thư viện, chạy Node 22/24) |
| 1.1 | 2026-10-16 | **Nhà riêng / Chung cư** (mặc định nhà riêng; chung cư: Tên chung cư `buildings/list` + Tòa nhà/Số tầng/Số phòng), **kiểm tra chính sách** theo địa chỉ (báo đỏ + khóa Tạo đơn), **Thông tin sản phẩm** (trả sau/trả trước N tháng, mặc định cái đầu) + **Dịch vụ/Thiết bị bổ sung** (mặc định không chọn) qua `checkout/calculate`, PTTT tính lại theo lựa chọn. Sửa lỗi: lỗi nghiệp vụ ECP (HTTP 200 + success:false) bị server trả 200 → UI tưởng thành công (giờ 422). Server xử lý tuần tự theo checkout. Icon desktop |
| 1.0 | 2026-10-16 | Tải gói từ link (PTTT theo gói + tạm tính), form mặc định (SĐT 0964633310, địa chỉ HCM nhà phố, PTTT đầu tiên), tạo đơn qua API ECP, thanh toán: COD xong ngay / thẻ = nút mở cổng thanh toán / VietQR hiện QR, bảng Kết quả + Lịch sử + màn hình Chi tiết, tab Xem đơn hàng, CLI |

- Quy ước version giống BMS: tính năng mới → tăng số giữa, sửa lỗi → tăng số cuối.

### Quyết định đã chốt với user (2026-10-16)
| Hạng mục | Quyết định |
|---|---|
| Thanh toán | Thẻ tín dụng / ATM **nhập thẻ test → thanh toán thành công** (user cung cấp thông tin thẻ sau – v1.1). Thanh toán tại nhà cũng chấp nhận |
| Cách làm | **Như tool BMS**: gọi thẳng API, UI web chạy local + CLI |
| SĐT | Mặc định `0964633310`, cho sửa, **đặt được số mặc định khác** (nút ☆) |
| Link gói | Mặc định `https://staging.fpt.vn/internet/goi-giga`, tự tải khi mở, cho sửa / đặt mặc định khác |
| Bố cục | Tạo đơn = 3 bước ngang như các bước đăng ký trên web; Kết quả ở cuối màn hình |
| Địa chỉ | Mặc định **Hồ Chí Minh**, cho sửa; **Nhà riêng / Chung cư**, mặc định **Nhà riêng** (`private_house`) |
| Chính sách | Địa chỉ không có chính sách → **báo lỗi, không tạo được đơn** (lưu ý case này) |
| Thông tin sản phẩm | Load **tất cả** lựa chọn (chính sách giá), **mặc định cái đầu tiên** |
| Dịch vụ/Thiết bị bổ sung | Load lên, **mặc định không chọn** |
| Chung cư | Tên chung cư mặc định **Tòa nhà VP 55 Nam Kỳ Khởi Nghĩa** (phường khác: "Nơi khác"); Tòa nhà / Số tầng / Số phòng **mặc định random**, cho sửa |
| PTTT | **Mặc định chọn PTTT đầu tiên**, cho đổi; danh sách PTTT **tùy gói + lựa chọn** (lấy từ API sau calculate) |
| Màn hình xem đơn | Như BMS: bảng Kết quả (Lần này / Lịch sử) + Chi tiết |

## 2. Cách chạy
```bash
npm run ui                    # http://localhost:3001 (UI_PORT), tự mở trình duyệt; --no-open để không mở
npm run methods -- <link>     # gói + PTTT
npm run create -- <link> [--pm COD] [-n 3] [--phone ..] [--province ..] [--ward ..] [--street ..] [--no ..]
npm run pay -- <mã đơn> ...   # tự thanh toán (Thẻ tín dụng/ATM, thẻ test trong .env); create ... --pm INTERNATIONAL --pay
npm run repay -- <mã đơn> --pm DOMESTIC [--pay]   # đơn chờ thanh toán: đổi PTTT online + thanh toán lại
npm run status -- <mã đơn> ...
npm run detail -- <mã đơn>
npm run build                 # dist/fptvn-order-tool-<ver>-linux-x64.tar.gz (kèm Node portable)
npm run install-launcher      # icon Desktop + menu (Ubuntu/GNOME)
```
- **Không có dependency** (v1.0–1.4). Tự thanh toán (v1.4) dùng CDP qua `WebSocket` có sẵn Node 22 + **Google Chrome cài trên máy** (`google-chrome`, hoặc `CHROME_PATH` trong .env) – không cần playwright.
- Sửa `src/` xong phải khởi động lại server (`bash scripts/launch-ui.sh stop` rồi chạy lại); `public/index.html` đọc mới mỗi request.
- **Test trong Claude Code**: server test `UI_PORT=3011 node src/server.js --no-open` (tool tự đi proxy GNOME). KHÔNG bật server 3001 từ sandbox bằng `launch-ui.sh` – để user bấm icon.
- Server chỉ bind `127.0.0.1` (tool không có đăng nhập).
- **Proxy**: máy user ở mạng FPT có proxy hệ thống GNOME `proxy.fpt.vn:80` (không cần auth), DNS nội bộ **không** phân giải `apis-stag.fpt.vn` → bắt buộc đi proxy. `config.proxy` (env.js `detectProxy`) → `EcpClient` dùng `requestViaProxy` (CONNECT + tls.connect; **không** đặt `agent: false` vì Node sẽ bỏ qua `createConnection`). Server in nguồn proxy khi khởi động. Icon launcher dùng `/usr/bin/node` v22 (có trước nvm trong PATH).
- Test trong sandbox: proxy GNOME cũng dùng được từ sandbox → không cần mẹo `NO_PROXY=` nữa.

## 3. Cấu trúc code
```
config/environments.js   URL theo môi trường (stag): webUrl, ecpApiUrl, clientId
src/core/env.js          nạp .env, config + defaults form (DEFAULT_URL, DEFAULT_PHONE, DEFAULT_PROVINCE...); output/settings.json (url, phone) đè lên, saveDefaults()
src/core/http.js         EcpClient: header client-id (+ x-checkout-token), bóc {success,data,error}; ApiError(code = mã lỗi ECP)
src/core/store.js        output/<kind>.jsonl + .csv (BOM); readRecords()
src/core/logger.js       log màu (copy từ BMS)
src/data/random.js       random SĐT
src/ecp/product.js       parseProductUrl(link|slug), getProduct() (packages/get), formatVnd
src/ecp/location.js      Locations: provinces/wards/streets (cache), resolve(id|tên, mặc định) – so khớp không dấu
src/ecp/checkout.js      createCheckout, setAddress, getPaymentMethods, placeOrder, orderStatus, toOrderView
src/ecp/orders.js        OrderService (dùng chung UI + CLI): prepare / changeAddress / create / pay / detail / statuses / history
src/ecp/payment.js       payByCard (Chrome thật + CDP, tự nhập thẻ Foxpay/3DS Cardinal/NAPAS), cardStatus(), CARD_METHODS
src/server.js            HTTP server node:http + API nội bộ
src/cli.js               CLI (parseArgs)
public/index.html        UI 1 file (2 tab: Tạo đơn hàng / Xem đơn hàng, bảng Kết quả, <dialog> Chi tiết)
scripts/                 launch-ui.sh, install-launcher.sh, build-package.sh (chuyển thể từ BMS)
khao-sat/                Kết quả khảo sát 2026-10-16 (KHAO_SAT.md, ảnh, script Playwright explore2.js) + pay-recorder.js (2026-10-17, nâng cấp 19/10) – không đóng gói
```
- API nội bộ: `GET /api/config` (+ `cards: {INTERNATIONAL, DOMESTIC}` = đã có thẻ test), `POST /api/settings/defaults {phone?, url?}` → defaults mới, `GET /api/locations/{provinces,wards?provinceId=,streets?wardId=,buildings?wardId=}`, `POST /api/prepare {url, address, offerKey?, extras?}` → `{checkoutId, product, policy:{ok,message}, address, offers[], offerKey, extras[], selectedExtras[], gifts[], methods[], items[], total}`, `POST /api/prepare/update {checkoutId, address, offerKey, extras}` (cùng dạng; 410 = checkout hết hạn → UI tự prepare lại), `POST /api/orders {checkoutId?, url, fullName, phone, address, note, paymentCode, offerKey, extras}` → `{summary, payment:{type:none|redirect|qr, url|qrImage}, steps, view}`, `POST /api/orders/pay {code}` → `{code, paymentCode, card: "n/tổng", result: success|failed|unknown, message, steps[], order}` (chạy tuần tự, ~20–60s), `POST /api/orders/repay {code, paymentCode}` → `{summary, payment, view, canAutoPay}` (409 nếu đơn không còn chờ thanh toán / đã tự thanh toán), `POST /api/orders/status {codes}` (+ `canAutoPay`), `detail` có thêm `changeMethods` (PTTT online đổi được), `POST /api/orders/detail {code}`, `GET /api/history`.
- `address` nhận id hoặc tên: `{provinceId|province, wardId|ward, streetId|street, houseType: private|apartment, addressNo | buildingId|building, block, floor, room}`; thiếu → mặc định `.env`.
- `offerKey` = `<price_list_id>:<billing_type_id>:<months>` (price_list_id dùng chung giữa các chu kỳ, phải ghép đủ 3). `extras` = sku_id dịch vụ bổ sung.
- Lỗi nghiệp vụ ECP về **HTTP 200** + `success:false` → `EcpClient` ném `ApiError` status **422** (đừng để 200 lọt ra UI). Lỗi không có chính sách → `code: CHECKOUT_PACKAGE_NOT_AVAILABLE` (`NO_POLICY`), `#configure` trả `policy.ok=false` thay vì ném.
- `OrderService.#serial(p, fn)`: các thao tác trên cùng 1 checkout chạy tuần tự (UI bắn nhiều update liên tiếp).
- **Token checkout** chỉ ở server (`prepared` Map, TTL 30 phút) + `output/orders.jsonl` – không trả ra trình duyệt, không log. Ảnh QR chỉ giữ trong bộ nhớ phiên.

## 4. Kiến thức hệ thống (khảo sát thực tế 2026-10-16)

### URL
- Web: `https://staging.fpt.vn` – chi tiết gói `/<danh-mục>/<slug>` (vd `/internet/goi-giga`), đăng ký `/checkout/register/<slug>` → redirect `/checkout/<checkout_id>/register` → `/payment` → `/completed` (COD/thẻ) | `/qrpayment` (VietQR) | `/finish` (lead, **không có đơn**).
- API: `https://apis-stag.fpt.vn/ecp` – tất cả `POST` JSON, response `{success, error:{code,message,details[]}, meta, data}`.
- Header `client-id: fptvn` (= `checkout.context.source`, thấy trong bundle `/checkout/assets/index-*.js`, không phải secret). Từ checkout trở đi thêm `x-checkout-token` (token trả về khi tạo checkout).

### Luồng API (đã tái hiện bằng tool)
| # | Endpoint | Body | Ghi chú |
|---|---|---|---|
| 1 | `/public/v1.1/packages/get` | `{code: slug, location: null \| {province_id, ward_id, building_id}}` | Tên/giá gói, `end_to_end_selling` |
| 2 | `/ordering/public/v1/checkout/create` | `{bundles:[{bundle_code}], referral:{url, utm_content, camp_extra...}}` | → `checkout_id`, `token` |
| 3 | `/public/v1/locations/{provinces,wards,streets}/list` | `{address_level:"Level2", location_id \| ward_id}` | `[{id,text}]`. HCM = 8, P. Bến Thành = 1000009709, Trương Định = 1001016687 |
| 4 | `/ordering/public/v1/checkout/address` | `{address, location_id, district_id:null, ward_id, street_id, address_no, type_house:"private_house", building_id:null, building_name:"", floor:"", block:"", room:""}` | **PTTT chỉ có sau bước này** |
| 5 | `/ordering/public/v1/checkout/payment-methods/get` | `{bundle_codes:[slug]}` | `[{payment_method:"Online"\|"COD", code, name, payment_type}]` – Gói Giga: INTERNATIONAL, DOMESTIC, APPLE_PAY, COD, BANK_TRANSFER, ZALO_PAY, MOMO, VIETQR |
| 6 | `/ordering/public/v1/checkout/customer` | `{full_name, phone, ...address, note}` | Lỗi nghiệp vụ hay gặp ở đây (xem dưới) |
| 7 | `/ordering/public/v1/checkout/payment` | `{selected_payment_method:"Online"\|"COD", selected_online_method: code \| null}` | |
| 8 | `/ordering/public/v1/voucher/apply` | `{vouchers:[], mode:"Auto"}` | Web gọi trước khi thanh toán (ưu đãi tự áp, vd CA454650KNET) |
| 9 | `/ordering/public/v1/checkout/complete` | `{}` | → `order_id, order_code (= checkout_id), status, redirect_url, display_type (None/WebApp/QRCode), qr_code_info{image_base64, expire_time (phút)}` |
| 10 | `/ordering/public/v1/checkout/get` | `{}` | Toàn bộ đơn: `status, order_id/code, customer_info, bundles, line_items[{display_name, quantity, prepaid_month, pricing.amount}], calculation_detail, summary.final_amount, payment_info` |
- **Lựa chọn sản phẩm / bổ sung** (v1.1): nguồn = `packages/get` **có location** (`{province_id, ward_id, building_id}` – building_id 0 nếu nhà riêng/"Nơi khác"):
  - `product_offering_price[]` = "Thông tin sản phẩm": mỗi phần tử 1 chính sách (`id` = price_list_id, `billing_type_id` 2 Trả sau / 1 Trả trước, `contract_length_months`, `summary.service_price.price`, `sku_prices[]` giá từng sku theo chính sách, `applicable_offering_group_ids`). **null/rỗng = địa chỉ không có chính sách**.
  - `product_offering[].products[]`: `item_role` 1 = gói chính (children `purchase_type: add-on` = thiết bị bắt buộc → `addons [{sku_id, parent_sku_id, quantity}]`), `item_role` 2 = **dịch vụ/thiết bị bổ sung** (Gói Ultra Fast SA 1907, TV 4204...).
  - `product_offering_group[]` = quà tặng (Nhóm camera 414, sku_group `default_checked`) – web tự gửi sku_group mặc định khi chọn trả trước → tool cũng gửi.
  - Áp lựa chọn: `/ordering/public/v1/checkout/calculate {bundles:[{bundle_code, price_list_id, billing_type_id, billing_cycle, contract_length_months, products:[], addons, extras:[{sku_id, parent_sku_id:null, quantity} | {group_id, sku_group_id, quantity}]}]}` → sau đó `payment-methods/get` (PTTT đổi theo lựa chọn: Gói Giga + bổ sung → mất COD).
- **Gói thiết bị / camera** (khảo sát 2026-10-20, `combo-2-camera-fcam-play-4-iq-4s`, `type: fpt-camera`): `product_offering_price[0]` có `billing_type_id/contract_length_months = null`; chu kỳ nằm ở `sku_prices` của sku dịch vụ chính `purchase_type: billing` (An Tâm 7 - Max 4177: 1/6/12 tháng, `billing_type_id 1`). Nhiều sản phẩm `item_role 1` (FPTCameraPlay4 2091, FPTCameraIQ4S 2390 = device, children "Phí triển khai Camera Combo" id 27 service 4-404, `parent_sku_id` = id sku_price của thiết bị 5048/5050). `item_role 2` "Gói giao hàng - combo" 4176 (service 4-405). Web: trang gói chọn chu kỳ → "Mua ngay" → thẳng `/checkout/<id>/payment` (1 màn: thông tin + "Hỗ trợ lắp đặt / Tôi muốn tự lắp đặt" + PTTT). calculate (bundle FE `package-*.js`): `products: [{sku_id, parent_sku_id, quantity, contract_length_months}]` (line item không phải fee) – **gửi `products: []` thì chu kỳ không đổi**; `extras` = phí triển khai `{sku_id:27, parent_sku_id:5048|5050}` (INSTALLATION, service 3-13/4-404) **hoặc** gói giao hàng (DELIVERY, 3-305/4-405). Gửi parent_sku_id = id sản phẩm (2091) → `CHECKOUT_EXTRAS_SKU_NOT_FOUND`. Tự lắp đặt → mất COD.
- **Gói catalog mới FCP** (khảo sát 2026-10-21/22, `PRD_NET_001` Internet Giga, `PRD_NET_003` Internet Meta; trang gói có nhãn "FCP", link đăng ký `/checkout/register/<mã>?salechannelcode=fptvn`):
  - `packages/get` trả null, v1 create → `CHECKOUT_PACKAGE_NOT_FOUND`. Nhận diện: `POST /channel/public/v1/products/content {slug}` → `{source:"FCP"|"ECP", product_code, product_type, display_name}` (gói ECP cũng trả `source:"ECP"`). **Mã phân biệt hoa/thường** (`prd_net_003` → rỗng).
  - Bảng giá: `POST /public/v2/products/quote {product_code, location_id, ward_id, building_id}` (thêm `products` → REQ_400) → `pricing_options[0].offering_price[]`: `render_group_code` CORE_BUNDLE (`payment_term_id` 2 trả sau / 1 trả trước, `prepaid`, `usage`, `price`, `display_name`) + `attr_dev_internet` (Access Point AX3000CV2, ECP tự gán).
  - v2 (`/ordering/public/v2`): `checkout/create {bundles:[{bundle_code}], order_info:{order_type:1}, referral}` → address (payload như v1) → `checkout/calculate {bundles:[{bundle_code, payment_term_id, contract_length_months: usage}]}` (web chỉ gửi vậy → option trùng (term, usage), vd Meta prepaid 3/usage 4 và prepaid 4/usage 4, ECP lấy cái đầu) → `payment-methods/get` (không body, chưa calculate → `CHECKOUT_ALLOWED_PAYMENT_METHOD_NOT_FOUND`; item có `payment_method_id`: COD 12, Online 9999) → `customer` → `payment {selected_payment_method_id, selected_online_method: code | ""}` → v1 `voucher/apply`, `complete`, `get`.
  - Mỗi response v2 trả token mới (web lưu token xoay vòng) – token cũ **vẫn dùng được**, tool giữ token lúc create. Token v1/v2 đều sống 1200s.
  - Trả sau có thêm "PLĐ Net" (phí lắp đặt: Giga 199k, Meta 299k). Dịch vụ đi kèm (companion: FSafe ISC_NET_002, Camera ISC_CAM_001, `channel/public/v1/products/checkout-context`) = bundle thêm, chưa làm.
- **Chung cư** (`type_house: "apartment"`): `buildings/list {ward_id}` → `[{id,text}]`, phần tử đầu `{id:-1, text:"Nơi khác"}`. Payload address/customer: `building_id`, `building_name` (tên chung cư, "" nếu Nơi khác), `block` (Tòa nhà), `floor`, `room` (bắt buộc), `address_no: ""`, `address: "Tòa A1, Tầng 5, Phòng 501, VVA Tower, Trương Định, Phường Bến Thành, Hồ Chí Minh"`. Chung cư "Nơi khác" ở P. Bến Thành → `checkout/address` lỗi `CHECKOUT_PACKAGE_NOT_AVAILABLE` (web không báo gì).
- `status`: `open` (chưa xong) → `completed` (COD xong ngay) | `recompleting` (online, chờ thanh toán). Sau thanh toán online thành công (19/10, cổng báo "Thanh toán thành công!", cả thẻ tín dụng lẫn ATM): ECP **vẫn `recompleting`** – user xác nhận **lỗi hệ thống staging** (bình thường sẽ lên trạng thái đã thanh toán) → v1.4 lấy kết quả từ **trang cổng** (`/portal-ecom/payment/v3/result/*` "Thanh toán thành công!" | redirect `/checkout/payment/callback`), không chờ `completed`. Web: callback gọi `checkout/get` rồi đá về `/vi` – không có màn completed.
- Thanh toán online: `redirect_url` → `paygateway-stag.fpt.vn/gateway-web/...` (thẻ tín dụng: `/portal-ecom/payment/international/card/cs_sess_*` form Foxpay: Số thẻ / Tên in trên thẻ / MM/YY / CVV (password) / nút "Thanh toán", hết hạn ~15 phút; ATM: `/payment-page/napas/*` → `dps-staging.napas.com.vn`). **WAF chặn headless Chromium** ("Sorry, you have been blocked") – Chrome thật thì vào được.

### Lỗi nghiệp vụ đã gặp
| Code | Khi nào |
|---|---|
| `CHECKOUT_PACKAGE_NOT_AVAILABLE` | Gói không khả dụng (vd `combo-giga-lite`, content `status: draft`). Web vẫn chuyển `/finish` "Đăng ký thành công" (FE nuốt lỗi) |
| `CHECKOUT_FPT_PLAY_REGISTER_PHONE_EXISTS` | Gói Combo có FPT Play, SĐT đã có tk FPT Play |
| `CHECKOUT_PACKAGE_NOT_AVAILABLE` ở `checkout/address` | Địa chỉ/chung cư không có chính sách (vd chung cư "Nơi khác" P. Bến Thành) |
| `BUSINESS_INTERNAL_ERROR` "ServiceCode not found" | `complete` với **mọi chính sách trả trước** của Gói Giga (3/7/12 tháng, COD lẫn online, có/không quà camera) – cấu hình staging |
| `BUSINESS_INTERNAL_ERROR` | `/checkout/order/short-link` trên trang completed (lỗi phụ của web) |

### Gói đã chạy thật
| Gói (slug) | Kết quả | Mã test |
|---|---|---|
| `goi-giga` | ✔ COD / thẻ tín dụng (chờ TT) / ATM (chờ TT) / VietQR (chờ TT). v1.1: chung cư VVA Tower + COD ✔, + SA + TV + VietQR ✔, trả trước ✖ ServiceCode | 0000N1X5O1MO (COD), 0000N1XA9PJ4 (thẻ), 0000N1XCZ7FK (VietQR), 0000N1Y0ZSW0 (chung cư COD), 0000N1Y1L3UO (2 bổ sung), 0000N1YF4LA8 (chung cư + SA, qua UI) |
| `combo-giga` | Lựa chọn khác nhau theo tỉnh (26 tỉnh 1 lựa chọn, 7 tỉnh 4, 1 tỉnh 12); bổ sung AccessPoint/TV/FSafe | – |
| `combo-giga-lite` | ✖ CHECKOUT_PACKAGE_NOT_AVAILABLE | – |
| `PRD_NET_003` (FCP, v1.7) | ✔ COD trả sau 299.000đ, ✔ thẻ tín dụng trả trước 1 tháng + tự thanh toán (completed), ✔ VietQR 2 tháng → repay ATM, ✔ COD qua UI | 0000N9IYCF40, 0000N9IYL8RK, 0000N9IZ0YKG, 0000N9J035B4 |
| `PRD_NET_001` (FCP, script khảo sát) | ✔ COD trả sau 208.000đ | 0000N6YLKEM8 |
| `combo-2-camera-fcam-play-4-iq-4s` (camera, v1.6) | ✔ COD 6 tháng + lắp đặt (1.700.000đ sau ưu đãi CA4384VC3D6CMR -200k, khớp web), ✔ VietQR 12 tháng + tự lắp đặt (chờ TT), ✔ qua UI | 0000N6VAHIV4, 0000N6VB29UO, 0000N6VCGX40 |
| `combo-giga` | ✖ trùng SĐT FPT Play (với 0912345678) – thử lại với SĐT random | – |
| `combo-lux-500`, `dat-test` | Chưa rõ (khảo sát bằng UI bị timeout) | – |

## 5. Cách khảo sát khi làm bước mới
- Playwright headless đi từ trang gói (`khao-sat/explore2.js` – log API, mask key nhạy cảm) hoặc Claude in Chrome hook fetch/XHR (chỉ in URL/method/status/key body).
- Bundle FE `/checkout/assets/index-*.js` tải công khai → grep endpoint.
- **Khảo sát cổng thanh toán** (`khao-sat/pay-recorder.js`, không cần thư viện – CDP qua `WebSocket` có sẵn Node 22): `node khao-sat/pay-recorder.js [--pm INTERNATIONAL|DOMESTIC] [--code <mã đơn>] [--port 9333]` → tạo đơn (hoặc dùng đơn có sẵn) → mở **Chrome thật** profile tạm thẳng vào `redirect_url` (không qua DevTools), chờ tải xong mới gắn CDP, **không `Runtime.enable`** (Cloudflare dò được) → người dùng tự nhập thẻ → log `khao-sat/pay-log/<mã>-<time>.jsonl`: URL (che query), redirect, status request document/xhr/fetch, cấu trúc form (type/name/id/placeholder/label – **không đọc value**), `checkout/get` trước/sau. Thoát khi đóng Chrome hoặc quay về `staging.fpt.vn/checkout/...`.
- 17/10 bị Cloudflare chặn theo đường mạng (máy ngoài mạng công ty). **19/10 xong**: Chrome của script đi `--proxy-server` theo `config.proxy` (proxy.fpt.vn) → vào được. Script giờ: `--pm` mặc định `INTERNATIONAL,DOMESTIC` (chạy lần lượt), **báo** (console 🔔 + notify-send) khi tới màn có ô nhập, poll giá trị ô 500ms → khi xong **ghi thẳng `.env`** `CARD_<PTTT>_*` (không in giá trị, log chỉ có độ dài; `--no-save` để không ghi), luồng không có giá trị → `khao-sat/pay-log/<PTTT>-flow.json`.
- **Luồng thẻ tín dụng** (đơn 0000N5CS6VJ4): Foxpay `/portal-ecom/payment/international/card/cs_sess_*` (Số thẻ / Tên / MM/YY / CVV, nút "Thanh toán") → **3DS Cardinal** `1merchantacsstag.cardinalcommerce.com/MerchantACSWeb/creq.jsp` (iframe "Purchase Authentication", ô `challengeDataEntry` = OTP) → `/portal-ecom/payment/v3/result/cs_sess_*` "Thanh toán thành công!" → `staging.fpt.vn/checkout/payment/callback`. Biến: `CARD_INTERNATIONAL_NUMBER/NAME/EXPIRY/CVV/OTP`.
- **Luồng thẻ ATM** (đơn 0000N5CU905C): `paygateway.../payment-page/napas/*` → NAPAS `dps-staging.napas.com.vn/.../merchant/FTEL/paymentpage`: `#selectBank` (select ngân hàng), `#napasCardNo`, `#napasNameOnCard`, `#napasIssueDate` (MMYY), `#napasProcessBtn1` "Tiếp tục" → `#napasOtpCode` → `#napasProcessBtn2` "Tiếp tục" → 302 `staging.fpt.vn/checkout/payment/callback`. Biến: `CARD_DOMESTIC_BANK/NUMBER/NAME/ISSUE_DATE/OTP`.
- **Không tự nhập số thẻ** khi khảo sát bằng trình duyệt – thông tin thẻ test do user cung cấp, chỉ nằm trong `.env`/code chạy trên máy user.

## 6. Tự thanh toán (v1.4) – ghi chú
- `payByCard`: Chrome profile tạm, `--remote-debugging-port=0` (đọc `DevToolsActivePort`), mở thẳng `redirect_url`, chờ 3s mới gắn CDP, **không Runtime.enable**; poll mọi target (page + iframe OOPIF như 3DS Cardinal) bằng `Runtime.evaluate` DETECT → bước `foxpay | cardinal | napasCard | napasOtp`. Làm xong 1 bước thì **chờ màn đó biến mất** (trang còn hiện vài giây sau khi bấm – trước đây nhập OTP 2 lần), bước lặp > 2 lần = lỗi.
- Điền ô: gõ phím (`Input.dispatchKeyEvent`, ô có mask) → đọc lại **trước khi blur** (Foxpay/NAPAS che số thẻ thành ● khi rời ô) → sai thì gán qua setter gốc + event. Nút khóa → lỗi kèm chẩn đoán (id:độ dài + chữ lỗi, không giá trị).
- Kết quả: "Thanh toán thành công" trên trang cổng → success; NAPAS 302 thẳng về `staging.fpt.vn/checkout/payment/callback` → coi là success nếu đã qua bước và không thấy lỗi. 3DS Cardinal **không phải lúc nào cũng hỏi** (lần chạy 19/10 bỏ qua).
- Biến .env: `CARD_INTERNATIONAL_NUMBER/NAME/EXPIRY/CVV/OTP`, `CARD_DOMESTIC_BANK (value option #selectBank)/NUMBER/NAME/ISSUE_DATE/OTP`. Số thẻ phải đủ số (pay-recorder bản đầu lưu nhầm bản bị che ●, đã sửa; tool báo lỗi nếu còn ●).
- Đơn đã chạy: 0000N5DLOHXC (thẻ tín dụng, CLI), 0000N5DNJI00 (ATM, CLI), 0000N5DP70YO (ATM, API UI).

### v1.5 – nhiều thẻ, đổi PTTT (khảo sát 19/10)
- **Đổi PTTT trên đơn `recompleting`**: `checkout/payment` (PTTT mới) → `voucher/apply` → `checkout/complete` → cùng `order_code`, `redirect_url`/QR mới, vẫn `recompleting`. Đổi qua lại INTERNATIONAL ↔ DOMESTIC ↔ VIETQR đều được. **Đổi sang COD → `complete` lỗi `PROCESSING_ERROR_PLEASE_CONTACT_HOTLINE` (ORDER_SUBMISSION_FAILED)** → tool chỉ cho PTTT online (`onlineMethods`). Response `payment`/`complete` trả `token` mới nhưng token cũ vẫn dùng được → giữ token cũ. Mỗi lần đổi ghi 1 bản ghi mới vào `orders.jsonl` (`summary.paymentChangedAt`); `#tokens()`/`history()` lấy bản mới nhất theo mã.
- Gọi `complete` lại cùng PTTT = link cổng mới → `pay()` dùng khi thử thẻ sau / khi đơn đã từng tự thanh toán (link cũ đã dùng, Foxpay hết hạn ~15 phút).
- `payByCard`: lỗi do thẻ (nút khóa, bước lặp, màn còn nguyên kèm chữ lỗi) → `result: 'failed'` (thử thẻ sau); lỗi môi trường (không mở được Chrome, Cloudflare chặn) → ném.
- Thẻ 2 của user (`CARD_INTERNATIONAL_NUMBER2`) là **Mastercard** → Foxpay staging báo "Loại thẻ không được hỗ trợ thanh toán" (cả link mới). Thẻ 1 (Visa) OK.
- Đơn test: 0000N5GE0UJK (thẻ 1 giả lỗi → thẻ 2 lỗi; chạy lại thẻ 1 trên link mới ✔), 0000N5GIQQIO (API: INTERNATIONAL → COD ✖ → VIETQR → DOMESTIC → tự thanh toán ✔), 0000N5GH3CM8 (chỉ thẻ 2 ✖, còn chờ thanh toán).

## 7. Kế hoạch tiếp theo
**Backlog:** FCP: dịch vụ đi kèm (FSafe/Camera), chọn thiết bị khi nhóm attr_dev có nhiều lựa chọn, số lượng gói (quote `product_quantity` max 3); số lượng camera > 1 (web có ô Số lượng), số lượng bổ sung > 1, chọn quà tặng khác (nhóm camera nhiều sku_group), số lượng đơn trên UI, mã ưu đãi, môi trường khác.
