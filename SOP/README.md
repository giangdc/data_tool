# SOP Order Tool – Tạo đơn + hợp đồng trên Portal SOP

**v0.4.0** · lịch sử nâng cấp: [CHANGELOG.md](CHANGELOG.md)

Tạo nhanh **đơn + hợp đồng** (Internet và các dịch vụ khác) trên **Portal SOP stag** (https://portal-sop-stg.fpt.vn) cho khách hàng có sẵn,
thay cho việc bấm tay ~20 bước. Chọn dịch vụ trên **menu ở header**: Internet · Truyền hình · Camera · Tốc độ & Wi-Fi · Dịch vụ khác.

Luồng Internet:

| Bước | Màn | Tool làm gì |
|---|---|---|
| 1 | Portal – Khách hàng của tôi | Tìm KH theo **SĐT** (chọn từ danh sách KH tự tải) → mở chi tiết → tab Đơn hàng → **Thêm đơn hàng → Bán mới** |
| 2 | Sale Platform – Tạo báo giá | **Địa chỉ**: gõ vào ô Tìm kiếm trên bản đồ → chọn kết quả đầu → điền thêm Số nhà + Toạ độ (Google stag hay báo OVER_QUERY_LIMIT) → Xác nhận. Có hộp thoại "đơn hàng trước đó chưa hoàn thành" thì bấm **Không** |
| 3 | | Chọn **gói** trong Combo gợi ý (nhóm GigaF1/F2, MetaF1/F2, SkyF1/F2, Combo khác + thứ tự trong nhóm); thẻ khuất thì tự cuộn ngang. Stag báo "Thời gian phản hồi quá lâu" thì đóng thông báo, bấm lại (tối đa 3 lần) |
| 3b | | **Đối tượng khách hàng**: *Cá nhân* (mặc định, = "Gia đình" trên portal) hoặc *Doanh nghiệp* → nhập form doanh nghiệp (Tên, MST, Ngày cấp/Nơi cấp, Ngày thành lập, Địa chỉ GPKD, SĐT tổ chức + liên hệ, Người đại diện) → Xác nhận & Lưu. Ô trống = dữ liệu test (MST ngẫu nhiên hợp lệ, SĐT = SĐT KH…) |
| 4 | | Đổi **phương thức thanh toán** (mặc định portal "FRT Thu Hộ" bị stag báo không hỗ trợ → tool chọn **Napas**) |
| 5 | | Thông tin KH → Cập nhật → **Xác nhận & Lưu** (Họ tên + SĐT là đủ) |
| 6 | | **Tạo báo giá** (tự bấm Xác nhận ở cảnh báo trùng đơn – địa chỉ/SĐT test dùng chung) → **mã đơn** + link báo giá |
| 7 | | **Tạo hợp đồng** → khảo sát Định danh KH (1 tầng / Nhà riêng / Không cho thuê) → **mã HĐ** + bookport |

Luồng dịch vụ khác giống trên, chỉ thay bước 3: bấm ô dịch vụ trong **Combo tùy chọn** → tự điền form (ô nào chọn trên giao diện thì theo đó,
còn lại lấy dòng đầu, số lượng 1) → **Xác nhận** → **Chi tiết giỏ hàng** → **Xác nhận**. Có thể tick **Mua kèm combo Internet**.
Nếu dịch vụ không có phương thức thanh toán đã chọn, tool dùng dòng đầu của portal và ghi vào nhật ký.

Kết quả (mã đơn, mã HĐ, bookport, link báo giá) hiện trên giao diện và lưu ở `output/orders.csv`.
Chưa làm: bước **Thanh toán** sau khi có HĐ.

## Cài đặt & chạy

```bash
cd SOP
npm install
npm run ui            # mở http://localhost:3005
# hoặc: bash install.sh  (cài thư viện + tạo icon Desktop/menu + mở giao diện)
```

Cần **Google Chrome** (hoặc Edge). Tool điều khiển 1 cửa sổ Chrome riêng (profile ở `.cache/browser-profile`, giữ phiên đăng nhập).

## Dùng giao diện

1. Lần đầu: nhập **Tài khoản / Mật khẩu** Portal SOP ở thanh trên cùng → **Lưu & đăng nhập**.
   Tool lưu vào `.env` của máy này (quyền 600), lần sau mở không cần nhập lại.
   - **Đổi tài khoản**: sửa tài khoản / mật khẩu (để trống mật khẩu = giữ nguyên).
   - **Đăng nhập lại**: xoá phiên đang lưu rồi đăng nhập bằng tài khoản đang lưu.
   - Tool luôn đăng nhập qua trang `…/user/login/basic-auth`.
2. **Khách hàng**: tool tự tải "Khách hàng của tôi" và chọn sẵn SĐT dùng lần trước; chọn lại trong danh sách, hoặc "✎ Nhập SĐT khác…" (**↻ Tải lại** để cập nhật danh sách).
   **Gói**: chọn sẵn gói dùng lần trước (lần đầu: gói đầu tiên); chọn lại trong danh sách gói theo nhóm (giá tháng, phí lắp, tổng, thiết bị), có ô lọc.
   Danh sách gói lấy từ API `package-view/list` theo địa chỉ – đổi địa chỉ thì bấm **↻ Tải gói** (~1 phút, không tạo đơn).
   **Dịch vụ khác**: chọn trên menu header → chọn gói / chu kỳ cước (bấm **↻ Tải gói** để lấy danh sách theo địa chỉ, để trống = dòng đầu trên portal).
   Dấu chấm vàng trên menu = dịch vụ đang vướng trên stag (xem ghi chú trong form). Hộp cảnh báo của portal không đọc được chữ → lỗi có link mở ảnh.
   **Chế độ chạy**: *Chạy ngầm* (mặc định, không hiện Chrome) hoặc *Hiện cửa sổ Chrome* để theo dõi → **Tạo đơn**.
3. Theo dõi nhật ký; xong thì copy mã ở khung Kết quả. Mỗi đơn ~2–3 phút.

> ⚠ Màn tạo đơn là app **Flutter** (vẽ trên canvas) nên tool bấm theo **toạ độ** với cửa sổ cố định 1440×813.
> Chạy ngầm vẫn giữ khung 1440×813. Chế độ hiện cửa sổ: đừng thao tác / thu nhỏ cửa sổ Chrome của tool khi đang chạy. Portal đổi giao diện thì phải khảo sát lại toạ độ.
> Mỗi bước có ảnh chụp ở `output/debug/<thời gian>-<bước>.png` để tra khi lỗi.

## Dòng lệnh

```bash
npm run order -- --phone 0964633310
npm run order -- --phone 0964633310 --address "123, Trương Định, Phường Bến Thành, Hồ Chí Minh" \
                 --coords "10.7733664, 106.6944494" --combo MetaF1 --index 2 --payment Napas [--no-contract] [--show]
# --combo = nhóm gói, --index = thứ tự gói trong nhóm, --show = hiện cửa sổ Chrome (mặc định chạy ngầm)

npm run order -- --phone 0833329408 --customer-type "Doanh nghiệp" [--company "Công ty TNHH ABC"] [--tax-code 0312345678] \
                 [--representative "Nguyễn Văn A"] [--org-phone 09..] [--contact-phone 09..] [--email ..] [--issue-place ..] [--gpkd-address ..]
npm run order -- --customer-types  # đối tượng KH đang hỗ trợ (Cá nhân, Doanh nghiệp)
npm run order -- --services      # danh sách id dịch vụ
npm run order -- --phone 0964633310 --service fpt-camera --field "Gói dịch vụ=..." --field "Gói tính cước=6T" [--with-internet]
```

## Cấu hình `.env` (tạo từ `.env.example`)

| Biến | Ý nghĩa |
|---|---|
| `SOP_USER`, `SOP_PASSWORD` | Tài khoản Portal SOP (nhập trên giao diện được) |
| `DEFAULT_PHONE`, `DEFAULT_ADDRESS`, `DEFAULT_COORDS`, `DEFAULT_COMBO`, `DEFAULT_COMBO_INDEX`, `DEFAULT_PAYMENT` | Giá trị mặc định của form |
| `HEADLESS` | `true` (mặc định) chạy ngầm, `false` hiện cửa sổ Chrome – chọn lại được trên giao diện |
| `UI_PORT` | Cổng giao diện (mặc định 3005) |

## Cấu trúc

```
config/environments.js   URL portal + trang đăng nhập basic-auth
config/packages-default.json  danh sách gói mẫu (khi chưa "Tải gói" lần nào)
src/core/                env (.env, tài khoản), browser (Chrome ngầm/hiện + đăng nhập), store (csv/jsonl, cache gói + DS KH), logger
src/sop/flutter.js       điều khiển Flutter web: đọc nhãn qua semantics (click xuyên), bấm toạ độ, chờ màn đổi
src/sop/order.js         luồng tạo đơn + HĐ; mã đơn/HĐ/link/bookport đọc từ response API sapi.fpt.vn
src/sop/services.js      danh mục dịch vụ, bộ điền form chung (đọc tên ô qua semantics), giỏ hàng
src/sop/customer.js      đối tượng KH (Cá nhân / Doanh nghiệp) + form doanh nghiệp
src/server.js, cli.js    giao diện web (cổng 3005) + dòng lệnh
khao-sat/                ghi chép khảo sát (KHAO_SAT.md) + script khảo sát (Chrome debug 9333, netlog chỉ ghi KEY)
```

## Bảo mật

- **Không commit** `.env`, `.cache/`, `output/` (gồm cả `packages.json`, `customers.json`) (mật khẩu, phiên đăng nhập, dữ liệu KH test).
- Server chỉ nghe `127.0.0.1`, chỉ nhận JSON (trang web lạ không gửi lệnh đổi tài khoản được), không trả mật khẩu ra giao diện.
