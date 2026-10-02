import { selectionRects, viewportRect, eraseAnnotations } from './core/annotations.mjs';
import { normalizeSelection } from './core/glossary.mjs';
import { icon } from './icons.mjs';
const $ = id => document.getElementById(id);
const hints = { select:'Chọn văn bản để dịch hoặc ghi chú', highlight:'Bôi đen → tự tô màu · Esc để thoát', draw:'Kéo bút trên trang · Esc để thoát', erase:'Kéo qua vùng tô / nét vẽ để tẩy · Esc để thoát', textbox:'Nhấn vào trang để đặt text box · Ctrl+Enter để lưu', 'ai-image':'Kéo khoanh hình/bảng trên một trang → xem trước · Esc để hủy' };

export class MarkupTools {
  constructor({ desktop, viewer, container, annotations, getDocument, capturePosition, onSaved, onError, onFocus, onCapture }) {
    Object.assign(this,{desktop,viewer,container,annotations,getDocument,capturePosition,onSaved,onError,onFocus,onCapture});
    this.mode='select'; this.stroke=null; this.editor=null; this.pending=Promise.resolve();
    this.eraserCursor=document.createElement('div');this.eraserCursor.className='eraser-cursor';this.eraserCursor.hidden=true;document.body.append(this.eraserCursor);
    document.querySelectorAll('[data-tool]').forEach(button => button.onclick=()=>this.setMode(button.dataset.tool));
    annotations.onEditTextbox = entry => this.editText(entry).catch(onError);
    container.addEventListener('pointerdown',event=>this.down(event),true);
    container.addEventListener('pointermove',event=>this.move(event),true);
    container.addEventListener('pointerup',event=>this.up(event),true);
    container.addEventListener('pointercancel',()=>this.cancelStroke(),true);
    container.addEventListener('lostpointercapture',()=>this.cancelStroke(),true);
    container.addEventListener('pointerleave',()=>{this.eraserCursor.hidden=true;});
    container.addEventListener('click',event=>{
      if(this.suppressClick){this.suppressClick=false;event.preventDefault();event.stopImmediatePropagation();return;}
      if (this.mode!=='select' && !event.target.closest('.textbox-editor,.saved-textbox,.annotation-marker')) {event.preventDefault();event.stopImmediatePropagation();}
    },true);
    document.addEventListener('pointerup',()=>{ if(this.mode==='highlight') setTimeout(()=>this.highlight(),40); });
    document.addEventListener('keyup',event=>{ if(this.mode==='highlight' && event.key==='Shift') this.highlight(); });
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape' && !document.querySelector('dialog[open]')) {
        this.cancelStroke(); if(this.editor){this.editor.wrapper.remove();this.editor=null;} this.setMode('select');
      }
    });
  }
  setMode(mode) {
    if(this.editor)this.finishEditor().catch(this.onError);
    this.cancelStroke(); this.mode=mode; this.container.dataset.tool=mode;
    this.eraserCursor.hidden=true;
    document.querySelectorAll('[data-tool]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tool===mode)));
    $('tool-color-label').hidden=!['draw','textbox'].includes(mode);
    $('tool-width-label').hidden=mode!=='draw'; $('tool-eraser-label').hidden=mode!=='erase'; $('tool-font-label').hidden=mode!=='textbox';
    $('tool-hint').textContent=hints[mode]; $('selection-tools').hidden=true;
    window.getSelection()?.removeAllRanges();
  }
  async changeDocument() { this.cancelStroke(); await this.finishEditor(); }
  save(work) {
    $('markup-status').textContent='Đang lưu…';
    const task=this.pending.catch(()=>{}).then(work);
    this.pending=task;
    task.then(()=>{if(this.pending===task)$('markup-status').textContent='Đã lưu';},error=>{ $('markup-status').textContent='Chưa lưu';this.onError(error); });
    return task;
  }
  position(page) {
    const position=this.capturePosition(); if(!position)return null;
    return {...position,page:Number(page.dataset.pageNumber),top:(this.container.scrollTop-page.offsetTop)/position.scale,left:(this.container.scrollLeft-page.offsetLeft)/position.scale};
  }
  base(page) { const doc=this.getDocument(); return doc && {documentId:doc.id,position:this.position(page),note:''}; }
  point(event,page,view) {
    const b=page.getBoundingClientRect();
    return view.viewport.convertToPdfPoint(Math.max(0,Math.min(b.width,event.clientX-b.left)),Math.max(0,Math.min(b.height,event.clientY-b.top)));
  }
  highlight() {
    if(this.mode!=='highlight' || this.editor || document.querySelector('dialog[open]'))return;
    const selection=window.getSelection(); if(!selection?.rangeCount || selection.isCollapsed)return;
    const range=selection.getRangeAt(0), start=range.startContainer.parentElement, end=range.endContainer.parentElement;
    if(!start?.closest('.textLayer') || !end?.closest('.textLayer') || !this.container.contains(start))return;
    const text=normalizeSelection(selection.toString()), rects=selectionRects(range,this.viewer), page=start.closest('.page');
    if(!text || !rects.length || !page)return;
    const draft={...this.base(page),text,rects,color:$('tool-highlight-color').value};
    selection.removeAllRanges();
    this.save(async()=>{await this.desktop.saveAnnotation(draft);await this.onSaved();});
  }
  down(event) {
    this.suppressClick=false;
    if(event.button!==0 || !['draw','erase','textbox','ai-image'].includes(this.mode) || event.target.closest('.textbox-editor'))return;
    const page=event.target.closest('.page'), view=page && this.viewer.getPageView(Number(page.dataset.pageNumber)-1);
    if(!view?.viewport || !this.getDocument())return;
    this.onFocus(); event.preventDefault();event.stopImmediatePropagation();window.getSelection()?.removeAllRanges();
    if(this.mode==='textbox') {
      const entry=this.annotations.entries.find(item=>item.id===event.target.closest('.saved-textbox')?.dataset.annotationId);
      if(entry)this.editText(entry).catch(this.onError); else this.newText(event,page,view).catch(this.onError); return;
    }
    const point=this.point(event,page,view);
    if(this.mode==='ai-image'){
      this.stroke={mode:this.mode,page,view,viewport:view.viewport,pointer:event.pointerId,base:this.base(page),points:[point,point]};
      this.container.setPointerCapture(event.pointerId);this.previewRegion();return;
    }
    this.stroke={mode:this.mode,page,view,pointer:event.pointerId,base:this.base(page),points:[point],color:$('tool-color').value,width:Number($('tool-width').value),brush:Number($('tool-eraser-size').value)/view.viewport.scale,rects:[],original:this.annotations.entries};
    this.container.setPointerCapture(event.pointerId);
    if(this.mode==='erase')this.eraseAt(point);else this.preview();
  }
  move(event) {
    if(this.mode==='erase') {
      const bounds=this.container.getBoundingClientRect(), size=Number($('tool-eraser-size').value);
      this.eraserCursor.hidden=event.clientX<bounds.left || event.clientX>bounds.right || event.clientY<bounds.top || event.clientY>bounds.bottom || !(this.stroke?.page || event.target.closest('.page'));
      Object.assign(this.eraserCursor.style,{left:`${event.clientX-size/2}px`,top:`${event.clientY-size/2}px`,width:`${size}px`,height:`${size}px`});
    }
    const s=this.stroke;if(!s || event.pointerId!==s.pointer)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!s.page.isConnected || this.getDocument()?.id!==s.base.documentId){this.cancelStroke();return;}
    if(s.mode==='ai-image'){if(s.view.viewport!==s.viewport){this.cancelStroke();return;}s.points[1]=this.point(event,s.page,s.view);this.previewRegion();return;}
    const b=s.page.getBoundingClientRect();
    if(event.clientX<b.left || event.clientX>b.right || event.clientY<b.top || event.clientY>b.bottom){s.outside=true;return;}
    if(s.outside){this.up(event);return;}
    const point=this.point(event,s.page,s.view), last=s.points.at(-1);
    if(Math.hypot(point[0]-last[0],point[1]-last[1])<0.3)return;
    if(s.points.length>=20000 || s.rects.length>=9900){this.up(event);return;}
    if(s.mode==='erase') {
      const steps=Math.ceil(Math.hypot(point[0]-last[0],point[1]-last[1])/(s.brush/3));
      for(let i=1;i<=steps && s.rects.length<9900;i++)this.eraseAt([last[0]+(point[0]-last[0])*i/steps,last[1]+(point[1]-last[1])*i/steps]);
      this.annotations.paintPage(Number(s.page.dataset.pageNumber));
    }
    s.points.push(point);if(s.mode==='draw')this.preview();
  }
  eraseAt(point) {
    const s=this.stroke, r=s.brush/2, rect=[point[0]-r,point[1]-r,point[0]+r,point[1]+r];s.rects.push(rect);
    this.annotations.entries=eraseAnnotations(this.annotations.entries,{documentId:s.base.documentId,page:Number(s.page.dataset.pageNumber),rects:[rect]});
    if(s.rects.length===1)this.annotations.paintPage(Number(s.page.dataset.pageNumber));
  }
  preview() {
    const s=this.stroke;
    if(!s.svg){
      s.svg=document.createElementNS('http://www.w3.org/2000/svg','svg');s.svg.classList.add('ink-preview');
      s.svg.setAttribute('width',s.view.viewport.width);s.svg.setAttribute('height',s.view.viewport.height);
      s.path=document.createElementNS(s.svg.namespaceURI,'path');s.path.setAttribute('fill','none');s.path.setAttribute('stroke',s.color);s.path.setAttribute('stroke-width',s.width*s.view.viewport.scale);s.path.setAttribute('stroke-linecap','round');s.path.setAttribute('stroke-linejoin','round');s.svg.append(s.path);s.page.append(s.svg);
    }
    const points=s.points.length===1?[s.points[0],[s.points[0][0]+0.01,s.points[0][1]]]:s.points;
    s.path.setAttribute('d',points.map((p,i)=>`${i?'L':'M'}${s.view.viewport.convertToViewportPoint(...p).join(' ')}`).join(' '));
  }
  previewRegion(){
    const s=this.stroke;if(!s.region){s.region=document.createElement('div');s.region.className='ai-image-region';s.page.append(s.region);}
    const [a,b]=s.points.map(p=>s.view.viewport.convertToViewportPoint(...p));
    Object.assign(s.region.style,{left:Math.min(a[0],b[0])+'px',top:Math.min(a[1],b[1])+'px',width:Math.abs(a[0]-b[0])+'px',height:Math.abs(a[1]-b[1])+'px'});
  }
  up(event) {
    const s=this.stroke;if(!s || event.pointerId!==s.pointer)return;
    this.stroke=null;event.preventDefault();event.stopImmediatePropagation();
    if(this.container.hasPointerCapture(s.pointer))this.container.releasePointerCapture(s.pointer);
    const page=Number(s.page.dataset.pageNumber);
    if(s.mode==='ai-image'){
      s.region?.remove();this.setMode('select');this.suppressClick=true;
      if(s.view.viewport!==s.viewport||this.getDocument()?.id!==s.base.documentId)return;
      s.points[1]=this.point(event,s.page,s.view);
      const [a,b]=s.points.map(p=>s.view.viewport.convertToViewportPoint(...p));
      if(Math.abs(a[0]-b[0])<12||Math.abs(a[1]-b[1])<12){this.onError(new Error('Vùng chọn quá nhỏ. Hãy kéo chọn trọn hình hoặc bảng.'));return;}
      Promise.resolve(this.onCapture({documentId:s.base.documentId,page,rect:[...s.points[0],...s.points[1]],rotation:s.view.viewport.rotation})).catch(this.onError);return;
    }
    if(s.mode==='erase')this.save(async()=>{try{await this.desktop.eraseAnnotations({documentId:s.base.documentId,page,rects:s.rects});}finally{await this.onSaved();}});
    else {
      if(s.points.length===1)s.points.push([s.points[0][0]+0.01,s.points[0][1]]);
      const xs=s.points.map(p=>p[0]),ys=s.points.map(p=>p[1]),rect=[Math.min(...xs)-s.width/2,Math.min(...ys)-s.width/2,Math.max(...xs)+s.width/2,Math.max(...ys)+s.width/2];
      this.save(async()=>{try{await this.desktop.saveAnnotation({...s.base,kind:'ink',color:s.color,width:s.width,paths:[s.points],rects:[{page,rect}]});await this.onSaved();}finally{s.svg?.remove();}});
    }
  }
  cancelStroke() {
    const s=this.stroke;if(!s)return;this.stroke=null;s.svg?.remove();s.region?.remove();
    if(s.mode==='erase'){this.annotations.entries=s.original;this.annotations.paintAll();}
    if(this.container.hasPointerCapture(s.pointer))this.container.releasePointerCapture(s.pointer);
  }
  async newText(event,page,view) {
    const point=this.point(event,page,view),base=this.base(page),color=$('tool-color').value,fontSize=Number($('tool-font-size').value);
    const [x,y]=view.viewport.convertToViewportPoint(...point);
    const width=Math.min(240*view.viewport.scale,view.viewport.width-x),height=Math.min(80*view.viewport.scale,view.viewport.height-y);
    if(width<30 || height<20)return this.onError(new Error('Hãy đặt hộp văn bản xa mép trang hơn.'));
    const rect=[...view.viewport.convertToPdfPoint(x,y),...view.viewport.convertToPdfPoint(x+width,y+height)];
    await this.editText({...base,kind:'textbox',text:'',fontSize,color,rects:[{page:Number(page.dataset.pageNumber),rect}]});
  }
  async editText(entry) {
    if(this.editor?.entry.id && this.editor.entry.id===entry.id)return this.editor.input.focus();
    await this.finishEditor();
    const view=this.viewer.getPageView(entry.rects[0].page-1);if(!view?.viewport || this.getDocument()?.id!==entry.documentId)return;
    const [x1,y1,x2,y2]=viewportRect(view.viewport,entry.rects[0].rect),scale=view.viewport.scale;
    const wrapper=document.createElement('div');wrapper.className='textbox-editor';
    Object.assign(wrapper.style,{left:`${Math.min(x1,x2)}px`,top:`${Math.min(y1,y2)}px`});
    const input=document.createElement('textarea');input.className='textbox-input';input.placeholder='Nhập ghi chú…';input.maxLength=8000;input.value=entry.text;input.setAttribute('aria-label','Nội dung text box');
    Object.assign(input.style,{width:`${Math.abs(x2-x1)}px`,height:`${Math.abs(y2-y1)}px`,fontSize:`${entry.fontSize*scale}px`,color:entry.color,maxWidth:`${view.viewport.width-Math.min(x1,x2)}px`,maxHeight:`${view.viewport.height-Math.min(y1,y2)}px`});
    const actions=document.createElement('div');actions.className='textbox-actions';
    const done=document.createElement('button');done.textContent='Lưu';done.onclick=()=>this.finishEditor().catch(this.onError);
    const remove=document.createElement('button');remove.innerHTML=icon('close');remove.title='Xóa hộp văn bản';remove.setAttribute('aria-label','Xóa text box');
    const editor={entry,wrapper,input,view,scale,closing:null};this.editor=editor;
    remove.onclick=()=>{this.editor=null;wrapper.remove();if(entry.id)this.save(async()=>{await this.desktop.deleteAnnotation(entry.id);await this.onSaved();});};
    actions.append(done,remove);wrapper.append(input,actions);view.div.append(wrapper);
    wrapper.onpointerdown=event=>event.stopPropagation();
    input.onkeydown=event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();this.editor=null;wrapper.remove();}else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();this.finishEditor().catch(this.onError);}};
    wrapper.addEventListener('focusout',()=>setTimeout(()=>{if(this.editor===editor && !wrapper.contains(document.activeElement))this.finishEditor().catch(this.onError);},0));
    input.focus();input.setSelectionRange(input.value.length,input.value.length);
  }
  async finishEditor() {
    const editor=this.editor;if(!editor)return;
    if(editor.closing)return editor.closing;
    const text=editor.input.value.trim();
    if(!text && !editor.entry.id){this.editor=null;editor.wrapper.remove();return;}
    if(!text){editor.input.focus();throw new Error('Hãy nhập nội dung hoặc dùng nút Xóa.');}
    const entry=editor.entry, b=editor.wrapper.getBoundingClientRect(),page=editor.view.div.getBoundingClientRect();
    const height=Math.min(page.bottom-b.top,Math.max(editor.input.clientHeight,editor.input.scrollHeight));
    const rect=[...editor.view.viewport.convertToPdfPoint(b.left-page.left,b.top-page.top),...editor.view.viewport.convertToPdfPoint(b.left-page.left+editor.input.offsetWidth,b.top-page.top+height)];
    editor.closing=this.save(async()=>{await this.desktop.saveAnnotation({...entry,text,rects:[{page:entry.rects[0].page,rect}]});editor.wrapper.remove();if(this.editor===editor)this.editor=null;await this.onSaved();});
    try{await editor.closing;}catch(error){editor.closing=null;editor.input.focus();throw error;}
  }
}
