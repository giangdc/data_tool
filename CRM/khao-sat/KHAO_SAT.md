# Khảo sát CRM stag – luồng Cơ hội → Báo giá → Đơn hàng (19/10/2026)

Tool "anh em" của FTMS Data Tool (`../bms`) và FPT.vn Order Tool (`../Tao_DH`) – dự kiến cùng khuôn (Node thuần, UI 1 file, CLI, output jsonl/csv).

## 1. Mục tiêu (user yêu cầu)
- Tool tạo data đơn hàng CRM, **mặc định load theo cơ hội mẫu** `https://crm-stag.fpt.net/opportunity/01a1440e-6275-79bd-98d9-289e568e5531`.
- Luồng lên đơn: **Tạo cơ hội → Tạo báo giá → Đánh dấu version → Chờ 5 phút → Tạo đơn hàng**.

## 2. URL / hệ thống
- Web: `https://crm-stag.fpt.net` (Next.js turbopack, antd). Đăng nhập `/signin`: chọn tenant (FTEL) + Email/Password, hoặc "Đăng nhập bằng IAM" (`/auth/sso-iam`).
- API: `https://crm-api-stag.fpt.net/crm/<service>/api/...`, axios + Bearer. Service đã thấy:
  - `administration-service`: `accounts/my-profile`, `notifications/*`, `file/download`, `auth/{logout,sso-iam,refresh}`
  - `sales-management`: `opportunity/{id}`, `opportunity/{id}/agreement-codes`, `task-assignment/{id}/tasks`, `sale-activity/activities-log`, `agreement/...`
  - `product-catalog-management`: `api/quotes`, `catalogs/{product-catalog,product-offering}`
- Bundle JS công khai (`/_next/static/chunks/*.js`) → grep endpoint được (chunk trang chỉ tải sau khi login; danh sách lấy bằng `performance.getEntriesByType('resource')`).

## 3. Cơ hội mẫu CH2610160004 "qc test nha"
| Trường | Giá trị |
|---|---|
| id | 01a1440e-6275-79bd-98d9-289e568e5531 |
| AM | Nguyễn Viết Hoàng (stag_hoangnv75) – Sale chính 51% |
| Khách hàng / Người liên hệ | qc tets (TK2610160001) / test |
| Người duyệt | stag_thaodt51 |
| Ưu tiên / Doanh thu kỳ vọng / Khả năng TC | Trung bình / 500.000 / 50% |
| Dự kiến chốt HĐ | 31/10/2026 · Kênh: Kinh doanh trực tiếp |
| Sản phẩm (danh mục FPT Play SME?) | Hospitality: CMS & Launcher Hospitality – Dịch vụ lắp đặt CMS Basic; Gói nội dung Hospitality – Gói nội dung Hotel 3 Basic; CMS & Launcher Hospitality – Dịch vụ CMS Basic |
| Giai đoạn | Khảo sát/Tiếp cận → Demo/Tư vấn → Chào giá → Đàm phán → Kết thúc - Thành công |
| HĐ | SGABP4951 (Bình thường) |

## 4. Báo giá CH2610160004_BG01 (`/quote/0914bafa-6ec4-4f63-026d-3a24563c58f4`)
- Version V1: 190.000đ, hiệu lực 16/10–14/11/2026, **Id chính sách 28012** (Đã ban hành), Trạng thái phê duyệt "Hệ thống duyệt".
- Nút trên dòng version: 👁 xem · Download · ✔ **"KH đã chọn"** (= bước *Đánh dấu version*).
- API: `GET quotes/{id}`, `GET quotes/quote-version`, **`PUT quotes/version-selection`** (đánh dấu version – body chưa bắt), `quotes/preview-version`, `quote-version/approve(s)`, `quotes/v2/{id}`, `quotes/cancel-policy`.

## 5. Đơn hàng DH2610160004-001 (`/order/01a14412-72b9-7fec-b8ca-a3efa35701cc`)
- Mã version báo giá `CH2610160004_BG01_V1`, KH `TK2610160001 - qc tets`, trạng thái **Đang thực hiện**, tab Tổng quan / Triển khai.
- Dòng: Gói nội dung Hotel 3 Basic 1×80.000 (1 tháng) · Dịch vụ CMS Basic 1×10.000 (1 tháng) · Dịch vụ lắp đặt CMS Basic 2×50.000 (1 lần) – VAT 10% – tổng 190.000.
- Liên quan: `agreement/{quoteVersionId?}/detail-for-order`, `createAgreement` (POST multipart `agreement`: documentType, agreementType, **quoteVersionId**, isPaymentRecorded, agreementCode, localTypeId, paymentMethod, signDate/startDate/endDate, status, description, billingAddress.*, deploymentAddress[i].*, files) – **chưa xác nhận** đây là nút "Tạo đơn hàng".

## 6. Form Tạo cơ hội (`/opportunity/create`, 2 bước)
1. Thông tin cơ hội: Tên*, AM phụ trách*, Mức độ ưu tiên (Trung bình), Doanh thu kỳ vọng, Khả năng thành công %, Ngày dự kiến chốt HĐ, Nguồn cơ hội, Kênh bán hàng, Mô tả · KH liên quan: **Khách hàng** (có hồ sơ – tìm theo mã TK/MST/CCCD) hoặc **KH tiềm năng** · Người liên hệ* · Danh mục sản phẩm* (FPT Camera SME / FPT Play SME) · Thêm nhân sự (AM = Sale chính, %).
2. Thông tin phê duyệt.
- Danh sách cơ hội có tab Đã duyệt / Chờ duyệt / Từ chối → cơ hội cần duyệt.

## 7. Chạy thật trên UI (19/10/2026, tk stag_hoangnv75) – data test: CH2610190003 / CH2610190003_BG01

### 7.1 Tạo cơ hội – `POST /sales-management/api/opportunity` → `data: <oppId guid>`
Response chuẩn: `{data, status:"OK"|"NOTOK", error:{code,message,details}, statusCode, message, systemName}` – lỗi nghiệp vụ HTTP 400 + `error.message` tiếng Việt.
```jsonc
{ "description": "", "saleLeadId": null, "name": "[AUTO-QC] Hospitality - khao sat tool", "sourceId": null,
  "saleId": "<empId AM>",                       // stag_hoangnv75 = 01993d24-553a-7ad8-a1cd-f909fa6e7c0e
  "services": [{ "oppId": null, "serviceGroupId": "<Sản phẩm: Hospitality fb8a21c8-…>", "serviceTypeId": "<Gói DV: CMS & Launcher 4bdecf12-…>", "prodSpecCharId": "<DV quan tâm: CMS Basic ed19d923-…>" }],
  "members": [{ "empId", "email", "name", "percentage": 100, "roleMembers": [1], "isPrimary": true, "roleMember": 0 }],
  "selectedMembers": ["<empId>"], "priority": 2 /*Trung bình*/, "partyType": 2 /*KH tiềm năng*/, "partyClassification": 1 /*Tổ chức – Trong nước*/,
  "channelId": "00b17ef3-442b-420f-9c95-07a200a87cf9" /*Kinh doanh trực tiếp*/, "expectedRevenue": 500000, "successRate": 50,
  "endDate": "2026-10-30T17:00:00.000Z" /*31/10 giờ VN*/, "prospectContactName": "AUTO-QC Lien He", "prospectContactInfo": "0912345678",
  "productCatalogId": "7ebaa204-e30d-4483-a270-f46cad38a21a" /*FPT Play SME*/, "productSpecByIndex": [],
  "userCanApproval": "<empId người phê duyệt>" /*stag_thaodt51 = 01993d24-0b02-71a7-bd43-65f1f4c3f86f*/,
  "saleLeadNote": null, "opportunityType": 0, "dealSizeId": 1, "supportTechFlag": 1, "isHasSpecification": true }
```
- Master data: `GET product-catalog-management/api/catalogs/product-offering?productCatalogId=` (Sản phẩm/Gói), `…/product-specification-characteristics?productOfferingId=&productSpecificationId=&isHasSpecification=&productType=&isActive=`, `…/product-specification-characteristic-values?prodSpecCharId=&isImplementationFee=&productType=` (DV quan tâm), `GET administration-service/api/employee/manager-approvement?managerType=` (người phê duyệt).
- KH tiềm năng: chỉ cần Loại KH + Phân loại + Tên/Thông tin liên hệ ("sẽ tạo hồ sơ chính thức khi cơ hội sang giai đoạn ký hợp đồng").
- Cơ hội mới ở giai đoạn Khảo sát/Tiếp cận, **tạo báo giá được ngay** (không cần chờ duyệt).

### 7.2 Tạo báo giá – `/quote/create?opportunityId=` → `POST /product-catalog-management/api/quotes` → `data: <quoteId>`
```jsonc
{ "name": "19/10/2026 CMS & Launcher Hospitality", "refId": "<oppId>", "targetType": 1, "memberId": "<empId NV tư vấn>", "surveyCode": null, "organizationCode": 1,
  "quoteVersion": { "description": null, "effective": "2026-10-19T16:59:59.999Z", "expiration": "2026-11-17T16:59:59.999Z" /*+29 ngày*/, "monthValue": null,
    "extraClause": "<điều khoản mặc định ~740 ký tự>", "quoteActionType": 1, "legalEntityInformation": 1,
    "quoteItems": [ { "productId": "4bdecf12-…", "quantity": 1, "name": "Dịch vụ CMS Basic", "unitOfMeasure": 2, "unitOfMeasureText": null,
                      "productPrice": 10000, "vatRate": 10, "discountValue": null, "quoteDiscountType": 1, "productType": 1 },
                    { "productId": "6085ef84-…", "quantity": 1, "name": "Dịch vụ lắp đặt CMS Basic", "productPrice": 50000, "productType": 2 /*phí khởi tạo*/, … } ],
    "quotePaymentTerm": { "paymentType": 1 /*Trả tháng*/, "paymentRequest": 1 /*Toàn bộ*/, "paymentTerm": 15 /*ngày, mặc định*/, "paymentTermNotes": null },
    "customerType": 1 /*Khách hàng cũ*/ },
  "isCreateNew": true }
```
- Form tự nạp dòng "Cước phí gói DV thuê bao/tháng" từ DV của cơ hội; **lỗi 400 "Số lượng gói dịch vụ thuê bao phải bằng số lượng phí khởi tạo dịch vụ & thiết bị triển khai."** → phải thêm 1 dòng "Phí khởi tạo dịch vụ & Thiết bị triển khai" (Thêm SPDV: Hospitality / CMS & Launcher / Dịch vụ lắp đặt CMS Basic 50.000) cho mỗi gói thuê bao. Giá niêm yết lấy từ `…/product-specification-characteristic-values/{id}`.
- Sau tạo: version V1 `state: 6` (Trạng thái phê duyệt "Hệ thống duyệt"), `isSelected: false`, chưa có Id chính sách.

### 7.3 Đánh dấu version – nút "Đánh dấu version KH chọn" (header bảng) → modal chọn version → `PUT /product-catalog-management/api/quotes/version-selection`
```json
{ "quoteId": "<quoteId>", "quoteVersionId": "<versionId>" }   →  { "data": true }
```
- Ngay sau đó version có **Id chính sách 28029**, Trạng thái chính sách **"Đang được ban hành"** (enum: 1 Đã ban hành/Approved, 2 Rejected, 3 Đã hủy, 4 Đang được ban hành/InProgress), `isSelected: true`.
- Lấy danh sách version: `GET quotes/quote-version?quoteId=&refId=&page=&fetch=&keyword=`.

### 7.3b Tạo version mới – nút "Tạo version mới" → `/quote/create-version?quoteId=` → `POST /product-catalog-management/api/quotes/quote-version`
```jsonc
{ "quoteId", "isInCreateQuoteVersion": true, "quoteActionType": 1, "description": "<Mô tả version – BẮT BUỘC từ V2>",
  "effective", "expiration", "monthValue": null, "legalEntityInformation": 1, "extraClause",
  "quoteItems": [ {CMS Basic 10.000 productType 1}, {"productId": "07c24d98-8b48-4bdc-8ec3-9ad0a085e5c8", "name": "Gói nội dung Hotel 3 Basic", "productPrice": 80000, "productType": 1},
                  {"productId": "6085ef84-84ce-427b-ba6d-596fb38fa8bb", "name": "Dịch vụ lắp đặt CMS Basic", "quantity": 2, "productPrice": 50000, "productType": 2} ],
  "quotePaymentTerm": {...}, "customerType": 1 }   →  { "data": {} }
```
- Rule "số lượng thuê bao = số lượng phí khởi tạo" tính theo **tổng quantity** (2 gói thuê bao ↔ lắp đặt × 2), giống báo giá mẫu.

### 7.4 Chờ 5 phút → Tạo đơn hàng
- Nút **"Tạo đơn hàng"** trên dòng version chỉ hiện khi `canCreateOrder` (field của quote-version) = true → chuyển `/order/create?quoteVersionId=<versionId>`.
- API đơn hàng (service `sales-management`?, base `${g}/order`): `POST /order` (createOrder), `GET /order` (list), `GET /order/{id}`, `POST /order/spf`, `POST /order/deployment` (activeDeployment), `/order/{id}/histories`, `/order/{id}/cancel-all`, `/order/general-information`.
- Liên quan HĐ: `agreement/{id}/detail-for-order`, `POST agreement` multipart (quoteVersionId…).
- Thực tế: V1 đánh dấu 14:44 → "Đã ban hành" + có nút Tạo đơn hàng lúc 14:46 (~2 phút; user nói chờ 5 phút cho chắc → tool poll `quote-version` tới khi `canCreateOrder`).

### 7.5 Form Tạo đơn hàng `/order/create?quoteVersionId=` (3 bước) – service **`agreement-management`**
**Bước 1 – Thông tin đơn hàng** (hiện Mã CH, Mã version BG, AM, Đơn vị bán hàng "FPL - Phòng Dự án SME"). KH: tìm KH có sẵn (mã TK/MST/CCCD) **hoặc** "Nhập thông tin khách hàng mới" (cơ hội KH tiềm năng bắt buộc bước này). Bắt buộc: Tên KH, MST, Nguồn KH, Tỉnh, Phường, Số nhà/Tên đường, Tên liên hệ + **SĐT hoặc Email** (cả KH lẫn liên hệ). "Lưu và tiếp tục" →
`POST /customer-management/api/party/setup-for-opportunity` → `data: true`
```json
{ "opportunityId": "<oppId>", "existingPartyId": null, "existingContactId": null,
  "partyInfo": { "partyName": "CONG TY TNHH AUTO-QC KHAO SAT 1910", "email": null, "phoneNumber": "0912345678", "taxCode": "0319104471",
                 "identificationCard": null, "passport": null, "sourceId": "bf61f54d-fce8-448b-9424-c20f66b1410d" /*Nguồn KH: Khác*/,
                 "provinceId": 79 /*HCM*/, "wardId": 12724, "addressNo": "1 Duong AUTO-QC" },
  "contactInfo": { "name": "AUTO-QC Lien He", "positionName": null, "email": null, "primaryPhone": "0912345678" } }
```
- Master data: `GET administration-service/api/masterdata/province-new?areaId=&keyword=`, `…/ward-new?provinceId=&keyword=` (phường sau sáp nhập). Sau bước này `GET agreement-management/api/agreement/payment-types`, `GET agreement-management/api/order/general-information?versionId=`, `GET customer-management/api/related-contact/{partyId}/contacts`.

**Bước 2 – Tạo hợp đồng/Phụ lục** (chỉ lưu client): Loại văn bản (Hợp đồng/Phụ lục), Phân loại HĐ (HĐ dự án/HĐ dịch vụ), Hình thức TT (Tiền mặt/Chuyển khoản), Ngày ký, Thời hạn HĐ (từ–đến), Ghi nhận thanh toán trên HĐ, **Địa chỉ thu cước** (Tỉnh, Phường, **Đường**, Số nhà), Mô tả, File đính kèm (không bắt buộc), Nhân sự %LSP.
- Đường: `POST agreement-management/api/address/streets {provinceCode:"79", wardCode:"25975"}` → `{success, message, locationDetail:{locationId, districtId, wardId,…}, streets:[{id,name}]}` – **rất chậm (20–40s)**, axios FE timeout 20s → hay ra status 0, phải chọn lại phường. Có phường không có đường/timeout (P. An Đông). Tool nên gọi với timeout dài + cache.

**Bước 3 – Phân bổ đơn hàng**: Thông tin báo giá (read-only) + Thông tin triển khai (n địa chỉ): Loại nhà (Nhà phố / C.Cư,C.Xá,Chợ,Thương xá / Nhà không địa chỉ), Tỉnh, Phường, Đường, Số nhà, Người liên hệ (chọn từ liên hệ KH hoặc "Tạo liên hệ"), Chi tiết SPDV (chọn dòng báo giá + số lượng). Nút **Tạo đơn hàng** → confirm →
`POST /agreement-management/api/order` (**multipart/form-data**):
```
quoteVersionId
agreementInfo.documentType=1 (Hợp đồng)          agreementInfo.agreementKind=2 (HĐ dịch vụ)
agreementInfo.quoteVersionId                      agreementInfo.isPaymentRecorded=false
agreementInfo.signDate=2026-10-19  .startDate=2026-10-19  .endDate=2026-11-30
agreementInfo.paymentMethod=1 (Tiền mặt)
agreementInfo.billingAddress.{provinceId=79, wardId=12631, address="Đường D1", addressInvoiceStreet="Đường D1", nation="Việt Nam", addressInvoiceNumber="1", addressInvoiceStreetId=1000951402}
agreementInfo.deploymentAddress[0].{provinceId=79, wardId=12668, address="Đường T15", addressInstallStreetVn="Đường T15", addressInstallStreet="Duong T15", addressInstallStreetId=1000951901, relatedContactId=<contactId>, typeHouse=1 (Nhà phố), addressInstallNumber=1}
agreementInfo.deploymentAddress[0].subService[i].{policySubServiceId=240201|240203 (id dòng trong chính sách), quantity=1}
agreementInfo.memberInfos[0].{employeeId=<empId AM>, percentage=100}
```
- ⚠ Lỗi 400 lần 1 (V1 chỉ có CMS Basic + lắp đặt): **"Hợp đồng/Đơn hàng bán mới phải có ít nhất một sản phẩm dịch vụ thuộc FPT Play SME."** → báo giá phải có gói nội dung (Gói nội dung Hospitality – Hotel 3 Basic…) như mẫu → tạo V2 (7.3b), đánh dấu V2 (15:02), chờ ban hành rồi tạo đơn lại.
- ✅ Lần 2 (V2, 15:0x): `POST /agreement-management/api/order` → `data: <orderId>` → **DH2610190003-001** (`/order/01a15336-0b6d-7663-bb3a-235137956bc7`), trạng thái **"Mới tạo"**, 3 dòng = 190.000đ. Đơn mẫu DH2610160004-001 đang "Đang thực hiện" (bước sau – chưa khảo sát).
- Lần 2 KH đã có hồ sơ → bước 1 gửi `setup-for-opportunity {opportunityId, existingPartyId, existingContactId, partyInfo:null, contactInfo:null}`.
- `subService[i].policySubServiceId` = `quoteItems[i].policySubServiceId` của `GET agreement-management/api/order/general-information?versionId=` (240201 CMS Basic, 240102 Hotel 3 Basic, 240203 lắp đặt CMS Basic – theo chính sách), `quantity` = số lượng dòng báo giá. Response này còn có `partyId`, `relatedContactId`, `oppMembers`, `quotePaymentTerm`, `organizationUnit`.
- Địa chỉ: `ward-new` item `{id: 12631 (→ wardId), wardCode: "25975" (→ streets.wardCode), provinceId: 79 (→ provinceCode "79")}`; street `{id (→ addressInvoiceStreetId / addressInstallStreetId), name}`. `addressInstallStreet` = tên không dấu.

## 8. Data test đã tạo (19/10/2026, tk stag_hoangnv75)
| Loại | Mã | Ghi chú |
|---|---|---|
| Cơ hội | CH2610190003 (`01a1531a-6bfb-7a4c-9d63-5a30b6378f21`) | "[AUTO-QC] Hospitality - khao sat tool", KH tiềm năng → TK2610190003 |
| Báo giá | CH2610190003_BG01 (`74b20239-58f5-3cbe-6195-3a24654acb1b`) | V1 60.000 (CS 28029), V2 190.000 (CS 28030, KH chọn) |
| Đơn hàng | DH2610190003-001 (`01a15336-0b6d-7663-bb3a-235137956bc7`) | Mới tạo |

## 9. Đề xuất thiết kế tool (khuôn FTMS Data Tool)
- **Đăng nhập**: tenant FTEL + Email/Password lưu `.env` (user tự điền, tool đọc trực tiếp). Login qua Playwright form `/signin` rồi lấy phiên (API login trong bundle: `POST administration-service/api/auth` – body chưa xác định, refresh `POST /auth/refresh`). Chưa rõ token nằm ở cookie hay localStorage → khảo sát khi code (chỉ in key).
- **Mặc định load theo cơ hội mẫu** `01a1440e-…5531`: `GET sales-management/api/opportunity/{id}` → copy danh mục SP, dịch vụ, AM, người duyệt, kênh, doanh thu, % TC; `GET product-catalog-management/api/quotes?refId=` + `quote-version` → copy dòng báo giá (productId, giá, SL, productType).
- **Pipeline 1 click**: Tạo CH (KH tiềm năng AUTO-QC random) → Tạo BG (dòng như mẫu) → `version-selection` → poll `quote-version` tới `canCreateOrder` (timeout ~5–10 phút) → `setup-for-opportunity` (KH mới random MST/SĐT) → `general-information` → streets (timeout 60s, cache theo ward) → `POST order` multipart. Từng bước cũng chạy riêng được trên bảng Kết quả (như FTMS: nút bước kế tiếp theo trạng thái).
- Rule cần đảm bảo: tổng SL phí khởi tạo = tổng SL thuê bao; phải có ≥1 SPDV thuộc FPT Play SME (gói nội dung); KH + liên hệ cần SĐT hoặc Email; V2+ bắt buộc mô tả version.
- Chưa khảo sát: các bước sau "Mới tạo" (tab Triển khai, `order/deployment`, `order/spf`), duyệt cơ hội (cơ hội mới vẫn tạo BG được ngay), danh mục FPT Camera SME.
