# Khảo sát – Tạo đơn hàng trên Portal SOP

- Môi trường: stag – https://portal-sop-stg.fpt.vn
- Đăng nhập: `/user/login/basic-auth` (ô `#basic_username`, `#basic_password`, nút submit "Login").
  Vào thẳng trang trong portal khi chưa đăng nhập sẽ bị chuyển sang `/user/login` (trang khác) → luôn mở basic-auth.
- Tài khoản khảo sát: qc.hattt65 (2026-10-24). Phiên lưu trong `.cache/browser-profile`.

## Công cụ khảo sát (`khao-sat/`)
- `start-chrome.sh`: Chrome headless dùng profile đã đăng nhập, cổng debug 9333 (127.0.0.1).
- `cdp.mjs '<code>' [ảnh]`: chạy code trên tab portal mới nhất; có `text()`, `sem(regex)`, `tap(regex)` cho Flutter.
- `netlog.mjs`: ghi method/status/url + KEY body/response (không giá trị, không header) vào `output/net.log`.
  Lưu ý: không bắt được request của tab tạo đơn (Flutter) → dùng `performance.getEntriesByType('resource')` để xem URL.

## Luồng tạo đơn (UI)
1. Quản lý khách hàng → Khách hàng của tôi (`/quan-ly-khach-hang/khach-hang/danh-sach`, React + antd) → bấm tên KH
   → `/quan-ly-khach-hang/khach-hang/chi-tiet` (tab Thông tin khách hàng / **Đơn hàng** / Hoạt động).
2. Tab Đơn hàng → **Thêm đơn hàng** → popup "Lựa chọn hình thức bán": **Bán mới** | Bán thêm.
3. Bán mới mở **tab mới** `/ban-hang/order/create` = app **Sale Platform (Flutter web, `main.dart.mjs`)**, tiêu đề "Tạo báo giá":
   - Thông tin địa chỉ (bấm kính lúp góc phải) → bắt buộc trước khi có combo.
   - Dropdown đối tượng ("Gia đình"), "Combo gợi ý cho bạn" (cần địa chỉ), "Combo tùy chọn": Internet, FPT Play, FPT Camera,
     Tổng đài Oncall, FPT Camera Only, FPT Play Stand Alone, Sản phẩm khác, FPT Smart Home.
   - Khu vực góc phải: Hồ Chí Minh.
4. Màn Thông tin địa chỉ: tab **Tìm kiếm** (Google Maps, gọi `sale/v1/api/googleapis/geocode`; stag trả "Không có kết quả phù hợp")
   | tab **Nhập địa chỉ**: Loại nhà* (Nhà phố / Nhà không số → thêm "Vị trí nhà*"…), Xã/Phường*, Đường*, Số nhà*,
   Tọa độ (dùng để book port), Ghi chú địa chỉ → **Xác nhận**.
   - ⚠ Nhập tay (kể cả có tọa độ) → Xác nhận không phản hồi. **Cách chạy được**: tab Tìm kiếm → gõ
     "123, Trương Định, Phường Bến Thành, Hồ Chí Minh" → nút Tìm kiếm → bấm dòng kết quả → bấm thanh địa chỉ dưới bản đồ
     → form tự điền (tọa độ 10.7733664, 106.6944494) → Xác nhận. API: googleapis/autocomplete-search, place-detail,
     order-info/check-address-2, get-address-convert-2, validate-address.
5. Có địa chỉ → "Combo gợi ý": GigaF1/F2, MetaF1/F2, SkyF1/F2, Combo khác. Chọn thẻ "Giga F1 - 1T" (210.000đ/tháng,
   phí lắp 399.000đ, Internet hub AX1800GZ + Access Point AX1800AZ) → màn báo giá:
   Đối tượng KH (Gia đình), Thông tin KH (Cập nhật), **Phương thức thanh toán** (mặc định FRT Thu Hộ → stag báo
   "chưa được hỗ trợ" 0xb2373817034; user chọn **Napas**), Thông tin dịch vụ, Hình thức thanh toán cước hằng tháng
   (Qua Ngân hàng…), Phiếu mua hàng, Thành tiền → **Tạo báo giá**.
6. Tạo báo giá → lỗi 0xb2319565099: thiếu **ngày sinh, loại giấy tờ, quốc tịch** của KH.
   - Form Thông tin KH (Flutter): Họ tên, SĐT, Email, Thông tin liên hệ khác (người liên hệ, kênh tiếp thị, ghi chú
     triển khai, địa chỉ hóa đơn / thu cước) – KHÔNG có ô ngày sinh / giấy tờ.
   - "Thêm ảnh" giấy tờ: loại CCCD, ảnh mặt trước/sau, ảnh hồ sơ; công tắc "Sử dụng quét QR CCCD" bị khoá (luôn bật).
   - "Quét QR" → Camera | Thư viện ảnh. Upload ảnh QR tự tạo (định dạng `CCCD|CMND|Họ tên|ddmmyyyy|Giới tính|Địa chỉ|ngày cấp`)
     → "Không quét được thông tin trên CCCD" (nghi bản web không giải mã ảnh QR).
   - Portal (React) sửa KH chỉ có Ngày sinh, không có giấy tờ / quốc tịch.
   - ✅ **Cách qua** (user chỉ, 2026-10-24): Thông tin KH → "Cập nhật" → giữ Họ tên + SĐT → **Xác nhận & Lưu** → Tạo báo giá.
     (Lỗi trên xuất hiện khi chưa bấm Xác nhận & Lưu ở form KH.)
7. Cảnh báo trùng đơn 0xb2368580028 (trùng địa chỉ lắp đặt/SĐT với 210 đơn – dữ liệu test dùng chung) → **Xác nhận**.
8. ✅ Màn **Chi tiết báo giá**: Mã đơn hàng (vd **HCMSF0026TIZ**, 2026-10-24, KH Đặng Châu Giang, Giga F1 - 1T, Napas,
   399.000đ), Mã hợp đồng (trống), Link báo giá `https://staging.fpt.vn/shop/bao-gia/<id>` + QR, Thu hồi / Copy link,
   tab Theo dõi báo giá, nút **Tạo hợp đồng**.
9. Tạo hợp đồng → màn "Đang tạo hợp đồng" (Kiểm tra thông tin đơn → Tạo phiếu thông tin KH → Tạo hợp đồng, ~15s)
   → khảo sát **Định danh khách hàng** (3 câu bắt buộc: số tầng, nhà riêng/thuê, chia phòng cho thuê) → Hoàn tất
   → "Hợp đồng đã được định danh" → Đóng → Chi tiết báo giá có **Mã hợp đồng** (vd SGABP5146), Book Port
   (vd HCMP005.0315/HU, "đơn hàng đang được bookport ảo"), nút **Thanh toán** (chưa khảo sát).

## Mã trong response API (tool đọc ở đây – màn Flutter không có chữ)
- `sale/.../order/update` → `Data.Result.OrderCode`; `order/detail` → `Data.Result.OrderInfo.OrderCode`
- `quotation/detail` → `Data.Result.Quotation.OrderCode`, `Data.Result.Quotation.URL` (link báo giá)
- `contract/create` → `Data.Result.ObjContract` (mã HĐ)
- Cảnh báo trùng đơn có liệt kê mã HĐ khác (SGABP…) → chỉ lấy mã HĐ ở giai đoạn sau khi bấm Tạo hợp đồng.

## Flutter web – cách điều khiển
- DOM không có text; bật semantics: click `flt-semantics-placeholder` → `flt-semantics` có `aria-label`, role, toạ độ.
- Dropdown mở hộp thoại có ô tìm (input ~ y=196) + danh sách button.
- Nút Xác nhận không xuất hiện trong cây semantics (gộp vào tabpanel "Xác nhận").
- ⚠ Bật semantics làm lớp `flt-semantics` nuốt click → nút "Xác nhận" địa chỉ không ăn. Cách xử lý (tool đang dùng):
  thêm CSS `flt-semantics-host, flt-semantics { pointer-events: none }` → vẫn đọc được nhãn, click xuyên xuống canvas.
- Hộp thoại cảnh báo: chữ KHÔNG có trong semantics, chỉ có nút → [Hủy + Xác nhận] = cảnh báo trùng đơn, [Xác nhận] = lỗi.
- Radio khảo sát: node nhãn rộng cả hàng → bấm ô tròn x=36 tại y của nhãn.
- Bấm khi app chưa tải xong sẽ hụt → chờ node "Internet" (Combo tùy chọn) rồi mới bấm; mỗi bước chuyển màn kiểm tra
  node của màn kế (tab "Nhập địa chỉ", nút "Tìm kiếm"…), không thấy thì bấm lại.

## API (sapi.fpt.vn – Sale Platform)
- Token: `gateway-sop-stg.fpt.vn/auth-service/api/auth-service/sdk/refresh-access-key-desktop`
  → `sapi.fpt.vn/saleplatform-gateway-api-staging/gateway/auth/api/v3/authentication/token`
- Base: `https://sapi.fpt.vn/saleplatform-api-staging/gateway/`
  - d2d/v1/api: config/menu, config/mobile-config, account/update-device-info, order-info/check-debit, potential/get-permission…
  - sale/v1/api/order-info: get-sale-range-info, get-permission-services, get-master-data, get-district, get-street
  - sale/v1/api/googleapis/geocode
- Portal (React): `gateway-sop-stg.fpt.vn/customer-service/api/v2/customer/list-customer`, `customer/customer-by-id`…

## Cập nhật 26/10/2026 (v0.2.0)

- **Chạy ngầm**: headless chạy được với app Flutter (viewport cố định 1440×813) → mặc định chạy ngầm, chọn "Hiện cửa sổ Chrome" trên UI hoặc `--show`.
- **Danh sách gói**: lúc Xác nhận địa chỉ, app gọi `sapi.fpt.vn/.../sale/v1/api/package-view/list` → `Data.Result.Packages[]`
  (PackageGroupTypeName, PackageIndex, PackageName, MonthlyFee, ExtraFee, Total, ProductListName, ServiceListName). 123 Trương Định: 42 gói.
  Hàng thẻ "Combo gợi ý" là 1 danh sách ngang liền cho mọi nhóm (tab chỉ cuộn tới đầu nhóm), thẻ rộng 229px, cuộn bằng wheel(deltaX).
- **Google Places stag** báo `OVER_QUERY_LIMIT` → form địa chỉ thiếu Số nhà + Toạ độ → tool điền tay 2 ô này (Số nhà @720,517; Toạ độ @700,625).
  Màn "Thông tin địa chỉ" nhớ tab dùng lần trước → luôn bấm về tab "Tìm kiếm" trước.
- **Hộp thoại**: "Bạn đang có một đơn hàng trước đó chưa hoàn thành…" [Không | Xác nhận] → Không. Chỉ có [Xác nhận] = lỗi
  ("Đã có lỗi xảy ra", "Thời gian phản hồi quá lâu" khi bấm thẻ gói → đóng, bấm lại).
- **Lỗi tạo HĐ** (stag): màn "Cảnh báo!!! / Đã có lỗi xảy ra! (0x…)" + nút "Quay lại", bước "Tạo phiếu thông tin khách hàng" lỗi → tool báo lý do ngay.
- **Mã đơn** có dạng `HCMSF…` hoặc `HCMSI…` (vd HCMSI0026TN4).
- Đã chạy trọn: HCMSI0026TN4 / SGABP5177 (Sky F2 - 12T), SGABP5176 (Giga F1 - 1T).

## Dịch vụ khác – Combo tùy chọn (khảo sát 30/10/2026)

- Màn Tạo báo giá là **giỏ dịch vụ**: bấm ô dịch vụ → form riêng → Xác nhận → thanh đáy "N Dịch vụ được mua / **Chi tiết giỏ hàng**"
  → màn Chi tiết → **Xác nhận** → màn báo giá giống Internet (PTTT, Thông tin KH, Tạo báo giá, Tạo hợp đồng).
  Chọn thẻ Combo gợi ý nhảy thẳng sang màn báo giá, bấm mũi tên (23,25) quay lại thì combo vẫn trong giỏ.
- 20 ô dịch vụ: Internet, FPT Play, FPT Camera, Tổng đài Oncall, FPT Camera Only, FPT Play Stand Alone, Sản phẩm khác, FPT Smart Home,
  Ultra Fast Stand Alone, FPro, FSafe Go, VioEdu Stand Alone, VIP 247, SIM data, Pay Wifi, Ultra Fast, FPT Camera B2B, HyperFast, FPT AI Wi-Fi, FPT Play SME.
- **Form đọc được**: ô nhập là `flt-semantics > input` có `aria-label` = tên ô ("Gói dịch vụ", "Gói tính cước", "Số lượng", "Loại thiết bị", "Thiết bị",
  "Tình trạng", "Thu hồi", "Đơn vị triển khai"). Ô đã điền: aria-label đổi thành giá trị, `value` vẫn rỗng; Số lượng đã điền thành "SL: 1" (ô `value` rỗng).
- ⚠ Form mở ra, Flutter **không cập nhật** cây semantics (chỉ có node "Hộp thoại") → đổi viewport 1px rồi trả lại là có đủ (`formFields` trong flutter.js).
- Sheet chọn: nút role=button có nhãn, X đóng ở góc trái (nút không nhãn). Nút + / thùng rác của mục: nút không nhãn cùng hàng tiêu đề mục.
- Hộp cảnh báo: nút Xác nhận ở giữa màn (y < 640); chữ cảnh báo chỉ có trên ảnh.
- Khu vực bán (góc phải) app nhớ từ lần trước; lệch địa chỉ → "Bạn không thể bán hàng trong khu vực đã chọn" → tool đổi theo phần cuối địa chỉ.
- PTTT khác nhau theo dịch vụ: FPT Play Stand Alone chỉ có Chuyển khoản / Shopee Thu Hộ / Tiktokshop Thu Hộ (không có Napas).
- FPT Play Stand Alone bắt buộc "Hình thức nạp code" = Gửi SMS / Auto Active; SĐT đã gắn HĐ thì Tạo báo giá báo "Số … đã được gắn với hợp đồng …".
- API gói theo dịch vụ (`sale/v1/api/`): `net/packages`, `fptplay/packages`, `camera-bundle/{deploy,cloud,…}`, `oncall/device-ip-phone`, `camera-ott/{device,cloud,extra}`,
  `fptplay-sa/{device,extra,get-method-active-code}`, `retailequipment/list-type`, `smarthome/device`, `fsafe-go/packages`, `group-code/{get-sub-service-type,packages}`,
  `fpro/outsource`, `camera-b2b/{deploy,device,license,cloud}` → `Data.Result[]` {SubServiceTypeName, SubServiceName, PrePaid[].Value, DeployTypes[], MaxQty}.
- Thử `khao-sat/matrix.mjs` (thêm từng dịch vụ vào giỏ, không tạo báo giá), `khao-sat/fresh.mjs` (mở đơn nháp mới tới màn Combo cho cdp.mjs).
- `cdp.mjs` không thêm CSS click xuyên semantics như tool: nút trong app có thể không ăn → chạy `nodes` của flutter.js hoặc tự thêm style.



## Đối tượng khách hàng (khảo sát 2026-11-04 – khao-sat/doi-tuong.mjs, form-dn.mjs, radio.mjs)
- Danh sách từ API `order-info/get-sale-range-info`: CusType 100 "Tổ chức/Hộ kinh doanh" (L2: 120 Doanh nghiệp, 122 Cơ quan nhà nước,
  124 Đơn vị sự nghiệp, 126 ĐSQ/Tổ chức phi CP, 128 Đại lý Internet, 204 Hộ kinh doanh) · CusType 102 "Cá nhân" (132 Gia đình – mặc định,
  134 Học sinh/sinh viên, 136 KH nước ngoài) · ObjectType = "Khách hàng đặc biệt" (ô tick: ISP khác, Nhà báo…).
- Ô Đối tượng KH = node group đầu tiên trên màn báo giá (chữ "Đối tượng khách hàng" KHÔNG có trong semantics); ô PTTT = group thứ 2.
- Hộp chọn 2 cấp: bấm TÊN NHÓM = chọn loại đầu của nhóm + đóng hộp. Bấm loại con phải bấm đúng VÒNG TRÒN radio (mép phải, x+w/2-17);
  bấm giữa dòng không ăn.
- Đổi sang nhóm Tổ chức: thông tin KH bị xoá → "+ Cập nhật" → form DN. Bắt buộc: Tên, MST/ĐKKD, Ngày cấp, Nơi cấp, Ngày thành lập,
  Địa chỉ GPKD, SĐT tổ chức, SĐT giao dịch (SMS), Họ tên người đại diện. Ảnh giấy tờ KHÔNG bắt buộc.
- Ô ngày = bánh xe Cupertino (ngày/tháng/năm, mặc định hôm nay): cuộn chuột trên cột năm (deltaY -40 = lùi 1 năm) → Xác nhận.
  "Ngày thành lập" là node gộp nhãn + ô (h>70) → bấm phần dưới node.
- Payload order/validate DN: CusTypeId 100, CusTypeL2Id 120, FullName = tên DN, IDCard = MST, RepresentativeFullName.
- Đã chạy trọn DN: HCMUO0026UR0 / SGABP5645.
