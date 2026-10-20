# Khảo sát luồng tạo đơn – staging.fpt.vn (16/10/2026)

## 1. Luồng màn hình
| Bước | URL | Ghi chú |
|---|---|---|
| Chi tiết gói | `/internet/<slug>` | Nút "Đăng ký ngay" → `/checkout/register/<slug>?salechannelcode&url&utm_content` |
| Đăng ký | `/checkout/<checkout_id>/register` | Họ tên, SĐT, Tỉnh → Phường/Xã → Tên đường, Nhà riêng/Chung cư, Số nhà, Ghi chú |
| Thanh toán | `/checkout/<checkout_id>/payment` | Chọn chu kỳ (trả sau 1 tháng / trả trước 3-7-12 tháng), addon, voucher, phương thức TT |
| Hoàn tất | `/checkout/<order_code>/completed` | Mã đơn, thông tin KH, trạng thái "Chưa thanh toán"/"Đã thanh toán" |
| QR | `/checkout/<order_code>/qrpayment` | VietQR (FPT Pay / Napas247), hết hạn 15 phút |
| Lead (không bán được) | `/checkout/<checkout_id>/finish` | "Đăng ký thành công" nhưng KHÔNG có đơn |

## 2. API (host `https://apis-stag.fpt.vn`, đều POST, header `client-id`; từ bước 2 thêm `x-checkout-token`)
1. `/ecp/public/v1.1/packages/get` {code, location} – thông tin gói
2. `/ecp/ordering/public/v1/checkout/create` {bundles, referral} → `checkout_id`, `token`
3. `/ecp/public/v1/locations/{provinces,wards,streets,buildings}/list`
4. `/ecp/ordering/public/v1/checkout/address` {address, location_id, ward_id, street_id, address_no, type_house, ...}
5. `/ecp/ordering/public/v1/checkout/customer` {full_name, phone, ...address, note}
6. `/ecp/ordering/public/v1/checkout/payment-methods/get` {bundle_codes} → INTERNATIONAL, ATM, COD, chuyển khoản, Zalopay, MoMo, VietQR...
7. `/ecp/ordering/public/v1/checkout/payment` {selected_payment_method, selected_online_method}
8. `/ecp/ordering/public/v1/voucher/list`, `/voucher/apply` {vouchers, mode}
9. `/ecp/ordering/public/v1/checkout/complete` → `order_id`, `order_code`, `status`, `redirect_url`, `display_type`, `qr_code_info`
10. `/ecp/ordering/public/v1/checkout/get` – đọc toàn bộ đơn (customer_info, bundles, line_items, giá, status, order_id/code)

## 3. Kết quả chạy thử
| Gói | PTTT | Kết quả |
|---|---|---|
| combo-giga-lite (link mẫu) | – | `checkout/customer` lỗi `CHECKOUT_PACKAGE_NOT_AVAILABLE`, FE vẫn báo "Đăng ký thành công" → **không có đơn** |
| combo-giga | – | lỗi `CHECKOUT_FPT_PLAY_REGISTER_PHONE_EXISTS` (SĐT đã có TK FPT Play) |
| combo-lux-500, dat-test | – | Timeout ở bước điền form (cần xem thêm, có thể khác form) |
| goi-giga | Thanh toán tại nhà | ✅ order_id 3836, `0000N1WNE7HC`, status `completed`, "Chưa thanh toán" |
| goi-giga | Thẻ ATM | Redirect `paygateway-stag.fpt.vn` → `dps-staging.napas.com.vn` (cần thẻ test Napas) |
| goi-giga | VietQR | order_id 3838, `0000N1WPTF40`, status `recompleting`, chờ quét QR |

## 4. Lưu ý cho tool
- SĐT phải random mỗi lần (check trùng TK FPT Play).
- Phải bắt lỗi API `checkout/customer` — FE nuốt lỗi và vẫn báo thành công.
- Sau khi chọn PTTT, phải đợi voucher/apply + checkout/get xong mới bấm "Thanh toán".
- Lỗi phụ: `/checkout/order/short-link` trả `BUSINESS_INTERNAL_ERROR` trên trang completed.
- Script khảo sát: `explore2.js` (Playwright; chỉ log tên key, token bị mask).
