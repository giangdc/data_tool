import { spPost, SP } from '../src/core/sp.js';
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url),'utf8').split('\n').map(l=>l.match(/^(\w+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim()]));
const app = JSON.parse(fs.readFileSync(new URL('../config/sp-app.json', import.meta.url)));
async function sdk(){
  const r1=await fetch(SP.sop+'auth-service/api/auth-service/sign-in/basic-auth',{method:'POST',headers:{'content-type':'application/json',origin:'https://portal-sop-stg.fpt.vn'},body:JSON.stringify({username:env.APP_USERNAME,password:env.APP_PASSWORD,remember:true})});
  const j=await r1.json();const at=j.data.access_token;
  for(let i=0;i<5;i++){const r2=await fetch(SP.sop+'auth-service/api/auth-service/sdk/refresh-access-key-desktop',{headers:{authorization:`Bearer ${at}`,origin:'https://portal-sop-stg.fpt.vn'}});const t=(await r2.json())?.data?.sc_sdk_token;if(t)return {t,emp:j.data.user_info?.emp_id};await new Promise(r=>setTimeout(r,700));}
  throw new Error('no sdk');
}
for (const Device of ['Android','iOS','Mobile Web','MobileApp','Phone','sdk_gphone64_x86_64','FoxPro']) {
  try{
    const {t,emp}=await sdk();
    const r=await spPost(SP.login,'gateway/auth/api/v3/authentication/token',{GrantType:'one_time_password_2',Token:t,RedirectUrl:'',AccountName:'',Password:'',Platform:'Mobile',Device,ClientApp:app.ClientApp,OldVersion:app.OldVersion,CurrentVersion:app.CurrentVersion,Bundle:app.Bundle,PsId:emp||'00246901'});
    const d=r.data;
    console.log(`Device="${Device}": ${d?.Data?.Result?.AccessToken?'ĐĂNG NHẬP OK ✅':('Code '+d?.Code+' '+(d?.Message?.ExMessage||d?.Message?.Message||'').slice(0,80))}`);
  }catch(e){console.log(`Device="${Device}": lỗi ${e.message}`);}
  await new Promise(r=>setTimeout(r,1400));
}
