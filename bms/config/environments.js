// Cấu hình URL theo môi trường. Thêm môi trường mới (vd: uat) bằng cách thêm 1 key.
export const ENVIRONMENTS = {
  stag: {
    name: 'stag',
    ssoLoginUrl: 'https://ftms-stag.fpt.net/id/login',
    bmsWebUrl: 'https://ftms-stag.fpt.net/bmsv2/',
    bmsApiUrl: 'https://ftisapi-stag.fpt.net/bms-service',
    bmsTokenCookie: 'BMS_access_token',
    // SM (Service Management) – tool LeasedLine: khảo sát dịch vụ, khai cước trước khi lên HĐ
    smWebUrl: 'https://ftms-stag.fpt.net/sm/v2/',
    smApiUrl: 'https://ftisapi-stag.fpt.net/sm/v2/ll/api/v1',
    smTokenCookie: 'access_token_smp',
  },
};
