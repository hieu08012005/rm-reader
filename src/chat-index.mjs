import { rankPassages } from './core/chat.mjs';
const memory=new Map();
let database;
async function db(){if(!database)database=new Promise(resolve=>{const request=indexedDB.open('rm-reader-chat-index',1);request.onupgradeneeded=()=>request.result.createObjectStore('documents');request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(null);});return database;}
async function read(id){const database=await db();if(!database)return null;return new Promise(resolve=>{const request=database.transaction('documents').objectStore('documents').get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(null);});}
async function write(id,pages){const database=await db();if(!database)return;await new Promise(resolve=>{const tx=database.transaction('documents','readwrite');tx.objectStore('documents').put({version:1,pages,updated:Date.now()},id);tx.oncomplete=resolve;tx.onerror=resolve;tx.onabort=resolve;});}
function cancelled(signal){if(signal?.aborted)throw new Error('Đã dừng lập chỉ mục.');}
export async function pagePassages(context,pageNumber,labels){
  const page=await context.pdf.getPage(pageNumber),content=await page.getTextContent(),view=page.getViewport({scale:1});
  const rows=[];let row=null;
  for(const item of content.items){if(!item.str)continue;const x=item.transform[4],y=item.transform[5],height=Math.max(1,item.height||Math.abs(item.transform[3])||10),rect=[x,y,x+Math.max(item.width,1),y+height];
    if(!row||Math.abs(row.y-y)>height*.55){row={y,text:'',rects:[]};rows.push(row);}
    row.text+=(row.text?'\t':'')+item.str;row.rects.push({page:pageNumber,rect});if(item.hasEOL)row=null;
  }
  const blocks=[];let text='',rects=[];
  const flush=()=>{if(text.trim())blocks.push({text:text.trim(),rects:rects.slice(0,200)});text='';rects=[];};
  for(const line of rows){if(text.length+line.text.length>1800)flush();text+=(text?'\n':'')+line.text;rects.push(...line.rects);}flush();
  return {page:pageNumber,label:labels?.[pageNumber-1]||null,width:view.width,height:view.height,blocks};
}
export async function indexDocument(context,{signal,onProgress=()=>{}}={}){
  const id=context.info.id;cancelled(signal);if(memory.has(id))return memory.get(id);
  const saved=await read(id);cancelled(signal);if(saved?.version===1){memory.set(id,saved.pages);return saved.pages;}
  const labels=await context.pdf.getPageLabels().catch(()=>null),pages=[];
  for(let number=1;number<=context.pdf.numPages;number++){
    cancelled(signal);onProgress(`Đang lập chỉ mục ${context.info.name}: ${number}/${context.pdf.numPages} trang…`);
    pages.push(await pagePassages(context,number,labels));
    // Yield between pages; PDF reading and navigation stay responsive.
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  cancelled(signal);memory.set(id,pages);await write(id,pages);return pages;
}
export async function searchDocument(context,question,options){return rankPassages(await indexDocument(context,options),question,8);}
export function sourceFrom(context,block){return {token:context.info.token,documentId:context.info.id,documentName:context.info.name,owner:context.owner,page:block.page,label:block.label,text:block.text,rects:block.rects||[]};}
