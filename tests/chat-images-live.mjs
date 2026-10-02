// One bounded real vision request. Never print encrypted preferences or headers.
import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=process.cwd(),output=path.join(project,'test-results'),profile=path.join(output,`chat-images-live-profile-${Date.now()}`);
let saved;try{saved=JSON.parse(await fs.readFile(path.join(process.env.APPDATA,'rm-reader','preferences.json'),'utf8'));}catch{}
if(!saved?.encryptedKey){console.log('SKIP No existing encrypted Gemini key available.');process.exit(0);}
await fs.mkdir(profile,{recursive:true});
await fs.writeFile(path.join(profile,'preferences.json'),JSON.stringify({encryptedKey:saved.encryptedKey,settings:{...saved.settings,autoFallback:true,chatOutputTokens:512,chatContextChars:4000,autoTranslate:false},documents:{},vocabulary:[],annotations:[]}));saved=null;
await fs.copyFile(path.join(process.env.APPDATA,'rm-reader','Local State'),path.join(profile,'Local State')).catch(()=>{});
const data=(await fs.readFile(path.join(output,'clock-image.png'))).toString('base64');
const env={...process.env,RM_TEST_MODE:'1',RM_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;let app;
try{
  app=await electron.launch({args:[project],cwd:project,env,timeout:60000});const page=await app.firstWindow();await page.waitForFunction(()=>!!window.rmTest);
  const result=await page.evaluate(async data=>{
    const image=await window.desktop.addChatImage({mimeType:'image/png',data,name:'clock-image.png'});
    const chat=await window.desktop.createChat({tokens:[],imageIds:[image.id]});
    return window.desktop.sendChat({conversationId:chat.id,question:'Đọc chính xác dòng chữ bắt đầu bằng CODE_ trong ảnh, giải thích ngắn gọn bộ chia clock, và dẫn nguồn ảnh.',scope:'Ảnh',sources:[],imageIds:[image.id]});
  },data);
  const ids=[...result.text.matchAll(/\[\s*SRC\s*:\s*([\w-]+)\s*\]/gi)].map(m=>m[1]);
  const report={status:result.status,model:result.model,usage:result.usage,recognizedImageOnlyCode:result.text.includes('CODE_7391'),citationValid:ids.some(id=>result.sources.some(s=>s.id===id)),error:result.error||null};
  await fs.writeFile(path.join(output,'chat-images-live-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  if(result.status!=='complete'||!report.recognizedImageOnlyCode||!report.citationValid)process.exitCode=1;
}catch(e){console.error(String(e.message).replace(/AIza[\w-]{20,}/g,'[redacted]'));process.exitCode=1;}finally{await app?.close().catch(()=>{});}
