import { icon } from './icons.mjs';
import { viewportRect } from './core/annotations.mjs';
const $ = id => document.getElementById(id);

export class AnnotationManager {
  constructor({ desktop, getDocument, viewer, onJump, onSaved, onError, openEditor }) {
    Object.assign(this, { desktop, getDocument, viewer, onJump, onSaved, onError });
    this.entries = []; this.draft = null;
    this.edit = openEditor || (draft => this.openEditor(draft));
    $('annotations-button').onclick = async () => { await onSaved(); this.renderList(); $('annotations-dialog').showModal(); $('annotations-filter').focus(); };
    $('annotations-close').onclick = () => $('annotations-dialog').close();
    $('annotations-filter').oninput = () => this.renderList();
    $('annotation-close').onclick = $('annotation-cancel').onclick = () => $('annotation-dialog').close();
    $('annotation-form').onsubmit = async event => {
      event.preventDefault(); $('annotation-error').textContent = ''; $('annotation-save').disabled = true;
      try {
        const graphic = this.draft.kind && this.draft.kind !== 'highlight';
        const color = graphic ? $('annotation-graphic-color').value : document.querySelector('input[name="annotation-color"]:checked').value;
        await desktop.saveAnnotation({ ...this.draft, color, text: this.draft.kind === 'textbox' ? $('annotation-body').value : this.draft.text, note: $('annotation-note').value });
        await onSaved(); $('annotation-dialog').close();
      } catch (error) { $('annotation-error').textContent = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }
      finally { $('annotation-save').disabled = false; }
    };
  }
  update(entries) { this.entries = entries || []; this.renderList(); this.paintAll(); }
  openEditor(draft) {
    this.draft = structuredClone(draft);
    $('annotations-dialog').close();
    $('annotation-text').textContent = draft.text;
    $('annotation-source').textContent = `${draft.documentName || draft.document?.name || ''} · Trang ${draft.position?.page || draft.rects?.[0]?.page || 1}`;
    $('annotation-note').value = draft.note || '';
    const graphic = draft.kind && draft.kind !== 'highlight';
    document.querySelector('.annotation-colors').hidden = Boolean(graphic);
    $('annotation-graphic-field').hidden = !graphic; $('annotation-body-field').hidden = draft.kind !== 'textbox';
    if (graphic) $('annotation-graphic-color').value = draft.color;
    else document.querySelector(`input[name="annotation-color"][value="${draft.color || 'yellow'}"]`).checked = true;
    $('annotation-body').value = draft.text || '';
    $('annotation-error').textContent = ''; $('annotation-dialog').showModal(); $('annotation-note').focus();
  }
  renderList() {
    const list = $('annotations-list'); list.replaceChildren();
    const query = $('annotations-filter').value.trim().toLocaleLowerCase('vi');
    const entries = this.entries.filter(entry => `${entry.text} ${entry.note} ${entry.documentName}`.toLocaleLowerCase('vi').includes(query));
    $('annotations-count').textContent = `(${this.entries.length})`;
    if (!entries.length) {
      const empty = document.createElement('p'); empty.className = 'empty-note';
      empty.textContent = this.entries.length ? 'Không tìm thấy ghi chú phù hợp.' : 'Chưa có đánh dấu. Bôi đen trong PDF rồi chọn Đánh dấu / Ghi chú.';
      list.append(empty); return;
    }
    for (const entry of entries) {
      const card = document.createElement('article'); card.className = `annotation-card mark-${entry.color}`;
      const jump = document.createElement('button'); jump.className = 'annotation-jump';
      const text = document.createElement('strong'); text.textContent = entry.text; text.dataset.userContent = 'true';
      const note = document.createElement('span'); note.textContent = entry.note || `${entry.kind === 'ink' ? 'Nét vẽ' : entry.kind === 'textbox' ? 'Hộp văn bản' : 'Đoạn đã tô màu'} · nhấn để xem trong PDF`;
      if(entry.note)note.dataset.userContent = 'true'; jump.append(text, note); jump.onclick = () => { $('annotations-dialog').close(); this.onJump(entry).catch(this.onError); };
      const footer = document.createElement('div'); footer.className = 'vocabulary-card-footer';
      const source = document.createElement('span'); source.className = 'annotation-origin'; source.textContent = `${entry.documentName} · Trang ${entry.position.page}`;
      const edit = document.createElement('button'); edit.className = 'secondary'; edit.textContent = 'Sửa'; edit.setAttribute('aria-label', `Sửa ghi chú ${entry.text}`); edit.onclick = () => this.edit(entry);
      const remove = document.createElement('button'); remove.className = 'icon-button'; remove.innerHTML = icon('close'); remove.setAttribute('aria-label', `Xóa ghi chú ${entry.text}`);
      remove.onclick = async () => { try { await this.desktop.deleteAnnotation(entry.id); await this.onSaved(); } catch (error) { this.onError(error); } };
      footer.append(source, edit, remove); card.append(jump, footer); list.append(card);
    }
  }
  paintAll() { for (const page of this.viewer.viewer.querySelectorAll('.page')) this.paintPage(Number(page.dataset.pageNumber)); }
  paintPage(number) {
    const view = this.viewer.getPageView(number - 1), doc = this.getDocument();
    if (!view?.viewport || !doc) return;
    view.div.querySelectorAll('.saved-highlight-layer,.annotation-marker,.saved-graphic-layer').forEach(node => node.remove());
    const entries = this.entries.filter(item => item.documentId === doc.id && item.rects.some(rect => rect.page === number));
    if (!entries.length) return;
    const layer = document.createElement('div'); layer.className = 'saved-highlight-layer';
    const graphicLayer = document.createElement('div'); graphicLayer.className = 'saved-graphic-layer';
    for (const entry of entries) {
      if (entry.kind === 'ink') {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('saved-ink'); svg.dataset.annotationId = entry.id;
        svg.setAttribute('width', view.viewport.width); svg.setAttribute('height', view.viewport.height);
        for (const points of entry.paths) {
          const path = document.createElementNS(svg.namespaceURI, 'path');
          path.setAttribute('d', points.map((p,i) => `${i ? 'L' : 'M'}${view.viewport.convertToViewportPoint(...p).join(' ')}`).join(' '));
          path.setAttribute('fill','none'); path.setAttribute('stroke',entry.color); path.setAttribute('stroke-width',entry.width * view.viewport.scale);
          path.setAttribute('stroke-linecap','round'); path.setAttribute('stroke-linejoin','round'); svg.append(path);
        }
        graphicLayer.append(svg); continue;
      }
      if (entry.kind === 'textbox') {
        const [x1,y1,x2,y2] = viewportRect(view.viewport,entry.rects[0].rect);
        const box = document.createElement('div'); box.className = 'saved-textbox'; box.dataset.annotationId = entry.id;
        Object.assign(box.style, {left:`${Math.min(x1,x2)}px`,top:`${Math.min(y1,y2)}px`,width:`${Math.abs(x2-x1)}px`,minHeight:`${Math.abs(y2-y1)}px`,color:entry.color,fontSize:`${entry.fontSize * view.viewport.scale}px`});
        box.textContent = entry.text; box.title = 'Nhấn để sửa hộp văn bản'; box.tabIndex = 0;
        box.onclick = event => { event.stopPropagation(); this.onEditTextbox?.(entry); };
        box.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); this.onEditTextbox?.(entry); } };
        graphicLayer.append(box); continue;
      }
      const rects = entry.rects.filter(item => item.page === number);
      for (const item of rects) {
        const [x1, y1, x2, y2] = viewportRect(view.viewport, item.rect);
        const mark = document.createElement('div'); mark.className = `saved-highlight mark-${entry.color}`; mark.dataset.annotationId = entry.id;
        Object.assign(mark.style, { left: `${Math.min(x1, x2)}px`, top: `${Math.min(y1, y2)}px`, width: `${Math.abs(x2 - x1)}px`, height: `${Math.abs(y2 - y1)}px` });
        layer.append(mark);
      }
      if (rects.length && entry.rects[0].page === number) {
        const [x1, y1, x2, y2] = viewportRect(view.viewport, rects[0].rect);
        const marker = document.createElement('button'); marker.className = `annotation-marker mark-${entry.color}`; marker.innerHTML = icon('note'); marker.dataset.annotationId = entry.id;
        marker.title = entry.note || 'Đoạn đã đánh dấu'; marker.setAttribute('aria-label', `Xem ghi chú: ${entry.note || entry.text}`);
        Object.assign(marker.style, { left: `${Math.min(view.div.clientWidth - 24, Math.max(x1, x2) + 4)}px`, top: `${Math.min(y1, y2)}px` });
        marker.onclick = event => { event.stopPropagation(); this.edit(entry); }; view.div.append(marker);
      }
    }
    view.div.append(layer, graphicLayer);
  }
  flash(id) {
    this.paintAll();
    const marks = [...this.viewer.viewer.querySelectorAll('[data-annotation-id]')].filter(node => node.dataset.annotationId === id);
    marks.forEach(node => { node.classList.add('annotation-flash'); setTimeout(() => node.classList.remove('annotation-flash'), 2000); });
  }
}
