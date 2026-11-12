import { session } from '../src/app/order.js';
import fs from 'node:fs';
const T = JSON.parse(fs.readFileSync(new URL('../config/order-template.json', import.meta.url)));
const ctx = await session();
const v = ctx.instanceVer;
// lấy gói Meta
const r = await ctx.api(`gateway/sale/${v}/api/net/packages`, { ...{LocationId:T.orderUpdate.OrderDetails[0].Address.LocationId, DistrictId:T.orderUpdate.OrderDetails[0].Address.DistrictId, WardId:T.orderUpdate.OrderDetails[0].Address.WardId, BuildingId:0, CusTypeId:T.orderUpdate.CustomerInfo.CusTypeId, CusTypeL2Id:T.orderUpdate.CustomerInfo.CusTypeL2Id, ObjectTypeId:T.orderUpdate.CustomerInfo.ObjectTypeId}, ServiceAvailable:null, ObjId:0 });
const meta = (r.data.Data.Result||[]).find((x)=>x.SubServiceName==='Meta');
console.log('Meta prepaids:', JSON.stringify(meta.PrePaid.slice(0,3)));
console.log('Meta deploy:', JSON.stringify(meta.DeployTypes));
// dựng ServiceDetail Meta 6T
const base = JSON.parse(JSON.stringify(T.orderUpdate.OrderDetails[0].Services[0].ServiceDetail[0]));
const pp = meta.PrePaid.find((x)=>x.Key==='6_6') || meta.PrePaid.find((x)=>x.MonthUsed>1);
Object.assign(base,{SubServiceId:meta.SubServiceId,SubServiceName:'Meta',PrePaid:pp.MonthUsed,MonthUsed:pp.MonthUsed,Key:pp.Key,PrePaidName:pp.Value,Total:0,TotalVAT:0});
console.log('ServiceDetail dựng:', JSON.stringify(base));
const pr = JSON.parse(JSON.stringify(T.priceQuotation)); pr.Services[0].ServiceDetail=[base];
const pres = await ctx.api(`gateway/sale/${v}/api/order-info/get-price-quotation`, pr);
console.log('PRICE Code', pres.data.Code, 'Msg', JSON.stringify(pres.data.Message).slice(0,250));
