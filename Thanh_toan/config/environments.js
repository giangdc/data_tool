// Cấu hình URL theo môi trường. Thêm môi trường mới bằng cách thêm 1 key.
export const ENVIRONMENTS = {
  stag: {
    name: 'stag',
    // Trang "Tra cứu dễ dàng - Thanh toán tiện lợi" (không cần đăng nhập)
    payUrl: 'https://staging.fpt.vn/pay',
    // Cổng thanh toán Foxpay (form thẻ + kết quả)
    gatewayHost: 'paygateway-stag.fpt.vn',
    // Thẻ nội địa: Foxpay chuyển sang trang Napas (dps-staging.napas.com.vn/…/merchant/FTEL/paymentpage)
    napasHost: 'dps-staging.napas.com.vn',
  },
};
