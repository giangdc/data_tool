# Khảo sát luồng đăng ký gói FPT Play – dev.fptplay.vn (19/10/2026)

Link: `https://dev.fptplay.vn/dich-vu/v-vip2?from_source=main` (gói `v-vip2`). Chưa đăng nhập nên mới khảo sát được phần tĩnh: giao diện + bundle JS + API công khai.

## 1. Luồng màn hình (đọc từ bundle `_next/.../pages/dich-vu/[id]-*.js`)
| Bước | URL | Ghi chú |
|---|---|---|
| Chi tiết gói | `/dich-vu/<plan_type>?from_source=main` | **Bắt đăng nhập ngay**: popup "Dữ liệu & Quyền riêng tư" (bắt buộc tick "Thiết lập tài khoản…") → "Đăng nhập hoặc đăng ký" bằng **SĐT + OTP**. Chưa đăng nhập: trang chỉ hiện khung trống (skeleton) |
| Chọn PTTT / mã giảm giá | cùng trang | Danh sách PTTT = `payment_gateway[]` của gói (mặc định chọn cái đầu), ô coupon (`/paymentgw/coupon/check {plan_id, coupon}`), tùy chọn xuất hóa đơn (full_name, email, tax_code, full_address) |
| Thanh toán | redirect cổng / QR ngay trên trang | Tùy PTTT (bảng 3) |
| Kết quả | `/dich-vu/thanh-toan/<key PTTT>` (return_url) → `/dich-vu/thanh-toan/thanh-cong` \| `/that-bai?status_code&msg&error_message` | |

## 2. API (host `https://api-staging.fptplay.net/api/v7.1_w/`)
- **Phải đi proxy** `proxy.fpt.vn:80` (giống apis-stag.fpt.vn).
- Mọi request có query **`st` (chữ ký) + `e` (hết hạn = now+3600s)** + `device`, `drm=1`, `version` (paymentgw/customergw thêm `payment_version`). `st` = base64url(md5(hằng FE + e + "/api/v7.1_w/" + path)) – hằng nằm trong bundle `_app` công khai → **tái tạo được trong Node** (`api-probe.cjs` đã gọi thành công).
- Header `X-Did` (device id), sau đăng nhập `Authorization: Bearer <access_token>` (lưu localStorage `token`). Một số client ký thêm **mã hóa body POST** theo device id (cần xem kỹ khi làm tool).

| Endpoint | Cần đăng nhập | Ghi chú |
|---|---|---|
| `GET paymentgw/packages` | Không | ✔ 200 – danh sách nhóm gói (FPT Play NOW…), `packages_list[]` (`type`, `service_id`, giá hiển thị) |
| `GET paymentgw/packages/detail?plan_type&from_source&X-Agent&package_type?&location_id?` | **Có** | ✖ 401 khi chưa login. Trả `plan_id`, giá, `payment_gateway[]` (slug, `is_auto_pay`), `data_display.is_internet` (gói kèm internet → hỏi địa chỉ lắp đặt `location_id`) |
| `user/otp/verify {phone, otp_code, country_code, push_reg_id}` | – | Xác thực OTP → `data.access_token` (error_code 0 ok, 7/8 sai OTP) |
| `POST paymentgw/coupon/check {plan_id, coupon}` | Có | Mã giảm giá |
| `POST <createTransactionUrl của PTTT>` | Có | Body chung: `plan_id, coupon_code, payment_gateway_code, return_url/redirect_url/cancel_url = https://dev.fptplay.vn/dich-vu/thanh-toan/<key>, auto_pay:0, affiliate_source, traffic_id, is_invoice_required, full_name, email, tax_code, full_address, x_did_consumption, x_agent_consumption, reference_key, location_id` (+ thẻ: `card_expiration_month/year`). → `msg_data.{trans_id \| order_id, pay_url \| payment_url \| deep_link, expire_time}` |
| `POST <checkTransactionUrl> {trans_id, payment_gateway_code}` | Có | Poll trạng thái; `status_code` "1" = thành công |
| `POST paymentgw/payment_hub/create_transaction` / `check_transaction` | Có | Luồng "payment hub" (cấu hình `paymentHubConfig`) – thay cho từng cổng riêng |
| `POST paymentgw/postpaid/register_service {plan_type, plan_id, method, method_data, verify_token, verify_type, from_source}` | Có + OTP xác thực TT | Gói **trả sau** (cước FPT): trước đó `/account/otp/validate_user_payment` → `/account/otp/send` → nhập OTP lấy `verify_token` |
| `GET paymentgw/subscription/user_subscriptions`, `/payment/get_user_packages` | Có | Kiểm tra gói đã mua (dùng để xác nhận đơn) |

## 3. Phương thức thanh toán (map key → API, từ bundle)
| Key (slug) | Kiểu | Create | Check |
|---|---|---|---|
| `foxpay_credit` (thẻ tín dụng) | redirect `pay_url` | `paymentgw/foxpay/credit/create` | `paymentgw/foxpay/check` |
| `foxpay_atm` (ATM) | redirect | `paymentgw/foxpay/atm/create` | `paymentgw/foxpay/check` |
| `viet_qr` | QR / `payment_url` | `paymentgw/foxpay/vietqr/create` | `paymentgw/foxpay/check` |
| `foxpay` (ví FPT Pay) | QR + pay_url | `paymentgw/foxpay/qr/create`, `/pay_url/create` | `paymentgw/foxpay/check` |
| `applepayqr` | QR | `paymentgw/foxpay/appleqr/create` | foxpay/check |
| `momo_walle`, `zalo`, `shopeepay`, `vnpay`, `viettel_pay`, `grab_pay`, `napas_atm` (cũ), carrier billing | redirect/QR | `paymentgw/<cổng>/create` | `paymentgw/<cổng>/check` |

→ **Thẻ tín dụng / ATM dùng chung cổng Foxpay** (`paygateway-stag.fpt.vn`) như fpt.vn ⇒ tái dùng được `src/ecp/payment.js` (Foxpay form + 3DS Cardinal + NAPAS) – cần xác nhận lại khi đi thật (pay_url có thể khác path).

## 4. So với fpt.vn (tool Tao_DH)
| | fpt.vn | FPT Play |
|---|---|---|
| Đăng nhập | Không (checkout public) | **Bắt buộc SĐT + OTP** → cần access_token |
| Thông tin KH | Họ tên, SĐT, địa chỉ lắp đặt | Lấy theo tài khoản; chỉ hỏi địa chỉ nếu gói kèm internet (`is_internet`) |
| Tạo đơn | `checkout/create` … `checkout/complete` | 1 call create_transaction theo PTTT |
| Trạng thái | `checkout/get` | `<cổng>/check` (trans_id) + user_subscriptions |
| Cổng thẻ | Foxpay / NAPAS | Foxpay (giống) |

## 5. Còn thiếu (cần đăng nhập để chạy thật)
- Response thật của `packages/detail` gói v-vip2: plan_id, các chu kỳ (1/3/6/12 tháng?), danh sách PTTT trên dev.
- Body POST có bị mã hóa không (client thứ 2 trong `_app` mã hóa theo X-Did).
- pay_url thẻ tín dụng/ATM thực tế + màn kết quả, trạng thái gói sau khi trả tiền.
- Tài khoản đã có gói → có cho mua lại / nâng cấp không.

## File
- `explore-fpl.cjs` (Playwright, log API mask), `api-probe.cjs` (gọi API có ký `st`, cần `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://proxy.fpt.vn:80`), `01-goi.png` (popup quyền riêng tư), `02-sau-dong.png` (trang khi chưa login), `bundle/` (JS tải về).
