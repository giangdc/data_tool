// Môi trường SPF Web Admin (Sale Platform). Chọn bằng TMDT_ENV trong .env
export const ENVIRONMENTS = {
  stag: {
    name: 'stag',
    baseUrl: 'https://saleplatform-stag.fpt.net',
    basePath: '/web-admin',
  },
};

// Nguồn TMĐT: tên gửi lên (Source), RefSource ở tab Cập nhật chính sách, SaleTeamId (ngắt / kết nối đơn),
// settleAction = ActionCode quyết toán ở Queue/PushCustomTask (Instance 1)
export const SOURCES = {
  Tiktok: { label: 'TikTok Shop', refSource: 12, saleTeamId: 129, settleAction: 'Tiktok_CompletedOrder' },
  Shopee: { label: 'Shopee', refSource: 0, saleTeamId: 130, settleAction: 'SPFShopeeCompletedOrder' },
};
export const SETTLE_INSTANCE = 1;
