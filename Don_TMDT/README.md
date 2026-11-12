# Tạo đơn TMĐT Tool (Don_TMDT)

Tool giúp QC **tạo đơn hàng thương mại điện tử (TikTok Shop / Shopee) theo RefCode** trên **SPF Web Admin staging**
(`saleplatform-stag.fpt.net/web-admin` → *Ecomercial / OrderECPlatform*), gọi thẳng API thay cho thao tác tay.

Luồng tool làm (giống thao tác tay trên web):
1. **Load RefCode**: xem đơn trên sàn (SKU, giá, SĐT, địa chỉ) + tra đơn đã gắn RefCode ở tab **Cập nhật chính sách**.
2. Nếu có đơn lỗi được **Thử lại** → Retry đơn đó theo OrderId (gửi kèm SĐT).
3. Nếu **không có đơn** → sang tab **Cập nhật địa chỉ/SDT**: tạo đơn với SĐT + địa chỉ đã chọn.
4. Nếu RefCode **đã gắn đơn** (lỗi "Đơn hàng đã tồn tại trong hệ thống") → tick **Ngắt kết nối đơn cũ rồi tạo lại** (CLI `--disconnect`).
5. **Quyết toán**: nút *Quyết toán* ở dòng đơn trong bảng kết quả → đẩy task `Tiktok_CompletedOrder` (Shopee: `SPFShopeeCompletedOrder`) ở Queue → Push Custom Task, xem tiến độ.
6. Xem kết quả: mã đơn, PĐK / HĐ, trạng thái thanh toán, tiến độ queue (Tạo PĐK & Hợp đồng, Ghi nhận quà tặng…), link chi tiết đơn trên SPF.

## Cài đặt & chạy

```bash
cd Don_TMDT
cp .env.example .env          # tuỳ chọn: điền SPF_ACCESS_TOKEN, đổi SĐT/địa chỉ mặc định
bash install.sh               # tạo icon "Tạo đơn TMĐT Tool" trên Desktop + mở giao diện
# hoặc
npm run ui                    # http://localhost:3009
```

- Node.js >= 20.12, không cần cài thư viện.
- **Đăng nhập**: dán **Access Token** (ô Token ở trang Login SPF Web Admin) vào ô trên đầu trang → *Đăng nhập*.
  Token được lưu trong `.cache/session.json` để tự đăng nhập lại khi hết phiên. Token hết hạn thì tool báo, dán token mới.
- Mặc định: nguồn **TikTok**, SĐT **0868650892**, địa chỉ **qc test, Huỳnh Tấn Phát, Phường Phú Thuận, Hồ Chí Minh**.
  Đổi trên giao diện rồi bấm **☆ Đặt mặc định** để lưu.

## Dòng lệnh (CLI)

```bash
npm run login -- --token <AccessToken>                     # hoặc để SPF_ACCESS_TOKEN trong .env
npm run load -- 584542458320094402                          # xem đơn trên sàn + đơn đã có trên SPF
npm run create -- 584542458320094402                        # TikTok, SĐT + địa chỉ mặc định
npm run create -- <RefCode> -s Shopee -p 0912345678         # Shopee, SĐT khác
npm run create -- <RefCode> --disconnect                    # ngắt đơn cũ đang gắn RefCode rồi tạo lại
npm run create -- <RefCode> --location 8 --district 1000009701 --ward <id> --street <id> --no "12 qc test"
npm run search -- HCMUW0026VN0 --by ordercode               # tra đơn (refcode | ordercode | orderid)
npm run disconnect -- 3680172                               # ngắt kết nối 1 đơn khỏi RefCode
npm run status -- 3680172                                   # PĐK / HĐ / thanh toán + tiến độ queue
npm run history
npm run settle -- 3680172                                   # quyết toán (tất cả task); --tasks 1,2,5 · --replicate · -s Shopee
node src/cli.js settle-tasks -s Shopee                      # xem task quyết toán
```

## Dữ liệu

- `output/orders.csv` (mở bằng Excel) + `output/orders.jsonl`: đơn đã tạo bằng tool.
- `.cache/session.json`: Access Token + cookie phiên. **Không commit, không chia sẻ.**

## Lỗi hay gặp

| Thông báo | Cách xử lý |
|---|---|
| Đơn hàng đã tồn tại trong hệ thống / RefCode đã gắn đơn … | Tick *Ngắt kết nối đơn cũ rồi tạo lại* |
| Đã xảy ra lỗi trong quá trình kiểm tra thông tin chính sách | SKU của RefCode không có chính sách (gặp với RefCode gói Sky F1). Thử RefCode khác hoặc địa chỉ khác |
| Token không hợp lệ / Phiên đã hết hạn | Lấy Access Token mới, dán lại |
| Không tìm thấy đơn … có RefCode | Sai RefCode hoặc chọn sai nguồn TikTok / Shopee |
