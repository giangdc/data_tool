// Bộ sinh dữ liệu ngẫu nhiên dùng chung (không phụ thuộc thư viện ngoài).
export const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
export const pick = (arr) => arr[randInt(0, arr.length - 1)];
export const digits = (n) => Array.from({ length: n }, () => randInt(0, 9)).join('');

const pad = (n) => String(n).padStart(2, '0');
// Ngày theo giờ máy (VN): "yyyy-MM-dd"
export const formatDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (days, from = new Date()) => new Date(from.getTime() + days * 86400000);
// Mốc 0h / 23:59:59.999 của 1 ngày theo giờ máy, dạng ISO (UTC) như FE CRM gửi
export const startOfDayIso = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
export const endOfDayIso = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString();
// Mã ngắn theo thời gian, vd 1019-1530-27 -> dễ tra cứu, ít trùng
export const timeTag = (d = new Date()) =>
  `${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Ngô', 'Dương'];
const DEM = ['Văn', 'Thị', 'Minh', 'Hữu', 'Thanh', 'Ngọc', 'Quốc', 'Đức', 'Thu', 'Gia'];
const TEN = ['An', 'Bình', 'Cường', 'Dũng', 'Hà', 'Hải', 'Hùng', 'Lan', 'Linh', 'Long', 'Mai', 'Nam', 'Phúc', 'Quân', 'Sơn', 'Trang', 'Tuấn', 'Vy'];
const COMPANY_WORDS = ['Phát Đạt', 'Thành Công', 'Hưng Thịnh', 'Minh Long', 'An Khang', 'Đại Việt', 'Sao Mai', 'Tân Tiến', 'Hoàng Gia', 'Bình Minh', 'Trường Sơn', 'Kim Ngân'];
const COMPANY_FIELDS = ['Thương Mại', 'Khách Sạn', 'Du Lịch', 'Dịch Vụ', 'Đầu Tư', 'Giải Pháp Số'];
const COMPANY_TYPES = ['Công ty TNHH', 'Công ty Cổ phần'];
const MOBILE_PREFIX = ['090', '091', '093', '094', '096', '097', '098', '086', '088', '032', '035', '039'];

export const personName = () => `${pick(HO)} ${pick(DEM)} ${pick(TEN)}`;
export const companyName = (prefix) =>
  `${pick(COMPANY_TYPES)} ${pick(COMPANY_FIELDS)} ${pick(COMPANY_WORDS)} ${prefix} ${digits(4)}`;
export const mobilePhone = () => pick(MOBILE_PREFIX) + digits(7);
// MST doanh nghiệp 10 số (không kiểm checksum - đủ cho môi trường test)
export const taxCode = () => '0' + randInt(1, 9) + digits(8);
