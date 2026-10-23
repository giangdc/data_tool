# Bill Detail Tool – tra cứu chi tiết hóa đơn

Thay màn **Quản lý Kế toán > Liệt kê cước** trên `inside.fpt.net` (hay timeout) bằng cách gọi thẳng API `mvc.inside.fpt.net`:

**Nhập số hợp đồng → danh sách hóa đơn → bấm 1 hóa đơn → chi tiết hóa đơn** (đủ trường như inside: header, bảng Chi tiết,
Thông tin chi tiết loại dịch vụ, Chi tiết dịch vụ Telecom).

## Cài đặt & chạy

```bash
cd Bill_Detail
npm install
npm run ui            # mở http://localhost:3003
# hoặc: bash install.sh  (tạo icon Desktop/menu + mở giao diện)
```

Tài khoản inside: lần đầu mở tool, giao diện hiện ô **Tài khoản / Mật khẩu / OTP (nếu có)** → **Lưu & đăng nhập**.
Tool lưu vào `.env` của máy này (quyền 600), lần sau mở tự đăng nhập. Đổi tài khoản/mật khẩu: link **Đổi tài khoản**
(để trống mật khẩu/OTP = giữ nguyên). Vẫn sửa tay được trong `.env`: `INSIDE_USER`, `INSIDE_PASSWORD`, `INSIDE_OTP`.

Không cần trình duyệt: tool đăng nhập bằng form tài khoản + mật khẩu của `login-stag.fpt.net` (không qua IAM).

## Dùng giao diện

1. Mở tool là tự đăng nhập bằng tài khoản đã lưu (hoặc bấm **Đăng nhập** / cứ tra cứu luôn – chưa có phiên thì tool tự đăng nhập). Phiên lưu trong `.cache/`;
   phiên hết hạn thì tool tự đăng nhập lại bằng tài khoản trong `.env`. Sửa `.env` không cần khởi động lại tool.
2. Nhập **Số hợp đồng**, chọn **Năm** (khuyên chọn năm cụ thể: ~0.5s; "Toàn bộ" với HĐ nhiều hóa đơn mất ~15s) → **Tra cứu**.
3. Bấm 1 dòng hóa đơn → khung **Chi tiết hóa đơn** hiện bên dưới; **Mở tab mới** để xem/in riêng.

Bảng hóa đơn: bấm tiêu đề cột để sắp xếp, ô **Lọc** để tìm theo số HĐ / nội dung / NV bán. HĐ đã hủy bị gạch ngang và
không tính vào tổng. Danh sách được nhớ 10 phút, **Tải lại** để lấy mới.

## Dòng lệnh

```bash
npm run login
npm run bills  -- SGH835870 --year 2024
npm run detail -- SGH835870 U24SG00103292 --year 2024   # lưu output/bill-<số HĐ>.html
node src/cli.js logout
```

## Cách hoạt động

| Bước | API (`http://mvc.inside.fpt.net`) | Ghi chú |
|---|---|---|
| Đăng nhập | `POST http://login-stag.fpt.net/Login` `UserName, Password, OTP, IAM=false, urlReturn` → `{status:1, token}`, rồi `GET BillHistoryNew?Token=<token>` | nhận cookie phiên mvc.inside |
| Tìm HĐ | `POST /InternetSubs/Accounting/LayoutSearch20/onLS_ViewReport` `LocationID, Search=4, KeywordSup=1, Keyword` | trả `ID` = ObjID |
| Danh sách | `GET /InternetSubs/Accounting/BillHistoryNew/LoadReport?vID&QMont&QYear&IsSSTCus=0` | JSON; chậm khi QYear=0 |
| Chi tiết | `GET /InternetSubs/Accounting/LayoutSearch20/GetPartialPublicDetail?BillNumber&ObjID&Month&Year` | HTML, tool bỏ script rồi hiển thị |

Chi tiết khảo sát: [`khao-sat/KHAO_SAT.md`](khao-sat/KHAO_SAT.md).

## Bảo mật

- `.env` (mật khẩu) và `.cache/` (cookie phiên) đều quyền 600 – **không commit, không gửi cho người khác**. Đăng xuất = xóa file phiên.
- Dữ liệu hóa đơn có thông tin khách hàng → chỉ dùng nội bộ. Server chỉ nghe `127.0.0.1`.
