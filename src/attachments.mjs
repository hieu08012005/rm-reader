import { icon } from './icons.mjs';
import { attachmentName, attachmentLabel, canOpenAttachment } from './core/attachments.mjs';
const $=id=>document.getElementById(id);

export class AttachmentManager {
  constructor({desktop,owner,onOpenPdf,onShow,getSource,onError,onMessage,onDocumentChanged,fileAttachmentType}) {
    Object.assign(this,{desktop,owner,onOpenPdf,onShow,getSource,onError,onMessage,onDocumentChanged,fileAttachmentType});
    this.localSource=null;this.source=null;this.cache=new WeakMap();this.busy=false;
    $('toggle-attachments').onclick=()=>onShow(getSource());
    $('attachments-filter').oninput=()=>this.render();
    $('attachments-save-all').onclick=()=>this.saveAll();
  }
  setDocument(info,pdf) {
    this.localSource=info && pdf ? {info,pdf,owner:this.owner,openPdf:this.onOpenPdf} : null;
    this.onDocumentChanged(this.localSource);
  }
  useSource(source) {
    if(this.source!==source)$('attachments-filter').value='';
    this.source=source;this.render();
    if(source && !$('attachments-panel').hidden && !this.cache.get(source.pdf)?.promise)this.load(source).catch(this.onError);
  }
  async load(source) {
    let cached=this.cache.get(source.pdf);
    if(cached?.promise)return cached.promise;
    cached={entries:[],loaded:false,promise:null,error:''};this.cache.set(source.pdf,cached);
    const update=()=>{if(this.source===source)this.render();};
    cached.promise=(async()=>{
      try {
        const named=await source.pdf.getAttachments();
        const entries=named && typeof named.entries==='function' ? [...named.entries()] : Object.entries(named || {});
        cached.entries=entries.map(([id,entry])=>({...entry,id,name:attachmentName(entry.filename || entry.rawFilename || id)}));
        update();
        try {
          const pageFiles=await source.pdf.getAnnotationsByType(new Set([this.fileAttachmentType]),new Set());
          for(const item of pageFiles || []) {
            if(!item.file || cached.entries.some(entry=>entry.id===item.fileId))continue;
            // A paperclip can point to a file already in the catalog. Compare only
            // matching metadata; keep distinct files even if their names match.
            let duplicate=false;
            for(const entry of cached.entries.filter(entry=>entry.rawFilename===item.file.rawFilename && entry.description===item.file.description)) {
              try {
                const a=entry.content ||= await source.pdf.getAttachmentContent(entry.id);
                const b=item.file.content ||= await source.pdf.getAttachmentContent(item.fileId);
                if(a && b && a.length===b.length && a.every((byte,index)=>byte===b[index])){duplicate=true;break;}
              } catch {}
            }
            if(duplicate)continue;
            cached.entries.push({...item.file,id:item.fileId,name:attachmentName(item.file.filename || item.file.rawFilename),description:item.file.description || (Number.isInteger(item.pageIndex)?`Đính kèm tại trang ${item.pageIndex+1}`:'Tệp gắn trên trang PDF')});
          }
        } catch(error) {cached.error='Không đọc được một số tệp gắn trên trang.';}
      } catch(error) {cached.error='Không đọc được danh sách tệp đính kèm.';throw error;}
      finally {cached.loaded=true;cached.entries.sort((a,b)=>a.name.localeCompare(b.name,'vi',{numeric:true}));update();}
      return cached.entries;
    })();
    update();return cached.promise;
  }
  render() {
    const source=this.source,cached=source && this.cache.get(source.pdf),list=$('attachments-list');list.replaceChildren();
    $('attachments-source').textContent=source?.info.name || 'Chưa mở PDF';
    $('attachments-source').title=source?.info.name || '';
    const query=$('attachments-filter').value.trim().toLocaleLowerCase('vi');
    const entries=(cached?.entries || []).filter(entry=>`${entry.name} ${entry.description || ''}`.toLocaleLowerCase('vi').includes(query));
    $('attachments-count').textContent=cached ? `(${cached.entries.length})` : '';
    $('attachments-save-all').disabled=this.busy || !cached?.entries.length;
    $('attachments-status').textContent=this.busy?'Đang xử lý tệp…':cached?.error || (source && !cached?.loaded ? 'Đang tìm tệp đính kèm trong PDF…' : query ? `${entries.length} / ${cached?.entries.length || 0} tệp` : 'Nhấn tên tệp để mở · Lưu để lấy bản sao ra máy');
    if(!entries.length) {
      const empty=document.createElement('p');empty.className='empty-note';
      empty.textContent=!source?'Mở một PDF để xem các tệp được nhúng bên trong.':!cached?.loaded?'Đang đọc danh sách…':query?'Không tìm thấy tệp phù hợp.':cached?.error || 'PDF này không có tệp đính kèm.';
      list.append(empty);return;
    }
    for(const entry of entries) {
      const row=document.createElement('article');row.className='attachment-row';
      const title=document.createElement('button');title.className='attachment-name';title.innerHTML=icon('file');
      const text=document.createElement('span');text.textContent=entry.name;title.append(text);title.title=entry.name;
      title.disabled=this.busy || !canOpenAttachment(entry.name);title.onclick=()=>this.open(entry,source);
      const type=document.createElement('span');type.className='attachment-type';type.textContent=attachmentLabel(entry.name);
      const description=document.createElement('p');description.className='attachment-description';description.textContent=entry.description || 'Không có mô tả';
      const actions=document.createElement('div');actions.className='attachment-actions';
      const open=document.createElement('button');open.className='secondary';open.textContent='Mở';open.disabled=title.disabled;open.setAttribute('aria-label',`Mở ${entry.name}`);open.onclick=()=>this.open(entry,source);
      if(!canOpenAttachment(entry.name))open.title='Loại tệp này hỗ trợ lưu ra máy';
      const save=document.createElement('button');save.className='secondary';save.innerHTML=icon('save');save.append(document.createTextNode('Lưu'));save.disabled=this.busy;save.setAttribute('aria-label',`Lưu ${entry.name}`);save.onclick=()=>this.save(entry,source);
      actions.append(type,open,save);row.append(title,description,actions);list.append(row);
    }
  }
  async bytes(entry,source) {
    const content=entry.content || await source.pdf.getAttachmentContent(entry.id);
    if(!content || content.byteLength>512*1024*1024)throw new Error('Không đọc được nội dung tệp hoặc tệp lớn hơn 512 MB.');
    return {token:source.info.token,name:entry.name,content};
  }
  async action(work) {
    if(this.busy)return;
    this.busy=true;this.render();
    try{await work();}catch(error){this.onError(error);}finally{this.busy=false;this.render();}
  }
  open(entry,source=this.localSource,dest=null) {
    return this.action(async()=>{
      if(!source)throw new Error('Hãy mở PDF nguồn.');
      const result=await this.desktop.openAttachment(await this.bytes(entry,source));
      if(result.document) {
        await source.openPdf(result.document);
        if(dest)await source.navigateDestination?.(dest);
      } else if(result.opened)this.onMessage(`Đã mở ${entry.name} bằng ứng dụng trên máy.`);
    });
  }
  save(entry,source=this.source) {
    return this.action(async()=>{const result=await this.desktop.saveAttachment(await this.bytes(entry,source));if(result.saved)this.onMessage(`Đã lưu ${entry.name}.`);});
  }
  saveAll() {
    const source=this.source;if(!source)return;
    return this.action(async()=>{
      const entries=await this.load(source),inputs=[];let total=0;
      for(const entry of entries){const input=await this.bytes(entry,source);total+=input.content.byteLength;if(total>1024*1024*1024)throw new Error('Tổng dung lượng lớn hơn 1 GB. Hãy lưu từng tệp.');inputs.push(input);}
      const result=await this.desktop.saveAllAttachments(inputs);if(!result.canceled)this.onMessage(`Đã lưu ${result.saved} tệp đính kèm. File trùng tên được thêm số thứ tự.`);
    });
  }
  downloadManager(source) {
    return {
      openOrDownloadData:(content,name,dest)=>{this.open({content,name:attachmentName(name)},source,dest);return true;},
      downloadData:(content,name)=>this.save({content,name:attachmentName(name)},source),
      download:()=>this.onMessage('Nhấn biểu tượng kẹp giấy để xem và lưu các tệp đính kèm.')
    };
  }
}
