// Cấu hình URL theo môi trường. Thêm môi trường mới (vd: prod) bằng cách thêm 1 key.
export const ENVIRONMENTS = {
  dev: {
    name: 'dev',
    webUrl: 'https://dev.fptplay.vn',
    // API FPT Play (web dùng v7.1_w)
    apiUrl: 'https://api-staging.fptplay.net/api/v7.1_w',
    // Các hằng dưới đây lấy từ bundle FE công khai (_next/static/chunks/pages/_app-*.js), không phải secret:
    //   signSalt: tiền tố chữ ký URL (st = base64url(md5(signSalt + e + "/api/v7.1_w/" + path)))
    //   clientId: client_id web gửi kèm khi đăng nhập / OTP
    signSalt: 'XGFMEvDKTdRUkxBCnbCt3qZaT4ewWM',
    clientId: 'vKyPNd1iWHodQVknxcvZoWz74295wnk8',
    feVersion: '8.9.3',
    paymentVersion: '25',
  },
};
