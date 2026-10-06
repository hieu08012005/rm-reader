import { boundSources } from './core/chat.mjs';
import { pagePassages, searchDocument, sourceFrom } from './chat-index.mjs';
import { renderAnswer } from './chat-markdown.mjs';
import { icon } from './icons.mjs';
import { t } from './i18n.mjs';
import { MAX_CHAT_IMAGES,MAX_IMAGE_INPUT_BYTES,sourceLabel } from './core/chat-images.mjs';
const $=id=>document.getElementById(id);
const suggestions=['Giải thích đoạn này','Giải thích từng bit','Tóm tắt thành các bước cấu hình','Cho ví dụ C','Đối chiếu với PDF còn lại'];
const keyOf=contexts=>[...new Set(contexts.map(c=>c.info.id))].sort().join(':');
const cleanError=e=>String(e?.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
const layoutKey='rm-reader.chat-layout';
export class ChatManager{
  constructor({desktop,getContexts,getSettings,onOpen,onSource,onError}){
    Object.assign(this,{desktop,getContexts,getSettings,onOpen,onSource,onError});this.chats=[];this.selectedId=null;this.pinned=null;this.busy=null;this.sequence=0;this.documentKey='';
    this.imageDrafts=[];this.imageJobs=0;this.draftGeneration=0;
    this.layout={historyCollapsed:false,optionsCollapsed:false};
    try{const saved=JSON.parse(localStorage.getItem(layoutKey)||'{}');for(const key of Object.keys(this.layout))this.layout[key]=saved?.[key]===true;}catch{}
    $('chat-toggle-history').onclick=()=>this.toggleLayout('historyCollapsed');
    $('chat-toggle-options').onclick=()=>this.toggleLayout('optionsCollapsed');
    this.applyLayout();
    $('right-tab-chat').onclick=()=>this.open();$('right-tab-translation').onclick=()=>this.showTab('translation');
    $('chat-scope').onchange=()=>{this.pinned=null;if(this.selected()?.documents.length===0)this.selectedId=null;if($('chat-scope').value==='compare')$('chat-pane-source').value='both';this.changed();};$('chat-pane-source').onchange=()=>{this.pinned=null;if(this.selected()?.documents.length===0)this.selectedId=null;this.changed();};
    $('chat-form').onsubmit=e=>{e.preventDefault();this.send();};$('chat-input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();this.send();}};
    $('chat-stop').onclick=()=>this.stop();$('chat-retry').onclick=()=>this.retry();
    $('chat-new').onclick=()=>{this.selectedId=null;this.pinned=null;this.clearImages();$('chat-input').value='';this.render();};
    $('chat-history').onchange=()=>{this.selectedId=$('chat-history').value||null;this.pinned=null;this.clearImages();this.render();};
    $('chat-rename').onclick=()=>{const c=this.selected();if(c){$('chat-title').value=c.title;$('chat-title-dialog').showModal();}};
    $('chat-title-form').onsubmit=async e=>{e.preventDefault();try{const c=this.selected();if(!c)return;await desktop.renameChat({id:c.id,title:$('chat-title').value});c.title=$('chat-title').value.trim()||'Cuộc trò chuyện';$('chat-title-dialog').close();this.render();}catch(e){onError(e);}};
    $('chat-title-cancel').onclick=()=>$('chat-title-dialog').close();
    $('chat-add-image').onclick=()=>$('chat-image-file').click();
    $('chat-image-file').onchange=async()=>{const files=[...$('chat-image-file').files];$('chat-image-file').value='';for(const file of files){try{await this.addFile(file);}catch(e){$('chat-status').textContent=cleanError(e);break;}}};
    $('chat-input').addEventListener('paste',event=>{const files=[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();(async()=>{for(const file of files)await this.addFile(file);})().catch(e=>{$('chat-status').textContent=cleanError(e);});}});
    $('chat-include-pdf').onchange=()=>this.preview();
    $('chat-image-close').onclick=()=>$('chat-image-dialog').close();
    $('chat-image-zoom').onclick=()=>{const zoomed=$('chat-image-viewport').classList.toggle('actual-size');$('chat-image-zoom').setAttribute('aria-pressed',String(zoomed));$('chat-image-zoom').textContent=zoomed?'Vừa khung':'Phóng to 100%';};
    $('chat-delete').onclick=async()=>{const c=this.selected();if(!c)return;try{await desktop.deleteChat(c.id);this.chats=this.chats.filter(x=>x.id!==c.id);this.selectedId=null;this.render();}catch(e){onError(e);}};
    for(const question of suggestions){const button=document.createElement('button');button.type='button';button.textContent=question;button.onclick=()=>{if(question===suggestions[4])$('chat-scope').value='compare';$('chat-input').value=t(question);this.send();};$('chat-suggestions').append(button);}
    this.removeListener=desktop.onChatEvent(e=>this.event(e));this.ready=this.load();
  }
  async load(){try{this.chats=await this.desktop.listChats();this.render();}catch(e){this.onError(e);}}
  clearImages(){this.draftGeneration++;const images=this.imageDrafts;this.imageDrafts=[];$('chat-include-pdf').checked=false;for(const image of images)this.desktop.removeChatImage(image.id).catch(this.onError);this.renderDrafts();}
  async addFile(file){
    if(!['image/png','image/jpeg'].includes(file.type)||file.size>MAX_IMAGE_INPUT_BYTES)throw new Error('Chọn ảnh PNG/JPEG tối đa 12 MB.');
    const generation=this.draftGeneration;
    this.imageJobs++;this.renderDrafts();try{
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.slice(reader.result.indexOf(',')+1));reader.onerror=()=>reject(new Error('Không đọc được tệp ảnh.'));reader.readAsDataURL(file);});
    await this.addImage({name:file.name||'Ảnh dán từ clipboard',mimeType:file.type,data},generation);
    }finally{this.imageJobs--;this.renderDrafts();}
  }
  async addPdfImage(input){
    this.onOpen();this.showTab('chat');$('chat-scope').value='selection';$('chat-pane-source').value=input.origin.owner;
    await this.addImage(input);if(!$('chat-input').value.trim())$('chat-input').value=t('Giải thích hình/bảng này');$('chat-input').focus();
  }
  async addImage(input,generation=this.draftGeneration){
    if(this.busy)throw new Error('Hãy đợi AI trả lời xong hoặc dừng trước khi thêm ảnh.');
    if(this.imageDrafts.length>=MAX_CHAT_IMAGES)throw new Error('Mỗi câu hỏi hỗ trợ tối đa 3 ảnh. Hãy bỏ bớt ảnh trước khi thêm.');
    if(generation!==this.draftGeneration)return;
    this.imageJobs++;this.renderDrafts();
    try{
      const image=await this.desktop.addChatImage(input);
      if(generation!==this.draftGeneration||this.imageDrafts.length>=MAX_CHAT_IMAGES){await this.desktop.removeChatImage(image.id);return;}
      this.imageDrafts.push(image);$('chat-status').textContent='Ảnh xem trước đã sẵn sàng. Ảnh chỉ được gửi khi bạn nhấn Gửi.';this.preview();
    }finally{this.imageJobs--;this.renderDrafts();}
  }
  showImage(image){
    $('chat-image-large').src=`rm-chat-image://image/${image.id}`;
    $('chat-image-caption').textContent=(image.documentId?`${image.documentName} · Trang ${image.page}`:image.name)+` · ${image.width} × ${image.height} px`;
    $('chat-image-viewport').classList.remove('actual-size');$('chat-image-zoom').setAttribute('aria-pressed','false');$('chat-image-zoom').textContent='Phóng to 100%';
    if(!$('chat-image-dialog').open)$('chat-image-dialog').showModal();
  }
  imageThumb(image){const button=document.createElement('button');button.type='button';button.className='chat-image-thumb';button.title='Xem ảnh lớn';const img=document.createElement('img');img.src=`rm-chat-image://image/${image.id}`;img.alt=image.name;button.append(img);button.onclick=()=>this.showImage(image);return button;}
  renderDrafts(){
    const list=$('chat-image-drafts');list.replaceChildren();list.hidden=!this.imageDrafts.length;$('chat-image-context').hidden=!this.imageDrafts.length;
    for(const image of this.imageDrafts){const card=document.createElement('div');card.className='chat-image-draft';card.append(this.imageThumb(image));const caption=document.createElement('p');caption.dataset.userContent='true';caption.textContent=image.name;caption.title=image.name;card.append(caption);const remove=document.createElement('button');remove.type='button';remove.className='chat-image-remove';remove.textContent='Bỏ ảnh';remove.setAttribute('aria-label',t('Bỏ ảnh')+' '+image.name);remove.disabled=!!this.busy;remove.onclick=()=>{this.imageDrafts=this.imageDrafts.filter(i=>i.id!==image.id);this.desktop.removeChatImage(image.id).catch(this.onError);this.renderDrafts();this.preview();};card.append(remove);list.append(card);}
    $('chat-add-image').disabled=!!this.busy||this.imageJobs>0||this.imageDrafts.length>=MAX_CHAT_IMAGES;
    $('chat-send').disabled=!!this.busy||this.imageJobs>0;$('chat-include-pdf').disabled=!!this.busy||!this.contexts().length;
  }
  hasImageHistory(){const messages=this.selected()?.messages||[];return messages.some((m,i)=>m.role==='user'&&m.sources?.some(s=>s.image)&&messages[i+1]?.status==='complete');}
  renderImages(article,sources){
    const images=(sources||[]).filter(s=>s.image);if(!images.length)return;
    const list=document.createElement('div');list.className='chat-message-images';
    for(const source of images){const image={...source.image,documentId:source.documentId,documentName:source.documentName,page:source.page,owner:source.owner};const figure=document.createElement('figure');figure.className='chat-message-image';figure.append(this.imageThumb(image));const caption=document.createElement('figcaption');caption.textContent=sourceLabel(source);figure.append(caption);
      if(source.documentId){const link=document.createElement('button');link.type='button';link.className='chat-citation';link.textContent=t('Về vùng PDF nguồn');link.onclick=()=>this.onSource(this.selectedId,source).catch(this.onError);figure.append(link);}
      const reuse=document.createElement('button');reuse.type='button';reuse.className='text-button';reuse.textContent=t('Dùng lại ảnh');reuse.onclick=()=>{if(this.busy||this.imageDrafts.length>=MAX_CHAT_IMAGES)return;if(!this.imageDrafts.some(i=>i.id===image.id))this.imageDrafts.push(image);this.renderDrafts();this.preview();$('chat-input').focus();};figure.append(reuse);list.append(figure);
    }article.append(list);
  }
  applyLayout(){
    for(const[buttonId,key,targets,label]of[
      ['chat-toggle-history','historyCollapsed',['chat-conversation-details'],'hội thoại'],
      ['chat-toggle-options','optionsCollapsed',['chat-suggestions','chat-source-options'],'gợi ý và nguồn']
    ]){
      const collapsed=this.layout[key],button=$(buttonId);button.setAttribute('aria-expanded',String(!collapsed));
      button.title=(collapsed?'Mở':'Thu gọn')+' '+label;
      button.setAttribute('aria-label',button.title);
      button.querySelector('i').innerHTML=icon(collapsed?'down':'up');
      for(const id of targets)$(id).hidden=collapsed;
    }
    $('chat-conversation-summary').hidden=!this.layout.historyCollapsed;
    $('chat-source-summary').hidden=!this.layout.optionsCollapsed;
  }
  toggleLayout(key){
    const list=$('chat-messages'),atBottom=list.scrollHeight-list.scrollTop-list.clientHeight<90;
    this.layout[key]=!this.layout[key];this.applyLayout();
    try{localStorage.setItem(layoutKey,JSON.stringify(this.layout));}catch{}
    if(atBottom)list.scrollTop=list.scrollHeight;
  }
  selected(){return this.chats.find(c=>c.id===this.selectedId);}
  showTab(tab){$('translation-view').hidden=tab!=='translation';$('chat-view').hidden=tab!=='chat';$('right-tab-chat').setAttribute('aria-selected',String(tab==='chat'));$('right-tab-translation').setAttribute('aria-selected',String(tab==='translation'));}
  open(draft){this.onOpen();this.showTab('chat');if(draft){this.pinned=draft;$('chat-scope').value='selection';$('chat-pane-source').value=draft.owner||'left';}this.changed();$('chat-input').focus();}
  contexts(){const all=this.getContexts().filter(c=>c?.info&&c.pdf);let choice=$('chat-pane-source').value;
    if($('chat-scope').value==='compare')choice='both';
    if(choice==='focused'){const focused=all.find(c=>c.focused);return focused?[focused]:all.slice(0,1);}
    if(choice==='both')return all;return all.filter(c=>c.owner===choice);
  }
  changed(){const contexts=this.contexts(),key=keyOf(contexts);if(key===this.documentKey){this.preview();return;}this.documentKey=key;const c=this.selected();if(c&&c.key!==key)this.selectedId=null;if(this.pinned&&!contexts.some(c=>c.info.id===this.pinned.documentId))this.pinned=null;this.render();}
  preview(){const contexts=this.contexts();const scope=$('chat-scope').value;
    $('chat-pane-source').options[3].disabled=this.getContexts().filter(c=>c?.info&&c.pdf).length<2;
    const details=contexts.map(c=>{
      const selection=this.pinned?.documentId===c.info.id?this.pinned:c.selection;
      const mode=scope==='selection'&&selection?.text?'Đoạn bôi đen':scope==='search'||scope==='compare'?'Tìm trích đoạn liên quan':'Trang hiện tại';
      const pages=mode==='Đoạn bôi đen'?[...new Set((selection.pieces||selection.rects||[]).map(r=>r.page))]:[c.page];
      return `${t(c.owner==='right'?'Phải':'Trái')}: ${c.info.name} · ${t(mode)}${mode.startsWith('Tìm')?' · '+t('Số trang sẽ hiển thị sau khi tìm'):` · ${t('Trang')} ${pages.join(', ')||c.page} (${pages.length||1} ${t('trang')})`}`;
    });if(!contexts.length)$('chat-include-pdf').checked=false;
    const imageDetails=this.imageDrafts.map(image=>t('Ảnh:')+' '+image.name);
    const description=[...imageDetails,...(!this.imageDrafts.length||$('chat-include-pdf').checked?details:[])].join('\n')||'Mở PDF hoặc thêm ảnh để đặt câu hỏi.';
    $('chat-source-preview').textContent=description;
    $('chat-source-summary').textContent=description;$('chat-source-summary').title=description;
  }
  render(){
    const selected=this.selected();const history=$('chat-history');history.replaceChildren();const fresh=document.createElement('option');fresh.value='';fresh.textContent=t('Cuộc trò chuyện mới');history.append(fresh);
    for(const c of [...this.chats].sort((a,b)=>b.updatedAt-a.updatedAt)){const option=document.createElement('option');option.value=c.id;option.textContent=(c.documents.some(d=>d.stale)?'⚠ '+t('Nguồn cũ')+' · ':'')+c.title+(c.documents.length?' · '+c.documents.map(d=>d.name).join(' ↔ '):'');history.append(option);}history.value=selected?.id||'';
    $('chat-rename').disabled=$('chat-delete').disabled=!selected;
    $('chat-conversation-summary').toggleAttribute('data-user-content',!!selected);$('chat-conversation-summary').textContent=selected?.title||t('Cuộc trò chuyện mới');
    $('chat-conversation-summary').title=$('chat-history').selectedOptions[0]?.textContent||'Cuộc trò chuyện mới';
    $('chat-retry').disabled=!!this.busy||!selected?.messages.some(m=>m.role==='assistant');$('chat-send').disabled=!!this.busy;$('chat-stop').hidden=!this.busy;
    const list=$('chat-messages'),scrollBottom=list.scrollHeight-list.scrollTop-list.clientHeight<90;list.replaceChildren();
    if(!selected?.messages.length){const p=document.createElement('p');p.className='chat-welcome';p.textContent='Hỏi về bit, thanh ghi hoặc trình tự cấu hình. Để hỏi về sơ đồ/bảng, nhấn Hỏi hình/bảng trên PDF rồi kéo khoanh vùng; hoặc Thêm ảnh/dán ảnh vào ô chat. Bạn xem trước ảnh rồi mới Gửi. Chat đọc lớp văn bản và những ảnh bạn chủ động đính kèm.';list.append(p);}
    for(const m of selected?.messages||[]){const article=document.createElement('article');article.className='chat-message '+m.role;article.dataset.messageId=m.id;
      const title=document.createElement('div');title.className='chat-message-label';title.textContent=m.role==='user'?'Bạn':'Trợ lý lập trình nhúng';article.append(title);
      const body=document.createElement('div');body.className='chat-message-body';if(m.role==='user')body.textContent=m.text;else renderAnswer(body,m.text||t('Đang chuẩn bị câu trả lời…'),m.sources,s=>this.onSource(selected.id,s).catch(this.onError));article.append(body);
      if(m.role==='user'){this.renderImages(article,m.sources);const meta=document.createElement('div');meta.className='chat-message-meta';const grouped=new Map();for(const s of m.sources||[]){if(!s.documentId)continue;const pages=grouped.get(s.documentName)||new Set();pages.add(s.page);grouped.set(s.documentName,pages);}meta.textContent=(m.scope?m.scope+' · ':'')+[...grouped].map(([name,pages])=>`${name} · ${pages.size} trang: ${[...pages].join(', ')}`).join(' | ');article.append(meta);}
      else{const meta=document.createElement('div');meta.className='chat-message-meta';meta.textContent=[m.model,m.fallback?'Model dự phòng':'',m.usage?.totalTokenCount?`${m.usage.totalTokenCount} token (đầu vào ${m.usage.promptTokenCount||0}, đầu ra ${m.usage.candidatesTokenCount||0})`:'',m.trimmed?'Đã rút gọn lịch sử gửi: giữ các lượt hoàn chỉnh gần nhất.':'',m.finish==='MAX_TOKENS'?'Đã đạt giới hạn độ dài; có thể hỏi tiếp.':''].filter(Boolean).join(' · ');article.append(meta);
        if(m.error){const error=document.createElement('p');error.className='error-text';error.textContent=m.error;article.append(error);}
        if(m.sources?.length){const details=document.createElement('details');details.className='chat-provided-sources';const summary=document.createElement('summary');summary.textContent=t('Nguồn được cung cấp')+` (${m.sources.length})`;details.append(summary);for(const s of m.sources){const button=document.createElement('button');button.className='chat-citation';button.textContent=sourceLabel(s);button.title=s.text.slice(0,600);button.onclick=()=>this.onSource(selected.id,s).catch(this.onError);details.append(button);}article.append(details);}
        if(m.status==='complete'&&!([...m.text.matchAll(/\[\s*SRC\s*:\s*([\w-]+)\s*\]/gi)].some(match=>m.sources?.some(s=>s.id===match[1])))){const warning=document.createElement('p');warning.className='chat-message-meta';warning.textContent='AI chưa ghi trích dẫn hợp lệ trong câu trả lời. Hãy kiểm tra các trích đoạn đã cung cấp hoặc yêu cầu AI dẫn nguồn.';article.append(warning);}
        if(m.text){const copy=document.createElement('button');copy.className='text-button';copy.textContent='Sao chép câu trả lời';copy.onclick=()=>navigator.clipboard.writeText(m.text).then(()=>{copy.textContent='Đã sao chép';}).catch(this.onError);article.append(copy);}
      }list.append(article);
    }if(scrollBottom)list.scrollTop=list.scrollHeight;this.preview();this.renderDrafts();
  }
  async collect(contexts,question,scope,signal,imageCount=0){
    const sets=[];
    for(const context of contexts){let blocks;
      const selected=context.selection;
      if(scope==='selection'&&selected?.text){const pieces=selected.pieces?.length?selected.pieces:[{page:selected.position?.page||context.page,text:selected.text}];const labels=await context.pdf.getPageLabels().catch(()=>null);blocks=pieces.map(piece=>({...piece,label:labels?.[piece.page-1]||null,rects:(selected.rects||[]).filter(r=>r.page===piece.page)}));}
      else if(scope==='search'||scope==='compare')blocks=await searchDocument(context,question,{signal,onProgress:status=>{$('chat-status').textContent=status;}});
      else{const labels=await context.pdf.getPageLabels().catch(()=>null);const page=await pagePassages(context,context.page,labels);blocks=page.blocks.map(b=>({...b,page:page.page,label:page.label}));}
      sets.push(blocks.map(block=>sourceFrom(context,block)));
    }
    const interleaved=[];for(let i=0;i<Math.max(...sets.map(s=>s.length),0);i++)for(const set of sets)if(set[i])interleaved.push(set[i]);
    return boundSources(interleaved,(this.getSettings().chatContextChars||24000)-256*imageCount);
  }
  async send(){
    if(this.busy||this.imageJobs)return;const question=$('chat-input').value.trim()||(this.imageDrafts.length?'Giải thích hình/bảng này':'');if(!question)return;
    // Freeze source objects, page, selection and scope before the first await.
    const frozenConversationId=this.selectedId;
    const images=[...this.imageDrafts],imageIds=images.map(i=>i.id),includePdf=!images.length||$('chat-include-pdf').checked;
    const scope=$('chat-scope').value,contexts=(includePdf&&!(this.selected()?.documents.length===0&&this.hasImageHistory()&&!images.length)?this.contexts():[]).map(c=>({...c,selection:structuredClone(this.pinned?.documentId===c.info.id?this.pinned:c.selection)}));
    let desiredKey=[...new Set([...contexts.map(c=>c.info.id),...images.map(i=>i.documentId).filter(Boolean)])].sort().join(':');
    if(!contexts.length&&!images.length&&this.hasImageHistory())desiredKey=this.selected().key;
    if(!contexts.length&&!images.length&&!this.hasImageHistory()){$('chat-status').textContent='Hãy chọn PDF nguồn hoặc thêm ảnh.';return;}
    if(scope==='compare'&&contexts.length<2&&includePdf&&!this.hasImageHistory()){$('chat-status').textContent='Mở chế độ Hai PDF và chọn hai tài liệu để đối chiếu.';return;}
    const controller=new AbortController(),job={controller,conversationId:null,question,imageIds};this.busy=job;this.render();$('chat-status').textContent='Đang chuẩn bị nguồn…';
    try{
      await this.ready;const sources=await this.collect(contexts,question,scope,controller.signal,images.length);if(controller.signal.aborted)return;
      if(!sources.length&&!images.length&&!this.hasImageHistory())throw new Error('Không tìm được lớp văn bản phù hợp. Hãy khoanh vùng Hỏi hình/bảng để gửi ảnh của trang scan, hoặc chọn nguồn khác.');
      let c=this.chats.find(c=>c.id===frozenConversationId);if(!c||c.key!==desiredKey){c=await this.desktop.createChat({tokens:contexts.map(c=>c.info.token),imageIds});this.chats.unshift(c);}
      job.conversationId=c.id;if(images.length||!contexts.length||keyOf(this.contexts())===keyOf(contexts))this.selectedId=c.id;
      const usingImageHistory=!sources.length&&!images.length&&this.hasImageHistory();
      const docsMissing=usingImageHistory?[]:contexts.filter(ctx=>!sources.some(s=>s.documentId===ctx.info.id));
      const sourceSummary=[...new Set([...sources.map(s=>s.documentName+' · Trang '+s.page),...images.map(i=>i.name)])].join(' | ');
      $('chat-status').textContent=(sourceSummary?'Đã đính kèm: '+sourceSummary:'Dùng nguồn ảnh trong lịch sử hội thoại.')+(docsMissing.length?' · Không tìm thấy đoạn liên quan trong '+docsMissing.map(c=>c.info.name).join(', '):'');
      this.render();
      if(controller.signal.aborted)return;
      await this.desktop.sendChat({conversationId:c.id,question,sources,imageIds,scope:(usingImageHistory?'Ảnh trong lịch sử':images.length?'Ảnh'+(contexts.length?' + '+scope:''):scope)+(docsMissing.length?' (thiếu nguồn: '+docsMissing.map(c=>c.info.name).join(', ')+')':'')});
    }catch(e){$('chat-status').textContent=controller.signal.aborted?'Đã dừng.':cleanError(e);}
    finally{if(this.busy===job)this.busy=null;this.render();}
  }
  async retry(){const c=this.selected();if(!c||this.busy)return;const user=c.messages.filter(m=>m.role==='user').at(-1);if(!user)return;const job={controller:new AbortController(),conversationId:c.id};this.busy=job;this.render();try{await this.desktop.sendChat({conversationId:c.id,question:user.text,scope:user.scope,retry:true});}catch(e){$('chat-status').textContent=cleanError(e);}finally{if(this.busy===job)this.busy=null;this.render();}}
  stop(){const job=this.busy;if(!job)return;job.controller.abort();if(job.conversationId)this.desktop.cancelChat(job.conversationId).catch(this.onError);$('chat-status').textContent='Đang dừng…';}
  event(event){const c=this.chats.find(c=>c.id===event.conversationId);if(!c)return;
    if(event.type==='started'&&this.busy?.conversationId===c.id&&!event.retry){if($('chat-input').value.trim()===this.busy.question)$('chat-input').value='';if(this.imageDrafts.map(i=>i.id).join(':')===this.busy.imageIds.join(':'))this.clearImages();this.pinned=null;}
    if(event.type==='started'){if(event.retry&&c.messages.at(-1)?.role==='assistant'&&c.messages.at(-2)?.role==='user')c.messages.splice(-2);c.messages.push(event.user,event.assistant);if(c.messages.length===2)c.title=event.user.text.slice(0,70);}
    const m=c.messages.find(m=>m.id===event.messageId);if(m){if(event.delta)m.text+=event.delta;if(event.model)m.model=event.model;if(event.fallback)m.fallback=true;if(event.type==='finished')Object.assign(m,event.assistant);}
    c.updatedAt=Date.now();if(event.status&&c.id===this.selectedId)$('chat-status').textContent=event.status;
    if(c.id===this.selectedId)this.render();
  }
}
