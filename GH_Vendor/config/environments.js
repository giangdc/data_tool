// Cấu hình URL theo môi trường. Thêm môi trường mới bằng cách thêm 1 key.
export const ENVIRONMENTS = {
  stag: {
    name: 'stag',
    // Fox ERP – portal (trang chủ có ô ứng dụng "Quản lý NCU") + app Vendor (Blazor Server + MudBlazor)
    erpUrl: 'https://fox-erp-stag.fpt.net',
    vendorPath: '/vendor/vendor-cooperation/',
    // Màn "Giao hàng, triển khai NCU" (tab Quản lý đơn đặt hàng / Quản lý phiếu giao hàng / Quản lý tiến độ triển khai)
    deliveryPath: '/vendor/vendor-cooperation/ordering-delivery-management',
  },
};
