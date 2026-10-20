# Hướng dẫn cài đặt FTMS Data Tool

Tool hỗ trợ QC tạo nhanh dữ liệu test trên FTMS stag (tạo cơ hội → duyệt → khảo sát LeasedLine → yêu cầu HĐ → BGĐ duyệt HĐ).

## 1. Yêu cầu máy

| Hạng mục | Yêu cầu |
|---|---|
| Hệ điều hành | Ubuntu / Linux **64-bit (x64)** |
| Trình duyệt | **Google Chrome** hoặc **Microsoft Edge** đã cài (dùng để đăng nhập SSO) |
| Node.js | **Không cần**: gói cài đã kèm sẵn |
| Mạng | Truy cập được `ftms-stag.fpt.net` (thường không cần VPN) |
| Tài khoản | Tài khoản FTMS + **mã OTP dùng chung** (hỏi người phụ trách tool) |

File cài đặt có tên dạng `ftms-data-tool-<phiên bản>-linux-x64.tar.gz` (khoảng 46MB). File này để ở thư mục nào cũng được: Downloads, Desktop, USB…

## 2. Cài đặt bằng 1 lệnh (khuyến nghị)

Mở **Terminal** (`Ctrl + Alt + T`), dán nguyên lệnh dưới đây rồi nhấn Enter:

```bash
F=$(find ~ /media /mnt -name 'ftms-data-tool-*-linux-x64.tar.gz' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-); if [ -n "$F" ]; then echo "→ Cài từ: $F"; bash ~/ftms-data-tool/scripts/launch-ui.sh stop 2>/dev/null; tar -xzf "$F" -C ~ && bash ~/ftms-data-tool/install.sh; else echo "✖ Không tìm thấy file ftms-data-tool-*-linux-x64.tar.gz"; fi
```

Lệnh này làm các việc sau:
1. Tự tìm file cài đặt **mới nhất** trong thư mục cá nhân (`~`) và ổ USB (`/media`, `/mnt`), nên không cần biết file đang nằm ở đâu.
2. Tắt tool cũ nếu đang chạy.
3. Giải nén vào **`~/ftms-data-tool`**. Đây là vị trí cố định, mọi máy đều giống nhau.
4. Tạo icon **FTMS Data Tool** trên Desktop và trong menu ứng dụng, rồi mở tool trên trình duyệt.

> Dòng `→ Cài từ: ...` cho biết lệnh đang dùng file nào. Nếu đó không phải phiên bản bạn muốn cài, dùng cách 3.

## 3. Cài đặt thủ công (khi đã biết file ở đâu)

Cách 1: dùng giao diện. Mở thư mục chứa file `.tar.gz`, chuột phải vào chỗ trống → **Open in Terminal**, rồi chạy:

```bash
tar -xzf ftms-data-tool-*-linux-x64.tar.gz -C ~ && bash ~/ftms-data-tool/install.sh
```

Cách 2: chỉ rõ đường dẫn file (thay đường dẫn cho đúng):

```bash
tar -xzf /duong/dan/toi/ftms-data-tool-1.5.0-linux-x64.tar.gz -C ~ && bash ~/ftms-data-tool/install.sh
```

## 4. Lần đầu sử dụng

1. Trình duyệt tự mở `http://localhost:3000`.
2. Trên header hiện ô **OTP**: nhập OTP dùng chung rồi lưu. Việc này chỉ làm 1 lần; OTP được lưu ở `~/ftms-data-tool/.env`.
3. Nhập tên tài khoản (vd `giangdc2`, không cần `@fpt.com`) → **Đăng nhập**. Khi chấm xanh và tên hiện lên là đăng nhập thành công.
4. Từ các lần sau, bấm đúp icon **FTMS Data Tool** trên Desktop hoặc tìm "FTMS" trong menu ứng dụng.

> Lần đầu bấm icon trên Desktop, Ubuntu có thể hỏi. Chọn **Allow Launching** (hoặc chuột phải icon → *Allow Launching*).

## 5. Kiểm tra cài đặt thành công

| # | Kiểm tra | Mong đợi |
|---|---|---|
| 1 | Terminal sau khi cài | Có dòng `✔ Cài đặt xong` |
| 2 | Desktop / menu ứng dụng | Có icon **FTMS Data Tool** |
| 3 | Trình duyệt | Mở được `http://localhost:3000` |
| 4 | Đăng nhập | Chấm xanh và tên tài khoản hiện trên header, thấy đủ các tab chức năng |
| 5 | Tạo thử 1 cơ hội | Bảng Kết quả hiện mã `CH000…` |
| 6 | Tắt / mở lại | Chuột phải icon → *Tắt FTMS Data Tool*, sau đó bấm đúp icon mở lại được |

## 6. Cập nhật lên phiên bản mới

Chạy lại **đúng lệnh ở mục 2** (hoặc mục 3) với file phiên bản mới. Bản mới được giải nén đè lên `~/ftms-data-tool`:
- **OTP (`.env`), phiên đăng nhập và lịch sử dữ liệu (`output/`) được giữ nguyên**, nên không phải nhập lại.
- Sau khi cập nhật, tải lại trang (F5) để thấy giao diện mới.

## 7. Gỡ cài đặt

```bash
bash ~/ftms-data-tool/scripts/launch-ui.sh stop
rm -f ~/Desktop/ftms-data-tool.desktop ~/.local/share/applications/ftms-data-tool.desktop
rm -rf ~/ftms-data-tool
```

> Lệnh cuối xóa luôn OTP và lịch sử dữ liệu đã tạo (`~/ftms-data-tool/output/*.csv`). Nếu cần giữ lại thì sao lưu trước.

## 8. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| `✖ Không tìm thấy file ...` | File chưa tải xong hoặc nằm ngoài thư mục cá nhân. Dùng cách 2 ở mục 3 |
| `⚠ Không thấy Google Chrome / Microsoft Edge` | Cài Chrome: `https://www.google.com/chrome/` rồi cài lại |
| Bấm icon không thấy gì | Xem log: `cat ~/ftms-data-tool/output/ui-server.log` |
| Cổng 3000 đã bị phần mềm khác dùng | Thêm dòng `UI_PORT=3010` vào `~/ftms-data-tool/.env`, tắt rồi mở lại tool, truy cập `http://localhost:3010` |
| Đăng nhập báo sai tài khoản / OTP | Kiểm tra lại tên tk; đổi OTP qua nút **Đổi OTP** trên header |
| Đăng nhập bị treo / quá thời gian | Kiểm tra mạng tới `https://ftms-stag.fpt.net`; xem ảnh lỗi trong `~/ftms-data-tool/output/debug/` |
| Máy không phải Linux x64 (Windows, macOS, ARM) | Gói hiện tại chưa hỗ trợ, liên hệ người phụ trách tool |

Khi cần hỗ trợ, gửi kèm file `~/ftms-data-tool/output/ui-server.log`.
