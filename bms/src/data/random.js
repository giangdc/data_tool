// Bộ sinh dữ liệu ngẫu nhiên dùng chung (không phụ thuộc thư viện ngoài).
export const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
export const pick = (arr) => arr[randInt(0, arr.length - 1)];
export const digits = (n) => Array.from({ length: n }, () => randInt(0, 9)).join('');

const pad = (n) => String(n).padStart(2, '0');
export const formatDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (days, from = new Date()) => new Date(from.getTime() + days * 86400000);
// Mã ngắn theo thời gian, vd 1014-1530-27 -> dễ tra cứu, ít trùng
export const timeTag = (d = new Date()) =>
  `${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Ngô', 'Dương'];
const DEM = ['Văn', 'Thị', 'Minh', 'Hữu', 'Thanh', 'Ngọc', 'Quốc', 'Đức', 'Thu', 'Gia'];
const TEN = ['An', 'Bình', 'Cường', 'Dũng', 'Hà', 'Hải', 'Hùng', 'Lan', 'Linh', 'Long', 'Mai', 'Nam', 'Phúc', 'Quân', 'Sơn', 'Trang', 'Tuấn', 'Vy'];
const COMPANY_WORDS = ['Phát Đạt', 'Thành Công', 'Hưng Thịnh', 'Minh Long', 'An Khang', 'Đại Việt', 'Sao Mai', 'Tân Tiến', 'Hoàng Gia', 'Bình Minh', 'Trường Sơn', 'Kim Ngân'];
const COMPANY_FIELDS = ['Thương Mại', 'Công Nghệ', 'Xây Dựng', 'Dịch Vụ', 'Đầu Tư', 'Giải Pháp Số', 'Sản Xuất', 'Logistics'];
const COMPANY_TYPES = ['Công ty TNHH', 'Công ty Cổ phần'];
const STREETS = ['Lê Lợi', 'Trần Hưng Đạo', 'Nguyễn Huệ', 'Hai Bà Trưng', 'Lý Thường Kiệt', 'Phạm Văn Đồng', 'Võ Văn Kiệt', 'Cầu Giấy', 'Láng Hạ', 'Duy Tân'];
const POSITIONS = ['Giám đốc', 'Tổng Giám đốc', 'Phó Giám đốc', 'Chủ tịch HĐQT'];
const MOBILE_PREFIX = ['090', '091', '093', '094', '096', '097', '098', '086', '088', '032', '035', '039'];

export const personName = () => `${pick(HO)} ${pick(DEM)} ${pick(TEN)}`;
export const position = () => pick(POSITIONS);
export const companyName = (prefix) =>
  `${pick(COMPANY_TYPES)} ${pick(COMPANY_FIELDS)} ${pick(COMPANY_WORDS)} ${prefix} ${digits(4)}`;
export const streetAddress = () => `Số ${randInt(1, 999)} ${pick(STREETS)}`;
export const mobilePhone = () => pick(MOBILE_PREFIX) + digits(7);
export const testEmail = (tag) => `${tag}.${digits(6)}@example.com`.toLowerCase();
// MST doanh nghiệp 10 số (không kiểm checksum - đủ cho môi trường test)
export const taxCode = () => '0' + randInt(1, 9) + digits(8);
