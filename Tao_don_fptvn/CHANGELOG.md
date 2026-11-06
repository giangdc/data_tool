# Lịch sử cập nhật – FPT.vn Order Tool

Quy ước: tính năng mới → tăng số giữa (1.8.0 → 1.9.0), sửa lỗi → tăng số cuối (1.9.0 → 1.9.1). Mỗi lần cập nhật: sửa `version` trong `package.json` + thêm mục mới lên đầu file này.

## 1.10.1 – 2026-11-06
- **Đổi tên thư mục tool** `Tao_DH` → **`Tao_don_fptvn`** (trên máy + repo `data_tool`). Icon Desktop / menu đã cài lại theo đường dẫn mới; tool Thanh_toan đọc thẻ test từ `../Tao_don_fptvn/.env`.

## 1.10.0 – 2026-11-06
- Nút **＋ Thêm gói** (cạnh ô Chọn gói ở tab Tạo đơn hàng và ở tab Tạo đơn hàng loạt): nhập **Link**, **Tên nhóm** (chọn nhóm có sẵn hoặc gõ nhóm mới), **Tên trang** (để trống = tự lấy tên gói).
- Tool **kiểm tra link là gói có thật** (ECP / FCP / Shop) rồi ghi vào cuối file danh sách (`data/listgoi.csv`); gói mới **hiện ngay** trong ô Chọn gói (tự chọn + tải gói) và bảng Tạo đơn hàng loạt (tick sẵn).
- Báo lỗi khi link đã có trong danh sách / sai môi trường. Không kiểm tra được gói (không có gói hoặc staging lỗi) thì có nút **Vẫn thêm**.

## 1.9.0 – 2026-11-06
- Header hiện **phiên bản hiện tại** của tool (đọc từ `package.json`), bấm vào để xem **Lịch sử cập nhật** (file `CHANGELOG.md`).
- Thêm file `CHANGELOG.md` ghi lại toàn bộ các lần cập nhật; đóng gói kèm bản build.

## 1.8.0 – 2026-11-06
- **Danh sách gói** `data/listgoi.csv` (35 link màn hình chi tiết, đã sửa lỗi font → UTF-8): ô **Chọn gói từ danh sách** ở tab Tạo đơn hàng, chọn là tự tải gói; vẫn tự nhập link được.
- **Tab mới "Tạo đơn hàng loạt"**: tạo đơn tất cả link trong danh sách, **chạy song song** (mặc định 10, tối đa 50), dòng lỗi bỏ qua và ghi lý do. PTTT mặc định *Thanh toán tại nhà nếu gói có*. Trùng SĐT tài khoản FPT Play thì tự thử SĐT ngẫu nhiên.
- **File kết quả** `output/batch/<file>-<thời gian>.csv`: cột gốc + Kết quả (Thành công/Lỗi), **Mã đơn**, **Số hợp đồng**, Order ID, Nguồn, PTTT, Trạng thái, Tổng tiền, Lỗi. Nút ⬇ Tải file kết quả; CLI `npm run batch`.
- **Nguồn thứ 3: Shop selfservice** (vd `combo-internet-lux800-vvip`, link `/shop/.../register/...`): chọn gói trả sau / trả trước, tạo đơn COD / VietQR / online, xem trạng thái + tiến trình đơn ở Chi tiết.
- Chi tiết đơn có thêm **Số hợp đồng** (staging chưa trả lúc tạo đơn – có sau bước ký hợp đồng điện tử) và **nguồn** của gói.

## 1.7.0 – 2026-10-22
- **Gói catalog mới FCP** (vd `/internet/PRD_NET_001`, `PRD_NET_003`): tool tự nhận diện và đi luồng v2. Thông tin sản phẩm = trả sau / trả trước N tháng.

## 1.6.0 – 2026-10-20
- **Gói thiết bị / camera** (vd `/camera/combo-2-camera-fcam-play-4-iq-4s`): Thông tin sản phẩm = chu kỳ gói lưu trữ (1/6/12 tháng).
- Nhóm **Hình thức lắp đặt**: *Hỗ trợ lắp đặt* (mặc định, tính phí triển khai) / *Tôi muốn tự lắp đặt* (giao hàng, không có Thanh toán tại nhà).

## 1.5.0 – 2026-10-19
- **Nhiều thẻ test** (`CARD_<PTTT>_NUMBER2..5`): thẻ trước bị từ chối thì tự thử thẻ sau trên link thanh toán mới.
- **Đổi PTTT & thanh toán lại** đơn còn chờ thanh toán (chỉ PTTT online, cùng mã đơn, link/QR mới) – UI + CLI `repay`.

## 1.4.0 – 2026-10-19
- **Tự thanh toán bằng thẻ test** (Thẻ tín dụng / Thẻ ATM): tool mở Chrome, tự nhập thẻ + OTP, chờ cổng báo kết quả. Nút 💳 Tự thanh toán; CLI `create --pay`, `pay <mã>`.
- Kết quả lưu `output/payments.csv`; staging chưa cập nhật trạng thái thì hiện "Đã thanh toán (cổng) · ECP chưa cập nhật".

## 1.3.1 – 2026-10-17
- Chung cư: **Tên chung cư mặc định "Tòa nhà VP 55 Nam Kỳ Khởi Nghĩa"**; phường không có thì "Nơi khác".

## 1.3.0 – 2026-10-17
- **Tự tải gói mặc định** `/internet/goi-giga` khi mở tool; nút **☆ Đặt mặc định** cho SĐT + link gói.
- Màn Tạo đơn chia **3 bước xếp ngang** (Thông tin khách hàng · Thông tin sản phẩm · Thanh toán); bảng Kết quả dời xuống cuối.

## 1.2.0 – 2026-10-16
- Chung cư: **Tòa nhà / Số tầng / Số phòng điền ngẫu nhiên**, nút 🎲 sinh lại; tạo xong tự đổi căn hộ mới.

## 1.1.1 – 2026-10-16
- Sửa lỗi `fetch failed` khi tải gói trên mạng công ty: tool tự đi qua proxy (`ECP_PROXY` → proxy hệ thống GNOME → `HTTPS_PROXY`).

## 1.1.0 – 2026-10-16
- **Nhà riêng / Chung cư**, **kiểm tra chính sách** theo địa chỉ (báo đỏ + khóa Tạo đơn).
- **Thông tin sản phẩm** (trả sau / trả trước N tháng) + **Dịch vụ/Thiết bị bổ sung**; PTTT và giá tính lại theo lựa chọn.
- Sửa: lỗi nghiệp vụ ECP bị hiện như thành công. Icon desktop.

## 1.0.0 – 2026-10-16
- Phiên bản đầu: tải gói từ link, form mặc định (SĐT, địa chỉ Hồ Chí Minh), tạo đơn qua API ECP.
- Thanh toán: COD xong ngay / thẻ = mở cổng thanh toán / VietQR hiện QR.
- Bảng Kết quả (Lần này / Lịch sử), màn hình Chi tiết, tab Xem đơn hàng, CLI.
