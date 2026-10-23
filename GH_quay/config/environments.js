// Cấu hình URL theo môi trường. Thêm môi trường mới bằng cách thêm 1 key.
export const ENVIRONMENTS = {
  stag: {
    name: 'stag',
    // Fox ERP – màn "Giao dịch thiết bị" (Blazor Server). Portal nhúng /service/retail-counter qua iframe,
    // tool mở thẳng trang này để tìm HĐ; bấm tìm sẽ mở tab /service/retail-counter/ticket?q1=<token>
    erpUrl: 'https://fox-erp-stag.fpt.net',
    erpSearchPath: '/service/retail-counter',
    // Tool SCM (ASP.NET MVC + jQuery EasyUI), chạy http
    scmUrl: 'http://ftelscm-uat.fpt.net',
    scmImportPath: '/Modules/InvImport/CreatedTicketV2',
    scmAdvancePath: '/Inside/TamUng/Index2',
    // GHTK lab – màn Cấu hình API có nút Test webhook (giả lập trạng thái vận đơn)
    ghtkUrl: 'https://khachhang-staging.ghtklab.com',
    ghtkApiConfigPath: '/web/thong-tin-shop/cau-hinh-api',
  },
};
