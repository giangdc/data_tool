# FTMS Data Tool

Tool hỗ trợ QC tạo nhanh dữ liệu test trên hệ thống **FTMS stag**, thay vì phải đi tay từng bước trên BMS.

**Phiên bản 1.5.0**: chạy trọn luồng BMS **Tạo cơ hội → Duyệt cơ hội → (Khảo sát) → Tạo yêu cầu HĐ → BGĐ duyệt yêu cầu HĐ** (kết quả: cơ hội có số HĐ + mã đăng ký `CMR…`, trạng thái "Chờ DEM duyệt").
Người dùng chỉ chọn **Nhóm dịch vụ + Loại dịch vụ** (+ AM/TPP/BGĐ nếu muốn), các trường còn lại tool tự sinh ngẫu nhiên hợp lệ.

| Bước | Tool làm gì |
|---|---|
| 1. Tạo cơ hội | Tạo khách hàng mới + cơ hội (1 dịch vụ), gửi TPP đánh giá / BGĐ phê duyệt |
| 2. Duyệt cơ hội | Đánh giá **Đạt** toàn bộ tiêu chí (BMS thường tự phê duyệt luôn) |
| 3. Khảo sát *(chỉ dịch vụ Kênh truyền – LeasedLine)* | Tạo Công việc khảo sát trên BMS → phiếu khảo sát trên tool **SM** (1 địa chỉ ONNET ở HCM) → nhập kết quả **Thành công** → BMS ghi nhận "Khảo sát thành công" |
| 4. Tạo yêu cầu HĐ | Ghi chú giai đoạn, tạo báo giá **1đ** (kèm PDF mẫu), gửi YC HĐ dịch vụ trả sau. LeasedLine: tự lấy địa chỉ đã khảo sát + khai cước trên SM |
| 5. BGĐ duyệt YC HĐ | Phê duyệt → BMS cấp số HĐ + mã đăng ký CMR, chuyển "Chờ DEM duyệt" |

## 1. Yêu cầu

| Hạng mục | Yêu cầu |
|---|---|
| Hệ điều hành | Ubuntu / Linux x64 (CLI và giao diện web chạy được trên mọi OS có Node; icon desktop chỉ hỗ trợ Ubuntu/GNOME) |
| Node.js | **>= 20.12** (kèm npm). Kiểm tra: `node -v` |
| Trình duyệt | **Google Chrome** hoặc **Microsoft Edge** đã cài (tool dùng để đăng nhập SSO, chạy ẩn) |
| Mạng | Truy cập được `https://ftms-stag.fpt.net` (thường không cần VPN) |
| Tài khoản | Tài khoản FTMS + **mã OTP dùng chung** (hỏi người phụ trách tool) |

Chưa có Node? Cài nhanh bằng nvm:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc && nvm install 22
```

## 2. Cài đặt (git clone)

```bash
git clone https://github.com/giangdc/ToolFTMS.git ~/ftms-data-tool
cd ~/ftms-data-tool
bash install.sh
```

`install.sh` sẽ: cài thư viện (`npm ci`) → tạo icon **FTMS Data Tool** trên Desktop + menu ứng dụng → bật server và mở `http://localhost:3000`.

> Không dùng icon desktop (hoặc không phải Ubuntu)? Chạy `npm install` rồi `npm run ui`.

**Cập nhật bản mới:**
```bash
cd ~/ftms-data-tool
bash scripts/launch-ui.sh stop
git pull && npm ci --omit=dev
bash scripts/launch-ui.sh        # bật lại rồi F5 trình duyệt
```
OTP (`.env`), phiên đăng nhập (`.cache/`) và lịch sử dữ liệu (`output/`) không nằm trong git nên được giữ nguyên.

**Gỡ cài đặt:**
```bash
bash ~/ftms-data-tool/scripts/launch-ui.sh stop
rm -f ~/Desktop/ftms-data-tool.desktop ~/.local/share/applications/ftms-data-tool.desktop
rm -rf ~/ftms-data-tool      # xóa luôn OTP + lịch sử output/, sao lưu trước nếu cần
```

> Máy không có Internet ra GitHub / không cài được Node: dùng bản đóng gói `.tar.gz` (kèm sẵn Node), xem [INSTALL.md](INSTALL.md).

## 3. Sử dụng giao diện web (khuyến nghị)

Mở bằng icon **FTMS Data Tool**, hoặc `npm run ui` → `http://localhost:3000`.

1. **Lần đầu:** trên header hiện ô **OTP** → nhập OTP dùng chung → lưu (ghi vào `.env`, chỉ làm 1 lần).
2. **Đăng nhập:** nhập tên tài khoản (vd `giangdc2`, không cần `@fpt.com`) → **Đăng nhập**. Chấm xanh + tên hiện lên là thành công.
3. Chọn tab chức năng:

| Tab | Cách dùng |
|---|---|
| **Tạo cơ hội** | Chọn Nhóm DV → Loại DV, AM (mặc định `giangdc2`), TPP/BGĐ (chọn sẵn ngẫu nhiên, đổi được), số lượng → **Tạo cơ hội** |
| **Duyệt cơ hội** | Nhập 1 hoặc nhiều mã `CH…` (cách nhau dấu phẩy / xuống dòng) → **Duyệt** |
| **Khảo sát** | Nhập mã cơ hội **đã duyệt** có dịch vụ LeasedLine → **Tạo KS** (BMS báo "cần khảo sát trước khi lên yêu cầu Hợp đồng" thì làm bước này) |
| **Tạo yêu cầu HĐ** | Nhập mã cơ hội **đã duyệt** → **Tạo HĐ** |
| **Duyệt yêu cầu HĐ** | Nhập mã cơ hội có YC HĐ đang "Chờ BGĐ duyệt" → **BGĐ duyệt** |

4. **Bảng Kết quả** (bên phải, dùng chung các tab): tab *Lần này* / *Lịch sử*, cột trạng thái, và nút thao tác bước kế tiếp ngay trên từng dòng:

| Trạng thái cơ hội | Nút trên dòng |
|---|---|
| Chờ TPP đánh giá / Chờ BGĐ phê duyệt | **Duyệt CH** |
| Đã duyệt, dịch vụ LeasedLine chưa khảo sát ("KS: Cần khảo sát") | **Tạo KS** |
| Đã duyệt, chưa có YC HĐ (không cần KS hoặc "KS: thành công") | **Tạo HĐ** |
| YC HĐ "Chờ BGĐ duyệt" | **BGĐ duyệt** |
| YC HĐ "Chờ DEM duyệt" (hiện Số HĐ) | – (bước DEM chưa hỗ trợ) |

Nút *↻ Trạng thái* tải lại trạng thái từ BMS; có nút Copy mã và mở nhanh cơ hội trên BMS.

> ⚠ **Quyền:** các thao tác duyệt chạy bằng **tài khoản đang đăng nhập**.
> - Duyệt cơ hội: TPP/BGĐ của cơ hội hoặc tài khoản admin (vd `chuyennt5`). Tài khoản sale sẽ báo "không có quyền".
> - Khảo sát: nên dùng admin (vd `chuyennt5`) – cần quyền trên tool SM.
> - Tạo YC HĐ: AM của cơ hội hoặc admin.
> - BGĐ duyệt YC HĐ: BGĐ được chọn hoặc admin.
>
> Mẹo chạy trọn luồng nhanh nhất: đăng nhập bằng tài khoản admin rồi bấm lần lượt **Tạo cơ hội → Duyệt CH → (Tạo KS) → Tạo HĐ → BGĐ duyệt** trên bảng Kết quả.

## 4. Sử dụng dòng lệnh (CLI)

```bash
npm start                                                       # menu tương tác
npm run login -- -u giangdc2                                    # đăng nhập lại (đổi tk / lỗi phiên)
npm run services -- -u giangdc2                                 # xem danh sách Nhóm/Loại DV + id
npm run create-opp -- -u giangdc2 -g "Cloud partner" -t "Azure" -n 3
npm run create-opp -- -u giangdc2 -g 2000 -t 2002 --am giangdc2 --tpp <tk> --bgd <tk>
npm run approve -- -u chuyennt5 CH00086386 CH00086387          # duyệt cơ hội
npm run survey -- -u chuyennt5 CH00086403                       # khảo sát dịch vụ LeasedLine
npm run contract -- -u giangdc2 CH00086386                      # tạo yêu cầu HĐ
npm run approve-contract -- -u chuyennt5 CH00086386             # BGĐ duyệt yêu cầu HĐ
```
`--tpp` / `--bgd` bỏ trống = chọn ngẫu nhiên trong danh sách hợp lệ của AM.

## 5. Dữ liệu sinh ra

| Phần | Giá trị |
|---|---|
| Tên cơ hội | `[AUTO-QC] <Loại DV> - <MMdd-HHmm-ss>-xxx` |
| Khách hàng | **Luôn tạo mới**: Tổ chức – DN trong nước, tên chứa `AUTO-QC`, MST 10 số ngẫu nhiên, tỉnh/phường ngẫu nhiên, email `autoqc.xxxxxx@example.com` |
| Doanh thu / % thành công / Dự kiến kết thúc | Ngẫu nhiên 10tr–500tr / 10–90% / +15..180 ngày |
| Độ ưu tiên / Tạo dự án / Tài liệu | Trung bình / Không / Không |
| Báo giá | 1đ, file PDF mẫu |
| Khảo sát (LeasedLine) | 1 địa chỉ ONNET ở TP.HCM (đường `AUTO-QC`, phường ngẫu nhiên), băng thông 100, liên hệ = người đại diện KH; Thuê bao: Hạ tầng FTI, Access: FTI, Core: NOC – tất cả **Thành công** |
| Yêu cầu HĐ | HĐ dịch vụ trả sau, cước 1đ + 1đ/tháng × 1 tháng, hiệu lực hôm nay, công nợ 30 ngày, vùng miền ngẫu nhiên HCM/HN; liên hệ = người đại diện + địa chỉ KH |

Mọi dữ liệu có tiền tố `AUTO-QC` (đổi bằng `DATA_PREFIX` trong `.env`) để dễ lọc/dọn.
Kết quả lưu ở `output/` (mở bằng Excel): `opportunities.csv`, `surveys.csv`, `contracts.csv`, `contract-approvals.csv` (+ file `.jsonl` đầy đủ payload).

## 6. Cấu hình `.env`

Tạo bằng `cp .env.example .env` (hoặc để giao diện tự tạo khi nhập OTP). **Không commit `.env`.**

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `FTMS_OTP` | – | OTP dùng chung (bắt buộc; nhập qua giao diện được) |
| `FTMS_ENV` | stag | Môi trường (`config/environments.js`) |
| `FTMS_EMAIL_DOMAIN` | fpt.com | Ghép vào tên tài khoản |
| `FTMS_USER` | – | Tài khoản mặc định |
| `BMS_AM` | giangdc2 | AM mặc định khi tạo cơ hội |
| `DATA_PREFIX` | AUTO-QC | Tiền tố tên cơ hội/KH |
| `HEADLESS` | true | `false` để xem trình duyệt khi debug đăng nhập |
| `UI_PORT` | 3000 | Cổng giao diện web |
| `BROWSER` | auto | auto / chrome / msedge / chromium |
| `UI_HOST`, `UI_AUTH` | 127.0.0.1, – | Chạy trên server dùng chung, xem [DEPLOY-SERVER.md](DEPLOY-SERVER.md) |

## 7. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| `Không tìm thấy Node.js` / `npm` | Cài Node >= 20.12 (mục 1) rồi chạy lại `bash install.sh` |
| `⚠ Không thấy Google Chrome / Microsoft Edge` | Cài Chrome: https://www.google.com/chrome/ |
| Bấm icon không thấy gì | Xem log: `cat ~/ftms-data-tool/output/ui-server.log` |
| Cổng 3000 bị chiếm | Thêm `UI_PORT=3010` vào `.env`, tắt/mở lại tool, vào `http://localhost:3010` |
| Đăng nhập báo sai tài khoản / OTP | Kiểm tra tên tk; đổi OTP bằng nút **Đổi OTP** trên header |
| Đăng nhập treo / quá thời gian | Kiểm tra mạng tới `https://ftms-stag.fpt.net`; xem ảnh lỗi trong `output/debug/`; thử `HEADLESS=false` |
| Báo "không có quyền" khi duyệt | Đăng nhập bằng tài khoản có quyền (xem mục 3) |
| Tạo HĐ báo "cần khảo sát trước khi lên yêu cầu Hợp đồng" | Bấm **Tạo KS** (tab Khảo sát) trước, rồi Tạo HĐ |
| Sau `git pull` không thấy nút/tính năng mới | Tắt server (`bash scripts/launch-ui.sh stop`) rồi mở lại |

## 8. Phát triển

```
config/environments.js   URL theo môi trường
src/cli.js               CLI (menu + lệnh)
src/server.js            Server giao diện web + API nội bộ
public/index.html        Giao diện web (HTML/CSS/JS thuần)
src/core/                env, auth (SSO + OTP qua Playwright), http client, lưu kết quả
src/data/random.js       Bộ sinh dữ liệu ngẫu nhiên
src/bms/                 masterData, customer, opportunity, approval, survey (BMS + SM), contract
scripts/                 launch-ui.sh (bật/tắt), install-launcher.sh (icon), build-package.sh (đóng gói tar.gz)
```

Ghi chú kỹ thuật chi tiết (API BMS đã khảo sát, quyết định thiết kế, cách thêm chức năng): [CLAUDE.md](CLAUDE.md).
Đóng gói bản offline: `npm run build` → `dist/ftms-data-tool-<ver>-linux-x64.tar.gz`.
