// Sinh thông tin khách hàng mới (Tổ chức - Doanh nghiệp trong nước) cho form tạo cơ hội.
import * as rnd from '../data/random.js';

// Mã lấy từ payload thực tế của màn Tạo cơ hội
const CUSTOMER_TYPE_ORGANIZATION = 3;
const CUSTOMER_MAIN_TYPE_DOMESTIC_ENTERPRISE = 2;

export async function buildNewCustomer(master, { prefix }) {
  const province = rnd.pick(await master.provinces());
  const ward = rnd.pick(await master.communes(province.id));
  const groupCode = (await master.groupCompanies())[0]?.code ?? 'Anonymous';
  const address = rnd.streetAddress();

  return {
    id: null,
    fullName: rnd.companyName(prefix).toUpperCase(),
    nickName: '1',
    identity: rnd.taxCode(),
    identityDate: null,
    identityPlace: null,
    website: null,
    address,
    fullAddress: `${address}, ${ward.nameVN}, ${province.nameVN}, Viet Nam`,
    phone: rnd.mobilePhone(),
    email: rnd.testEmail(prefix.replace(/[^a-z0-9]/gi, '')),
    location: province.id,
    ward: ward.id,
    type: CUSTOMER_TYPE_ORGANIZATION,
    typeCusMain: CUSTOMER_MAIN_TYPE_DOMESTIC_ENTERPRISE,
    typeCusOfContract: null,
    country: 'Viet Nam',
    countryCode: 'VNM',
    business: null,
    groupCode,
    budgetRelationCode: null,
    certificateNumber: null,
    certificateDate: null,
    charterCapital: null,
    representativeName: rnd.personName(),
    representativePosition: rnd.position(),
    representativePhone: null,
    representativeEmail: null,
    representativeCmnd: null,
  };
}

// Payload rút gọn cho API validate (kiểm tra trùng KH trước khi tạo)
export function toValidatePayload(customer) {
  const { id, identity, fullName, type, location, ward, budgetRelationCode } = customer;
  return { customerId: null, customer: { id, identity, fullName, type, location, district: null, ward, budgetRelationCode } };
}
