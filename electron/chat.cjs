const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
module.exports=async function({app,handle,documents,registerPdf,getWindow,getSettings,getApiKey}){
  const {streamChat,buildChatContents}=await import(pathToFileURL(path.join(__dirname,'../src/core/chat.mjs')).href);
  const filename=path.join(app.getPath('userData'),'chats.json');let chats=[],queue=Promise.resolve();const running=new Map();
  try{const saved=JSON.parse(await fs.readFile(filename,'utf8'));if(Array.isArray(saved))chats=saved;}catch{}
  for(const chat of chats)for(const m of chat.messages||[])if(m.status==='streaming'){m.status='stopped';m.error='Lượt trả lời đã dừng khi đóng ứng dụng.';}
  const persist=()=>{const snapshot=JSON.stringify(chats);queue=queue.catch(()=>{}).then(async()=>{
    await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename+'.tmp',snapshot);
    // Windows scanners/sync clients can briefly lock the destination file.
    for(let attempt=0;;attempt++){try{await fs.rename(filename+'.tmp',filename);break;}catch(error){
      if(attempt>=5||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;
      await new Promise(resolve=>setTimeout(resolve,50*(attempt+1)));
    }}
  });return queue;};
  const get=id=>{const c=chats.find(c=>c.id===id);if(!c)throw new Error('Không tìm thấy cuộc trò chuyện.');return c;};
  const known=token=>{const d=documents.get(token);if(!d)throw new Error('Tài liệu đã đóng. Hãy mở lại PDF.');return {...d,name:path.basename(d.path)};};
  const stale=async doc=>{try{const stat=await fs.stat(doc.path);return createHash('sha256').update(path.resolve(doc.path)+':'+stat.size+':'+stat.mtimeMs).digest('hex')!==doc.id;}catch{return true;}};
  const imageStore=await require('./chat-images.cjs')({app,handle,chats,known,isUsed:id=>chats.some(c=>c.messages.some(m=>(m.sources||[]).some(s=>s.image?.id===id)))});
  const imageRecords=ids=>{
    if(!Array.isArray(ids)||ids.length>3||new Set(ids).size!==ids.length)throw new Error('Mỗi câu hỏi hỗ trợ tối đa 3 ảnh khác nhau.');
    return ids.map(id=>imageStore.get(id));
  };
  handle('chat:list',async()=>Promise.all(chats.map(async c=>({
    ...c,
    documents:await Promise.all(c.documents.map(async d=>({...d,path:undefined,stale:await stale(d)}))),
    messages:c.messages.map(m=>({...m,sources:(m.sources||[]).map(s=>({...s,path:undefined}))}))
  }))));
  handle('chat:create',async input=>{
    if(!Array.isArray(input?.tokens)||input.tokens.length>2)throw new Error('Chọn một hoặc hai PDF để chat.');
    const images=imageRecords(input.imageIds||[]);
    if(!input.tokens.length&&!images.length)throw new Error('Chọn PDF hoặc đính kèm ảnh để chat.');
    const docs=[...new Map([...input.tokens.map(known),...images.filter(i=>i.origin).map(i=>({id:i.origin.id,name:i.origin.name,path:i.origin.path}))].map(doc=>[doc.id,doc])).values()];
    if(docs.length>2)throw new Error('Một hội thoại hỗ trợ tối đa hai PDF nguồn. Hãy bỏ bớt ảnh từ PDF khác.');
    const c={id:randomUUID(),key:docs.map(d=>d.id).sort().join(':'),title:'Cuộc trò chuyện mới',documents:docs,createdAt:Date.now(),updatedAt:Date.now(),messages:[]};
    chats.unshift(c);await persist();return {...c,documents:docs.map(d=>({...d,path:undefined}))};
  });
  handle('chat:rename',async({id,title})=>{const c=get(id);c.title=String(title||'').trim().slice(0,120)||'Cuộc trò chuyện';c.updatedAt=Date.now();await persist();return true;});
  handle('chat:delete',async id=>{running.get(id)?.controller.abort();await running.get(id)?.promise.catch(()=>{});const imageIds=new Set(get(id).messages.flatMap(m=>(m.sources||[]).filter(s=>s.image).map(s=>s.image.id)));chats=chats.filter(c=>c.id!==id);await persist();for(const imageId of imageIds)await imageStore.remove(imageId);return true;});
  handle('chat:source',async({conversationId,sourceId})=>{
    const c=get(conversationId),source=c.messages.flatMap(m=>m.sources||[]).find(s=>s.id===sourceId);
    if(!source)throw new Error('Nguồn này chưa được cung cấp cho AI.');
    if(!source.documentId&&source.image){await imageStore.data(source.image.id);return {image:imageStore.publicImage(imageStore.get(source.image.id)),source};}
    if(await stale({id:source.documentId,path:source.path}))throw new Error('PDF nguồn đã thay đổi hoặc bị di chuyển. Đây là trích dẫn của phiên bản cũ.');
    const document=await registerPdf(source.path);return {document,source:{...source,path:undefined}};
  });
  handle('chat:cancel',id=>{running.get(id)?.controller.abort();return true;});
  handle('chat:send',async input=>{
    const c=get(input?.conversationId);if(running.has(c.id))throw new Error('Cuộc trò chuyện này đang trả lời.');
    const controller=new AbortController(),job={controller,promise:null};running.set(c.id,job);
    const operation=(async()=>{try{
    const question=String(input.question||'').trim();if(!question||question.length>8000)throw new Error('Câu hỏi phải có từ 1 đến 8.000 ký tự.');
    const settings={...getSettings()};let sources;
    if(input.retry){const last=c.messages.at(-2);if(last?.role!=='user'||c.messages.at(-1)?.role!=='assistant')throw new Error('Không có câu hỏi để thử lại.');sources=last.sources;for(const s of sources)if(s.documentId&&await stale({id:s.documentId,path:s.path}))throw new Error('Nguồn cũ đã thay đổi. Hãy bắt đầu cuộc trò chuyện với PDF hiện tại.');}
    else{
      const images=imageRecords(input.imageIds||[]);
      const priorImages=c.messages.some((m,i)=>m.role==='user'&&m.sources?.some(s=>s.image)&&c.messages[i+1]?.status==='complete');
      if(!Array.isArray(input.sources)||(!input.sources.length&&!images.length&&!priorImages)||input.sources.length+images.length>24)throw new Error('Không có nguồn phù hợp. Hãy chọn đoạn/trang PDF hoặc đính kèm ảnh.');
      let total=0;sources=input.sources.map(s=>{
        const d=known(s.token);if(!c.documents.some(doc=>doc.id===d.id))throw new Error('Nguồn không thuộc cuộc trò chuyện này.');
        if(typeof s.text!=='string'||!s.text.trim()||s.text.length>8000||!Number.isInteger(s.page)||s.page<1||s.page>100000)throw new Error('Trích đoạn PDF không hợp lệ.');
        total+=s.text.length;
        const rects=Array.isArray(s.rects)?s.rects.filter(r=>r.page===s.page&&Array.isArray(r.rect)&&r.rect.length===4&&r.rect.every(n=>Number.isFinite(n)&&Math.abs(n)<1e6)).slice(0,200):[];
        return {id:randomUUID(),documentId:d.id,documentName:d.name,path:d.path,text:s.text,page:s.page,label:typeof s.label==='string'?s.label.slice(0,80):null,owner:s.owner==='right'?'right':'left',rects};
      });if(total>(settings.chatContextChars||24000))throw new Error('Trích đoạn vượt giới hạn ngữ cảnh đã cấu hình.');
      if(total+images.length*120>(settings.chatContextChars||24000))throw new Error('Nguồn văn bản quá dài để kèm ảnh. Hãy giảm phạm vi văn bản.');
      for(const [index,image] of images.entries()){
        const origin=image.origin;
        if(origin&&(!c.documents.some(doc=>doc.id===origin.id)||await stale(origin)))throw new Error('PDF của ảnh đã thay đổi hoặc không thuộc hội thoại. Hãy khoanh lại vùng ảnh.');
        const text=(origin?.text||'Ảnh đính kèm do người dùng cung cấp; không có trang PDF nguồn.').slice(0,Math.min(8000,Math.floor(((settings.chatContextChars||24000)-total)/(images.length-index))));total+=text.length;
        sources.push({id:randomUUID(),kind:'image',image:imageStore.metadata(image),documentId:origin?.id||null,documentName:origin?.name||image.name,path:origin?.path,page:origin?.page||null,label:origin?.label||null,owner:origin?.owner||'left',rects:origin?.rects||[],text});
      }
    }
    // API key is decrypted here only, never exposed through IPC or stored with messages.
    const apiKey=getApiKey();
    const user={id:randomUUID(),role:'user',text:question,sources,scope:String(input.scope||'').slice(0,100),createdAt:Date.now()};
    const history=input.retry?c.messages.slice(0,-2):c.messages;
    const built=buildChatContents(history,user,16000);
    if(!sources.length&&!built.historySources.length)throw new Error('Ảnh gốc đã ra ngoài giới hạn lịch sử gửi. Nhấn Dùng lại ảnh để đính kèm ảnh vào câu hỏi mới.');
    const loaded=new Map();
    for(const content of built.contents)for(const part of content.parts)if(part.imageId){
      if(!loaded.has(part.imageId))loaded.set(part.imageId,await imageStore.data(part.imageId));
      part.inlineData=loaded.get(part.imageId);delete part.imageId;
    }
    await imageStore.save(sources.filter(s=>s.image).map(s=>s.image.id));
    if(controller.signal.aborted)throw new Error('Đã dừng chuẩn bị ảnh.');
    if(input.retry)c.messages.splice(-2);
    const assistant={id:randomUUID(),role:'assistant',text:'',sources:[...built.historySources,...sources],status:'streaming',trimmed:built.trimmed,createdAt:Date.now()};
    c.messages.push(user,assistant);if(c.messages.length===2)c.title=question.slice(0,70);c.updatedAt=Date.now();
    const send=event=>{const win=getWindow();if(win&&!win.isDestroyed())win.webContents.send('chat:event',{conversationId:c.id,messageId:assistant.id,...event});};
    const timer=setTimeout(()=>controller.abort(),180000);
    const task=(async()=>{await persist();send({type:'started',retry:Boolean(input.retry),user:{...user,sources:user.sources.map(s=>({...s,path:undefined}))},assistant:{...assistant,sources:assistant.sources.map(s=>({...s,path:undefined}))}});
      try{const result=await streamChat({apiKey,settings,contents:built.contents,signal:controller.signal,onEvent:event=>{if(event.delta)assistant.text+=event.delta;if(event.model)assistant.model=event.model;send(event);}});Object.assign(assistant,result,{status:'complete'});}
      catch(error){assistant.status=controller.signal.aborted?'stopped':'error';assistant.error=controller.signal.aborted?'Đã dừng trả lời (hoặc hết thời gian chờ 3 phút).':String(error.message).replaceAll(apiKey||'__NO_KEY__','[key]');}
      finally{clearTimeout(timer);c.updatedAt=Date.now();await persist();send({type:'finished',assistant:{...assistant,sources:assistant.sources.map(s=>({...s,path:undefined}))}});}
      return {...assistant,sources:assistant.sources.map(s=>({...s,path:undefined}))};
    })();return await task;
    }finally{if(running.get(c.id)===job)running.delete(c.id);}})();job.promise=operation;return operation;
  });
  return async()=>{for(const r of running.values())r.controller.abort();await Promise.allSettled([...running.values()].map(r=>r.promise));await queue;await imageStore.cleanup();};
};
