const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
module.exports=async function({app,handle,documents,registerPdf,getWindow,getSettings,getApiKey}){
  const {streamChat,buildChatContents}=await import(pathToFileURL(path.join(__dirname,'../src/core/chat.mjs')).href);
  const filename=path.join(app.getPath('userData'),'chats.json');let chats=[],queue=Promise.resolve();const running=new Map();
  try{const saved=JSON.parse(await fs.readFile(filename,'utf8'));if(Array.isArray(saved))chats=saved;}catch{}
  for(const chat of chats)for(const m of chat.messages||[])if(m.status==='streaming'){m.status='stopped';m.error='Lượt trả lời đã dừng khi đóng ứng dụng.';}
  const persist=()=>{const snapshot=JSON.stringify(chats);queue=queue.catch(()=>{}).then(async()=>{await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename+'.tmp',snapshot);await fs.rename(filename+'.tmp',filename);});return queue;};
  const get=id=>{const c=chats.find(c=>c.id===id);if(!c)throw new Error('Không tìm thấy cuộc trò chuyện.');return c;};
  const known=token=>{const d=documents.get(token);if(!d)throw new Error('Tài liệu đã đóng. Hãy mở lại PDF.');return {...d,name:path.basename(d.path)};};
  const stale=async doc=>{try{const stat=await fs.stat(doc.path);return createHash('sha256').update(path.resolve(doc.path)+':'+stat.size+':'+stat.mtimeMs).digest('hex')!==doc.id;}catch{return true;}};
  handle('chat:list',async()=>Promise.all(chats.map(async c=>({
    ...c,
    documents:await Promise.all(c.documents.map(async d=>({...d,path:undefined,stale:await stale(d)}))),
    messages:c.messages.map(m=>({...m,sources:(m.sources||[]).map(s=>({...s,path:undefined}))}))
  }))));
  handle('chat:create',async input=>{
    if(!Array.isArray(input?.tokens)||input.tokens.length<1||input.tokens.length>2)throw new Error('Chọn một hoặc hai PDF để chat.');
    const docs=[...new Map(input.tokens.map(token=>{const doc=known(token);return [doc.id,doc];})).values()];
    const c={id:randomUUID(),key:docs.map(d=>d.id).sort().join(':'),title:'Cuộc trò chuyện mới',documents:docs,createdAt:Date.now(),updatedAt:Date.now(),messages:[]};
    chats.unshift(c);await persist();return {...c,documents:docs.map(d=>({...d,path:undefined}))};
  });
  handle('chat:rename',async({id,title})=>{const c=get(id);c.title=String(title||'').trim().slice(0,120)||'Cuộc trò chuyện';c.updatedAt=Date.now();await persist();return true;});
  handle('chat:delete',async id=>{running.get(id)?.controller.abort();await running.get(id)?.promise.catch(()=>{});chats=chats.filter(c=>c.id!==id);await persist();return true;});
  handle('chat:source',async({conversationId,sourceId})=>{
    const c=get(conversationId),source=c.messages.flatMap(m=>m.sources||[]).find(s=>s.id===sourceId);
    if(!source)throw new Error('Nguồn này chưa được cung cấp cho AI.');
    if(await stale({id:source.documentId,path:source.path}))throw new Error('PDF nguồn đã thay đổi hoặc bị di chuyển. Đây là trích dẫn của phiên bản cũ.');
    const document=await registerPdf(source.path);return {document,source:{...source,path:undefined}};
  });
  handle('chat:cancel',id=>{running.get(id)?.controller.abort();return true;});
  handle('chat:send',async input=>{
    const c=get(input?.conversationId);if(running.has(c.id))throw new Error('Cuộc trò chuyện này đang trả lời.');
    const question=String(input.question||'').trim();if(!question||question.length>8000)throw new Error('Câu hỏi phải có từ 1 đến 8.000 ký tự.');
    const settings={...getSettings()};let sources;
    if(input.retry){const last=c.messages.at(-2);if(last?.role!=='user'||c.messages.at(-1)?.role!=='assistant')throw new Error('Không có câu hỏi để thử lại.');sources=last.sources;for(const s of sources)if(await stale({id:s.documentId,path:s.path}))throw new Error('Nguồn cũ đã thay đổi. Hãy bắt đầu cuộc trò chuyện với PDF hiện tại.');}
    else{
      if(!Array.isArray(input.sources)||!input.sources.length||input.sources.length>24)throw new Error('Không có trích đoạn văn bản phù hợp. Hãy chọn đoạn/trang khác hoặc mở rộng tìm kiếm.');
      let total=0;sources=input.sources.map(s=>{
        const d=known(s.token);if(!c.documents.some(doc=>doc.id===d.id))throw new Error('Nguồn không thuộc cuộc trò chuyện này.');
        if(typeof s.text!=='string'||!s.text.trim()||s.text.length>8000||!Number.isInteger(s.page)||s.page<1||s.page>100000)throw new Error('Trích đoạn PDF không hợp lệ.');
        total+=s.text.length;
        const rects=Array.isArray(s.rects)?s.rects.filter(r=>r.page===s.page&&Array.isArray(r.rect)&&r.rect.length===4&&r.rect.every(n=>Number.isFinite(n)&&Math.abs(n)<1e6)).slice(0,200):[];
        return {id:randomUUID(),documentId:d.id,documentName:d.name,path:d.path,text:s.text,page:s.page,label:typeof s.label==='string'?s.label.slice(0,80):null,owner:s.owner==='right'?'right':'left',rects};
      });if(total>(settings.chatContextChars||24000))throw new Error('Trích đoạn vượt giới hạn ngữ cảnh đã cấu hình.');
    }
    // API key is decrypted here only, never exposed through IPC or stored with messages.
    const apiKey=getApiKey();if(input.retry)c.messages.splice(-2);const controller=new AbortController();
    const user={id:randomUUID(),role:'user',text:question,sources,scope:String(input.scope||'').slice(0,100),createdAt:Date.now()};
    const built=buildChatContents(c.messages,user,16000);
    const assistant={id:randomUUID(),role:'assistant',text:'',sources:[...built.historySources,...sources],status:'streaming',trimmed:built.trimmed,createdAt:Date.now()};
    c.messages.push(user,assistant);if(c.messages.length===2)c.title=question.slice(0,70);c.updatedAt=Date.now();
    const send=event=>{const win=getWindow();if(win&&!win.isDestroyed())win.webContents.send('chat:event',{conversationId:c.id,messageId:assistant.id,...event});};
    const timer=setTimeout(()=>controller.abort(),180000);
    const task=(async()=>{await persist();send({type:'started',retry:Boolean(input.retry),user:{...user,sources:user.sources.map(s=>({...s,path:undefined}))},assistant:{...assistant,sources:assistant.sources.map(s=>({...s,path:undefined}))}});
      try{const result=await streamChat({apiKey,settings,contents:built.contents,signal:controller.signal,onEvent:event=>{if(event.delta)assistant.text+=event.delta;if(event.model)assistant.model=event.model;send(event);}});Object.assign(assistant,result,{status:'complete'});}
      catch(error){assistant.status=controller.signal.aborted?'stopped':'error';assistant.error=controller.signal.aborted?'Đã dừng trả lời (hoặc hết thời gian chờ 3 phút).':String(error.message).replaceAll(apiKey||'__NO_KEY__','[key]');}
      finally{clearTimeout(timer);running.delete(c.id);c.updatedAt=Date.now();await persist();send({type:'finished',assistant:{...assistant,sources:assistant.sources.map(s=>({...s,path:undefined}))}});}
      return {...assistant,sources:assistant.sources.map(s=>({...s,path:undefined}))};
    })();running.set(c.id,{controller,promise:task});return task;
  });
  return async()=>{for(const r of running.values())r.controller.abort();await Promise.allSettled([...running.values()].map(r=>r.promise));await queue;};
};
