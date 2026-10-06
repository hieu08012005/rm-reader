import { ENGLISH_UI } from './i18n-en.mjs';
let language='vi';
const originals=new WeakMap();
const reverse=new Map(Object.entries(ENGLISH_UI).map(([vi,en])=>[en,vi]));
const protectedContent='[data-user-content],#viewer,#viewerContainer,#translation-source,#translation-result,#annotation-text,#annotation-source,#annotation-note,.annotation-excerpt,.saved-textbox,.chat-message-body,.chat-message-images,.chat-provided-sources,#recent-list span,#document-name,#left-pane-name,#chat-history,#ai-models,#vocabulary-study-folder,#outline-tree .outline-item,#attachments-list .attachment-name,input,textarea,script,style';
export function t(source,values={}) {
  const text=language==='en'?(ENGLISH_UI[source]||source):source;
  return text.replace(/\{(\w+)\}/g,(_,key)=>values[key]??`{${key}}`);
}
function translate(source) {
  const leading=source.match(/^\s*/)[0],trailing=source.match(/\s*$/)[0],key=source.trim().replace(/\s+/g,' ');
  if(!key)return source;
  if(language!=='en')return source;
  if(ENGLISH_UI[key])return leading+ENGLISH_UI[key]+trailing;
  let text=key;
  const rules=[
    [/^Trang (\d+) \/ (\d+) · Có thể bôi đen văn bản để dịch$/,'Page $1 / $2 · Select text to translate'],
    [/^Trang (\d+)$/,'Page $1'],
    [/^(\d+) \/ (\d+) kết quả$/,'$1 / $2 results'],
    [/^Nguồn được cung cấp \((\d+)\)$/,'Provided sources ($1)'],
    [/^Cấp (\d+)$/,'Level $1'],
    [/^(.+) · TIẾNG VIỆT$/,'$1 · VIETNAMESE'],
    [/^Nhập API key (.+)$/,'Enter a $1 API key'],
    [/^Mở trang API key (.+) ↗$/,'Open the $1 API key page ↗'],
    [/^Đã tải (\d+) model(.*)$/,'Loaded $1 models$2'],
    [/^Sửa ghi chú (.+)$/,'Edit note $1'],[/^Xóa ghi chú (.+)$/,'Delete note $1'],
    [/^Lưu (.+)$/,'Save $1'],[/^Mở (.+)$/,'Open $1'],
    [/^(Nét vẽ|Hộp văn bản|Đoạn đã tô màu) · nhấn để xem trong PDF$/,(_,kind)=>({ 'Nét vẽ':'Drawing','Hộp văn bản':'Text box','Đoạn đã tô màu':'Highlighted passage' }[kind])+' · click to view in PDF'],
    [/^(R|G|B) cấp (\d+)$/,'$1 for level $2'],
    [/^Chọn màu cấp (\d+)$/,'Choose level $1 color'],
    [/^(.+) · Cấp (\d+)$/,'$1 · Level $2'],
    [/^Mở rộng (.+)$/,'Expand $1'],[/^Thu gọn (.+)$/,'Collapse $1'],
    [/^(.+) · Trang (\d+)(.*)$/,'$1 · Page $2$3'],
    [/^Đã tải (\d+) model\. Có thể chọn hoặc nhập tên khác\.$/,'Loaded $1 models. Pick one or enter another model ID.'],
    [/^Đang mở (.+)…$/,'Opening $1…'],[/^Mở lại (.+)$/,'Reopen $1'],
    [/^Trái: (.+)$/,'Left: $1'],[/^Phải: (.+)$/,'Right: $1'],
    [/^(.+) · đã lưu trong phiên$/,'$1 · cached for this session']
  ];
  for(const [pattern,english]of rules)if(pattern.test(text)){text=text.replace(pattern,english);break;}
  return leading+text+trailing;
}
function applyValue(target,key,value) {
  let record=originals.get(target);if(!record){record={};originals.set(target,record);}
  let item=record[key];
  if(!item||value!==item.rendered){const source=reverse.get(value.trim())||value;item={source,rendered:value};record[key]=item;}
  const next=translate(item.source);item.rendered=next;
  if(next!==value){if(key==='text')target.nodeValue=next;else target.setAttribute(key,next);}
}
export function localize(root=document.body) {
  if(!root)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{acceptNode:node=>node.nodeType===Node.ELEMENT_NODE?(node.matches(protectedContent)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_SKIP):(node.parentElement?.closest(protectedContent)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT)});
  while(walker.nextNode()){const text=walker.currentNode;applyValue(text,'text',text.nodeValue);}
  for(const element of [root,...root.querySelectorAll('[title],[aria-label],[placeholder]')]) {
    if(element.closest?.('[data-user-content],#viewer,#viewerContainer,.chat-message-body'))continue;
    for(const attribute of ['title','aria-label','placeholder'])if(element.hasAttribute(attribute))applyValue(element,attribute,element.getAttribute(attribute));
  }
}
let observer;
export function setLanguage(value) {
  language=value==='en'?'en':'vi';document.documentElement.lang=language;
  localize();
  if(!observer){let queued=false;observer=new MutationObserver(records=>{if(queued||records.every(record=>(record.target.nodeType===Node.ELEMENT_NODE?record.target:record.target.parentElement)?.closest(protectedContent)))return;queued=true;queueMicrotask(()=>{queued=false;localize();});});observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','placeholder']});}
}
export function getLanguage(){return language;}
