// Cấu hình URL theo môi trường. Thêm môi trường mới bằng cách thêm 1 key.
export const ENVIRONMENTS = {
  stag: {
    name: 'stag',
    // Portal SOP – đăng nhập bằng tài khoản + mật khẩu (basic auth)
    sopUrl: 'https://portal-sop-stg.fpt.vn',
    sopLoginPath: '/user/login/basic-auth',
  },
};
