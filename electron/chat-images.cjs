const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {nativeImage,protocol}=require('electron');
module.exports=async function({app,handle,chats,known,isUsed}){
  const {imagePayload,imageSourceFields,MAX_CHAT_IMAGE_BYTES}=await import(pathToFileURL(path.join(__dirname,'../src/core/chat-images.mjs')).href);
  const root=path.join(app.getPath('userData'),'chat-images'),records=new Map();
  const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id);
  const file=id=>{if(!validId(id))throw new Error('Mã ảnh không hợp lệ.');return path.join(root,id+'.bin');};
  for(const chat of chats)for(const message of chat.messages||[])for(const source of message.sources||[]){
    if(source.image&&validId(source.image.id)&&!records.has(source.image.id))records.set(source.image.id,{...source.image,origin:source.documentId?{id:source.documentId,name:source.documentName,path:source.path,page:source.page,label:source.label,owner:source.owner,rects:source.rects,text:source.text}:null});
  }
  const get=id=>{const record=records.get(id);if(!record)throw new Error('Không tìm thấy ảnh. Hãy đính kèm lại.');return record;};
  const metadata=record=>({id:record.id,name:record.name,mimeType:record.mimeType,width:record.width,height:record.height,bytes:record.bytes,sha256:record.sha256,url:`rm-chat-image://image/${record.id}`});
  const publicImage=record=>({...metadata(record),...(record.origin?{documentId:record.origin.id,documentName:record.origin.name,page:record.origin.page,label:record.origin.label,owner:record.origin.owner}: {})});
  const data=async id=>{
    const record=get(id);let buffer;
    try{buffer=record.buffer||await fs.readFile(file(id));}catch{throw new Error('Ảnh đã mất trên máy. Hãy đính kèm lại để tiếp tục.');}
    if(buffer.length>MAX_CHAT_IMAGE_BYTES||createHash('sha256').update(buffer).digest('hex')!==record.sha256)throw new Error('Ảnh đã thay đổi trên máy. Hãy đính kèm lại.');
    return {mimeType:record.mimeType,data:buffer.toString('base64')};
  };
  protocol.handle('rm-chat-image',async request=>{
    const url=new URL(request.url),id=url.pathname.slice(1);
    if(request.method!=='GET'||url.hostname!=='image'||!validId(id)||!records.has(id))return new Response('Not found',{status:404});
    try{const image=await data(id);return new Response(Buffer.from(image.data,'base64'),{headers:{'Content-Type':image.mimeType,'Cache-Control':'private, max-age=31536000','X-Content-Type-Options':'nosniff'}});}catch{return new Response('Image unavailable',{status:404});}
  });
  handle('chat:image-add',async input=>{
    imagePayload(input);const fields=imageSourceFields(input.origin);
    const origin=input.origin?{...known(input.origin.token),...fields}:null;
    const buffer=Buffer.from(input.data,'base64');
    const png=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=buffer[0]===255&&buffer[1]===216&&buffer[2]===255;
    if(!(input.mimeType==='image/png'?png:jpeg))throw new Error('Định dạng ảnh không khớp. Chọn PNG hoặc JPEG.');
    let image=nativeImage.createFromBuffer(buffer);if(image.isEmpty())throw new Error('Không đọc được ảnh. Hãy chọn ảnh PNG/JPEG khác.');
    let {width,height}=image.getSize();if(width<8||height<8||width*height>32e6)throw new Error('Ảnh quá nhỏ hoặc quá lớn. Hãy chọn vùng ảnh rõ hơn.');
    const ratio=Math.min(1,3072/width,3072/height,Math.sqrt(6e6/(width*height)));
    if(ratio<1)image=image.resize({width:Math.max(8,Math.round(width*ratio)),height:Math.max(8,Math.round(height*ratio)),quality:'best'});
    let bytes=image.toPNG(),mimeType='image/png';
    if(bytes.length>MAX_CHAT_IMAGE_BYTES){mimeType='image/jpeg';bytes=image.toJPEG(85);}
    while(bytes.length>MAX_CHAT_IMAGE_BYTES){const size=image.getSize();image=image.resize({width:Math.round(size.width*.8),height:Math.round(size.height*.8),quality:'best'});bytes=image.toJPEG(85);}
    ({width,height}=image.getSize());
    if([...records.values()].filter(r=>r.buffer&&!isUsed(r.id)).length>=16)throw new Error('Có quá nhiều ảnh chưa gửi. Hãy bỏ bớt ảnh trước khi thêm.');
    const record={id:randomUUID(),name:String(input.name||'Ảnh đính kèm').slice(0,180),mimeType,width,height,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),buffer:bytes,origin};
    records.set(record.id,record);return publicImage(record);
  });
  const remove=async id=>{if(isUsed(id))return false;const record=records.get(id);if(!record)return false;records.delete(id);await fs.unlink(file(id)).catch(e=>{if(e.code!=='ENOENT')throw e;});return true;};
  handle('chat:image-remove',remove);
  return {get,metadata,publicImage,data,remove,
    save:async ids=>{if(!ids.length)return;await fs.mkdir(root,{recursive:true});for(const id of new Set(ids)){const record=get(id);if(record.buffer){await fs.writeFile(file(id),record.buffer);delete record.buffer;}else await data(id);}},
    cleanup:async()=>{for(const id of records.keys())if(!isUsed(id))await remove(id);}
  };
};
