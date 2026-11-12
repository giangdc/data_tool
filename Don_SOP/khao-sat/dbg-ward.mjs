await new Promise((r)=>setTimeout(r,5000));
const { session } = await import('../src/app/order.js');
const ctx = await session();
console.log('OK instanceVer=', ctx.instanceVer, 'life(s)=', ctx.info.AccessTokenLifeTime);
const r = await ctx.api(`gateway/sale/${ctx.instanceVer}/api/order-info/get-district`, { LocationId: 8 });
const list = r.data?.Data?.Result || [];
console.log('phường:', list.length, '| Code', r.data?.Code, '| Msg', r.data?.Message?.Message);
console.log('Phú Thuận:', JSON.stringify(list.filter((x)=>/thuan/i.test((x.Name||'').normalize('NFD').replace(/[̀-ͯ]/g,'')))));
