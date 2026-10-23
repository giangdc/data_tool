# GH quầy Tool – Giao hàng tại quầy

Chạy nhanh luồng **Giao hàng tại quầy** qua 3 hệ thống, thay cho việc bấm tay từng màn:

| Chặng | Hệ thống | Tool làm gì |
|---|---|---|
| 1-4 | **Fox ERP** – Giao dịch thiết bị | Tìm HĐ → chọn phiếu → **Nhận xử lý phiếu** → chọn **kho xuất** + điền SĐT kho → **Đề nghị xuất kho giao hàng** → Cập nhật (sinh **phiếu tạm ứng** `PTUN…`) |
| 5-6 | **SCM** (`ftelscm-uat`) | Đọc chủng loại cần MAC của phiếu tạm ứng → **Tạo phiếu nhập** (Nhập khác, kho test, Hàng mới) với **MAC ngẫu nhiên** → **Xác nhận tạm ứng từ Inside** (Bảo hành v2): nhập MAC → Lưu → **Xác nhận V2** |
| 7 | **Fox ERP** | Chờ SCM đồng bộ → chọn **Giao hàng tiết kiệm** → **Lưu phiếu** → **Đóng hàng hoàn tất** (sinh **mã vận đơn** GHTK) |
| 8-10 | **GHTK lab** | Cấu hình API → Webhook → **Test**: nhập mã vận đơn, chọn trạng thái (mặc định **5 - Đã giao hàng**) → Fox ERP chuyển **Giao hàng thành công** |

Kết quả (mã ĐH, phiếu GH, phiếu tạm ứng, phiếu nhập, MAC, vận đơn, trạng thái) hiện trên giao diện và lưu ở `output/runs.csv`.

## Cài đặt & chạy

```bash
cd GH_quay
npm install
npm run ui            # mở http://localhost:3004
# hoặc: bash install.sh  (cài thư viện + tạo icon Desktop/menu + mở giao diện)
```

Cần **Google Chrome** (hoặc Edge) trên máy: tool điều khiển 1 cửa sổ trình duyệt riêng (profile lưu ở `.cache/browser-profile`).

## Dùng giao diện

1. Lần đầu: bấm **Fox ERP / SCM / GHTK** trên thanh trên cùng để mở từng hệ thống trong cửa sổ trình duyệt của tool và
   **đăng nhập** (phiên được nhớ cho lần sau). Không đăng nhập trước cũng được: khi chạy tới hệ thống nào chưa đăng nhập,
   tool dừng chờ bạn đăng nhập trong cửa sổ đó (tối đa `LOGIN_WAIT_MIN` phút) rồi tự chạy tiếp.
   - Fox ERP phải dùng tài khoản **có quyền kho xuất** (vd ChuyenNT5). Tài khoản không có quyền thì danh sách kho rỗng.
2. Nhập **Số hợp đồng** (HĐ có phiếu giao hàng tại quầy đang *Chờ xác nhận*), chọn **Chạy tới** và **Trạng thái GHTK** → **Chạy**.
3. Theo dõi 4 chặng + nhật ký; xong thì sao chép mã ở khung kết quả.

- **Chạy lại cùng HĐ** sẽ tiếp tục từ bước còn dở: tool đọc *Lịch sử xử lý* của phiếu (đã có phiếu tạm ứng? đã xác nhận? đã có vận đơn?).
- **Đẩy trạng thái GHTK** (khung bên trái): gửi trạng thái bất kỳ (-1, 1…9) cho vận đơn có sẵn, vd test *Đang giao* (4), *Không giao được* (9).
- Tuỳ chọn kho xuất / SĐT kho / đơn vị vận chuyển: mặc định lấy từ `.env`, sửa được trên giao diện.

## Dòng lệnh

```bash
node src/cli.js run SGABP5121                      # cả luồng, GHTK trạng thái 5
node src/cli.js run SGABP5121 --until ship         # dừng sau khi có mã vận đơn
node src/cli.js run SGABP5121 --status 9           # bước cuối đẩy "Không giao được hàng"
node src/cli.js ghtk S23115402.1100037933 4        # chỉ đẩy trạng thái GHTK
```

## Cấu hình (`.env`, tạo từ `.env.example`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `ERP_USER/PASSWORD`, `SCM_USER/PASSWORD`, `GHTK_USER/PASSWORD` | trống | Điền thì tool tự đăng nhập; trống thì chờ đăng nhập tay |
| `ERP_STOCK` | `KTNTESTMAC` | Kho xuất Fox ERP = Mã kho Inside bên SCM |
| `SCM_STOCK_NAME` | `Kho KTN test MAC` | Tên kho đó bên SCM (combo kho SCM chỉ tìm được theo **tên**) |
| `STOCK_PHONE` | `0775335608` | SĐT kho (bắt buộc trước khi đề nghị xuất kho) |
| `ITEM_CODES` | Play 4 = 20058112; IQ 4S = 20055098 | Không bắt buộc: tool tự biết thiết bị nào cần MAC (từ SCM) và tự tìm mã hàng theo tên + ID chủng loại. Chỉ điền để ép mã cụ thể |
| `MAC_PREFIX` | trống | Tiền tố MAC; MAC luôn 12 ký tự hex (SCM nhận 12-43 ký tự hex, không dấu `:`) |
| `CARRIER`, `GHTK_STATUS` | GHTK, 5 | Đơn vị vận chuyển, trạng thái GHTK mặc định |
| `SYNC_WAIT_SEC` | 120 | Thời gian chờ SCM/GHTK đồng bộ về Fox ERP |
| `CDP_URL` | trống | Gắn vào Chrome đang mở sẵn (`google-chrome --remote-debugging-port=9222` → `http://127.0.0.1:9222`) thay vì mở cửa sổ riêng |

## Cách hoạt động / lưu ý kỹ thuật

- **Fox ERP** màn retail-counter là **Blazor Server** (SignalR, không có REST API) → tool điều khiển UI qua Playwright.
  Tìm HĐ mở tab `/service/retail-counter/ticket?q1=<token mã hoá>` (không mở thẳng bằng số HĐ được).
  Dữ liệu SCM/GHTK đồng bộ về không tự hiện → tool tải lại trang + mở lại đúng phiếu để đọc.
- **SCM** là ASP.NET MVC + jQuery EasyUI → combo/lưới điều khiển qua API EasyUI trên trang. Popup *Nhập MAC* của phiếu
  tạm ứng cho biết chủng loại nào cần MAC (nguồn/phụ kiện không cần) → **đổi thiết bị khác không cần cấu hình**: tool đọc
  popup (chỉ xem), rồi chọn mã hàng có `FK_CATEGORY_INSIDE_ID` = ID chủng loại (nhiều mã trùng tên, vd IQ 4S có 20055098
  và 20058114). MAC phải **có trong kho** trước (phiếu nhập) thì mới nhập vào phiếu tạm ứng được; mỗi lần chạy tạo phiếu
  nhập mới với MAC ngẫu nhiên không trùng.
- **GHTK lab** gọi webhook `apis-stag.fpt.vn/.../ghtk-receive-data` → Fox ERP. Sau *Đã giao hàng*, Fox ERP tự tạo phiếu
  hoàn ứng, báo SPF, active camera, đẩy PHHD; bước nào lỗi (vd active camera với MAC giả) tool hiện ở **Cảnh báo**.
- Lỗi giữa chừng: ảnh chụp màn hình ở `output/debug/`, nhật ký server ở `output/ui-server.log`.
- Chi tiết khảo sát: [`khao-sat/KHAO_SAT.md`](khao-sat/KHAO_SAT.md).

## Bảo mật

- `.env` (mật khẩu) và `.cache/` (phiên đăng nhập của trình duyệt) **không commit, không gửi cho người khác**.
- Chỉ dùng cho môi trường staging/UAT; server chỉ nghe `127.0.0.1`.
