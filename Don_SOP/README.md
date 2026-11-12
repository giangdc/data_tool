# Đơn SOP Order Tool

Tool hỗ trợ QC tạo nhanh đơn hàng test: Desktop gọi thẳng API Sale Platform (cùng khuôn với `../Tao_DH`); Mobile điều khiển app SOP trên **điện thoại Android thật cắm qua USB** (adb).
Cổng giao diện: **3008**.

> Đang khảo sát – xem `khao-sat/KHAO_SAT.md`.

## Thư mục
| Thư mục | Dùng để |
|---|---|
| `khao-sat/` | Ghi chép khảo sát; `capture/` traffic bắt được, `screens/` ảnh chụp app |
| `config/` | Cấu hình môi trường (URL API staging) |
| `src/core/` | HTTP, proxy, lưu kết quả |
| `src/app/` | Gọi API của app: đăng nhập, tạo đơn |
| `public/` | Giao diện web (1 file `index.html`) |
| `scripts/` | Cài icon Desktop, đóng gói |
| `assets/` | Icon |
| `output/` | Kết quả đơn đã tạo (`orders.csv`, `orders.jsonl`) |

## Tạo đơn Mobile
Không cần file APK. Chỉ cần:
1. Điện thoại Android đã cài sẵn app SOP (bản staging) và đăng nhập.
2. Bật **Tuỳ chọn nhà phát triển → Gỡ lỗi USB**, cắm cáp vào máy, bấm **Cho phép** khi máy hỏi.
3. Kiểm tra `adb devices` thấy thiết bị ở trạng thái `device`.
