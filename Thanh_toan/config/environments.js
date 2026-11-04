// Cấu hình URL theo môi trường. Thêm môi trường mới (vd: prod) bằng cách thêm 1 key.
export const ENVIRONMENTS = {
  stag: {
    name: 'stag',
    // Trang "Tra cứu dễ dàng - Thanh toán tiện lợi" (Next.js, basePath /pay)
    webUrl: 'https://staging.fpt.vn',
    payUrl: 'https://staging.fpt.vn/pay',
    // API Hi FPT mà trang /pay gọi (khách vãng lai: không cần đăng nhập/token)
    hiApiUrl: 'https://hifpt-api-stag.fpt.vn',
    apiVersion: 'v127',
    // Hằng của web (không phải secret): mã kênh thanh toán hóa đơn trên web, appVersion
    paymentType: 'FTELBILLWEB',
    appVersion: '1.0',
  },
};
