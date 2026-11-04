# Changelog – SOP Order Tool

## v0.4.0 – 2026-11-04

**Đối tượng khách hàng**
- Thêm ô **Đối tượng khách hàng**: *Cá nhân* (mặc định, = "Gia đình" trên portal) và *Doanh nghiệp*.
  Các loại khác (Học sinh/sinh viên, KH nước ngoài, Hộ kinh doanh, Cơ quan nhà nước…) đã khảo sát, có sẵn trong
  `ALL_CUSTOMER_TYPES` (`src/sop/customer.js`) nhưng đang tắt – để phát triển sau.
- Lên đơn **Doanh nghiệp**: tool tự nhập form (Tên, MST, Ngày cấp, Nơi cấp, Ngày thành lập, Địa chỉ GPKD, SĐT tổ chức,
  SĐT liên hệ, Người đại diện) → Xác nhận & Lưu. Giao diện điền sẵn dữ liệu test (MST ngẫu nhiên hợp lệ, SĐT/người đại diện
  theo KH, địa chỉ GPKD theo địa chỉ lắp), sửa ô nào giữ ô đó; nút ↻ MST mới, ↺ Điền lại mặc định.
- CLI: `--customer-type "Doanh nghiệp"` + `--company --tax-code --representative --org-phone --contact-phone --email --issue-place --gpkd-address`;
  `--customer-types` xem danh sách.

**Rule mới trên stag (đã xử lý)**
- Mở Bán mới hiện "Cảnh báo!!! (0xb462392144) còn phiếu chưa nhập cọc / chưa xác nhận OTP" [Hủy | Xác nhận] → tự Xác nhận đi tiếp.
- Tìm địa chỉ báo "Không có kết quả phù hợp" [Nhập thủ công | Thử lại] → Thử lại + bấm Tìm kiếm lại (tối đa 4 lần).
- Form địa chỉ còn loading → chờ hết API đang chạy rồi mới gõ; kẹt thì báo tên API treo.
- `order/validate` chặn (vd SĐT đã có FPT Play) → báo kèm **Lý do** của portal (`Data.Result.Reason`).
- Mã đơn dạng mới `HCMUO…` → nhận cả dạng cũ/mới (5 chữ + 4 số + 3 ký tự).
- Trang đăng nhập đổi nút Login (`type="Login"`, không còn `submit`) → tìm nút theo chữ, không thấy thì Enter.
- Lưu khảo sát Định danh KH lỗi (API `update-contract-identify` quá giờ, HĐ đã tạo) → tự gửi lại 2 lần; vẫn lỗi thì báo "Đã tạo HĐ …".

**Tốc độ** (đơn DN ~174s → ~110s, Cá nhân ~96s; phần còn lại chủ yếu chờ backend stag)
- Chỉ ép dựng lại cây semantics Flutter khi cần (trước: mỗi lần tìm ô mất ~1,8s).
- Gõ 25ms/ký tự + chờ giá trị khớp (rớt ký tự thì gõ lại chậm); chọn ngày chờ hộp hiện thay vì chờ cố định.
- Tạo báo giá / HĐ kiểm tra mỗi 1,5s (trước 4s / 3s); hộp chỉ có [Xác nhận] phải thấy 2 lần liên tiếp mới tính là lỗi.
- Rút các chờ cố định ở bước địa chỉ.
- Ô PTTT tìm theo vị trí node (ô chọn thứ 2), không bấm toạ độ cứng – vị trí đổi theo đối tượng KH.

**Giao diện**
- Bố cục mới: 4 khối xếp ngang (Khách hàng & địa chỉ · Gói cước · Đối tượng KH · Thanh toán & chạy), Kết quả + Lịch sử ở dưới.
- Kết quả hiện Đối tượng + Doanh nghiệp/MST (lưu trong `output/orders.jsonl`; `orders.csv` giữ cột cũ).

**Chẩn đoán**
- `SOP_API_TRACE=1`: ghi request/response giai đoạn báo giá (che token) → `output/debug/<runId>-api-trace.jsonl`.
- `SOP_API_TIMING=1`: ghi thời gian từng API → `output/debug/<runId>-api-timing.json`.
- Script khảo sát mới: `khao-sat/doi-tuong.mjs`, `form-dn.mjs`, `radio.mjs`, `test-dn.mjs`, `peek-login2.mjs`.

## v0.3.0 – 2026-10-30
- Dịch vụ khác qua menu header (Truyền hình, Camera, Tốc độ & Wi-Fi, Dịch vụ khác): form dịch vụ + giỏ hàng, mua kèm combo Internet.

## v0.2.0 – 2026-10-26
- Chạy ngầm / hiện cửa sổ Chrome; gói lấy từ API `package-view/list` (nhóm + thứ tự); DS SĐT từ "Khách hàng của tôi";
  tự điền Số nhà + Toạ độ; bỏ đơn nháp; thử lại khi "Thời gian phản hồi quá lâu".

## v0.1.0 – 2026-10-23
- Luồng đầu tiên: KH có sẵn → Bán mới → địa chỉ (tìm bản đồ) → combo Internet → PTTT → Tạo báo giá → Tạo HĐ + khảo sát Định danh.
