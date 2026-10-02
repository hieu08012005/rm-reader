import { boundSources } from './core/chat.mjs';
import { pagePassages, searchDocument, sourceFrom } from './chat-index.mjs';
import { renderAnswer } from './chat-markdown.mjs';
import { icon } from './icons.mjs';
const $=id=>document.getElementById(id);
const suggestions=['Giải thích đoạn này','Giải thích từng bit','Tóm tắt thành các bước cấu hình','Cho ví dụ C','Đối chiếu với PDF còn lại'];
const keyOf=contexts=>[...new Set(contexts.map(c=>c.info.id))].sort().join(':');
const cleanError=e=>String(e?.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
const layoutKey='rm-reader.chat-layout';
export class ChatManager{
  constructor({desktop,getContexts,getSettings,onOpen,onSource,onError}){
    Object.assign(this,{desktop,getContexts,getSettings,onOpen,onSource,onError});this.chats=[];this.selectedId=null;this.pinned=null;this.busy=null;this.sequence=0;this.documentKey='';
    this.layout={historyCollapsed:false,optionsCollapsed:false};
    try{const saved=JSON.parse(localStorage.getItem(layoutKey)||'{}');for(const key of Object.keys(this.layout))this.layout[key]=saved?.[key]===true;}catch{}
    $('chat-toggle-history').onclick=()=>this.toggleLayout('historyCollapsed');
    $('chat-toggle-options').onclick=()=>this.toggleLayout('optionsCollapsed');
    this.applyLayout();
    $('right-tab-chat').onclick=()=>this.open();$('right-tab-translation').onclick=()=>this.showTab('translation');
    $('chat-scope').onchange=()=>{this.pinned=null;if($('chat-scope').value==='compare')$('chat-pane-source').value='both';this.changed();};$('chat-pane-source').onchange=()=>{this.pinned=null;this.changed();};
    $('chat-form').onsubmit=e=>{e.preventDefault();this.send();};$('chat-input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();this.send();}};
    $('chat-stop').onclick=()=>this.stop();$('chat-retry').onclick=()=>this.retry();
    $('chat-new').onclick=()=>{this.selectedId=null;this.pinned=null;$('chat-input').value='';this.render();};
    $('chat-history').onchange=()=>{this.selectedId=$('chat-history').value||null;this.pinned=null;this.render();};
    $('chat-rename').onclick=()=>{const c=this.selected();if(c){$('chat-title').value=c.title;$('chat-title-dialog').showModal();}};
    $('chat-title-form').onsubmit=async e=>{e.preventDefault();try{const c=this.selected();if(!c)return;await desktop.renameChat({id:c.id,title:$('chat-title').value});c.title=$('chat-title').value.trim()||'Cuộc trò chuyện';$('chat-title-dialog').close();this.render();}catch(e){onError(e);}};
    $('chat-title-cancel').onclick=()=>$('chat-title-dialog').close();
    $('chat-delete').onclick=async()=>{const c=this.selected();if(!c)return;try{await desktop.deleteChat(c.id);this.chats=this.chats.filter(x=>x.id!==c.id);this.selectedId=null;this.render();}catch(e){onError(e);}};
    for(const question of suggestions){const button=document.createElement('button');button.type='button';button.textContent=question;button.onclick=()=>{if(question===suggestions[4])$('chat-scope').value='compare';$('chat-input').value=question;this.send();};$('chat-suggestions').append(button);}
    this.removeListener=desktop.onChatEvent(e=>this.event(e));this.ready=this.load();
  }
  async load(){try{this.chats=await this.desktop.listChats();this.render();}catch(e){this.onError(e);}}
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
      return `${c.owner==='right'?'Phải':'Trái'}: ${c.info.name} · ${mode}${mode.startsWith('Tìm')?' · Số trang sẽ hiển thị sau khi tìm':` · Trang ${pages.join(', ')||c.page} (${pages.length||1} trang)`}`;
    });const description=details.join('\n')||'Hãy mở PDF để đặt câu hỏi.';
    $('chat-source-preview').textContent=description;
    $('chat-source-summary').textContent=description;$('chat-source-summary').title=description;
  }
  render(){
    const selected=this.selected();const history=$('chat-history');history.replaceChildren();const fresh=document.createElement('option');fresh.value='';fresh.textContent='Cuộc trò chuyện mới';history.append(fresh);
    for(const c of [...this.chats].sort((a,b)=>b.updatedAt-a.updatedAt)){const option=document.createElement('option');option.value=c.id;option.textContent=(c.documents.some(d=>d.stale)?'⚠ Nguồn cũ · ':'')+c.title+' · '+c.documents.map(d=>d.name).join(' ↔ ');history.append(option);}history.value=selected?.id||'';
    $('chat-rename').disabled=$('chat-delete').disabled=!selected;
    $('chat-conversation-summary').textContent=selected?.title||'Cuộc trò chuyện mới';
    $('chat-conversation-summary').title=$('chat-history').selectedOptions[0]?.textContent||'Cuộc trò chuyện mới';
    $('chat-retry').disabled=!!this.busy||!selected?.messages.some(m=>m.role==='assistant');$('chat-send').disabled=!!this.busy;$('chat-stop').hidden=!this.busy;
    const list=$('chat-messages'),scrollBottom=list.scrollHeight-list.scrollTop-list.clientHeight<90;list.replaceChildren();
    if(!selected?.messages.length){const p=document.createElement('p');p.className='chat-welcome';p.textContent='Hỏi về bit, thanh ghi hoặc trình tự cấu hình. Nguồn PDF sẽ được đính kèm khi bạn gửi. Chat AI chỉ đọc lớp văn bản; hình, trang scan và nội dung attachment chưa được đưa vào chat.';list.append(p);}
    for(const m of selected?.messages||[]){const article=document.createElement('article');article.className='chat-message '+m.role;article.dataset.messageId=m.id;
      const title=document.createElement('div');title.className='chat-message-label';title.textContent=m.role==='user'?'Bạn':'Trợ lý lập trình nhúng';article.append(title);
      const body=document.createElement('div');body.className='chat-message-body';if(m.role==='user')body.textContent=m.text;else renderAnswer(body,m.text||'Đang chuẩn bị câu trả lời…',m.sources,s=>this.onSource(selected.id,s).catch(this.onError));article.append(body);
      if(m.role==='user'){const meta=document.createElement('div');meta.className='chat-message-meta';const grouped=new Map();for(const s of m.sources||[]){const pages=grouped.get(s.documentName)||new Set();pages.add(s.page);grouped.set(s.documentName,pages);}meta.textContent=(m.scope?m.scope+' · ':'')+[...grouped].map(([name,pages])=>`${name} · ${pages.size} trang: ${[...pages].join(', ')}`).join(' | ');article.append(meta);}
      else{const meta=document.createElement('div');meta.className='chat-message-meta';meta.textContent=[m.model,m.fallback?'Model dự phòng':'',m.usage?.totalTokenCount?`${m.usage.totalTokenCount} token (đầu vào ${m.usage.promptTokenCount||0}, đầu ra ${m.usage.candidatesTokenCount||0})`:'',m.trimmed?'Đã rút gọn lịch sử gửi: giữ các lượt hoàn chỉnh gần nhất.':'',m.finish==='MAX_TOKENS'?'Đã đạt giới hạn độ dài; có thể hỏi tiếp.':''].filter(Boolean).join(' · ');article.append(meta);
        if(m.error){const error=document.createElement('p');error.className='error-text';error.textContent=m.error;article.append(error);}
        if(m.sources?.length){const details=document.createElement('details');details.className='chat-provided-sources';const summary=document.createElement('summary');summary.textContent=`Trích đoạn được cung cấp (${m.sources.length})`;details.append(summary);for(const s of m.sources){const button=document.createElement('button');button.className='chat-citation';button.textContent=`${s.documentName} · Trang ${s.page}`;button.title=s.text.slice(0,600);button.onclick=()=>this.onSource(selected.id,s).catch(this.onError);details.append(button);}article.append(details);}
        if(m.status==='complete'&&!([...m.text.matchAll(/\[\s*SRC\s*:\s*([\w-]+)\s*\]/gi)].some(match=>m.sources?.some(s=>s.id===match[1])))){const warning=document.createElement('p');warning.className='chat-message-meta';warning.textContent='AI chưa ghi trích dẫn hợp lệ trong câu trả lời. Hãy kiểm tra các trích đoạn đã cung cấp hoặc yêu cầu AI dẫn nguồn.';article.append(warning);}
        if(m.text){const copy=document.createElement('button');copy.className='text-button';copy.textContent='Sao chép câu trả lời';copy.onclick=()=>navigator.clipboard.writeText(m.text).then(()=>{copy.textContent='Đã sao chép';}).catch(this.onError);article.append(copy);}
      }list.append(article);
    }if(scrollBottom)list.scrollTop=list.scrollHeight;this.preview();
  }
  async collect(contexts,question,scope,signal){
    const sets=[];
    for(const context of contexts){let blocks;
      const selected=context.selection;
      if(scope==='selection'&&selected?.text){const pieces=selected.pieces?.length?selected.pieces:[{page:selected.position?.page||context.page,text:selected.text}];const labels=await context.pdf.getPageLabels().catch(()=>null);blocks=pieces.map(piece=>({...piece,label:labels?.[piece.page-1]||null,rects:(selected.rects||[]).filter(r=>r.page===piece.page)}));}
      else if(scope==='search'||scope==='compare')blocks=await searchDocument(context,question,{signal,onProgress:status=>{$('chat-status').textContent=status;}});
      else{const labels=await context.pdf.getPageLabels().catch(()=>null);const page=await pagePassages(context,context.page,labels);blocks=page.blocks.map(b=>({...b,page:page.page,label:page.label}));}
      sets.push(blocks.map(block=>sourceFrom(context,block)));
    }
    const interleaved=[];for(let i=0;i<Math.max(...sets.map(s=>s.length),0);i++)for(const set of sets)if(set[i])interleaved.push(set[i]);
    return boundSources(interleaved,this.getSettings().chatContextChars||24000);
  }
  async send(){
    if(this.busy)return;const question=$('chat-input').value.trim();if(!question)return;
    // Freeze source objects, page, selection and scope before the first await.
    const frozenConversationId=this.selectedId;
    const scope=$('chat-scope').value,contexts=this.contexts().map(c=>({...c,selection:structuredClone(this.pinned?.documentId===c.info.id?this.pinned:c.selection)}));
    if(!contexts.length){$('chat-status').textContent='Hãy chọn PDF nguồn.';return;}
    if(scope==='compare'&&contexts.length<2){$('chat-status').textContent='Mở chế độ Hai PDF và chọn hai tài liệu để đối chiếu.';return;}
    const controller=new AbortController(),job={controller,conversationId:null};this.busy=job;this.render();$('chat-status').textContent='Đang chuẩn bị trích đoạn…';
    try{
      await this.ready;const sources=await this.collect(contexts,question,scope,controller.signal);if(controller.signal.aborted)return;
      if(!sources.length)throw new Error('Không tìm được lớp văn bản/trích đoạn phù hợp. Hãy chọn trang khác, thêm tên thanh ghi tiếng Anh hoặc mở rộng phạm vi; hình và PDF scan chưa có OCR.');
      let c=this.chats.find(c=>c.id===frozenConversationId);if(!c||c.key!==keyOf(contexts)){c=await this.desktop.createChat({tokens:contexts.map(c=>c.info.token)});this.chats.unshift(c);}
      job.conversationId=c.id;if(keyOf(this.contexts())===keyOf(contexts))this.selectedId=c.id;
      const docsMissing=contexts.filter(ctx=>!sources.some(s=>s.documentId===ctx.info.id));
      const sourceSummary=[...new Set(sources.map(s=>s.documentName+' · Trang '+s.page))].join(' | ');
      $('chat-status').textContent='Đã đính kèm: '+sourceSummary+(docsMissing.length?' · Không tìm thấy đoạn liên quan trong '+docsMissing.map(c=>c.info.name).join(', '):'');
      $('chat-input').value='';this.pinned=null;this.render();
      if(controller.signal.aborted)return;
      await this.desktop.sendChat({conversationId:c.id,question,sources,scope:scope+(docsMissing.length?' (thiếu nguồn: '+docsMissing.map(c=>c.info.name).join(', ')+')':'')});
    }catch(e){$('chat-status').textContent=controller.signal.aborted?'Đã dừng.':cleanError(e);}
    finally{if(this.busy===job)this.busy=null;this.render();}
  }
  async retry(){const c=this.selected();if(!c||this.busy)return;const user=c.messages.filter(m=>m.role==='user').at(-1);if(!user)return;const job={controller:new AbortController(),conversationId:c.id};this.busy=job;this.render();try{await this.desktop.sendChat({conversationId:c.id,question:user.text,scope:user.scope,retry:true});}catch(e){$('chat-status').textContent=cleanError(e);}finally{if(this.busy===job)this.busy=null;this.render();}}
  stop(){const job=this.busy;if(!job)return;job.controller.abort();if(job.conversationId)this.desktop.cancelChat(job.conversationId).catch(this.onError);$('chat-status').textContent='Đang dừng…';}
  event(event){const c=this.chats.find(c=>c.id===event.conversationId);if(!c)return;
    if(event.type==='started'){if(event.retry&&c.messages.at(-1)?.role==='assistant'&&c.messages.at(-2)?.role==='user')c.messages.splice(-2);c.messages.push(event.user,event.assistant);if(c.messages.length===2)c.title=event.user.text.slice(0,70);}
    const m=c.messages.find(m=>m.id===event.messageId);if(m){if(event.delta)m.text+=event.delta;if(event.model)m.model=event.model;if(event.fallback)m.fallback=true;if(event.type==='finished')Object.assign(m,event.assistant);}
    c.updatedAt=Date.now();if(event.status&&c.id===this.selectedId)$('chat-status').textContent=event.status;
    if(c.id===this.selectedId)this.render();
  }
}
