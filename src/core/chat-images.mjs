export const MAX_CHAT_IMAGES=3;
export const MAX_CHAT_IMAGE_BYTES=2*1024*1024;
export const MAX_IMAGE_INPUT_BYTES=12*1024*1024;
export const MAX_HISTORY_IMAGE_BYTES=6*1024*1024;
export function sourceLabel(source){
  return source.documentId?`${source.documentName} · Trang ${source.page}${source.kind==='image'?' · Vùng ảnh':''}`:`Ảnh: ${source.image?.name||source.documentName||'Ảnh đính kèm'}`;
}
export function imagePayload(input){
  if(!input||!['image/png','image/jpeg'].includes(input.mimeType)||typeof input.data!=='string'||!input.data.length||input.data.length>Math.ceil(MAX_IMAGE_INPUT_BYTES/3)*4||input.data.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.data))throw new Error('Ảnh không hợp lệ. Chọn PNG/JPEG tối đa 12 MB.');
  return input;
}
export function imageSourceFields(origin){
  if(!origin)return {documentId:null,documentName:null,page:null,label:null,rects:[],text:'Ảnh đính kèm do người dùng cung cấp; không có trang PDF nguồn.'};
  const {page,rects}=origin;
  if(!Number.isInteger(page)||page<1||page>100000||!Array.isArray(rects)||rects.length!==1||rects[0].page!==page||!Array.isArray(rects[0].rect)||rects[0].rect.length!==4||!rects[0].rect.every(n=>Number.isFinite(n)&&Math.abs(n)<1e6)||rects[0].rect[0]===rects[0].rect[2]||rects[0].rect[1]===rects[0].rect[3])throw new Error('Vùng ảnh PDF không hợp lệ. Hãy khoanh lại vùng cần hỏi.');
  return {page,label:typeof origin.label==='string'?origin.label.slice(0,80):null,rects:structuredClone(rects),owner:origin.owner==='right'?'right':'left',text:typeof origin.text==='string'?origin.text.slice(0,8000):'Ảnh vùng PDF được người dùng chọn.'};
}
