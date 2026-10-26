// Cấu hình URL theo môi trường. Thêm môi trường mới bằng cách thêm 1 key.
export const ENVIRONMENTS = {
  stag: {
    name: 'stag',
    // Trang đăng nhập (form tài khoản + mật khẩu, không qua IAM)
    loginUrl: 'http://login-stag.fpt.net',
    // Trang Liệt kê cước gốc (khung ASP cũ) – chỉ để mở đối chiếu
    insideUrl: 'http://inside.fpt.net',
    // Nội dung thật của màn Liệt kê cước (iframe) + các API
    mvcUrl: 'http://mvc.inside.fpt.net',
    // Trang nhận token sau đăng nhập (?Token=...) và cấp cookie phiên của mvc.inside
    entryPath: '/InternetSubs/Accounting/BillHistoryNew?vUrl=/Functions/InternetSubs/Accounting/BillHistory/&vTable=CustomerEx',
  },
};
