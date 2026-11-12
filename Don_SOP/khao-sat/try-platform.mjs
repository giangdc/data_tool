import { spPost, SP, login } from '../src/core/sp.js';
import fs from 'node:fs';
// đăng nhập desktop để lấy sc_sdk_token mới rồi thử đổi Platform
const { sop } = await login();
// login() đã trả sp; nhưng ta cần thử nhiều Platform -> gọi lại chuỗi thủ công
const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url),'utf8').split('\n').map(l=>l.match(/^(\w+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim()]));
const app = JSON.parse(fs.readFileSync(new URL('../config/sp-app.json', import.meta.url)));
async function sdk() {
  const r1 = await fetch(SP.sop+'auth-service/api/auth-service/sign-in/basic-auth',{method:'POST',headers:{'content-type':'application/json',origin:'https://portal-sop-stg.fpt.vn'},body:JSON.stringify({username:env.APP_USERNAME,password:env.APP_PASSWORD,remember:true})});
  const at=(await r1.json()).data.access_token;
  for(let i=0;i<4;i++){const r2=await fetch(SP.sop+'auth-service/api/auth-service/sdk/refresh-access-key-desktop',{headers:{authorization:`Bearer ${at}`,origin:'https://portal-sop-stg.fpt.vn'}});const t=(await r2.json())?.data?.sc_sdk_token;if(t)return {t,emp:(await r1.json?.()||{})};await new Promise(r=>setTimeout(r,700));}
  const r1b=await fetch(SP.sop+'auth-service/api/auth-service/sign-in/basic-auth',{method:'POST',headers:{'content-type':'application/json',origin:'https://portal-sop-stg.fpt.vn'},body:JSON.stringify({username:env.APP_USERNAME,password:env.APP_PASSWORD,remember:true})});const j=await r1b.json();const at2=j.data.access_token;const r2=await fetch(SP.sop+'auth-service/api/auth-service/sdk/refresh-access-key-desktop',{headers:{authorization:`Bearer ${at2}`,origin:'https://portal-sop-stg.fpt.vn'}});return {t:(await r2.json()).data.sc_sdk_token, emp:j.data.user_info?.emp_id};
}
for (const Platform of ['Mobile','Android','MobileApp']) {
  const {t,emp}=await sdk();
  const r=await spPost(SP.login,'gateway/auth/api/v3/authentication/token',{GrantType:'one_time_password_2',Token:t,RedirectUrl:'',AccountName:'',Password:'',Platform,Device:Platform,ClientApp:app.ClientApp,OldVersion:app.OldVersion,CurrentVersion:app.CurrentVersion,Bundle:app.Bundle,PsId:emp||'00246901'});
  const d=r.data;
  console.log(`Platform=${Platform}: Code ${d?.Code} ${d?.Data?.Result?.AccessToken?'-> ĐĂNG NHẬP OK':('-> '+(d?.Message?.ExMessage||d?.Message?.Message||'').slice(0,90))}`);
  await new Promise(r=>setTimeout(r,1500));
}
