# FPT Play Order Tool

Tool hỗ trợ QC **mua nhanh gói FPT Play test trên dev.fptplay.vn**. Không phải đi tay từng bước trên web: nhập link gói → tool tự đăng nhập (OTP mặc định) → tạo giao dịch → tự thanh toán thẻ test → xem trạng thái + gói đã lên tài khoản.

**Phiên bản 1.0.0**

| Bước | Tool làm gì |
|---|---|
| 1. Tải gói | Nhập link gói (vd `https://dev.fptplay.vn/dich-vu/v-vip2?from_source=main`) → tool đăng nhập SĐT `0964633310` bằng OTP mặc định → hiện tài khoản (gói đang có), **kỳ hạn**, **PTTT** |
| 2. Mua gói | Chọn kỳ hạn (mặc định đầu tiên), mã giảm giá (nếu có), PTTT (mặc định đầu tiên) → **Mua gói** |
| 3. Thanh toán | *Thẻ tín dụng / ATM*: tick **Tự thanh toán bằng thẻ test** → tool mở Chrome, tự nhập thẻ + OTP (~10–60s), đối chiếu trạng thái trên FPT Play. Hoặc **Mở trang thanh toán** tự trả rồi bấm **↻ Kiểm tra thanh toán**. PTTT khác (MoMo…): mở link / quét QR |
| 4. Xem giao dịch | Bảng **Kết quả** (Lần này / Lịch sử) + **Chi tiết**: trạng thái, số tiền giao dịch thực tế, gói trên tài khoản (hết hạn ngày nào). Tab **Xem giao dịch** tra theo mã |

## 1. Yêu cầu

| Hạng mục | Yêu cầu |
|---|---|
| Hệ điều hành | Ubuntu / Linux x64 (icon desktop chỉ hỗ trợ Ubuntu/GNOME) |
| Node.js | **>= 20.12** (bản đóng gói `.tar.gz` đã kèm Node) |
| Mạng | Ra được `api-staging.fptplay.net`, `paygateway-stag.fpt.vn`. Mạng công ty: tool **tự dùng proxy hệ thống**, hoặc đặt `FPL_PROXY=http://proxy.fpt.vn:80` trong `.env` |
| Tài khoản | SĐT test có **OTP mặc định** môi trường dev (`FPL_PHONE`, `FPL_OTP` trong `.env`). SĐT khác sẽ báo sai OTP |
| Tự thanh toán | **Google Chrome** cài trên máy + thẻ test `CARD_*` trong `.env` (giống tool fpt.vn) |

## 2. Cài đặt

**Bản đóng gói** (`fpl-order-tool-<phiên bản>-linux-x64.tar.gz`):
```bash
tar -xzf fpl-order-tool-*-linux-x64.tar.gz -C ~ && bash ~/fpl-order-tool/install.sh
```
Rồi tạo `.env` từ `.env.example` (điền `FPL_OTP` + thẻ test).

**Từ mã nguồn**: `bash install.sh` (hoặc `npm run ui`). Không có thư viện ngoài, không cần `npm install`.

Tool chạy cổng **3002** (BMS 3000, tool fpt.vn 3001 – chạy song song được). Đổi bằng `UI_PORT` trong `.env`.

## 3. Dòng lệnh (CLI)

```bash
npm run login                                         # đăng nhập SĐT mặc định (token lưu .cache/)
npm run plans -- https://dev.fptplay.vn/dich-vu/v-vip2  # kỳ hạn + PTTT với tài khoản
npm run create -- v-vip2 --pm INTERNATIONAL --pay       # mua + tự thanh toán thẻ test
npm run create -- v-vip2 --plan 7859 --coupon ABC       # chọn kỳ hạn (plan_id) + mã giảm giá
npm run pay    -- 1792404081-38297814                   # tự thanh toán giao dịch chờ thanh toán
npm run status -- 1792404081-38297814
npm run detail -- 1792404081-38297814                   # JSON + gói trên tài khoản
```
Mã PTTT: `INTERNATIONAL` (thẻ tín dụng), `DOMESTIC` (ATM), `WALLET_MOMO`… – tùy gói.

## 4. Dữ liệu

- Giao dịch: `output/orders.csv` (Excel) + `output/orders.jsonl` (kèm link thanh toán). Token đăng nhập: `.cache/token-*.json` – không chia sẻ.
- Mỗi lần thanh toán ghi thêm 1 dòng (trạng thái mới) – Lịch sử lấy dòng mới nhất theo mã.

## 5. Lưu ý / lỗi thường gặp

| Hiện tượng | Giải thích |
|---|---|
| `OTP mặc định không dùng được cho SĐT …` | OTP mặc định dev chỉ áp dụng cho SĐT test đã cấu hình (0964633310) |
| Số tiền giao dịch < giá gói | Tài khoản đang có gói khác còn hạn → hệ thống trừ phần còn lại (vd V.VIP2 160.000₫, giao dịch 80.000₫) |
| Mua lại gói đang có | Được – hệ thống **cộng thêm** thời hạn (vd 19/11 → 19/12) |
| `Gói kèm lắp đặt Internet … chưa hỗ trợ` | Gói `is_internet = 1` cần địa chỉ lắp đặt – chưa làm |
| Link thanh toán hết hạn | Link cổng ~15 phút. 💳 Tự thanh toán sẽ tự tạo giao dịch mới |
| Popup "THÔNG TIN ĐĂNG KÝ – trả trước 2 tháng + lắp Internet" trên web | Popup khảo sát (upsell) của web, không ảnh hưởng giao dịch – tool bỏ qua |
| Cổng thanh toán "Sorry, you have been blocked" | WAF chặn trình duyệt tự động/headless – tool mở Chrome thường, cần mạng/proxy công ty |
