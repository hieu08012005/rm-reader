import { icon } from './icons.mjs';
import { studyEntries } from './core/vocabulary.mjs';
import { VocabularyStudy } from './vocabulary-study.mjs';
import { t } from './i18n.mjs';
const $ = id => document.getElementById(id);
const message = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
const node = (tag, text, className) => { const value = document.createElement(tag); if (text != null) value.textContent = text; if (className) value.className = className; return value; };
const userNode = (tag, text, className) => { const value = node(tag,text,className); value.dataset.userContent = 'true'; return value; };
export class VocabularyLibrary {
  constructor({ desktop, onSaved, onSource, onMessage }) {
    Object.assign(this,{desktop,onSaved,onSource,onMessage}); this.entries=[]; this.folders=[]; this.stats={}; this.folderId='default';
    try { this.folderId = localStorage.getItem('rm-reader.vocab-folder') || 'default'; } catch {}
    this.study = new VocabularyStudy({desktop,onSaved});
    $('vocabulary-button').onclick = async () => { await onSaved(); $('vocabulary-error').textContent=''; $('vocabulary-dialog').showModal(); };
    $('vocabulary-close').onclick = () => $('vocabulary-dialog').close();
    $('vocabulary-filter').oninput = () => this.render();
    $('vocabulary-folder').onchange = () => { this.folderId=$('vocabulary-folder').value; $('vocabulary-filter').value=''; try{localStorage.setItem('rm-reader.vocab-folder',this.folderId);}catch{} this.render(); };
    $('vocabulary-folder-new').onclick = () => this.folderEditor();
    $('vocabulary-folder-rename').onclick = () => this.folderEditor(this.folders.find(folder=>folder.id===this.folderId));
    $('vocabulary-save-new-folder').onclick = () => this.folderEditor();
    $('vocabulary-folder-delete').onclick = async () => {
      try { this.update(await desktop.deleteVocabularyFolder(this.folderId)); await onSaved(); }
      catch(error){$('vocabulary-error').textContent=t(message(error));}
    };
    $('vocabulary-add').onclick = () => this.capture({manual:true,text:'',translation:''});
    $('vocabulary-export').onclick = async () => {
      const button=$('vocabulary-export'); button.disabled=true; $('vocabulary-error').textContent='';
      try { const result=await desktop.exportVocabularyPdf(this.folderId); if(!result.canceled)onMessage(t('Đã xuất {count} từ ra PDF.',{count:result.count})); }
      catch(error){$('vocabulary-error').textContent=t(message(error));} finally{this.render();}
    };
    for(const mode of ['flashcards','typing','matching'])$('vocabulary-'+mode).onclick=()=>this.study.start(this.folderId,this.folderName(),this.folderEntries(),mode);
    for(const id of ['vocabulary-save-cancel','vocabulary-save-close'])$(id).onclick=()=>$('vocabulary-save-dialog').close();
    $('vocabulary-save-dialog').addEventListener('close',()=>{
      const saved=this.savedSelection;this.savedSelection=null;
      if(saved)requestAnimationFrame(()=>{
        if(document.querySelector('dialog[open]')||saved.ranges.some(range=>!range.startContainer.isConnected||!range.endContainer.isConnected))return;
        const selection=saved.owner.getSelection();selection.removeAllRanges();for(const range of saved.ranges)selection.addRange(range);
      });
    });
    $('vocabulary-save-form').onsubmit = async event => {
      event.preventDefault(); $('vocabulary-save-error').textContent=''; $('vocabulary-save-confirm').disabled=true;
      try {
        const input={...this.draft,text:$('vocabulary-word').value,translation:$('vocabulary-meaning').value,folderId:$('vocabulary-save-folder').value};
        const state = this.draft.id ? await desktop.editVocabulary(input) : await desktop.saveVocabulary(input);
        this.folderId=input.folderId; try{localStorage.setItem('rm-reader.vocab-folder',this.folderId);}catch{}
        this.update(state); await onSaved(); $('vocabulary-save-dialog').close(); onMessage(t('Đã lưu vocab vào thư mục đã chọn.'));
      }catch(error){$('vocabulary-save-error').textContent=t(message(error));}finally{$('vocabulary-save-confirm').disabled=false;}
    };
    for(const id of ['vocabulary-folder-cancel','vocabulary-folder-close'])$(id).onclick=()=>$('vocabulary-folder-dialog').close();
    $('vocabulary-folder-form').onsubmit = async event => {
      event.preventDefault(); $('vocabulary-folder-error').textContent='';
      try {
        const state=await desktop.saveVocabularyFolder({id:this.editFolder?.id,name:$('vocabulary-folder-name').value});
        const created=this.editFolder?.id || state.vocabularyFolders.at(-1).id;
        this.folderId=created; this.update(state); $('vocabulary-save-folder').value=created;
        await onSaved(); $('vocabulary-folder-dialog').close();
      }catch(error){$('vocabulary-folder-error').textContent=t(message(error));}
    };
  }
  folderName(folder=this.folders.find(folder=>folder.id===this.folderId)) { return folder?.isDefault ? t('Chưa phân loại') : folder?.name || ''; }
  folderEntries() { return this.entries.filter(entry=>entry.folderId===this.folderId); }
  update(state) {
    this.entries=state.vocabulary||[]; this.folders=state.vocabularyFolders||[]; this.stats=state.vocabularyStudy||{};
    if(!this.folders.some(folder=>folder.id===this.folderId))this.folderId='default';
    this.options($('vocabulary-folder'),this.folderId);
    this.options($('vocabulary-save-folder'),$('vocabulary-save-folder').value || this.folderId);
    this.render();
  }
  options(select,selected) {
    select.replaceChildren();
    for(const folder of this.folders){const option=userNode('option',`${this.folderName(folder)} (${this.entries.filter(entry=>entry.folderId===folder.id).length})`);option.value=folder.id;select.append(option);}
    select.value=this.folders.some(folder=>folder.id===selected)?selected:this.folderId;
  }
  capture(input,selectionOwner=window) {
    this.savedSelection=null;
    const selection=selectionOwner.getSelection();
    const normalize=value=>value.trim().replace(/\s+/g,' ');
    if(!input.manual&&!input.id&&selection.rangeCount&&normalize(selection.toString())===normalize(input.text||''))this.savedSelection={owner:selectionOwner,ranges:Array.from({length:selection.rangeCount},(_,index)=>selection.getRangeAt(index).cloneRange())};
    this.draft={...input}; $('vocabulary-word').value=input.text||''; $('vocabulary-meaning').value=input.translation||'';
    $('vocabulary-word').readOnly=!input.manual&&!input.id;
    $('vocabulary-save-heading').textContent=t(input.id?'Sửa vocab':'Lưu vocab');
    this.options($('vocabulary-save-folder'),input.folderId||this.folderId); $('vocabulary-save-error').textContent='';
    $('vocabulary-save-dialog').showModal(); (input.manual?$('vocabulary-word'):$('vocabulary-save-folder')).focus();
  }
  folderEditor(folder=null) {
    this.editFolder=folder; $('vocabulary-folder-heading').textContent=t(folder?'Đổi tên thư mục':'Tạo thư mục');
    $('vocabulary-folder-name').value=folder?.name||''; $('vocabulary-folder-error').textContent='';
    $('vocabulary-folder-dialog').showModal(); $('vocabulary-folder-name').focus();
  }
  render() {
    const list=$('vocabulary-list'); list.replaceChildren(); const entries=this.folderEntries();
    const query=$('vocabulary-filter').value.trim().toLocaleLowerCase('vi');
    const items=entries.filter(entry=>`${entry.text} ${entry.translation} ${entry.documentName}`.toLocaleLowerCase('vi').includes(query));
    $('vocabulary-count').textContent=`(${entries.length})`;
    $('vocabulary-folder-summary').textContent=t('{count} từ trong thư mục · {ready} từ có nghĩa để học',{count:entries.length,ready:studyEntries(entries).length});
    const folder=this.folders.find(folder=>folder.id===this.folderId);
    $('vocabulary-folder-rename').disabled=!folder||folder.isDefault;
    $('vocabulary-folder-delete').disabled=!folder||folder.isDefault;
    $('vocabulary-export').disabled=!entries.length;
    for(const mode of ['flashcards','typing','matching'])$('vocabulary-'+mode).disabled=!studyEntries(entries).length;
    if(!items.length){list.append(node('p',t(entries.length?'Không tìm thấy vocab phù hợp.':'Thư mục này chưa có vocab. Lưu từ trong PDF hoặc nhấn Thêm từ.'),'empty-note'));return;}
    for(const entry of items){
      const card=node('article',null,'vocabulary-card'); card.dataset.entryId=entry.id;
      const word=userNode('h3',entry.text), meaning=userNode('p',entry.translation||t('Chưa lưu nghĩa'),'vocabulary-meaning'+(entry.translation?'':' no-meaning'));
      const footer=node('div',null,'vocabulary-card-footer');
      if(entry.path){
        const source=node('button',null,'vocabulary-source'); source.innerHTML=icon('file');
        source.append(userNode('span',`${entry.documentName} · ${t('Trang')} ${entry.page}`)); source.title=t('Mở lại vị trí đã lưu trong PDF'); source.onclick=()=>this.onSource(entry.id).catch(error=>$('vocabulary-error').textContent=t(message(error))); footer.append(source);
      }else footer.append(node('span',t('Thêm thủ công'),'vocabulary-manual'));
      const edit=node('button',t('Sửa / chuyển'),'secondary vocabulary-edit'); edit.onclick=()=>this.capture(entry);
      const copy=node('button',null,'icon-button'); copy.innerHTML=icon('copy'); copy.title=t('Sao chép vocab và nghĩa'); copy.onclick=()=>navigator.clipboard.writeText(entry.text+(entry.translation?'\n'+entry.translation:'')).then(()=>this.onMessage(t('Đã sao chép vocab.')));
      const remove=node('button',null,'icon-button vocabulary-delete'); remove.innerHTML=icon('close'); remove.title=t('Xóa vocab'); remove.setAttribute('aria-label',t('Xóa vocab {word}',{word:entry.text}));
      remove.onclick=async()=>{try{this.update(await this.desktop.deleteVocabulary(entry.id));await this.onSaved();}catch(error){$('vocabulary-error').textContent=t(message(error));}};
      const stats=this.stats[entry.id]; if(stats)card.append(node('small',t('Ôn tập: {correct} đúng · {wrong} cần ôn',{correct:stats.correct,wrong:stats.wrong}),'vocabulary-review-stats'));
      footer.append(edit,copy,remove);card.prepend(word,meaning);card.append(footer);list.append(card);
    }
  }
}
