# SOP Order Tool – Tạo đơn Internet + hợp đồng trên Portal SOP

Tạo nhanh **đơn Internet + hợp đồng** trên **Portal SOP stag** (https://portal-sop-stg.fpt.vn) cho khách hàng có sẵn,
thay cho việc bấm tay ~20 bước:

| Bước | Màn | Tool làm gì |
|---|---|---|
| 1 | Portal – Khách hàng của tôi | Tìm KH theo **SĐT** → mở chi tiết → tab Đơn hàng → **Thêm đơn hàng → Bán mới** |
| 2 | Sale Platform – Tạo báo giá | **Địa chỉ**: gõ vào ô Tìm kiếm trên bản đồ → chọn kết quả đầu → form tự điền + toạ độ → Xác nhận |
| 3 | | Chọn **combo gợi ý** (GigaF1/F2, MetaF1/F2, SkyF1/F2) + gói thứ N |
| 4 | | Đổi **phương thức thanh toán** (mặc định portal "FRT Thu Hộ" bị stag báo không hỗ trợ → tool chọn **Napas**) |
| 5 | | Thông tin KH → Cập nhật → **Xác nhận & Lưu** (Họ tên + SĐT là đủ) |
| 6 | | **Tạo báo giá** (tự bấm Xác nhận ở cảnh báo trùng đơn – địa chỉ/SĐT test dùng chung) → **mã đơn** + link báo giá |
| 7 | | **Tạo hợp đồng** → khảo sát Định danh KH (1 tầng / Nhà riêng / Không cho thuê) → **mã HĐ** + bookport |

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
2. Nhập **SĐT khách hàng** (KH phải có trong "Khách hàng của tôi" của tài khoản), sửa địa chỉ / combo / gói / PTTT nếu cần → **Tạo đơn**.
3. Theo dõi nhật ký; xong thì copy mã ở khung Kết quả. Mỗi đơn ~2–3 phút.

> ⚠ Màn tạo đơn là app **Flutter** (vẽ trên canvas) nên tool bấm theo **toạ độ** với cửa sổ cố định 1440×813.
> Đừng thao tác / thu nhỏ cửa sổ Chrome của tool khi đang chạy. Portal đổi giao diện thì phải khảo sát lại toạ độ.
> Mỗi bước có ảnh chụp ở `output/debug/<thời gian>-<bước>.png` để tra khi lỗi.

## Dòng lệnh

```bash
npm run order -- --phone 0964633310
npm run order -- --phone 0964633310 --address "123, Trương Định, Phường Bến Thành, Hồ Chí Minh" \
                 --combo MetaF1 --index 2 --payment Napas [--no-contract]
```

## Cấu hình `.env` (tạo từ `.env.example`)

| Biến | Ý nghĩa |
|---|---|
| `SOP_USER`, `SOP_PASSWORD` | Tài khoản Portal SOP (nhập trên giao diện được) |
| `DEFAULT_PHONE`, `DEFAULT_ADDRESS`, `DEFAULT_COMBO`, `DEFAULT_COMBO_INDEX`, `DEFAULT_PAYMENT` | Giá trị mặc định của form |
| `HEADLESS` | `true` chạy ẩn trình duyệt, `false` (mặc định) hiện cửa sổ để theo dõi |
| `UI_PORT` | Cổng giao diện (mặc định 3005) |

## Cấu trúc

```
config/environments.js   URL portal + trang đăng nhập basic-auth
src/core/                env (.env, tài khoản), browser (Chrome + đăng nhập), store (csv/jsonl), logger
src/sop/flutter.js       điều khiển Flutter web: đọc nhãn qua semantics (click xuyên), bấm toạ độ, chờ màn đổi
src/sop/order.js         luồng tạo đơn + HĐ; mã đơn/HĐ/link/bookport đọc từ response API sapi.fpt.vn
src/server.js, cli.js    giao diện web (cổng 3005) + dòng lệnh
khao-sat/                ghi chép khảo sát (KHAO_SAT.md) + script khảo sát (Chrome debug 9333, netlog chỉ ghi KEY)
```

## Bảo mật

- **Không commit** `.env`, `.cache/`, `output/` (mật khẩu, phiên đăng nhập, dữ liệu KH test).
- Server chỉ nghe `127.0.0.1`, chỉ nhận JSON (trang web lạ không gửi lệnh đổi tài khoản được), không trả mật khẩu ra giao diện.
