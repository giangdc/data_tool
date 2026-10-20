# FPT.vn Order Tool

Tool hỗ trợ QC tạo nhanh **đơn hàng test trên fpt.vn (staging)**. Không phải đi tay từng bước trên web: nhập link màn hình chi tiết gói → tool tạo đơn → thanh toán → xem lại thông tin đơn.

**Phiên bản 1.2.0**

| Bước | Tool làm gì |
|---|---|
| 1. Tải gói | Nhập link chi tiết gói (vd `https://staging.fpt.vn/internet/goi-giga`) → tool kiểm tra **chính sách** tại địa chỉ, lấy **Thông tin sản phẩm** (trả sau / trả trước N tháng), **Dịch vụ/Thiết bị bổ sung**, **PTTT** và tạm tính |
| 2. Tạo đơn | Điền sẵn SĐT `0964633310`, địa chỉ **Hồ Chí Minh**, **Nhà riêng** (đổi được sang **Chung cư**), **sản phẩm đầu tiên**, **không chọn bổ sung**, **PTTT đầu tiên**. Sửa được hết → **Tạo đơn hàng** |
| 3. Thanh toán | *Thanh toán tại nhà*: xong ngay. *Thẻ tín dụng / ATM*: nút **Mở trang thanh toán** (cổng Foxpay/NAPAS staging) → nhập thẻ test → bấm **Kiểm tra thanh toán**. *VietQR*: hiện mã QR ngay trên tool |
| 4. Xem đơn | Bảng **Kết quả** (Lần này / Lịch sử) + nút **Chi tiết**: mã đơn, order ID, trạng thái, khách hàng, địa chỉ, sản phẩm, tổng tiền, PTTT. Tab **Xem đơn hàng** tra theo mã |

> Tự nhập thẻ tín dụng/ATM: sẽ có ở bản sau (chờ thông tin thẻ test).

## 1. Yêu cầu

| Hạng mục | Yêu cầu |
|---|---|
| Hệ điều hành | Ubuntu / Linux x64 (CLI và giao diện web chạy được trên mọi OS có Node; icon desktop chỉ hỗ trợ Ubuntu/GNOME) |
| Node.js | **>= 20.12** (bản đóng gói `.tar.gz` đã kèm Node) |
| Mạng | Truy cập được `staging.fpt.vn` và `apis-stag.fpt.vn`. Mạng công ty có proxy: tool **tự dùng proxy hệ thống** (Ubuntu Settings > Network > Proxy), hoặc đặt `ECP_PROXY=http://proxy.fpt.vn:80` trong `.env` |
| Tài khoản | **Không cần** – API checkout fpt.vn là public |

## 2. Cài đặt

**Bản đóng gói** (`fptvn-order-tool-<phiên bản>-linux-x64.tar.gz`):
```bash
tar -xzf fptvn-order-tool-*-linux-x64.tar.gz -C ~ && bash ~/fptvn-order-tool/install.sh
```
`install.sh` tạo icon **FPT.vn Order Tool** trên Desktop + menu ứng dụng rồi mở `http://localhost:3001`.

**Từ mã nguồn**: `bash install.sh` (hoặc `npm run ui`). Tool không có thư viện ngoài, không cần `npm install`.

Tool chạy cổng **3001** (tool BMS dùng 3000, chạy song song được). Đổi bằng `UI_PORT` trong `.env`.

## 3. Sử dụng giao diện web

1. Dán link màn hình chi tiết gói → **Tải gói** (hoặc Enter).
2. Kiểm tra/sửa Họ tên, SĐT, địa chỉ (Tỉnh → Phường/Xã → Tên đường → **Nhà riêng**: Số nhà / **Chung cư**: Tên chung cư, Tòa nhà, Số tầng, Số phòng – 3 ô sau **điền sẵn ngẫu nhiên**, bấm 🎲 để sinh lại).
3. Chọn **Thông tin sản phẩm** (mặc định cái đầu tiên), tick **Dịch vụ/Thiết bị bổ sung** nếu cần (mặc định không chọn), chọn **PTTT**. Mỗi lần đổi địa chỉ / sản phẩm / bổ sung, tool tính lại giá + PTTT (vd tick bổ sung thì gói Giga mất "Thanh toán tại nhà").
   - ⛔ **Địa chỉ không có chính sách** bán gói (vd chung cư "Nơi khác" ở P. Bến Thành, gói `combo-giga-lite`): tool báo đỏ, khóa nút Tạo đơn – web fpt.vn thì vẫn cho đăng ký và báo "thành công" nhưng không có đơn.
4. **Tạo đơn hàng** → đơn hiện ở bảng Kết quả.
5. Đơn online: **Thẻ tín dụng / Thẻ ATM** – để tick **Tự thanh toán bằng thẻ test** (cần thẻ test trong `.env`, xem `.env.example`) thì tạo xong tool tự mở Chrome, nhập thẻ + OTP và báo kết quả (~20–60s, đừng thao tác trên cửa sổ đó); hoặc bấm **💳 Tự thanh toán** sau. Có nhiều thẻ (`CARD_INTERNATIONAL_NUMBER2`...) thì thẻ trước lỗi tool tự thử thẻ sau. Thanh toán lỗi mà đơn còn **Chờ thanh toán** → chọn PTTT khác ở dòng **Thanh toán lỗi? … ↻ Đổi PTTT & thanh toán lại** (hộp thanh toán / Chi tiết; chỉ PTTT online, không đổi sang thanh toán tại nhà được). Các PTTT khác: **Mở trang thanh toán** / quét QR → thanh toán → **↻ Kiểm tra thanh toán** (hoặc *↻ Trạng thái* ở bảng).
6. **Chi tiết** trên từng dòng để xem đầy đủ thông tin đơn.

| Trạng thái | Ý nghĩa |
|---|---|
| Đã tạo đơn · Thanh toán tại nhà | Đơn đã lên (`completed`), thu tiền khi lắp |
| Chờ thanh toán | Đơn đã lên, đang chờ thanh toán online (`recompleting`) |
| Đã thanh toán | Thanh toán online thành công (`completed`) |
| Đã thanh toán (cổng) · ECP chưa cập nhật | Tool đã tự thanh toán, cổng báo thành công nhưng staging chưa cập nhật trạng thái (lỗi hệ thống) |

Nút 🎲 cạnh SĐT: sinh số ngẫu nhiên – dùng khi gói Combo báo *"Quý khách đã có tài khoản FPT Play theo số …"*.

## 4. Dòng lệnh (CLI)

```bash
npm run methods -- https://staging.fpt.vn/internet/goi-giga               # gói + PTTT khả dụng
npm run create  -- https://staging.fpt.vn/internet/goi-giga --pm COD -n 3  # tạo 3 đơn trả tại nhà
npm run create  -- goi-giga --pm VIETQR --phone 0912345678 --province "Hà Nội" --no 9
npm run create  -- goi-giga --apartment --building "VVA Tower" --block A1 --floor 5 --room 501 --extras 1907 --pm VIETQR
npm run methods -- goi-giga --offer 3                                    # xem PTTT/giá với lựa chọn thứ 3
npm run create  -- goi-giga --pm INTERNATIONAL --pay                     # tạo + tự thanh toán thẻ test (mở Chrome)
npm run pay     -- 0000N5DLOHXC                                           # tự thanh toán đơn chờ thanh toán (Thẻ tín dụng/ATM)
npm run repay   -- 0000N5DLOHXC --pm DOMESTIC --pay                       # đổi PTTT đơn chờ thanh toán + tự thanh toán lại
npm run status  -- 0000N1X5O1MO 0000N1XCZ7FK                              # trạng thái
npm run detail  -- 0000N1X5O1MO                                           # chi tiết (JSON)
```
Mã PTTT: `INTERNATIONAL` (thẻ tín dụng), `DOMESTIC` (ATM), `COD` (tại nhà), `BANK_TRANSFER`, `ZALO_PAY`, `MOMO`, `VIETQR`, `APPLE_PAY` – tùy gói.

## 5. Dữ liệu

- Đơn đã tạo: `output/orders.csv` (mở Excel) + `output/orders.jsonl` (đầy đủ, **kèm token checkout** để xem lại đơn → không chia sẻ file này).
- Chỉ xem được chi tiết đơn **do tool tạo** (cần token checkout của đơn).
- Ghi chú đơn mặc định `AUTO-QC tạo đơn test`, họ tên `AUTO-QC Test` → dễ lọc/dọn dữ liệu test.

## 6. Lỗi thường gặp

| Lỗi | Nguyên nhân / cách xử lý |
|---|---|
| `Địa chỉ không có chính sách bán gói này …` | Gói không có chính sách giá tại địa chỉ / chung cư đó (API `CHECKOUT_PACKAGE_NOT_AVAILABLE`, vd `combo-giga-lite` mọi nơi, chung cư "Nơi khác"). Web fpt.vn vẫn báo "Đăng ký thành công" nhưng **không có đơn** – tool chặn |
| `Quý khách đã có tài khoản FPT Play theo số …` | Gói Combo kiểm tra trùng SĐT FPT Play → bấm 🎲 đổi SĐT |
| `ServiceCode not found [BUSINESS_INTERNAL_ERROR]` | Staging chưa cấu hình mã dịch vụ cho chính sách **trả trước** (Gói Giga 3/7/12 tháng lỗi với mọi PTTT) → chọn Trả sau |
| `PTTT "COD" không khả dụng với lựa chọn này` | PTTT phụ thuộc lựa chọn: thêm dịch vụ bổ sung thì Gói Giga không còn Thanh toán tại nhà |
| Tải gói báo `Không gọi được apis-stag.fpt.vn (ENOTFOUND / fetch failed)` | Máy cần proxy để ra Internet. Tool tự lấy proxy hệ thống GNOME; nếu không có thì thêm `ECP_PROXY=http://proxy.fpt.vn:80` vào `.env` rồi tắt/mở lại tool |
| Cổng thanh toán "Sorry, you have been blocked" | WAF chặn trình duyệt tự động/headless. Mở bằng Chrome thường |
