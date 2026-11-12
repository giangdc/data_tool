# Khảo sát – Tạo đơn TMĐT trên SPF Web Admin (2026-11-12)

- URL: `https://saleplatform-stag.fpt.net/web-admin/Account/Login` → *Ecomercial → OrderECPlatform*.
- Cách khảo sát: mở Chrome thật (playwright-core), **user tự đăng nhập bằng Access Token và thao tác**; script ghi mọi request document/xhr (che AccessToken, antiforgery, cookie).
- Chi tiết API: xem `../CLAUDE.md` §4.

## Trình tự user đã làm (TikTok)
1. Tab *Cập nhật chính sách*: tra RefCode `584972625322673904` → thấy đơn cũ → **Ngắt kết nối** (`ConnectOrderEcom IsConnect=false`).
2. Tab *Cập nhật địa chỉ/SDT*: Load RefCode → chọn HCM / P. Phú Thuận / Huỳnh Tấn Phát, số nhà "qc test", SĐT 0868650892 → Submit → lỗi "kiểm tra thông tin chính sách" (SKU Sky F1).
3. Đổi RefCode `584542458320094402` (camera IQ4S): tra → ngắt đơn cũ HCMUT0026VBP → Load → Submit → **HCMUW0026VN0** (OrderId 3680172) → trang chi tiết đơn.
4. Shopee: cùng màn, đổi Source = Shopee; lần khảo sát này hệ thống lỗi, chưa có request.

## Quy tắc user
- Tra ở tab Cập nhật chính sách trước; **không có đơn thì qua tab Cập nhật địa chỉ/SDT** để tạo.
- Shopee giống TikTok, chỉ đổi Tiktok → Shopee.
