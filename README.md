# Data Tool – bộ tool hỗ trợ QC tạo dữ liệu test

Tập hợp các tool nhỏ giúp QC tạo nhanh dữ liệu test trên môi trường **staging/dev** của các hệ thống FPT, thay cho việc thao tác tay từng bước trên web.
Mỗi tool nằm trong 1 thư mục riêng, có README hướng dẫn chi tiết.

## Danh sách tool

| Tool | Thư mục | Hệ thống | Tool làm gì | Cổng UI | Trạng thái |
|---|---|---|---|---|---|
| **FTMS Data Tool** | [`bms/`](bms/README.md) | FTMS stag (BMS + SM) | Tạo cơ hội → Duyệt cơ hội → (Khảo sát LeasedLine) → Tạo yêu cầu HĐ → BGĐ duyệt YC HĐ | 3000 | v1.5.0 |
| **FPT.vn Order Tool** | [`Tao_DH/`](Tao_DH/README.md) | staging.fpt.vn | Nhập link gói → tạo đơn hàng → thanh toán (tại nhà / thẻ test / VietQR) → xem đơn | 3001 | v1.5.0 |
| **FPT Play Order Tool** | [`FPL/`](FPL/README.md) | dev.fptplay.vn | Nhập link gói → đăng nhập OTP mặc định → tạo giao dịch → tự thanh toán thẻ test → xem gói trên tài khoản | 3002 | v1.0.0 |
| **CRM Data Tool** | [`CRM/`](CRM/) | crm-stag.fpt.net | Tạo cơ hội (theo cơ hội mẫu) → Báo giá → Đánh dấu version → Tạo đơn hàng | 3002 | v1.0.0 (đang phát triển) |
| **Tra cứu chi tiết hóa đơn** | [`Bill_Detail/`](Bill_Detail/NOTES.md) | inside.fpt.net (Liệt kê cước) | Nhập số hợp đồng → danh sách hóa đơn → chi tiết hóa đơn (gọi thẳng API, tránh timeout của inside) | – | Đang khảo sát |

> FPL và CRM cùng mặc định cổng **3002** – muốn chạy song song thì đổi `UI_PORT` trong `.env` của một tool.

## Điểm chung

- **Node.js >= 20.12**, Node thuần (gần như không có thư viện ngoài), chạy trên Ubuntu / Linux x64.
- Mỗi tool có 2 cách dùng:
  - **Giao diện web** chạy trên máy: `npm run ui` → mở `http://localhost:<cổng>`.
  - **Dòng lệnh (CLI)**: `npm run <lệnh> -- <tham số>` (xem README từng tool).
- `bash install.sh` trong thư mục tool: cài đặt + tạo icon trên Desktop/menu ứng dụng (Ubuntu/GNOME) + mở giao diện.
- `npm run build` đóng gói `.tar.gz` kèm sẵn Node cho máy không cài được Node.
- Cấu hình nằm trong `.env` (tạo từ `.env.example`): OTP, thẻ test, proxy, cổng UI…
- Dữ liệu tạo ra lưu ở `output/` (`*.csv` mở bằng Excel + `*.jsonl`); phiên đăng nhập/token lưu ở `.cache/`.
- Thư mục `khao-sat/` chứa ghi chú khảo sát luồng nghiệp vụ + API của hệ thống đích.

## Bắt đầu nhanh

```bash
cd <thư mục tool>
cp .env.example .env      # điền OTP / thẻ test nếu tool cần
bash install.sh           # hoặc: npm install && npm run ui
```

## Bảo mật

- **Không commit** `.env`, `.cache/`, `output/`: chứa OTP, thẻ test, token đăng nhập và dữ liệu khách hàng test.
- Tool chỉ dùng cho môi trường **staging/dev**, dữ liệu chỉ dùng nội bộ.
