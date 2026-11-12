import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').map((l)=>l.match(/^(\w+)=(.*)$/)).filter(Boolean).map((m)=>[m[1],m[2].trim()]));
const mask=(o)=>JSON.stringify(o,(k,v)=>typeof v==='string'&&v.length>24?`str(${v.length})`:v);
const r1=await fetch('https://gateway-sop-stg.fpt.vn/auth-service/api/auth-service/sign-in/basic-auth',{method:'POST',headers:{'content-type':'application/json',origin:'https://portal-sop-stg.fpt.vn'},body:JSON.stringify({username:env.APP_USERNAME,password:env.APP_PASSWORD,remember:true})});
const s1=await r1.json(); console.log('sign-in',r1.status,mask(s1).slice(0,300));
const at=s1?.data?.access_token;
const r2=await fetch('https://gateway-sop-stg.fpt.vn/auth-service/api/auth-service/sdk/refresh-access-key-desktop',{headers:{authorization:`Bearer ${at}`,origin:'https://portal-sop-stg.fpt.vn'}});
console.log('refresh-key',r2.status, mask(await r2.json()));
