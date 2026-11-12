import { spPost, SP } from '../src/core/sp.js';
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url),'utf8').split('\n').map(l=>l.match(/^(\w+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim()]));
async function sdk(){
  const r1=await fetch(SP.sop+'auth-service/api/auth-service/sign-in/basic-auth',{method:'POST',headers:{'content-type':'application/json',origin:'https://portal-sop-stg.fpt.vn'},body:JSON.stringify({username:env.APP_USERNAME,password:env.APP_PASSWORD,remember:true})});
  const j=await r1.json();const at=j.data.access_token;
  for(let i=0;i<6;i++){const r2=await fetch(SP.sop+'auth-service/api/auth-service/sdk/refresh-access-key-desktop',{headers:{authorization:`Bearer ${at}`,origin:'https://portal-sop-stg.fpt.vn'}});const t=(await r2.json())?.data?.sc_sdk_token;if(t)return {t,emp:j.data.user_info?.emp_id};await new Promise(r=>setTimeout(r,700));}
  throw new Error('no sdk');
}
// ký bằng khóa web sẵn có (spPost mặc định), chỉ đổi ClientApp trong body
const cands=['sdk-mobileapp','sdk-mobisale','sdk-mobisalevn','sdk-mobinet','sdk-mobile','mobisalevn','ftel.isc.mobisalevn','sdk-app','sdk-androidapp','sdk-saleclub'];
for (const ClientApp of cands){
  try{
    const {t,emp}=await sdk();
    const r=await spPost(SP.login,'gateway/auth/api/v3/authentication/token',{GrantType:'one_time_password_2',Token:t,RedirectUrl:'',AccountName:'',Password:'',Platform:'Mobile',Device:'Android',ClientApp,OldVersion:'4.18.1.0',CurrentVersion:'5.0.1.0',Bundle:'ftel.isc.mobisalevn',PsId:emp||'00246901'});
    const d=r.data; const okk=d?.Data?.Result?.AccessToken;
    console.log(`ClientApp="${ClientApp}": ${okk?'✅✅ ĐĂNG NHẬP MOBILE OK':('Code '+d?.Code+' '+(d?.Message?.ExMessage||d?.Message?.Message||'').replace(/\s+/g,' ').slice(0,70))}`);
    if(okk) break;
  }catch(e){console.log(`ClientApp="${ClientApp}": lỗi ${e.message}`);}
  await new Promise(r=>setTimeout(r,1300));
}
