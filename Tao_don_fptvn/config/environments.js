// Cấu hình URL theo môi trường. Thêm môi trường mới (vd: prod) bằng cách thêm 1 key.
export const ENVIRONMENTS = {
  stag: {
    name: 'stag',
    webUrl: 'https://staging.fpt.vn',
    // API ECP (checkout fpt.vn) – public, không cần đăng nhập
    ecpApiUrl: 'https://apis-stag.fpt.vn/ecp',
    // Header client-id = mã kênh bán (checkout.context.source) mà web fpt.vn gửi kèm, không phải secret
    clientId: 'fptvn',
  },
};
