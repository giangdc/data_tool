# Khảo sát luồng GH_Vendor

Môi trường: staging (Fox ERP / SCM / GHTK lab – giống GH_quay). Ghi lại từng bước khi thao tác cùng QC.

| # | Hệ thống | Thao tác | Kết quả / ghi chú kỹ thuật |
|---|---|---|---|
| 1 | Fox ERP | Trang chủ → ứng dụng **Quản lý NCU** | Mở `/vendor/vendor-cooperation/` (app FTEL.VENDOR, cùng tab, Blazor + **MudBlazor**: `.mud-tab`, `.mud-popover-open`, `.mud-dialog`). Tải rất chậm (10-20s); bấm menu đôi khi chỉ đổi URL mà nội dung không đổi → reload trang. |
| 2 | Fox ERP | Menu **Giao hàng, triển khai NCU** | URL `/vendor/vendor-cooperation/ordering-delivery-management`. 3 tab: *Quản lý đơn đặt hàng* (dashboard + Danh sách đơn hàng NCU), *Quản lý phiếu giao hàng* (lọc theo Mã vận chuyển / Tình trạng / NCU), *Quản lý tiến độ triển khai*. Danh sách mặc định rỗng. |
| 3 | Fox ERP | Tab **Quản lý đơn đặt hàng** → nút **Lọc** (cái đầu) → ô **Hợp đồng/Mã giao dịch** = `SGK29694608` → **Áp dụng** | Nút Áp dụng hiện "Processing" ~1-2 phút. Kết quả 1 dòng: NCU Casper, SALECLUB, HCM_KDDA, HĐ **SGABP5142**, chính sách "SOP Bán TV lẻ - 03/09", Tivi Casper E32HAC110 x1, 3.378.531 ₫, VNPay-QR, Mã đơn đặt hàng NCU = SGK29694608, Tình trạng đặt hàng **Đã đặt hàng**. Cột cuối **Đặt hàng** = nút dấu tích (td thứ 31). |
| 4 | Fox ERP | Bấm **dấu tích** (cột Đặt hàng) | Mở popup **Xác nhận đặt hàng**: Mã ĐH FTEL, Số HĐ, Địa chỉ, SĐT (chỉ đọc); **Mã PO NCU(\*)** điền sẵn = mã ĐH; **Tình trạng đặt hàng** (dropdown, đang "Không chọn"); nút **Xác nhận** / **Đóng**. |

> Bước 3-4 ở trên là **nhầm tab** (đã bấm Đóng, KHÔNG xác nhận). Luồng đúng làm ở tab *Quản lý phiếu giao hàng*:

| # | Hệ thống | Thao tác | Kết quả / ghi chú kỹ thuật |
|---|---|---|---|
| 3' | Fox ERP | Tab **Quản lý phiếu giao hàng** (không cần lọc: 434 phiếu, mới nhất ở đầu) | Dòng: NCU CASPER, Mã ĐH FTEL "SGK29694608 CASPER", **Mã PO NCU HCMSF0026TIR**, **Mã PGH `<><23102026-38>`**, KH qc test, ngày 23/10/2026, Tình trạng giao hàng **Chưa giao hàng**, Acc tạo qc.hattt65. Cột cuối **Giao hàng** = nút dấu tích xanh (td thứ 11). Bộ lọc chỉ có Mã vận chuyển / Tình trạng giao hàng / NCU (không lọc được theo mã ĐH) → tìm dòng theo text. |
| 4' | Fox ERP | Bấm **dấu tích xanh** cột Giao hàng | Popup **Cập nhật tình trạng phiếu giao hàng**: NCU, Mã ĐH FTEL, Mã PGH, Thông tin KH (chỉ đọc); **Tình trạng giao hàng (\*)** (mud-select: Bỏ chọn / **Đang giao hàng** / Đã huỷ); nút Xác nhận / Đóng. |
| 5 | Fox ERP | Tình trạng giao hàng = **Đang giao hàng** | Giá trị option = `1`. Chưa bấm Xác nhận. |
| 6 | Fox ERP | Popup cập nhật → **Xác nhận** | Lần 1: popup đóng, KHÔNG có thông báo, phiếu vẫn *Chưa giao hàng* (không lưu). Lần 2 (chờ ~3s sau khi chọn trạng thái rồi mới bấm): mở popup thứ 2 **Xác nhận giao hàng**. |
| 7 | Fox ERP | Popup **Xác nhận giao hàng** | Chỉ đọc: NCU, Mã S/O FTEL, Số HĐ NCU (01/TTHT/CASPER-FTEL), Địa chỉ lấy/giao, SĐT, Mã PO NCU, Tình trạng đặt hàng, Mã vận đơn (= Mã PGH). Nhập: **Hóa đơn NCU (\*)** (`input[placeholder="Nhập Hóa đơn NCU"]`), **Ngày HD NCU (\*)** (date picker dd-MM-yyyy, mặc định hôm nay), **Hóa đơn điện tử (\*)** (MudFileUpload `input[type=file]` hidden multiple → hiện chip), Hóa đơn FTEL (text, không bắt buộc), Tình trạng giao hàng (Bỏ chọn / Đang giao hàng). Đã điền test: HDNCU-SGK29694608, 23-10-2026, hoa-don-test.pdf, HDFTEL-SGK29694608, Đang giao hàng. |
| 8 | Fox ERP | Popup Xác nhận giao hàng → **Xác nhận** | Snackbar **"Cập nhật thành công"**, popup đóng. Sau ~18s danh sách: phiếu `<><23102026-38>` → **Đang giao hàng**. |
| 9 | Fox ERP | Dấu tích Giao hàng lần nữa → Tình trạng giao hàng (lúc này chỉ có Bỏ chọn / **Đã hoàn tất**, value `2`) → **Xác nhận** | KHÔNG có popup thứ 2, KHÔNG có snackbar; popup đóng ngay. Lần 1 không lưu (sau ~45s vẫn Đang giao hàng). Lần 2 (chờ 6s sau khi chọn rồi mới bấm) → phiếu **Đã hoàn tất**. ⇒ Tool phải: chọn trạng thái, chờ vài giây, bấm Xác nhận, rồi đọc lại danh sách để kiểm tra; chưa đổi thì làm lại. |
