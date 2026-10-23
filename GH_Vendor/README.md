# GH Vendor Tool – Giao hàng NCU

Chạy nhanh luồng **cập nhật tình trạng phiếu giao hàng NCU** trên Fox ERP, thay cho việc bấm tay từng popup:

| Bước | Màn | Tool làm gì |
|---|---|---|
| 1 | Fox ERP – portal | Mở ứng dụng **Quản lý NCU** (app Vendor) |
| 2 | **Giao hàng, triển khai NCU** → tab **Quản lý phiếu giao hàng** | Chờ danh sách tải (1-2 phút), để 100 dòng/trang, tìm phiếu theo **mã đơn hàng FTEL** (hoặc Mã PGH / Mã PO NCU) |
| 3 | Dấu tích xanh cột **Giao hàng** | **Chưa giao hàng → Đang giao hàng** → Xác nhận → popup **Xác nhận giao hàng**: Hoá đơn NCU, Ngày HĐ NCU, tệp **Hoá đơn điện tử**, Hoá đơn FTEL, Tình trạng = Đang giao hàng → Xác nhận ("Cập nhật thành công") |
| 4 | Dấu tích xanh lần nữa | **Đang giao hàng → Đã hoàn tất** → Xác nhận (nút tích chuyển xám = khoá) |

Kết quả (Mã PGH, NCU, PO, tình trạng trước/sau, hoá đơn) hiện trên giao diện và lưu ở `output/runs.csv`.

## Cài đặt & chạy

```bash
cd GH_Vendor
npm install
npm run ui            # mở http://localhost:3005
# hoặc: bash install.sh  (cài thư viện + tạo icon Desktop/menu + mở giao diện)
```

Cần **Google Chrome** (hoặc Edge) trên máy: tool điều khiển 1 cửa sổ trình duyệt riêng (profile lưu ở `.cache/browser-profile`).

## Dùng giao diện

1. Lần đầu: bấm **Fox ERP** trên thanh trên cùng để mở Fox ERP trong cửa sổ trình duyệt của tool và **đăng nhập**
   (phiên được nhớ). Không đăng nhập trước cũng được: tool dừng chờ bạn đăng nhập (tối đa `LOGIN_WAIT_MIN` phút).
2. Nhập **Mã đơn hàng FTEL** (nhiều mã cách nhau dấu phẩy / xuống dòng), chọn **Chạy tới** (Đang giao hàng / Đã hoàn tất) → **Chạy**.
3. Tuỳ chọn **Hoá đơn**: số HĐ NCU / FTEL (`{code}` = mã đơn hàng), ngày HĐ (trống = hôm nay), tệp hoá đơn
   (không chọn thì tool tự tạo file PDF test trong `output/invoices/`).

- **Chạy lại cùng mã** sẽ tiếp tục từ tình trạng hiện tại (đã Đang giao hàng thì chỉ làm bước Đã hoàn tất; đã hoàn tất thì không làm gì).
- Nhiều mã: chạy lần lượt, mã lỗi không chặn mã sau.

## Dòng lệnh

```bash
node src/cli.js run SGK29694608                         # tới Đã hoàn tất
node src/cli.js run SGK29694608 --until shipping        # chỉ tới Đang giao hàng
node src/cli.js run SGK1,SGK2 --invoice HD001 --date 23-10-2026 --file ~/hoa-don.pdf
```

## Cấu hình (`.env`, tạo từ `.env.example`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `ERP_USER/PASSWORD` | trống | Điền thì tool tự đăng nhập; trống thì chờ đăng nhập tay |
| `INVOICE_NCU`, `INVOICE_FTEL` | `HDNCU-{code}`, `HDFTEL-{code}` | Số hoá đơn điền vào popup Xác nhận giao hàng |
| `INVOICE_FILE` | trống | Tệp hoá đơn điện tử; trống = tự tạo PDF test |
| `LIST_WAIT_SEC` | 240 | Chờ danh sách phiếu giao hàng tải xong |
| `CONFIRM_DELAY_SEC` | 5 | Chờ sau khi chọn tình trạng rồi mới bấm Xác nhận |
| `MAX_PAGES` | 5 | Số trang (100 dòng) tối đa lật để tìm phiếu |
| `CDP_URL` | trống | Gắn vào Chrome đang mở sẵn (`google-chrome --remote-debugging-port=9222` → `http://127.0.0.1:9222`) |

## Cách hoạt động / lưu ý kỹ thuật

- App Vendor (`/vendor/vendor-cooperation/`) là **Blazor Server + MudBlazor** (không có REST API) → điều khiển UI qua
  Playwright. App cần `SessionCode` do portal cấp nên tool luôn đi từ trang chủ portal → ô **Quản lý NCU**.
- Danh sách phiếu giao hàng **tải rất chậm** và hay đứng ở `1-0 of 0` → tool chuyển sang tab khác rồi quay lại để tải lại.
  Sau khi cập nhật, danh sách cũng không tự làm mới đúng lúc → tool đọc lại tới khi thấy tình trạng mới.
- **Bấm Xác nhận quá sớm** sau khi chọn tình trạng thì hệ thống **bỏ qua, không báo gì** (popup đóng, phiếu không đổi) →
  tool chờ `CONFIRM_DELAY_SEC` rồi mới bấm, đọc lại danh sách; chưa đổi thì làm lại (tối đa 3 lần). Bước Đang giao hàng
  đã báo "Cập nhật thành công" thì **không** bấm lại (tránh gửi hoá đơn 2 lần).
- Lọc của tab Quản lý phiếu giao hàng chỉ có Mã vận chuyển / Tình trạng / NCU → tool tìm phiếu bằng cách đọc danh sách
  (phiếu mới ở đầu). Tab **Quản lý đơn đặt hàng** (dấu tích "Xác nhận đặt hàng") là bước khác, tool không đụng tới.
- Lỗi giữa chừng: ảnh chụp màn hình ở `output/debug/`, nhật ký server ở `output/ui-server.log`.
- Chi tiết khảo sát: [`khao-sat/KHAO_SAT.md`](khao-sat/KHAO_SAT.md).

## Bảo mật

- `.env` (mật khẩu) và `.cache/` (phiên đăng nhập của trình duyệt) **không commit, không gửi cho người khác**.
- Chỉ dùng cho môi trường staging/UAT; server chỉ nghe `127.0.0.1`.
