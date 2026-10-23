# Thanh toán Tool – thanh toán hoá đơn HĐ

Chạy nhanh luồng **thanh toán hoá đơn của hợp đồng** trên trang [staging.fpt.vn/pay](https://staging.fpt.vn/pay) bằng thẻ test:

| Bước | Trang | Tool làm gì |
|---|---|---|
| 1 | staging.fpt.vn/pay | Đóng popup thông báo → nhập **số HĐ** → **Tìm kiếm** |
| 2 | Kết quả tìm kiếm | **Tích tất cả khoản thu** (vd Tiền dịch vụ) → **Thanh toán (n)** |
| 3 | `/pay/payment-info` | **Phương thức khác** → **Thẻ Quốc Tế** (mặc định) / **Thẻ Nội địa** → **Thanh toán** → popup **Xác nhận số điện thoại** chủ thẻ (mặc định 0868650892) |
| 4a | Thẻ Quốc Tế: cổng Foxpay (`paygateway-stag.fpt.vn`) | Nhập thẻ → **Thanh toán** → OTP 3DS Cardinal → **"Thanh toán thành công!"** |
| 4b | Thẻ Nội địa: trang **Napas** (`dps-staging.napas.com.vn`) | Số thẻ, Họ tên, Ngày hiệu lực (MMYY) → **Tiếp tục** → OTP → **Tiếp tục** |
| 5 | Kết quả | Tra lại HĐ: phải hiện "chưa có hoá đơn cần thanh toán". Thẻ nội địa không có trang kết quả Foxpay nên kết luận bằng bước này |

Kết quả (khoản thu, số tiền, mã đơn Foxpay, paymentCode, trạng thái) hiện trên giao diện và lưu ở `output/runs.csv`.
Số thẻ chỉ lưu dạng che (`400000******1091`), không lưu CVV/OTP.

> Đã chạy tay thành công cả 2 phương thức trên staging (SGABP5152 thẻ quốc tế, SGABP5050 thẻ nội địa).

## Cài đặt & chạy

```bash
cd Thanh_toan
npm install
npm run ui            # mở http://localhost:3006
# hoặc: bash install.sh  (cài thư viện + tạo icon Desktop/menu + mở giao diện)
```

Cần **Google Chrome** (hoặc Edge). Trang thanh toán không cần đăng nhập.

## Dùng giao diện

1. Nhập **Số hợp đồng** (nhiều HĐ cách nhau dấu phẩy / xuống dòng) – HĐ phải đang có hoá đơn cần thanh toán.
2. Chọn **Phương thức** (Thẻ Quốc Tế / Thẻ Nội địa), sửa **SĐT chủ thẻ** nếu cần.
3. **Thông tin thẻ**: tự điền thẻ test theo phương thức; CVV/OTP để trống = dùng giá trị trong `.env`.
4. Bấm **Thanh toán**. Mỗi HĐ mất khoảng 1 phút (giao dịch ở cổng hết hạn sau 15 phút).

## Dòng lệnh

```bash
node src/cli.js pay SGABP5152                         # thẻ quốc tế mặc định
node src/cli.js pay SGABP5152 --method domestic       # thẻ nội địa
node src/cli.js pay SGABP1,SGABP2 --phone 0901234567 --card 4000000000001091 --date 12/26 --cvv 111 --otp 1234
```

## Cấu hình (`.env`, tạo từ `.env.example`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `CARD_NUMBER`, `CARD_NAME`, `CARD_EXPIRY`, `CARD_CVV`, `CARD_OTP` | VISA 4000000000001091, NGUYEN VAN A, 12/26, 111, 1234 | Thẻ quốc tế test |
| `DOMESTIC_CARD_NUMBER`, `DOMESTIC_CARD_NAME`, `DOMESTIC_CARD_ISSUE`, `DOMESTIC_CARD_OTP` | 9704000000000018, NGUYEN VAN A, 03/07, otp | Thẻ nội địa test |
| `PHONE` | `0868650892` | SĐT chủ thẻ ở popup xác nhận |
| `STEP_WAIT_SEC` | 60 | Thời gian chờ tối đa mỗi bước |
| `CDP_URL` | trống | Gắn vào Chrome đang mở sẵn (`--remote-debugging-port=9222` → `http://127.0.0.1:9222`) |

## Lưu ý kỹ thuật

- Ô thẻ ở Foxpay có input mask → tool gõ từng ký tự (`#card-number`, `#card-name`, `#expiration-date`, `#cvv-number`, `#checkout-btn`).
- Popup 3DS là iframe Cardinal; URL iframe có lúc rỗng → tool tìm khung theo ô `challengeDataEntry`.
- Sau trang kết quả, cổng tự quay về `staging.fpt.vn/web/pay/payment-result?paymentCode=…` – trang này trên staging đang
  báo **"Không thể tìm thấy trang này"**; QC chốt thấy "Thanh toán thành công" ở cổng là đạt, tool chỉ đọc `paymentCode` từ URL.
- Popup xác nhận SĐT ghi "Thông tin thẻ sẽ được lưu và thanh toán cho lần sau" (thẻ được lưu theo SĐT).
- Lỗi giữa chừng: ảnh chụp màn hình ở `output/debug/`, nhật ký server ở `output/ui-server.log`.
- Chi tiết khảo sát: [`khao-sat/KHAO_SAT.md`](khao-sat/KHAO_SAT.md).

## Bảo mật

- Chỉ dùng **thẻ test** của môi trường staging. `.env` không commit.
- Server chỉ nghe `127.0.0.1`; CVV/OTP không trả về giao diện, không lưu vào `output/`.
