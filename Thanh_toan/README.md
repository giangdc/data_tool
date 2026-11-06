# FPT.vn Bill Pay Tool

Tool giúp QC **thanh toán khoản thu** của hợp đồng test trên **staging.fpt.vn/pay** (trang "Tra cứu dễ dàng - Thanh toán tiện lợi") mà không phải thao tác tay:

1. Nhập **số hợp đồng** (vd `SGABP5048`) → bấm **Thanh toán**
2. Hiện **danh sách khoản thu**: mặc định **tick hết**, bỏ tick được từng khoản nếu HĐ có nhiều khoản thu
3. Chọn PTTT **Thẻ Quốc Tế** hoặc **Thẻ Nội địa** → **Thanh toán**: tool mở Chrome, tự nhập thẻ test, tự nhập OTP, rồi kiểm tra trạng thái giao dịch tới khi **Thành công**

## Cài đặt & chạy

Yêu cầu: Node.js >= 20.12, Google Chrome (dùng cho bước tự nhập thẻ), máy ở mạng công ty hoặc có proxy công ty.

```bash
cd Thanh_toan
cp .env.example .env      # không cần sửa gì: thẻ test tự lấy từ ../Tao_don_fptvn/.env
bash install.sh           # tạo icon "FPT.vn Bill Pay Tool" + mở http://localhost:3006
# hoặc: npm run ui
```

## Thẻ test

Tool dùng **chung thẻ test với các tool trước** (cùng cổng paygateway-stag Foxpay/NAPAS):
- Nếu `.env` của tool này để trống `CARD_*`, tool tự đọc `CARD_*` từ `../Tao_don_fptvn/.env` (không có thì `../FPL/.env`).
- Muốn dùng thẻ riêng thì điền `CARD_INTERNATIONAL_*` / `CARD_DOMESTIC_*` vào `.env` của tool này.
- Có nhiều thẻ (`CARD_<PTTT>_NUMBER2..5`): thẻ trước bị từ chối thì tool tạo giao dịch mới và thử thẻ sau.

## Dòng lệnh (CLI)

```bash
npm run bills  -- SGABP5048                                   # xem khoản thu
npm run pay    -- SGABP5048 --pm INTERNATIONAL                # thanh toán tất cả khoản thu bằng Thẻ Quốc Tế
npm run pay    -- SGABP5048 --pm DOMESTIC --bills SG26O6108691,SG26O8247682   # chỉ các khoản chọn
npm run status -- FTELBILLWEB_2_51843                         # trạng thái giao dịch
```

## Giao diện

- **Số hợp đồng**: ☆ Đặt mặc định để lần sau mở tool tự tra cứu.
- **① Khoản thu**: tick sẵn tất cả, có ô "Chọn tất cả" khi có từ 2 khoản. Khoản không phải loại `RECEIPT` bị khóa (web cũng không cho chọn).
- **② Phương thức thanh toán**: lấy từ API theo khoản thu đã chọn. Tool tự thanh toán được Thẻ Quốc Tế và Thẻ Nội địa; QR-VietQR và Zalopay hiện mờ. Tick "Đặt làm PTTT mặc định" để lần sau tool chọn sẵn.
- **③ Thanh toán**: hiện tiến trình từng bước và kết quả (mã giao dịch `FTELBILLWEB_2_xxx`). Xong thì tool tra cứu lại hợp đồng, các khoản đã trả biến khỏi danh sách.
- **Kết quả**: chia 2 chế độ *Lần này* / *Lịch sử*, có nút ⟳ Cập nhật trạng thái.

Lịch sử lưu ở `output/payments.jsonl` và `output/payments.csv` (mở bằng Excel).

## Lưu ý

- Thanh toán là **thật trên staging**: khoản thu đã trả sẽ không còn để test lại. Cần khoản thu mới thì phải tạo HĐ/khoản thu mới (vd bằng tool SOP).
- Tool không tick "Liên kết" thẻ như web (`isTokenization: 0`), nên không lưu thẻ test vào hợp đồng.
- Không commit `.env` và `output/`.
