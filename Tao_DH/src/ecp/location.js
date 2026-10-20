import { apartmentUnit } from '../data/random.js';

// Danh mục địa chỉ ECP (Tỉnh/TP -> Phường/Xã -> Đường), cache trong bộ nhớ. Địa chỉ cấp 2 (sau sáp nhập).
const LEVEL = 'Level2';

// So khớp tên không dấu, không phân biệt hoa thường: "phuong ben thanh" khớp "Phường Bến Thành"
export const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();

export class Locations {
  constructor(api) {
    this.api = api;
    this.cache = new Map();
  }

  async #list(key, path, body) {
    if (!this.cache.has(key)) {
      this.cache.set(key, this.api.post(path, { ...body, address_level: LEVEL }).then((d) => d || []).catch((err) => {
        this.cache.delete(key);
        throw err;
      }));
    }
    return this.cache.get(key);
  }

  /** [{id, text}] */
  provinces() {
    return this.#list('p', '/public/v1/locations/provinces/list', {});
  }

  wards(provinceId) {
    return this.#list(`w${provinceId}`, '/public/v1/locations/wards/list', { location_id: Number(provinceId) });
  }

  streets(wardId) {
    return this.#list(`s${wardId}`, '/public/v1/locations/streets/list', { ward_id: Number(wardId) });
  }

  /** Chung cư theo phường: phần tử đầu là {id: -1, text: "Nơi khác"} */
  async buildings(wardId) {
    const key = `b${wardId}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, this.api.post('/public/v1/locations/buildings/list', { ward_id: Number(wardId) }).then((d) => d || []).catch((err) => {
        this.cache.delete(key);
        throw err;
      }));
    }
    return this.cache.get(key);
  }

  /** Tìm theo id hoặc tên (không dấu, khớp đúng trước rồi tới chứa) */
  static find(list, value) {
    if (value === undefined || value === null || value === '') return undefined;
    const byId = list.find((x) => String(x.id) === String(value));
    if (byId) return byId;
    const v = norm(value);
    return list.find((x) => norm(x.text) === v) || list.find((x) => norm(x.text).includes(v));
  }

  /**
   * Chuẩn hóa địa chỉ từ input (id hoặc tên) -> {provinceId, provinceName, wardId, wardName, streetId, streetName, houseType, ...}.
   * houseType 'private' (nhà riêng/nhà phố, mặc định): addressNo bắt buộc.
   * houseType 'apartment' (chung cư): buildingId|building (mặc định fallback.building nếu phường có, không thì "Nơi khác"), block (tòa nhà), floor, room bắt buộc.
   * Thiếu phần nào thì lấy mặc định (fallback) rồi tới phần tử đầu danh sách.
   */
  async resolve(input = {}, fallback = {}) {
    const one = async (list, value, def, label) => {
      const hit = Locations.find(list, value) ?? Locations.find(list, def) ?? list[0];
      if (!hit) throw Object.assign(new Error(`Không có danh sách ${label}`), { status: 400 });
      if (value && !Locations.find(list, value)) throw Object.assign(new Error(`Không tìm thấy ${label} "${value}"`), { status: 400 });
      return hit;
    };
    const p = await one(await this.provinces(), input.provinceId ?? input.province, fallback.province, 'Tỉnh/Thành phố');
    const w = await one(await this.wards(p.id), input.wardId ?? input.ward, fallback.ward, 'Phường/Xã');
    const s = await one(await this.streets(w.id), input.streetId ?? input.street, fallback.street, 'Tên đường');
    const base = { provinceId: p.id, provinceName: p.text, wardId: w.id, wardName: w.text, streetId: s.id, streetName: s.text };
    const txt = (v) => String(v ?? '').trim();

    if (norm(input.houseType) === 'apartment' || norm(input.houseType) === 'chung cu') {
      const list = await this.buildings(w.id);
      const b = Locations.find(list, input.buildingId ?? input.building) ?? Locations.find(list, fallback.building) ?? list.find((x) => x.id === -1) ?? { id: -1, text: 'Nơi khác' };
      if ((input.buildingId ?? input.building) && !Locations.find(list, input.buildingId ?? input.building)) {
        throw Object.assign(new Error(`Không tìm thấy chung cư "${input.buildingId ?? input.building}" ở ${w.text}`), { status: 400 });
      }
      // Không nhập Tòa nhà / Số tầng / Số phòng -> sinh ngẫu nhiên (CLI; UI đã điền sẵn random)
      const rnd = apartmentUnit();
      const floor = txt(input.floor) || rnd.floor;
      const room = txt(input.room) || (txt(input.floor) ? `${floor}${rnd.room.slice(-2)}` : rnd.room);
      const block = input.block === undefined ? rnd.block : txt(input.block);
      return { ...base, houseType: 'apartment', buildingId: b.id, buildingName: b.id === -1 ? '' : b.text, block, floor, room, addressNo: '' };
    }

    const addressNo = txt(input.addressNo ?? fallback.addressNo);
    if (!addressNo) throw Object.assign(new Error('Chưa nhập Số nhà'), { status: 400 });
    return { ...base, houseType: 'private', addressNo };
  }
}
