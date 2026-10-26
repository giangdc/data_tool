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
