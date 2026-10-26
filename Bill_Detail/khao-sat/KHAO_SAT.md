# Tool tra cứu chi tiết hóa đơn (thay màn "Liệt kê cước" trên inside.fpt.net)

Khảo sát ngày 2026-10-19.

## Mục tiêu
Nhập **Số hợp đồng** → hiển thị **danh sách hóa đơn** → click 1 hóa đơn → hiển thị **chi tiết hóa đơn**
đầy đủ các trường như inside hiện tại. Lý do: inside hay timeout → gọi thẳng API cho nhanh.

## Luồng trên inside (UI)
`http://inside.fpt.net/` → menu trái ô tìm kiếm "liệt kê cước" → Quản lý Kế toán > Liệt kê cước
→ Điều kiện lọc: Vùng miền (HCM), Tìm theo = Số hợp đồng, Bằng = `sgh835870`, Chính xác → **Xem báo cáo**
→ tab "Báo cáo tổng hợp" (bảng hóa đơn) → click số hóa đơn → tab "Chi tiết của Hóa đơn".

## Kiến trúc
- `inside.fpt.net` = ASP cũ, frame; nội dung thật là iframe cross-origin:
  `http://mvc.inside.fpt.net/InternetSubs/Accounting/BillHistoryNew?vUrl=/Functions/InternetSubs/Accounting/BillHistory/&vTable=CustomerEx&vR197011=<random>`
- Mở URL iframe ở tab riêng vẫn chạy (khi đã có cookie SSO).
- Auth: **cookie SSO**, chưa đăng nhập → 302 về `http://login-stag.fpt.net/?urlreturn=...` (môi trường STAG).
- jQuery 1.9.1, logic ở `/Scripts/InternetSubs/BillHistoryNew/View_9.js` (đọc file này để biết giá trị param).

## Form ids (trang BillHistoryNew)
`ddlBranch` (vùng), `ddlField` (tìm theo), `txtData` (từ khoá), `ddlSearch` (chính xác/gần đúng),
`ddlCServ` (loại HĐ), `ddlQCrit` (loại), `ddlQMont`, `ddlQYear`, `btnLS_ViewReport`, hidden `txtDate1`, `txtDate2`.

## API (base `http://mvc.inside.fpt.net`)
| Bước | Method + path | Params | Kết quả |
|---|---|---|---|
| 1 Tìm HĐ | `POST /InternetSubs/Accounting/LayoutSearch20/onLS_ViewReport` (form-urlencoded, X-Requested-With) | `LocationID, Search, KeywordSup, Keyword` | JSON `{data, msg}` → lấy `vID` (ObjID) |
| 2 Danh sách | `GET /InternetSubs/Accounting/BillHistoryNew/LoadReport` | `vID, QMont, QYear, IsSSTCus=0` | **JSON** `{data, msg}` ~310KB (242 dòng cho sgh835870), `data` là chuỗi JSON lồng |
| 3 Chi tiết | `GET /InternetSubs/Accounting/LayoutSearch20/GetPartialPublicDetail` | `BillNumber, ObjID, Month, Year` | HTML ~41KB, 3 table; **gọi thẳng OK chỉ với cookie** |

- Link hóa đơn trong bảng: `onclick="MJS.onViewPublicDetail({BillNumber:'U24SG00103292', ObjID:'1054648943', Month:'6', Year:'2024'})"`
  → parse ra tham số cho bước 3.
- Các call phụ khi xem báo cáo (không cần cho mục tiêu): CheckDate, Check, CheckBillReplace, CheckSAL, CheckCusHONew,
  SSTCus, GetInfoObjID, CheckAdvance, ObjectDA, VIP, Reason, LoadToken, LoadTokenIAM, Payment, NameCustomerEx, View_9,
  LoadGTBB (cần accessToken), LoadAmountPTTN (cần accessTokenIAM).

## Trường của màn chi tiết hóa đơn
Header: Số hóa đơn, Ngày phát hành, Mã số thuế KH, Tổng số tiền, Đơn vị, Tên truy nhập, Kính gửi, Mã khách hàng,
Địa chỉ, Mã định danh, Số hộ chiếu, Mã QHNS, Cước phí từ ngày / đến ngày.
Bảng Chi tiết: STT, Khoản, Items, Số tiền, Cộng, Thuế suất GTGT, Tiền thuế, Số tiền bằng chữ, Tổng cộng.
Bảng Thông tin chi tiết loại dịch vụ: STT, Số HĐ, Loại DV, Số tiền thanh toán, Nội dung, Từ ngày, Đến ngày, Số lượng, Đơn giá (sau VAT).
Bảng Chi tiết dịch vụ Telecom: STT, Số HĐ, Loại DV, Nội dung, Số tiền, VAT, VAT Rate, Tổng tiền, Tên sale bán.
→ Cách đơn giản nhất: render lại nguyên HTML partial của bước 3 (giữ đủ trường).

## Khảo sát bổ sung 2026-10-20 (đã chốt)
- Script form tìm kiếm = inline trong trang BillHistoryNew (`onViewReport`): `LocationID=ddlBranch` (8 = HCM),
  `Search=ddlField` (**4 = Số hợp đồng**), `KeywordSup=ddlSearch` (**1 = Chính xác**), `Keyword=txtData`.
  Kết quả `data` (chuỗi JSON) → `[{STT, PaymentAddress, Contract, ID, LocationID, Name, StatusDesc, Location}]`, `ID` = ObjID.
- Tìm theo số HĐ **không phụ thuộc LocationID** (8 / 4 / -1 / 0 đều ra cùng kết quả).
- `LoadReport` trả JSON, field chính: `BillNumber, BillDate (/Date(ms)/), Content, BranchCode, Digital (1 điện tử/0 giấy), Amount,
  PaidTotal, PaidAction (>0 = đã hủy), PaidType/PaidTypeName, LastPaidDate, PaymentDetailReceipt, SalesName, ObjID, Month, Year…`
  Lỗi trả `msg:"error"` + SqlException trong `data`.
- Đo thời gian (gọi trong trình duyệt): tìm HĐ 13ms · **LoadReport toàn bộ 15.3s** (chỗ chậm) · LoadReport `QYear=2024` 0.5s · chi tiết 2.4s.
- Chi tiết: HTML 41KB, 3 bảng render sẵn phía server, 1 `<style>` + 2 script (biến `dt4` không dùng, chặn copy) → bỏ script vẫn đủ.
- Đăng nhập: `login-stag.fpt.net` → Keycloak `iam-stag.fpt.net` (realm fpt, client `inside_portal`).
- Stack chốt: Node thuần + playwright-core (giống các tool khác), UI web cổng 3003 – xem `../README.md`.

## Đăng nhập bằng tài khoản + mật khẩu (không qua IAM) – 2026-10-20
- `login-stag.fpt.net` vẫn có form cũ (`fUserName`, `fPassword`, `fOTP` + checkbox "Sử dụng OTP"); trang tự bấm
  "ĐĂNG NHẬP VỚI IAM" bằng JS nên trình duyệt mới bị chuyển sang IAM.
- Nút "ĐĂNG NHẬP" gọi `POST /Login` (form-urlencoded) `UserName, Password, OTP, Token='', IAM=false, urlReturn`
  → JSON `{status: 1, token}`; lỗi `status: -1` + `errDescription` (`Invalid user credentials`, `Account is not fully set up`, `Account disabled`).
- Sau đó trình duyệt chuyển tới `urlReturn?Token=<token>` → mvc.inside đổi token lấy cookie phiên.
- Tool làm đúng 2 bước này bằng HTTP (src/core/auth.js), không cần Playwright.
