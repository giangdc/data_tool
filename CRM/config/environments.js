// Cấu hình URL theo môi trường. Thêm môi trường mới (vd: uat) bằng cách thêm 1 key.
export const ENVIRONMENTS = {
  stag: {
    name: 'stag',
    webUrl: 'https://crm-stag.fpt.net',
    apiUrl: 'https://crm-api-stag.fpt.net/crm',
    // Ô "tenant" ở màn đăng nhập + header X-Tenant khi gọi API
    tenant: 'FTEL',
    // Cơ hội mẫu: tool copy sản phẩm/dịch vụ, AM, người duyệt, dòng báo giá từ cơ hội này
    sampleOpportunityId: '01a1440e-6275-79bd-98d9-289e568e5531',
  },
};
