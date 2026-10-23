# GH_quay — Tool "Giao hàng tại quầy"

Khảo sát bắt đầu: 2026-10-23. Trạng thái: **ĐANG KHẢO SÁT** (mới có luồng UI, chưa bắt API).

## Mục tiêu
Tự động hoá luồng **Giao hàng tại quầy** để QC tạo nhanh dữ liệu test, thay cho việc bấm tay
qua nhiều hệ thống. Cổng UI mặc định: **3004** (sau Bill_Detail 3003).

## Các hệ thống liên quan (3 hệ thống)
| Ký hiệu | Hệ thống | URL | Vai trò trong luồng |
|---|---|---|---|
| **ERP** | Fox ERP – Quản lý chuỗi cung ứng | `https://fox-erp-stag.fpt.net/app/supply-chain` | Phiếu giao dịch thiết bị: tìm HĐ, xử lý, xuất vật tư, đóng hàng |
| **SCM** | Tool SCM | `https://ftelscm-uat.fpt.net` | Quản lý kho: nhập kho, xác nhận tạm ứng từ inside |
| **GHTK** | GHTK lab (đối tác vận chuyển) | `https://khachhang-staging.ghtklab.com/web/` | Giả lập webhook cập nhật trạng thái vận đơn |

> Auth: Fox ERP đăng nhập qua **Keycloak IAM** (`iam-stag.fpt.net`, realm `fpt`, client
> `nextgen-stag_portal`, OIDC code flow) — xem màn login đã khảo sát. SCM và GHTK: **CHƯA KHẢO SÁT** cơ chế auth.

## Luồng nghiệp vụ (10 bước, theo mô tả)

### Giai đoạn A — Fox ERP (Quản lý chuỗi cung ứng / Giao dịch thiết bị)
1. Truy cập tool **Quản lý chuỗi cung ứng** → **Giao dịch thiết bị** → **tìm HĐ** (hợp đồng).
2. **Nhận xử lý phiếu**.
3. **Chọn kho xuất = KTN test**.
4. **Đề nghị xuất vật tư**.

### Giai đoạn B — Tool SCM (ftelscm-uat.fpt.net)
5. **Quản lý kho → Nhập kho → Tạo phiếu nhập**.
6. **Quản lý kho → Xác nhận tạm ứng** (từ inside).

### Giai đoạn C — Quay lại Fox ERP
7. Quay lại **phiếu Giao dịch thiết bị** → chọn **Lưu và đóng hàng**.

### Giai đoạn D — GHTK lab (giả lập webhook vận chuyển)
8. **Thông tin tài khoản → Cấu hình API**.
9. **Webhook → chọn test → nhập mã vận đơn** vào ô "mã đơn hàng".
10. **Cập nhật trạng thái = 5**.

## KẾT QUẢ KHẢO SÁT THỰC TẾ (2026-10-23)

### Giai đoạn A — Fox ERP (đã khảo sát bước tìm HĐ)
- **Entry (tab /app/supply-chain)**: ô "Nhập số hợp đồng" → bấm 🔍. Có bộ lọc sẵn
  **Hình thức hỗ trợ = "Tại quầy"** (đúng nghiệp vụ). Tài khoản khảo sát: VanMTT3 (vanmtt3@fpt.com).
- Bấm tìm **mở TAB MỚI**: `https://fox-erp-stag.fpt.net/service/retail-counter/ticket?q1=<SỐ_HĐ>`
  → route **`retail-counter`** = "giao hàng tại quầy".
- Màn phiếu hiển thị **Thông tin khách hàng** từ số HĐ. Với `SGABP5109`:
  Tên: QC TEST NHA · Tên truy cập: Sgfdl-260508-5109 · Gói: Offnet · Tình trạng HĐ: Bình thường ·
  Địa chỉ: 111 Huynh Tan Phat, P. Phu Thuan, HCM. Bên trái có nút **＋ (tạo phiếu)** và phiếu số **1**.

### ⚠️ KIẾN TRÚC — ĐIỂM MẤU CHỐT CHO THIẾT KẾ TOOL
Module `retail-counter` của Fox ERP là **BLAZOR SERVER** (phát hiện qua network khi reload):
- `_framework/blazor.server.js`, `_content/Radzen.Blazor/*`, `_content/MudBlazor/*`.
- ⇒ Mọi tương tác (nhận xử lý phiếu, đề nghị xuất vật tư, lưu & đóng hàng) chạy qua
  **SignalR WebSocket** (`_blazor`), **KHÔNG có REST/JSON API** để gọi thẳng như bms/Bill_Detail.
- ⇒ **Hệ quả**: phần Fox ERP của GH_quay nhiều khả năng phải **tự động hoá UI (drive browser)**,
  không "gọi thẳng API" được. Cần xác nhận lại ở các bước sau xem có REST backend ẩn nào không.

### Màn CHI TIẾT PHIẾU (click phiếu số 1) — cấu trúc dữ liệu
**Thông tin chung**: Hình thức giao dịch = Giao hàng · Ngày tạo phiếu · Trạng thái phiếu = **Chờ xác nhận** ·
Mã vận đơn (rỗng) · Mã đơn hàng = `0000NADS5E68` · Hợp đồng = SGABP5109 · Kênh bán = DKOL · Thời gian đặt hàng.
- Mã phiếu giao hàng = **GH261023-001** · Trạng thái giao hàng = Chờ xác nhận · Đơn vị vận chuyển = Chưa chọn.

**Thông tin giao - nhận**:
- A) KH (bên nhận): Họ tên, Địa chỉ nhận hàng, SĐT, Ghi chú.
- B) Kho xuất (bên giao): Họ tên = "Công ty CP Viễn thông FPT", SĐT*, **Kho xuất\* (dropdown "Chọn kho xuất")** ← BƯỚC 3,
  Địa chỉ lấy hàng*, Người đóng hàng, Thời gian xác nhận, Thời gian đóng hàng hoàn tất, Ghi chú giao hàng.

**Lịch sử xử lý**: timeline (vd "Đơn hàng được tạo · SPF · HCM.ECOM.fptvn").

**Thông tin Đơn vị vận chuyển**: Đơn vị vận chuyển* (dropdown) · Số kiện* · Trọng lượng(kg)* ·
Loại hình vận chuyển* = Giao nhanh (XFast) · Tiền bồi thường nếu thất thoát.

**Thông tin hàng hóa giao** (table): Nhập trả · Tên thiết bị · Tình trạng xuất · Tình trạng thiết bị · SL · Khối lượng(kg) · SL hủy · Địa chỉ mac.
- vd: `FPT Camera Play 4 | Chưa xuất | | 1 | 0,7` (khớp mã 20058112 QC cung cấp).

**Thao tác phiếu** (góc phải dưới): nút **"Nhận xử lý phiếu"** ← BƯỚC 2.
Chú thích: *"Bấm 'Nhận xử lý phiếu' để mở khóa các thao tác còn lại."* ⇒ các nút bước 3/4 bị khóa tới khi nhận xử lý.
Góc phải trên: nút **"Xem thông tin hoàn ứng"**.

### Bước 2 "Nhận xử lý phiếu" — kết quả (ĐÃ CHẠY trên SGABP5109)
- Thao tác qua SignalR (không REST). Sau ~2s: **Trạng thái phiếu: Chờ xác nhận → Đang xử lý**;
  Trạng thái giao hàng → "Đang xử lý". Tự điền **Người đóng hàng = Vanmtt3**, **Thời gian xác nhận** = giờ hiện tại.
- Lịch sử xử lý thêm dòng: *"Nhận xử lý phiếu · Portal · vanmtt3@fpt.com · Trạng thái phiếu: Mới tạo → Đang xử lý"*.
- **Mở khóa thao tác mới**:
  - Khu hàng hóa: **"Đề nghị xuất kho giao hàng"** (= bước 4) + "Xem danh sách phiếu nhập/trả".
  - Góc phải: **"Lưu phiếu"** (thay nút Nhận xử lý) + **"Đóng hàng hoàn tất"** (= bước 7).

### Bước 3 "Chọn kho xuất" — ĐANG VƯỚNG (2026-10-23)
- Dropdown "Chọn kho xuất" có ô search. Thử gõ "KTN TESTMAC", "TESTMAC", và để trống → **không hiện kho nào**.
- Sau khi đổi tài khoản (Vanmtt3 → **ChuyenNT5**) và mở lại phiếu, trang hiện **"Mất kết nối máy chủ"** rồi
  **"no healthy upstream"** ⇒ **backend retail-counter đang DOWN/không reachable** (lỗi server).
- ⇒ Nghi vấn: dropdown kho rỗng có thể do backend chập chờn, CHƯA kết luận được cách chọn kho. **Cần khảo sát lại khi server ổn.**
- 📌 Lưu ý thiết kế tool: Blazor Server circuit rớt → cả UI treo "Mất kết nối máy chủ"; tool tự động hoá UI cần
  xử lý reconnect / chờ "no healthy upstream" hết.

### Thử lại với HĐ SGABP5120 (server đã ổn) — vẫn vướng kho xuất
- HĐ SGABP5120: KH QC TEST NHA, Offnet, Mã ĐH `0000NAGKW674`, Mã phiếu GH `GH261023-003`.
- Bước 2 "Nhận xử lý phiếu" OK (→ Đang xử lý). Nhưng **dropdown "Chọn kho xuất" VẪN RỖNG** (gõ "KTN" cũng không ra).
- ⚠️ **Nghi vấn quyền/session**: dù portal đã đăng nhập **ChuyenNT5**, màn retail-counter vẫn hiện **"Vanmtt3"**
  (góc phải + tự điền Người đóng hàng = Vanmtt3). ⇒ service retail-counter dường như còn giữ **session cũ Vanmtt3**,
  mà Vanmtt3 có thể **không có quyền kho KTN TESTMAC** → list kho rỗng.
- 👉 Cần: đăng nhập LẠI hẳn Fox ERP bằng tài khoản có quyền kho KTN TESTMAC (clear session cũ), rồi thử lại Bước 3.
  Hoặc xác nhận: tài khoản nào có quyền chọn kho KTN TESTMAC?

### ✅ GỠ ĐƯỢC Bước 3 — nguyên nhân là PHÂN QUYỀN TÀI KHOẢN (2026-10-23)
- Dropdown kho rỗng trước đó là do tài khoản **Vanmtt3 KHÔNG có quyền** kho đó. Đổi sang **ChuyenNT5** (chuyennt5@fpt.com) → kho hiện ngay.
- **Tên kho chính xác = `KTNTESTMAC`** (viết LIỀN, không phải "KTN TESTMAC"). Gõ "KTN" trong ô search dropdown là ra.
- ⇒ Tool GH_quay: cần đăng nhập bằng tài khoản có quyền kho (vd ChuyenNT5). Lưu ý session: logout sạch khi đổi account
  (service retail-counter giữ session cũ — xem phần trên).

### Cách khảo sát đang dùng (quan trọng cho tool)
- Portal `/app/supply-chain` nhúng màn "Quản lý giao dịch thiết bị" qua **iframe** `src=/service/retail-counter` (ô "Nhập số hợp đồng" nằm trong iframe này).
- Bấm tìm → mở **tab mới** `/service/retail-counter/ticket?q1=<TOKEN>`. **`q1` là TOKEN mã hoá** (vd `kNH5I5zJ2Zn2KAKh1H5R-...=`),
  KHÔNG phải số HĐ trần → **không mở URL trực tiếp bằng số HĐ được** (bị "Dữ liệu không đúng").
- Màn ticket = **Blazor Server** (Radzen components `rz-*`). Tự động hoá qua Playwright + CDP (connectOverCDP) vào trình duyệt persistent.
- SGABP5121: Mã ĐH `0000NAHXFDDS`, Mã phiếu giao hàng `GH261023-004`.
  - Phiếu: Hình thức "Giao hàng - Tại quầy - **MobiSale**", Loại biên bản "Biên bản cứng", nguồn MBS-HCM.ECOM.fptvn.

### ✅ Bước 3 hoàn tất (chọn kho) — đã chạy bằng Playwright
- Chọn **KTNTESTMAC** trong dropdown "Chọn kho xuất" (ô search gõ "KTN" → chọn option).
- Hệ thống **tự điền "Địa chỉ lấy hàng"** = *"Tòa nhà FPT, KCX Tân Thuận, 29B-31B-33B, Phường Tân Thuận, Hồ Chí Minh"*.
- ⚠️ Field **"Số điện thoại"** (bên kho xuất, B) còn trống — là field bắt buộc (*), có thể phải điền trước khi "Đề nghị xuất kho".
- Nút **"Đề nghị xuất kho giao hàng"** (= bước 4) nằm ở khu "Thông tin hàng hóa giao" (cuối trang).

### Bước 4 "Đề nghị xuất kho giao hàng" → modal "PHIẾU TẠM ỨNG VẬT TƯ"
- Điền trước **Số điện thoại (kho) = 0775335608** (field bắt buộc bên B).
- Bấm "Đề nghị xuất kho giao hàng" → modal **PHIẾU TẠM ỨNG VẬT TƯ**:
  - Người đề nghị: Chuyennt5 · Đối tác: **Bến Thành** · Tổ: **To BTE-300** · Tình trạng: Hàng · Mã kho: **KTNTESTMAC**.
  - Bảng vật tư tự điền (4 dòng): (1) FPT Camera Play 4 ·1·CHI (2) FPT Camera IQ 4S ·1·CHI
    (3) Nguon 5V/1A type C cho Play 4 ·1·Chiếc (4) Nguon Camera 12V-1A cho IQ 4S ·1·Chiếc.
    ⇒ Mỗi camera tự kèm 1 nguồn phụ kiện.
  - Nút: **"Cập nhật"** (chốt tạm ứng → sinh dữ liệu sang SCM) / **"Quay lại"** (huỷ).
- ⏸️ DỪNG ở modal này chờ xác nhận trước khi "Cập nhật" (thao tác tạo dữ liệu chéo SCM).
- ✅ Bấm "Cập nhật" → **TẠO phiếu tạm ứng thành công**, **Mã phiếu = `PTUN300.BTE-23.10.2026-002`**.
  Modal chuyển sang chế độ xem (chỉ còn nút "Đóng"). Đây là mã nối sang SCM (bước 5-6: tạo phiếu nhập / xác nhận tạm ứng).

### Giai đoạn B — SCM (ftelscm-uat.fpt.net) — bắt đầu khảo sát
- SCM = **FTEL SCM v1.5**, ASP.NET MVC cổ điển (DOM thường, KHÔNG Blazor). Chạy **http** (không https).
- Đăng nhập SCM bằng tài khoản riêng (khảo sát: **Dungna36@fpt.com**) — khác tài khoản Fox ERP.
- **Bước 5 "Tạo phiếu nhập"**: menu **Quản lý kho → Phiếu nhập kho → Tạo phiếu nhập** → URL `/Modules/InvImport/CreatedTicketV2`
  (đây đúng là bản dùng — user xác nhận). Màn gồm khối TÌM KIẾM (Loại nhập, Trạng thái, Kho [vd K0031006], Tình trạng hàng, Tổ, Từ/Đến ngày)
  + DANH SÁCH PHIẾU NHẬP (nút "Thêm mới", "Tải mẫu nhập", "Nhập từ Excel"...).
- **Bước 6 "Xác nhận tạm ứng từ Inside"**: menu Quản lý kho → **Xác nhận tạm ứng từ Inside** (chưa khảo sát chi tiết).
- ⏸️ Dừng khảo sát tự động tại màn Tạo phiếu nhập — user tự thao tác tiếp phần nhập liệu SCM.
- 🔗 Mã nối từ Fox ERP: phiếu tạm ứng **PTUN300.BTE-23.10.2026-002** (dùng để tạo phiếu nhập / xác nhận).
- ✅ **Bước 5 HOÀN TẤT (23/10/2026)** — tạo phiếu nhập **`ISCHN-PN-000230832`** ("Thực hiện thành công"):
  - Form "THÊM MỚI": Loại nhập = **Nhập khác** · Kho = **Kho KTN test MAC (K0000771)** · Tình trạng hàng = **Hàng mới**.
  - ⚠️ Combo Kho là combogrid phân trang (~13.4k kho), có hàng lọc: **tìm theo cột Tên kho** (tên "Kho KTN test MAC"),
    gõ mã "KTNTESTMAC" ở cột Mã kho sẽ không ra. Đổi kho → popup "thông tin hàng hóa sẽ bị xóa hết" → Ok.
  - Vật tư (grid `#dg1`): Thêm dòng → Mã hàng (combogrid remote, gõ mã → chọn đúng dòng ITEM_CODE khớp, tránh "FTI…")
    → icon MAC/Seri mở popup "MÃ HÀNG (QUẢN LÝ THEO MAC)": Kiểu nhập = Nhập lẻ, nhập MAC → "Thêm" → "Lưu"
    → nút Lưu dòng (`saverow`). Số lượng tự = số MAC. Sau mỗi lần lưu dòng hệ thống tự chèn 1 dòng trống ở đầu → bỏ bằng nút Hủy (`cancelrow`).
  - MAC/seri: **12–43 ký tự hex**, không dấu ":" (user quy định). Đã dùng:
    20058112 FPT Camera Play 4 = `AABBCC171207`; 20055098 FPT Camera IQ 4S = `AABBCC171208` (mỗi dòng SL 1).
  - Nút "Tạo" ở cuối form → về danh sách phiếu nhập (lọc Kho K0000771 để thấy phiếu mới).
- ✅ **Bước 6 HOÀN TẤT (23/10/2026)** — Xác nhận tạm ứng **PTUN300.BTE-23.10.2026-002**:
  - Menu Quản lý kho → "Xác nhận tạm ứng từ Inside" = `/Inside/TamUng/Index2` (redirect → `/Inside/TamUng/Index4`).
  - Lọc: **Mã kho Inside** (combogrid `#cbbStockInside`, lọc theo cột Tên kho "KTN" → chọn `ktntestmac` / Kho KTN test MAC),
    tích **Bảo hành v2** (`#ckbWarrantyV2`) → **Tìm Kiếm V2** (`#btnSearchNew`). Grid `#dgInsideTickets` (cột Mã phiếu Inside, Người đề xuất).
  - Bấm ⊕ mở chi tiết phiếu: các nút **Nhập MAC** (`…-btn-scan-mac`), **Xác nhận V2** (`…-confirm-V2`), Từ chối V2.
    Dòng không quản lý MAC (2 nguồn) tự có SL thực xuất = 1; 2 camera SL thực xuất 0 → cần nhập MAC.
  - Popup "NHẬP MAC": Kiểu xuất = Xuất lẻ, ô Mac/Seri → "Thêm" (`#btn_add`), hệ thống tự map MAC → chủng loại
    (MAC phải đã nhập kho ở Bước 5; thêm trùng báo "đã tồn tại trong phiếu này") → "Lưu" (`#btn_save`) → "Thực hiện thành công".
    Đã nhập: AABBCC171207 → FPT Camera Play 4; AABBCC171208 → FPT Camera IQ 4S. Cả 4 dòng chênh lệch = 0.
  - Bấm **Xác nhận V2** → phiếu biến mất khỏi danh sách chờ xác nhận (không có popup thông báo).
- ✅ **Bước 7a (23/10/2026) — quay lại Fox ERP**: F5 trang phiếu (`/service/retail-counter/ticket?q1=…`) → bấm phiếu "1" ở cột trái.
  - Lịch sử xử lý đã nhận đồng bộ từ SCM (nguồn **AdvanceService**, 12:30): "Xác nhận tạm ứng thành công" + "Cập nhật thông tin vật tư"
    (Play 4 Mac AABBCC171207, IQ 4S Mac AABBCC171208, 2 nguồn SL 1 — tất cả "Đã xuất"). Bảng "Thông tin hàng hóa giao" hiện đủ 4 dòng + MAC.
  - Khung "Thông tin Đơn vị vận chuyển": dropdown Radzen (`.rz-dropdown` "Chọn đơn vị vận chuyển") — UAT chỉ có 1 lựa chọn **Giao hàng tiết kiệm**.
    Hệ thống tự điền Số kiện 1, Trọng lượng 1,7 kg (tổng khối lượng vật tư), Loại hình **Giao nhanh (XFast)**, Tiền bồi thường 1.251.210 đ.
  - Bấm **Lưu phiếu** (khung "Thao tác phiếu") → lịch sử thêm "Cập nhật phiếu" (Portal, 13:30):
    "Đơn vị vận chuyển: (trống) → Giao hàng tiết kiệm; Trọng lượng (kg): 0 → 1,7". Trạng thái phiếu/giao hàng vẫn **Đang xử lý**, Mã vận đơn còn trống.
  - Nút kế tiếp: **Đóng hàng hoàn tất** (xanh lá, dưới "Lưu phiếu").
- ✅ **Bước 7b/8 (23/10/2026 13:32) — Đóng hàng hoàn tất → tạo vận đơn GHTK**:
  - Bấm "Đóng hàng hoàn tất" → KHÔNG có hộp xác nhận, chạy thẳng ("Đang tải dữ liệu...", ~vài giây).
  - Thông báo: *"Tạo vận đơn sang đối tác giao hàng thành công. Vui lòng tiếp tục in vận đơn và bàn giao đơn hàng cho đơn vị vận chuyển."*
  - **Mã vận đơn GHTK: `S23115402.1100037933`** (tạo 23/10/2026 13:31:55).
  - Lịch sử: "Đóng hàng hoàn tất" (Portal) Trạng thái phiếu: Đang xử lý → Đóng hàng hoàn tất; rồi
    "Cập nhật trạng thái từ đơn vị vận chuyển: ĐVVC chưa tiếp nhận" (nguồn **Vendor**, user = mã vận đơn).
  - Trạng thái phiếu & trạng thái giao hàng hiện: **ĐVVC chưa tiếp nhận**.
  - Khung "Thao tác phiếu" đổi thành: **Hủy giao hàng**, **In vận đơn**.
- ✅ **Bước 8–10 (23/10/2026 13:36) — GHTK lab giả lập trạng thái 5**:
  - GHTK lab cần đăng nhập (user tự login; shop **S23115402 / FPT Telecom**). Avatar "NF" → **Thông tin tài khoản**
    (`/web/thong-tin-shop/tai-khoan`) → **Cấu hình API** (`/web/thong-tin-shop/cau-hinh-api`).
  - Khối Webhook: URL đích `https://apis-stag.fpt.vn/m-vendor-cooperation/delivery/api/v1/Shipping/ghtk-receive-data`
    (x-www-form-urlencoded, Đang hoạt động) → nút **Test** → popup "Cập nhật trạng thái đơn hàng":
    ô "Mã đơn hàng" (nhiều mã cách nhau dấu phẩy) = **mã vận đơn**; select trạng thái (UI kiểu antd, prefix `nft-select`).
  - Danh sách trạng thái: -1 Hủy đơn · 1 Chưa tiếp nhận · 2 Đã tiếp nhận · 3 Đã lấy hàng/Đã nhập kho · 4 Đã điều phối/Đang giao ·
    **5 Đã giao hàng/Chưa đối soát** · 6 Đã đối soát · 7 Không lấy được hàng · 8 Hoãn lấy hàng · 9 Không giao được hàng.
  - Chọn 5 → Xác nhận → toast "Gửi yêu cầu thành công!".
  - **Kết quả bên Fox ERP** (F5 + mở phiếu): Trạng thái phiếu & giao hàng = **Giao hàng thành công**, Mã vận đơn hiện ở Thông tin chung.
    Lịch sử tự động (13:36–13:37): Vendor "Giao hàng thành công" → System "Đẩy tạo phiếu hoàn ứng" (tạo & duyệt tự động, 4 vật tư)
    → "Đã gửi tín hiệu giao hàng thành công cho SPF" (DeliverySuccess_SPF) → "Đẩy tín hiệu active Camera" **KHÔNG thành công**
    (ServiceId 4: An unexpected error occurred — có thể do MAC giả) → "Đẩy thông tin giao hàng sang PHHD" code 2 "Không tìm thấy đơn hàng OrderRaw",
    đã lưu vào OI_DeliverySignal. Khung "Thao tác phiếu" không còn nút nào. ⇒ **LUỒNG 10 BƯỚC HOÀN TẤT END-TO-END.**

## CẦN KHẢO SÁT TIẾP (điền khi chạy browser có đăng nhập)

### ERP (Fox ERP supply-chain)
- [ ] Màn "Giao dịch thiết bị" nằm ở menu nào trong `/app/supply-chain`? Route cụ thể.
- [ ] API tìm HĐ (method + path + params + response). Trường khoá để nhận diện phiếu.
- [ ] API "Nhận xử lý phiếu", "Đề nghị xuất vật tư", "Lưu và đóng hàng".
- [ ] Mã/định danh kho "KTN test".
- [ ] Token/header dùng cho API (Bearer từ Keycloak? cookie?).

### SCM (ftelscm-uat.fpt.net)
- [ ] Cơ chế đăng nhập/auth.
- [ ] API "Tạo phiếu nhập", "Xác nhận tạm ứng".
- [ ] Mối liên hệ dữ liệu giữa phiếu ERP ↔ phiếu SCM (mã nào nối 2 bên?).

### GHTK (khachhang-staging.ghtklab.com)
- [ ] Màn "Cấu hình API" cần những gì (API key/token?).
- [ ] Endpoint webhook test: payload gửi lên (mã vận đơn, trạng thái 5 nghĩa là gì?).
- [ ] Mã vận đơn lấy từ đâu trong luồng ERP/SCM?

## Dữ liệu test (do QC cung cấp)
- **Số hợp đồng**: `SGABP5109` → KH "QC TEST NHA", gói Offnet, HCM.
- **Kho xuất**: `KTN TESTMAC` (chọn ở dropdown "Chọn kho xuất", bước 3).
- **Mã hàng / vật tư** (dùng ở bước 4 đề nghị xuất vật tư & bước 5 tạo phiếu nhập SCM):
  | Tên thiết bị | Mã hàng |
  |---|---|
  | FPT Camera Play 4 | `20058112` |
  | FPT Camera IQ 4S | `20055098` |

## Câu hỏi nghiệp vụ còn mở
- Dữ liệu đầu vào tool cần nhận là gì? (số HĐ? mã phiếu?) → đầu ra mong muốn?
- Có bước nào bắt buộc thao tác tay (duyệt bởi người khác) không thể tự động?
- "Trạng thái 5" ở GHTK map sang trạng thái nghiệp vụ nào (đã giao / hoàn tất)?
