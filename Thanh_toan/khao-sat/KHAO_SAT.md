# Khảo sát luồng Thanh toán đơn hàng KH

Môi trường: staging. Ghi lại từng bước khi thao tác cùng QC.

| # | Hệ thống | Thao tác | Kết quả / ghi chú kỹ thuật |
|---|---|---|---|
| 1 | FPT.vn staging | Mở `https://staging.fpt.vn/pay` | Trang "Tra cứu dễ dàng - Thanh toán tiện lợi" (không cần đăng nhập). Popup "Thông báo cập nhật giao diện mới" (nút **Đóng**). Ô `input[placeholder="Nhập số hợp đồng cần tra cứu"]` + nút **Tìm kiếm**; tab Lịch sử / Tiện ích. Thanh toán qua mã QR, thẻ nội địa 38 ngân hàng, thẻ quốc tế. |
| 2 | FPT.vn staging | Đóng popup → nhập HĐ `SGABP5152` → **Tìm kiếm** | URL không đổi (`/pay`). "Kết quả tìm kiếm": Hợp đồng SGABP5152 (icon ⓘ, nút chia sẻ), dòng "Trả tự động cho lần sau – **Đăng ký**", 1 khoản: **Tiền dịch vụ – Khoan thu 23/10/2026 – 3.378.531đ** + ô chọn (radio tròn bên phải). |
| 3 | FPT.vn staging | Tích ô tròn của khoản **Tiền dịch vụ** (button không chữ trong thẻ khoản thu) | Hiện thanh **Tổng cộng 3.378.531đ** + nút **Thanh toán (1)** (số trong ngoặc = số khoản đã chọn). |
| 4 | FPT.vn staging | **Thanh toán (1)** | Cùng tab, chuyển sang `/pay/payment-info` "Thông tin thanh toán": HĐ SGABP5152, 3.378.531đ, Ưu đãi (Chọn ưu đãi), **đồng hồ "Giao dịch kết thúc trong" 15:00** (đếm ngược), mặc định QR "Dùng ứng dụng ngân hàng để thanh toán" (Lưu ảnh), nút **Phương thức khác**, Tổng thanh toán 3.378.531đ (đã gồm VAT). |
| 5 | FPT.vn staging | **Phương thức khác** | Mở panel "Chọn phương thức thanh toán": Đề xuất **QR-VietQR**; Khác: **Thẻ Quốc Tế**, **Thẻ Nội địa**, **Ví Zalopay** (giảm 50% tối đa 60k lần đầu liên kết); nút Thu gọn. Tất cả là `button` theo tên. |
| 6 | FPT.vn staging | Chọn **Thẻ Quốc Tế** | Panel đóng, màn hiện "Thanh toán bằng Thẻ Quốc Tế" + công tắc **Liên kết** (để tắt) + nút **Thanh toán**. |
| 7 | FPT.vn staging | **Thanh toán** | Popup **"Xác nhận số điện thoại"** của chủ thẻ ("Thông tin thẻ sẽ được lưu và thanh toán cho lần sau"): `input[name=phoneNumber]` = 0868650892 → **Xác nhận**. |
| 8 | Foxpay gateway | Chuyển cùng tab sang `paygateway-stag.fpt.vn/gateway-web/portal-ecom/payment/international/card/cs_sess_<id>/` | Form thẻ: `#card-number` (input mask, gõ từng ký tự), `#card-name` (name=cardName), `#expiration-date` (name=cardExpirationDate, gõ `1226` → `12/26`), `#cvv-number` (name=cardCvv); nút `#checkout-btn` "Thanh toán 3.378.531 đ"; Hủy giao dịch. Bên phải: Mã đơn hàng (vd jwCg5E3s2HcjvyoEFfYnfK), Nội dung = số HĐ, đồng hồ còn lại. Thẻ test VISA 4000000000001091 / NGUYEN VAN A / 12/26 / CVV 111. |
| 9 | Cardinal 3DS | Popup "Purchase Authentication" (iframe `1merchantacsstag.cardinalcommerce.com/MerchantACSWeb/creq.jsp`, url frame có thể rỗng → tìm frame có `input[name=challengeDataEntry]`) | Nhập OTP **1234** → SUBMIT. |
| 10 | Foxpay gateway | Kết quả | `/payment/v3/result/cs_sess_<id>`: **"Thanh toán thành công!"**, Trạng thái **Thành công**, tự quay lại sau 10s → `staging.fpt.vn/web/pay/payment-result?paymentCode=FTELBILLWEB_2_51602` hiện **"Không thể tìm thấy trang này"** (lỗi trang kết quả staging?). Tra lại HĐ trên /pay: **"Hợp đồng chưa có hoá đơn cần thanh toán."** ⇒ đã thanh toán. **QC chốt: thấy kết quả thành công ở gateway là đạt.** |

Thẻ nội địa test (chưa khảo sát luồng): 9704 0000 0000 0018 / NGUYEN VAN A / phát hành 03/07 / OTP `otp`.

## Thẻ nội địa (HĐ SGABP5050, 250.000đ)

| # | Hệ thống | Thao tác | Kết quả / ghi chú kỹ thuật |
|---|---|---|---|
| N1 | FPT.vn staging | Phương thức khác → **Thẻ Nội địa** → Thanh toán → Xác nhận SĐT | Giống thẻ quốc tế. Lưu ý: nút "Phương thức khác" có `<img alt="share icon">` → tên accessibility "Phương thức khácshare icon" ⇒ tìm nút theo chữ hiển thị, không dùng getByRole. |
| N2 | **Napas** | Chuyển cùng tab sang `https://dps-staging.napas.com.vn/api/restjs/version/1/merchant/FTEL/paymentpage` | Nhà cung cấp FTEL, Số tiền 250.000 VND, Mô tả đơn hàng = mã đơn Foxpay (DED4QMSoopygobKnzT2rcf) + số HĐ, hết hạn 15:00. Tab Thẻ / Tài khoản. Ô: `#napasCardNo` (Số thẻ), `#napasNameOnCard` (Họ tên chủ thẻ không dấu), `#napasIssueDate` (Ngày hiệu lực MMYY); nút `#napasCancelBtn1` Hủy / `#napasProcessBtn1` Tiếp tục. **Dừng ở đây theo yêu cầu QC** (chưa nhập thẻ). Bước OTP + kết quả chưa khảo sát. |
| N3 | Napas | Nhập 9704000000000018 / NGUYEN VAN A / 0307 → **Tiếp tục** (`#napasProcessBtn2` sau đó) | Hiện ô `#napasOtpCode` "Mã xác thực (OTP)" + `#napasCancelBtn2` Hủy / `#napasProcessBtn2` Tiếp tục. (QC cho làm tiếp.) |
| N4 | Napas | OTP `otp` → **Tiếp tục** | Chuyển THẲNG về `staging.fpt.vn/web/pay/payment-result?paymentCode=FTELBILLWEB_2_51608` (trang "Không thể tìm thấy trang này", không thấy trang kết quả Foxpay). Tra lại SGABP5050: **"Hợp đồng chưa có hoá đơn cần thanh toán."** ⇒ thành công; tool kết luận bằng tra lại HĐ. |
| N5 | FPT.vn staging | Tra lại HĐ sau thanh toán (SGABP4840, 2 khoản 9.000đ + 520.000đ, thẻ nội địa) | Trang báo **"Không tìm thấy hợp đồng"** (thay vì "chưa có hoá đơn cần thanh toán"). QC chốt: sau thanh toán, không còn khoản thu là ĐÚNG ⇒ cả 2 thông báo đều = thành công. Trước khi thanh toán, 2 thông báo này vẫn là lỗi (không có gì để thanh toán). |
