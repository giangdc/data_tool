// Danh mục (master data) của BMS, có cache trong bộ nhớ cho mỗi lần chạy.
export class BmsMasterData {
  constructor(api) {
    this.api = api;
    this.cache = new Map();
  }

  async memo(key, fn) {
    if (!this.cache.has(key)) this.cache.set(key, await fn());
    return this.cache.get(key);
  }

  serviceGroups() {
    return this.memo('groups', () => this.api.get('/api/master-data/service-groups'));
  }

  async serviceTypes(serviceGroupId) {
    const types = await this.memo(`types:${serviceGroupId}`, () =>
      this.api.get('/api/master-data/service-types', { serviceGroupId }),
    );
    return types.filter((t) => t.isActive !== 0);
  }

  provinces() {
    return this.memo('provinces', async () => (await this.api.get('/api/bam/provinces')).filter((p) => p.isActive));
  }

  communes(provinceId) {
    return this.memo(`communes:${provinceId}`, async () =>
      (await this.api.get('/api/bam/communes', { provinceId })).filter((c) => c.isActive),
    );
  }

  groupCompanies() {
    return this.memo('groupCompanies', () => this.api.get('/api/customners/group-companies'));
  }

  sales() {
    return this.memo('sales', () => this.api.get('/api/bam/sales'));
  }

  // /sales chỉ trả về sale trong phạm vi quản lý của người đăng nhập (tk sale nhận về rỗng)
  allSales() {
    return this.memo('salesAll', () => this.api.get('/api/bam/sales/all'));
  }

  async findSale(userName) {
    const match = (s) => s.userName?.toLowerCase() === userName.toLowerCase();
    const sale = (await this.sales()).find(match) ?? (await this.allSales()).find(match);
    if (!sale) throw new Error(`Không tìm thấy AM "${userName}" trong danh sách sale của BMS`);
    return sale;
  }

  // TPP đánh giá: trưởng/phó phòng của AM
  departmentManagers(email) {
    return this.memo(`dept:${email}`, () => this.api.get(`/api/bam/employees/${encodeURIComponent(email)}/department-managers`));
  }

  // BGĐ phê duyệt: ban giám đốc trung tâm của AM
  centralManagers(email) {
    return this.memo(`central:${email}`, () => this.api.get(`/api/bam/employees/${encodeURIComponent(email)}/central-managers`));
  }

  /** Danh sách sale để chọn AM: gộp /sales + /sales/all, bỏ trùng theo userName. */
  async salesForPicker() {
    const seen = new Set();
    return [...(await this.sales()), ...(await this.allSales())].filter((s) => {
      const key = s.userName?.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** AM + danh sách TPP đánh giá / BGĐ phê duyệt hợp lệ của AM đó. */
  async approvers(amUserName) {
    const sale = await this.findSale(amUserName);
    // Danh sách duyệt có thể chứa chính AM -> loại ra để người tạo không tự duyệt
    const notAm = (u) => u.userName?.toLowerCase() !== sale.userName.toLowerCase();
    const [tpp, bgd] = (
      await Promise.all([this.departmentManagers(sale.email), this.centralManagers(sale.email)])
    ).map((list) => list.filter(notAm));
    return { sale, tpp, bgd };
  }

  /** Tìm nhóm + loại dịch vụ theo id hoặc tên (không phân biệt hoa thường, bỏ khoảng trắng thừa). */
  async resolveService(groupInput, typeInput) {
    const norm = (s) => String(s).trim().toLowerCase();
    const groups = await this.serviceGroups();
    const group = groups.find((g) => String(g.id) === norm(groupInput) || norm(g.serviceGroupName) === norm(groupInput));
    if (!group) {
      throw new Error(`Không có Nhóm dịch vụ "${groupInput}". Có: ${groups.map((g) => g.serviceGroupName).join(', ')}`);
    }
    const types = await this.serviceTypes(group.id);
    const type = types.find((t) => String(t.id) === norm(typeInput) || norm(t.serviceTypeName) === norm(typeInput));
    if (!type) {
      throw new Error(
        `Nhóm "${group.serviceGroupName}" không có Loại dịch vụ "${typeInput}". Có: ${types.map((t) => t.serviceTypeName.trim()).join(', ')}`,
      );
    }
    return { group, type };
  }
}
