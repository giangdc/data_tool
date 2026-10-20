// Bộ sinh dữ liệu ngẫu nhiên dùng chung (không phụ thuộc thư viện ngoài).
export const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
export const pick = (arr) => arr[randInt(0, arr.length - 1)];
export const digits = (n) => Array.from({ length: n }, () => randInt(0, 9)).join('');

const MOBILE_PREFIX = ['090', '091', '093', '094', '096', '097', '098', '086', '088', '032', '035', '039'];
export const mobilePhone = () => pick(MOBILE_PREFIX) + digits(7);

// Chung cư: tòa A1..E3, tầng 2..30, phòng = tầng + 2 số (vd tầng 12 -> 1205)
export function apartmentUnit() {
  const floor = randInt(2, 30);
  return { block: pick(['A', 'B', 'C', 'D', 'E']) + randInt(1, 3), floor: String(floor), room: `${floor}${String(randInt(1, 20)).padStart(2, '0')}` };
}
