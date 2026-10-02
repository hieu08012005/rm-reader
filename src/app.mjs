import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import './style.css';
import { decorateIcons, icon } from './icons.mjs';
import { NavigationHistory } from './core/history.mjs';
import { normalizeSelection } from './core/glossary.mjs';
import { selectionRects, viewportRect } from './core/annotations.mjs';
import { AnnotationManager } from './annotations.mjs';
import { MarkupTools } from './markup.mjs';
import { AttachmentManager } from './attachments.mjs';
import { ChatManager } from './chat.mjs';
import { capturePdfRegion } from './pdf-image.mjs';

globalThis.pdfjsLib = pdfjs;
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const { EventBus, PDFViewer, PDFLinkService, PDFFindController, LinkTarget } = await import('pdfjs-dist/web/pdf_viewer.mjs');
const $ = id => document.getElementById(id);
decorateIcons();
const secondary = new URLSearchParams(location.search).get('pane') === 'right';
if (secondary) document.documentElement.classList.add('secondary-reader');
// Both panes are our local app. The child uses the parent's narrow IPC bridge;
// it does not enable Node.js or broaden the main-process sender permissions.
const desktop = secondary ? window.parent.desktop : window.desktop;
const container = $('viewerContainer');
const eventBus = new EventBus();
let history = new NavigationHistory();
const tabs = [];
let activeTab = null;
let documentInfo = null, pdfDocument = null, loadingTask = null, loadSerial = 0;
let preferences = { provider: 'gemini', model: 'gemini-3.8-flash', endpoint: 'http://127.0.0.1:11434', autoTranslate: false, translationFont: 16 };
let recentDocuments = [], selectedText = '', requestId = null, translationSerial = 0;
let vocabulary = [], selectedPosition = null;
let selectedDocumentInfo = null, selectedRects = [];
let comparing = false, comparisonReady = null, comparePanels = null, focusedPane = 'left';
let draggingTab = null;
let outlineBeforeAttachments = true;
let chat=null,selectedPieces=[];
let citationBack=[],citationForward=[];
let citationJump=null;
let positionTimer, selectionTimer, toastTimer, findTimer, restoring = false;
let sourceLinkRect = null, gesture = null, lastMouseNavigate = { action: '', time: 0 };
let passwordCallback = null, busyNavigating = false;
let navigationQueue = Promise.resolve();
function queueNavigation(work) {
  const serial = loadSerial;
  const result = navigationQueue.catch(() => {}).then(async () => {
    if (serial !== loadSerial) return;
    busyNavigating = true;
    try { return await work(); } finally { busyNavigating = false; }
  });
  navigationQueue = result;
  return result;
}

function toast(message) {
  $('toast').textContent = String(message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500);
}
function failure(error) { toast(error?.message || 'Đã xảy ra lỗi. Hãy thử lại.'); }
function setReaderStatus(message) { $('reader-status').replaceChildren(); const dot = document.createElement('span'); dot.className = 'status-dot'; $('reader-status').append(dot, document.createTextNode(message)); }
function updateHistoryButtons() { $('back').disabled = !history.canBack; $('forward').disabled = !history.canForward; }

class ReaderLinkService extends PDFLinkService {
  async goToDestination(dest) {
    if (!pdfDocument) return;
    const linkRect = sourceLinkRect;
    sourceLinkRect = null;
    return queueNavigation(async () => {
    const serial = loadSerial;
    const origin = capturePosition();
    if (linkRect) origin.link = linkRect;
    try {
      const explicit = typeof dest === 'string' ? await pdfDocument.getDestination(dest) : await dest;
      if (!Array.isArray(explicit) || !explicit[1]?.name) throw new Error('Liên kết không có đích đến hợp lệ trong PDF này.');
      const ref = explicit[0];
      const page = typeof ref === 'object' && ref ? await pdfDocument.getPageIndex(ref) + 1 : ref + 1;
      if (serial !== loadSerial) return;
      if (!Number.isInteger(page) || page < 1 || page > this.pagesCount) throw new Error('Trang đích của liên kết không tồn tại.');
      history.record(origin); clearCitationForward(); updateHistoryButtons();
      await super.goToDestination(explicit);
      pdfViewer.update();
      scheduleSave();
    } catch (error) { if (serial === loadSerial) failure(error); }
    });
  }
  goToPage(value) {
    const page = Number(value);
    if (!pdfDocument || !Number.isInteger(page) || page < 1 || page > pdfViewer.pagesCount) { toast('Số trang không hợp lệ.'); return; }
    return queueNavigation(() => { recordJump(); super.goToPage(page); pdfViewer.update(); scheduleSave(); });
  }
  addLinkAttributes(link, url) {
    super.addLinkAttributes(link, url, true);
    link.addEventListener('click', event => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (/^https?:\/\/|^mailto:/i.test(url)) desktop.openExternal(url).catch(failure);
      else toast('Liên kết trỏ đến file khác hoặc loại địa chỉ chưa được hỗ trợ. Hãy mở file đích bằng nút Mở PDF.');
    }, true);
  }
  executeNamedAction(action) {
    if (action === 'GoBack') return navigate('back');
    if (action === 'GoForward') return navigate('forward');
    const pages = { FirstPage: 1, LastPage: this.pagesCount, NextPage: this.page + 1, PrevPage: this.page - 1 };
    if (pages[action]) return this.goToPage(Math.min(this.pagesCount, Math.max(1, pages[action])));
    toast('Thao tác này trong tài liệu chưa được hỗ trợ.');
  }
}
const linkService = new ReaderLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK, ignoreDestinationZoom: false });
const findController = new PDFFindController({ eventBus, linkService });
const pdfViewer = new PDFViewer({
  container, viewer: $('viewer'), eventBus, linkService, findController,
  textLayerMode: 1, annotationMode: pdfjs.AnnotationMode.ENABLE,
  enableAutoLinking: false, maxCanvasPixels: 16777216, enableDetailCanvas: true,
  imageResourcesPath: new URL('./pdf-assets/images/',location.href).href
});
linkService.setViewer(pdfViewer);
const attachments = new AttachmentManager({desktop,owner:secondary?'right':'left',onOpenPdf:openDocument,
  onShow:source=>secondary?window.parent.rmReader.showAttachmentsFromPane(source):toggleAttachments(source),
  getSource:()=>secondary?attachments.localSource:focusedAttachmentSource(),onError:failure,onMessage:toast,
  fileAttachmentType:pdfjs.AnnotationType.FILEATTACHMENT,
  onDocumentChanged:source=>{
    if(secondary)window.parent.rmReader.attachmentSourceChanged(source);
    else if(focusedPane==='left')attachments.useSource(source);
  }});
const annotations = new AnnotationManager({ desktop, viewer: pdfViewer, getDocument: () => documentInfo,
  onJump: jumpToAnnotation, onSaved: annotationsChanged, onError: failure,
  openEditor: secondary ? draft => window.parent.rmReader.editAnnotation(draft) : undefined });
async function annotationsChanged() {
  if (secondary) { await window.parent.rmReader.refreshState(); await refreshState(); }
  else await refreshState();
}
const markup = new MarkupTools({desktop, viewer:pdfViewer,container,annotations,getDocument:()=>documentInfo,capturePosition,
  onSaved:annotationsChanged,onError:failure,onFocus:()=>focusPane(secondary?'right':'left'),onCapture:async region=>{
    const context=chatContext();if(context.info?.id!==region.documentId||!context.pdf)throw new Error('PDF đã đổi. Hãy khoanh lại vùng ảnh.');
    const recipient=secondary?window.parent.rmReader:window.rmReader;recipient.beginAIImageCapture();
    $('markup-status').textContent='Đang tạo ảnh xem trước…';
    try{const image=await capturePdfRegion(context,region);if(secondary)await window.parent.rmReader.askAIImage(image);else await chat.addPdfImage(image);}
    finally{$('markup-status').textContent='';recipient.endAIImageCapture();}
  }});
eventBus.on('pagerendered', ({ pageNumber }) => annotations.paintPage(pageNumber));
eventBus.on('textlayerrendered', ({ pageNumber }) => annotations.paintPage(pageNumber));

function capturePosition() {
  if (!documentInfo || !pdfDocument) return null;
  const page = pdfViewer.currentPageNumber;
  const view = pdfViewer.getPageView(page - 1)?.div;
  const scale = pdfViewer.currentScale || 1;
  return {
    documentId: documentInfo.id, page, scale,
    top: view ? (container.scrollTop - view.offsetTop) / scale : 0,
    left: view ? (container.scrollLeft - view.offsetLeft) / scale : 0,
    scrollTop: container.scrollTop, scrollLeft: container.scrollLeft
  };
}
function recordJump() {
  if (restoring) return;
  clearCitationForward();
  history.record(capturePosition()); updateHistoryButtons();
}
function clearCitationForward(){if(secondary)return window.parent.rmReader.clearCitationForward();if(!citationJump)citationForward=[];}
async function restorePosition(position) {
  if (!position || !pdfDocument || position.documentId !== documentInfo.id) return;
  const serial = loadSerial;
  restoring = true;
  try {
    pdfViewer.currentScaleValue = Math.min(5, Math.max(0.25, position.scale || 1));
    const page = Math.min(pdfViewer.pagesCount, Math.max(1, position.page || 1));
    pdfViewer.scrollPageIntoView({ pageNumber: page });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (serial !== loadSerial) return;
    const view = pdfViewer.getPageView(page - 1)?.div;
    if (view) {
      container.scrollTop = view.offsetTop + position.top * pdfViewer.currentScale;
      container.scrollLeft = Math.max(0, view.offsetLeft + position.left * pdfViewer.currentScale);
      pdfViewer.update();
    }
    if (position.link) flashLink(position.link);
  } finally { if (serial === loadSerial) { restoring = false; scheduleSave(); } }
}
async function navigate(action, mouse = false) {
  if (!pdfDocument) return;
  if (mouse) {
    const time = performance.now();
    if (lastMouseNavigate.action === action && time - lastMouseNavigate.time < 180) return;
    lastMouseNavigate = { action, time };
  }
  return queueNavigation(async () => {
    const target = action === 'back' ? history.back(capturePosition()) : history.forward(capturePosition());
    updateHistoryButtons();
    if (!target) return;
    try { await restorePosition(target); } catch (error) { failure(error); }
  });
}
function flashLink(link) {
  const page = pdfViewer.getPageView(link.page - 1)?.div;
  if (!page) return;
  const flash = document.createElement('div'); flash.className = 'return-flash';
  const scale = pdfViewer.currentScale;
  Object.assign(flash.style, { left: `${link.x * scale}px`, top: `${link.y * scale}px`, width: `${link.width * scale}px`, height: `${link.height * scale}px` });
  page.append(flash); setTimeout(() => flash.remove(), 2000);
}
function scheduleSave() {
  if (!documentInfo || restoring) return;
  clearTimeout(positionTimer);
  positionTimer = setTimeout(() => savePosition().catch(failure), 450);
}
async function savePosition() {
  const position = capturePosition();
  if (position) await desktop.savePosition(documentInfo.id, position);
}

function renderTabs(focusId) {
  const list = $('document-tabs'); list.replaceChildren();
  const entries = [{ id: 'start', name: 'Start' }, ...tabs.map(tab => ({ ...tab.info, tab }))];
  entries.forEach(entry => {
    const active = entry.tab ? entry.tab === activeTab : !activeTab;
    const wrapper = document.createElement('div'); wrapper.className = 'document-tab' + (active ? ' active' : '');
    const button = document.createElement('button'); button.className = 'tab-select'; button.id = `tab-${entry.id}`;
    button.dataset.documentId = entry.id; button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(active)); button.setAttribute('aria-controls', 'reader-area'); button.tabIndex = active ? 0 : -1;
    button.title = entry.tab ? `${entry.name} · ${(entry.size / 1048576).toFixed(1)} MB` : 'Màn hình đầu · tài liệu gần đây';
    const label = document.createElement('span'); label.textContent = entry.name;
    if (entry.tab) button.innerHTML = icon('file');
    button.append(label); button.onclick = () => activateTab(entry.tab || null);
    wrapper.append(button);
    if (entry.tab) {
      wrapper.draggable = true;
      wrapper.ondragstart = event => {
        draggingTab = entry.id; wrapper.classList.add('tab-dragging');
        event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-rm-reader-tab', entry.id);
      };
      wrapper.ondragover = event => {
        if (!draggingTab || draggingTab === entry.id) return;
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
        list.querySelectorAll('.tab-drop-before,.tab-drop-after').forEach(node => node.classList.remove('tab-drop-before', 'tab-drop-after'));
        const bounds = wrapper.getBoundingClientRect(); wrapper.classList.add(event.clientX < bounds.left + bounds.width / 2 ? 'tab-drop-before' : 'tab-drop-after');
      };
      wrapper.ondrop = event => {
        if (!draggingTab) return;
        event.preventDefault(); event.stopPropagation();
        const bounds = wrapper.getBoundingClientRect(); moveTab(draggingTab, entry.id, event.clientX >= bounds.left + bounds.width / 2);
        draggingTab = null;
      };
      wrapper.ondragend = () => { draggingTab = null; list.querySelectorAll('.tab-dragging,.tab-drop-before,.tab-drop-after').forEach(node => node.classList.remove('tab-dragging', 'tab-drop-before', 'tab-drop-after')); };
      button.title += ' · Kéo thả để đổi thứ tự';
      const close = document.createElement('button'); close.className = 'tab-close'; close.innerHTML = icon('close');
      close.title = `Đóng ${entry.name}`; close.setAttribute('aria-label', `Đóng tab ${entry.name}`);
      close.onclick = () => closeTab(entry.tab); wrapper.append(close);
    }
    list.append(wrapper);
  });
  const current = list.querySelector('[aria-selected="true"]'); current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (focusId) $( `tab-${focusId}` )?.focus();
}
function moveTab(id, targetId, after = false) {
  if (id === targetId) return;
  const from = tabs.findIndex(tab => tab.info.id === id), target = tabs.findIndex(tab => tab.info.id === targetId);
  if (from < 0 || target < 0) return;
  const [tab] = tabs.splice(from, 1);
  const destination = tabs.findIndex(item => item.info.id === targetId) + (after ? 1 : 0);
  tabs.splice(destination, 0, tab); renderTabs(id);
}
function rememberTab() {
  if (!activeTab) return;
  activeTab.info.position = capturePosition() || activeTab.info.position;
  activeTab.find = { query: $('find-input').value, caseSensitive: $('find-case').checked, visible: !$('find-bar').hidden };
  activeTab.outlineFilter = $('outline-filter').value;
  activeTab.expanded = new Set(expandedOutline);
  activeTab.translation = {
    selectedText, visible: !$('translation-content').hidden, source: $('translation-source').textContent,
    position: selectedPosition,
    document: selectedDocumentInfo, rects: selectedRects,
    result: requestId ? 'Nhấn Dịch đoạn đã chọn để tiếp tục dịch.' : $('translation-result').textContent,
    status: requestId ? '' : $('translation-status').textContent,
    error: !requestId && $('translation-result').classList.contains('error'),
    retry: Boolean(requestId) || !$('retry-translation').hidden, copy: !requestId && !$('copy-result').disabled
  };
  const position = activeTab.info.position;
  if (position) desktop.savePosition(activeTab.info.id, position).catch(failure);
}
function restoreTabTranslation(tab) {
  const saved = tab.translation;
  if (!saved) return;
  selectedText = saved.selectedText;
  selectedPosition = saved.position;
  selectedDocumentInfo = saved.document; selectedRects = saved.rects || [];
  $('translation-empty').hidden = saved.visible; $('translation-content').hidden = !saved.visible;
  $('translation-source').textContent = saved.source; $('translation-result').textContent = saved.result;
  $('translation-status').textContent = saved.status; $('translation-result').classList.toggle('error', saved.error);
  $('retry-translation').hidden = !saved.retry; $('copy-result').disabled = !saved.copy;
}
async function closeTab(tab) {
  const index = tabs.indexOf(tab); if (index < 0) return;
  if (tab === activeTab) {
    rememberTab();
    const next = tabs[index + 1] || tabs[index - 1] || null;
    tabs.splice(index, 1);
    // Detach this document from the viewer before releasing its PDF.js task.
    await activateTab(next);
  } else { tabs.splice(index, 1); renderTabs(); }
  await tab.task?.destroy().catch(() => {});
  desktop.releasePdf(tab.info.token).catch(() => {});
}
container.addEventListener('scroll', () => {
  scheduleSave(); $('selection-tools').hidden = true;
  clearTimeout(selectionTimer); selectionTimer = setTimeout(updateSelection, 90);
}, { passive: true });
eventBus.on('pagechanging', ({ pageNumber }) => { $('page-number').value = pageNumber; setReaderStatus(`Trang ${pageNumber} / ${pdfViewer.pagesCount} · Có thể bôi đen văn bản để dịch`); scheduleSave(); });
eventBus.on('scalechanging', ({ scale, presetValue }) => {
  const value = presetValue || String(scale);
  if ([...$('zoom').options].some(option => option.value === value)) $('zoom').value = value;
  else { const option = $('zoom').querySelector('[value="custom"]'); option.textContent = `${Math.round(scale * 100)}%`; option.hidden = false; $('zoom').value = 'custom'; }
  scheduleSave();
});

function resetTranslation() {
  cancelTranslation(); selectedText = ''; selectedPosition = null;
  selectedDocumentInfo = null; selectedRects = [];
  $('translation-empty').hidden = false; $('translation-content').hidden = true;
  $('translation-source').textContent = ''; $('translation-result').textContent = '';
  $('translation-result').classList.remove('error'); $('translation-status').textContent = '';
  $('copy-result').disabled = true; $('retry-translation').hidden = true;
  $('selection-tools').hidden = true;
}
function cancelTranslation() {
  translationSerial++;
  if (requestId) desktop.cancelTranslation(requestId);
  requestId = null;
}
async function openDocument(info) {
  if (!info) return;
  let tab = tabs.find(item => item.info.id === info.id);
  if (tab) {
    if (info.token !== tab.info.token) desktop.releasePdf(info.token).catch(() => {});
  } else {
    tab = { info, history: new NavigationHistory(), task: null, pdf: null };
    tabs.push(tab);
  }
  return activateTab(tab);
}
async function activateTab(tab) {
  await markup.changeDocument();
  if (tab === activeTab && (pdfDocument || !tab)) { renderTabs(); return; }
  const serial = ++loadSerial;
  rememberTab();
  restoring = false;
  clearTimeout(positionTimer); clearTimeout(selectionTimer); clearTimeout(findTimer);
  pendingFindOrigin = null; sourceLinkRect = null; gesture = null;
  resetTranslation(); window.getSelection()?.removeAllRanges();
  if ($('password-dialog').open) $('password-dialog').close();
  passwordCallback = null;
  pdfViewer.setDocument(null); linkService.setDocument(null); pdfDocument = null;
  attachments.setDocument(null,null);
  selectedPieces=[];chat?.changed();
  activeTab = tab; documentInfo = tab?.info || null; loadingTask = tab?.task || null;
  history = tab?.history || new NavigationHistory(); updateHistoryButtons(); renderTabs();
  $('find-input').value = tab?.find?.query || ''; $('find-case').checked = tab?.find?.caseSensitive || false;
  $('find-bar').hidden = !tab?.find?.visible; $('find-count').textContent = 'Nhập từ cần tìm';
  document.querySelectorAll('.pdf-control').forEach(control => { control.disabled = true; }); $('page-number').disabled = true;
  $('outline-tree').replaceChildren(); $('outline-filter').value = tab?.outlineFilter || '';
  outlineData = []; expandedOutline.clear();
  $('page-count').textContent = '—'; $('page-number').value = 1;
  if (!tab) {
    $('welcome').hidden = false; $('loading').hidden = true;
    $('document-name').textContent = 'Chưa mở tài liệu'; $('document-meta').textContent = '';
    $('left-pane-name').textContent = 'Chọn một PDF';
    document.title = 'RM Reader'; setReaderStatus('Chọn một tab hoặc mở thêm tài liệu');
    return;
  }
  const info = tab.info;
  restoreTabTranslation(tab);
  $('welcome').hidden = true; $('loading').hidden = false;
  $('loading-text').textContent = 'Đang mở tài liệu…'; $('document-name').textContent = info.name;
  $('document-meta').textContent = `${(info.size / 1048576).toFixed(1)} MB`;
  document.title = `${info.name} — RM Reader`;
  $('left-pane-name').textContent = info.name;
  const resources = new URL('./pdf-assets/', window.location.href).href;
  const task = loadingTask = tab.task ||= pdfjs.getDocument({
    url: info.url, cMapUrl: resources + 'cmaps/', cMapPacked: true,
    standardFontDataUrl: resources + 'standard_fonts/', wasmUrl: resources + 'wasm/', iccUrl: resources + 'iccs/',
    isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true, rangeChunkSize: 262144
  });
  task.onProgress = ({ loaded, total }) => { if (serial === loadSerial) $('loading-text').textContent = total ? `Đang mở tài liệu… ${Math.min(100, Math.round(loaded / total * 100))}%` : 'Đang mở tài liệu…'; };
  task.onPassword = (callback, reason) => {
    if (serial !== loadSerial) return;
    passwordCallback = callback; $('pdf-password').value = '';
    $('password-message').textContent = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? 'Mật khẩu chưa đúng. Vui lòng nhập lại.' : 'Nhập mật khẩu để mở tài liệu.';
    $('loading').hidden = true;
    if (!$('password-dialog').open) $('password-dialog').showModal();
    $('pdf-password').focus();
  };
  try {
    const doc = await task.promise;
    tab.pdf = doc;
    if (serial !== loadSerial) return;
    pdfDocument = doc;
    attachments.setDocument(info,doc);
    chat?.changed();if(secondary)window.parent.rmReader.chatChanged();
    attachments.localSource.navigateDestination=dest=>linkService.goToDestination(dest);
    pdfViewer.downloadManager=attachments.downloadManager(attachments.localSource);
    const pagesReady = new Promise(resolve => {
      const handler = () => { eventBus.off('pagesinit', handler); resolve(); };
      eventBus.on('pagesinit', handler);
    });
    pdfViewer.setDocument(doc); linkService.setDocument(doc);
    await pagesReady;
    if (serial !== loadSerial) return;
    pdfViewer.currentScaleValue = 'page-width';
    await restorePosition(info.position);
    if (serial !== loadSerial) return;
    $('page-count').textContent = doc.numPages; $('page-number').max = doc.numPages;
    document.querySelectorAll('.pdf-control').forEach(control => { control.disabled = false; }); $('page-number').disabled = false;
    $('loading').hidden = true;
    chat?.changed();if(secondary)window.parent.rmReader.chatChanged();
    setReaderStatus(`Trang ${pdfViewer.currentPageNumber} / ${doc.numPages} · Có thể bôi đen văn bản để dịch`);
    doc.getOutline().then(outline => {
      if (serial !== loadSerial) return;
      renderOutline(outline);
      if (tab.expanded) { expandedOutline.clear(); tab.expanded.forEach(id => expandedOutline.add(id)); drawOutline(); }
    }).catch(() => { if (serial === loadSerial) renderOutline(null); });
    doc.getPageLabels().then(labels => { if (serial === loadSerial && labels) pdfViewer.setPageLabels(labels); }).catch(() => {});
    doc.getPage(pdfViewer.currentPageNumber).then(page => page.getTextContent()).then(content => {
      if (serial === loadSerial && !content.items.some(item => item.str?.trim())) toast('Trang này không có lớp văn bản. PDF scan chưa hỗ trợ bôi đen để dịch (chưa có OCR).');
    }).catch(() => {});
    await refreshState();
  } catch (error) {
    if (serial !== loadSerial) return;
    $('loading').hidden = true; $('welcome').hidden = false;
    if ($('password-dialog').open) $('password-dialog').close();
    passwordCallback = null; pdfDocument = null;
    attachments.setDocument(null,null);
    $('document-name').textContent = 'Chưa mở tài liệu'; $('page-count').textContent = '—';
    setReaderStatus('Không mở được tài liệu');
    toast(error.name === 'PasswordException' ? 'Tài liệu cần mật khẩu để mở.' : `Không mở được PDF: ${error.message}`);
    tab.task = null; task.destroy().catch(() => {});
  }
}
async function choosePdf() {
  try {
    const files = await desktop.openPdfs();
    for (const file of files) { if (file.error) toast(file.error); else await openDocument(file.document); }
  } catch (error) { failure(error); }
}
$('open-pdf').addEventListener('click', choosePdf); $('welcome-open').addEventListener('click', choosePdf);
$('new-tab').addEventListener('click', choosePdf);
$('password-form').addEventListener('submit', event => { event.preventDefault(); const callback = passwordCallback; passwordCallback = null; $('password-dialog').close(); $('loading').hidden = false; callback?.($('pdf-password').value); });
function cancelPassword() { passwordCallback = null; $('password-dialog').close(); loadingTask?.destroy().catch(() => {}); }
$('password-cancel').addEventListener('click', cancelPassword);
$('password-dialog').addEventListener('cancel', event => { event.preventDefault(); cancelPassword(); });

let outlineData = [];
const expandedOutline = new Set();
function renderOutline(items) {
  outlineData = items || []; expandedOutline.clear();
  outlineData.forEach((_item, i) => expandedOutline.add(String(i)));
  drawOutline();
}
function drawOutline() {
  const tree = $('outline-tree'); tree.replaceChildren();
  if (!outlineData.length) { const note = document.createElement('p'); note.className = 'empty-note'; note.textContent = 'PDF này không có mục lục bookmarks. Bạn vẫn có thể nhấp liên kết trong trang mục lục của tài liệu.'; tree.append(note); return; }
  const query = $('outline-filter').value.trim().toLocaleLowerCase('vi');
  const matches = item => item.title.toLocaleLowerCase('vi').includes(query) || item.items?.some(matches);
  function appendItems(items, parent, prefix = '') {
    items.forEach((item, index) => {
      if (query && !matches(item)) return;
      const id = prefix ? `${prefix}.${index}` : String(index);
      const wrapper = document.createElement('div'); const row = document.createElement('div'); row.className = 'outline-row';
      const children = item.items || []; const open = Boolean(query) || expandedOutline.has(id);
      const toggle = document.createElement('button'); toggle.className = 'outline-toggle' + (open ? ' open' : '');
      toggle.setAttribute('aria-label', `${open ? 'Thu gọn' : 'Mở rộng'} ${item.title}`);
      if (children.length) { toggle.innerHTML = icon('chevron'); toggle.setAttribute('aria-expanded', String(open)); toggle.onclick = () => { if (expandedOutline.has(id)) expandedOutline.delete(id); else expandedOutline.add(id); drawOutline(); }; }
      else { toggle.disabled = true; toggle.setAttribute('aria-hidden', 'true'); }
      const button = document.createElement('button'); button.className = 'outline-item'; button.textContent = item.title; button.title = item.title;
      button.onclick = async () => {
        document.querySelectorAll('.outline-row.active').forEach(node => node.classList.remove('active')); row.classList.add('active');
        if (item.dest) await linkService.goToDestination(item.dest);
        else if (item.url) desktop.openExternal(item.url).catch(failure);
        else toast('Mục này không có liên kết tới trang.');
      };
      row.append(toggle, button); wrapper.append(row);
      if (children.length && open) { const nested = document.createElement('div'); nested.className = 'outline-children'; appendItems(children, nested, id); wrapper.append(nested); }
      parent.append(wrapper);
    });
  }
  appendItems(outlineData, tree);
  if (!tree.childElementCount) { const note = document.createElement('p'); note.className = 'empty-note'; note.textContent = 'Không tìm thấy mục phù hợp.'; tree.append(note); }
}
$('outline-filter').addEventListener('input', drawOutline);
function setOutlineVisible(visible) { if(visible && !$('attachments-panel').hidden)setAttachmentsVisible(false,false); $('outline-panel').hidden = !visible; $('toggle-outline').setAttribute('aria-pressed', String(visible)); }
function focusedAttachmentSource() { return comparing && focusedPane==='right' ? rightReader()?.attachmentSource || null : attachments.localSource; }
function setAttachmentsVisible(visible,restoreOutline=true) {
  if(visible && $('attachments-panel').hidden){outlineBeforeAttachments=!$('outline-panel').hidden;setOutlineVisible(false);}
  $('attachments-panel').hidden=!visible;$('toggle-attachments').setAttribute('aria-pressed',String(visible));
  if(!visible && restoreOutline)setOutlineVisible(outlineBeforeAttachments);
}
function showAttachments(source) {setAttachmentsVisible(true);attachments.useSource(source);}
function toggleAttachments(source) {if(!$('attachments-panel').hidden && attachments.source===source)setAttachmentsVisible(false);else showAttachments(source);}
$('attachments-close').onclick=()=>setAttachmentsVisible(false);
function setTranslationVisible(visible) { $('translation-panel').hidden = !visible; $('translation-resizer').hidden = !visible; $('toggle-translation').setAttribute('aria-pressed', String(visible)); }
$('toggle-outline').onclick = () => setOutlineVisible($('outline-panel').hidden); $('outline-close').onclick = () => setOutlineVisible(false);
$('toggle-translation').onclick = () => setTranslationVisible($('translation-panel').hidden); $('translation-close').onclick = () => setTranslationVisible(false);
$('back').onclick = () => navigateFocused('back'); $('forward').onclick = () => navigateFocused('forward');
$('page-number').addEventListener('change', () => { linkService.goToPage($('page-number').value); $('page-number').value = pdfViewer.currentPageNumber; });
$('zoom').addEventListener('change', () => { if ($('zoom').value !== 'custom') pdfViewer.currentScaleValue = $('zoom').value; });
function changeZoom(factor) { if (pdfDocument) pdfViewer.currentScaleValue = Math.min(5, Math.max(0.25, pdfViewer.currentScale * factor)); }
$('zoom-in').onclick = () => changeZoom(1.2); $('zoom-out').onclick = () => changeZoom(1 / 1.2);
container.addEventListener('wheel', event => { if (event.ctrlKey && pdfDocument) { event.preventDefault(); changeZoom(event.deltaY < 0 ? 1.05 : 1 / 1.05); } }, { passive: false });

function showFind(visible) {
  $('find-bar').hidden = !visible;
  if (visible) { $('find-input').focus(); $('find-input').select(); }
  else eventBus.dispatch('findbarclose', { source: window });
}
let pendingFindOrigin = null;
function find(again = false, previous = false) {
  if (!pdfDocument || !$('find-input').value.trim()) return;
  pendingFindOrigin = capturePosition();
  eventBus.dispatch('find', { source: window, type: again ? 'again' : '', query: $('find-input').value, phraseSearch: true, caseSensitive: $('find-case').checked, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
}
eventBus.on('updatefindmatchescount', ({ matchesCount }) => { $('find-count').textContent = matchesCount.total ? `${matchesCount.current} / ${matchesCount.total} kết quả` : 'Chưa có kết quả'; });
eventBus.on('updatefindcontrolstate', ({ state: findState, matchesCount }) => {
  if (findState === 3) { $('find-count').textContent = 'Đang tìm…'; return; }
  $('find-count').textContent = findState === 1 ? 'Không tìm thấy' : `${matchesCount?.current || 0} / ${matchesCount?.total || 0} kết quả`;
  if (pendingFindOrigin) {
    if (findState !== 1) { history.record(pendingFindOrigin); updateHistoryButtons(); }
    pendingFindOrigin = null;
  }
});
$('toggle-find').onclick = () => showFind($('find-bar').hidden); $('find-close').onclick = () => showFind(false);
$('find-input').addEventListener('input', () => { clearTimeout(findTimer); findTimer = setTimeout(() => find(), 300); });
$('find-input').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); clearTimeout(findTimer); find(true, event.shiftKey); } });
$('find-next').onclick = () => find(true); $('find-prev').onclick = () => find(true, true); $('find-case').onchange = () => find();

// Annotation hit-testing keeps the text layer selectable even over blue links.
function linkAt(x, y) {
  const element = document.elementFromPoint(x, y);
  if (element?.closest('.annotation-marker,.saved-textbox,.textbox-editor,.fileAttachmentAnnotation') || markup.mode !== 'select') return null;
  const page = element?.closest('.page');
  if (!page) return null;
  for (const anchor of page.querySelectorAll('.linkAnnotation a')) {
    const rect = anchor.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return { anchor, page, rect };
  }
  return null;
}
container.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  gesture = { x: event.clientX, y: event.clientY, moved: false, link: linkAt(event.clientX, event.clientY) };
});
container.addEventListener('pointermove', event => {
  if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4) gesture.moved = true;
  container.classList.toggle('over-link', Boolean(linkAt(event.clientX, event.clientY)) && !gesture?.moved);
});
document.addEventListener('pointerup', event => {
  if (event.button !== 0 || !gesture) return;
  const previous = gesture; gesture = null;
  if (previous.link && !previous.moved) {
    const hit = linkAt(event.clientX, event.clientY);
    if (hit?.anchor === previous.link.anchor && window.getSelection()?.isCollapsed) {
      const pageRect = hit.page.getBoundingClientRect(), scale = pdfViewer.currentScale;
      sourceLinkRect = { page: Number(hit.page.dataset.pageNumber), x: (hit.rect.left - pageRect.left) / scale, y: (hit.rect.top - pageRect.top) / scale, width: hit.rect.width / scale, height: hit.rect.height / scale };
      hit.anchor.click();
      $('selection-tools').hidden = true;
      return;
    }
  }
  clearTimeout(selectionTimer); selectionTimer = setTimeout(updateSelection, 40);
});
container.addEventListener('pointerleave', () => container.classList.remove('over-link'));
container.addEventListener('click', event => {
  if (gesture?.moved && event.target.closest('.linkAnnotation')) { event.preventDefault(); event.stopPropagation(); }
}, true);
function updateSelection() {
  if (markup.mode !== 'select' || markup.editor) { $('selection-tools').hidden = true; return; }
  // Wait until the drag is released: partial selections must not consume API quota.
  if (gesture) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) { $('selection-tools').hidden = true; return; }
  const range = selection.getRangeAt(0);
  const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const end = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
  if (!start?.closest('.textLayer') || !end?.closest('.textLayer')) { $('selection-tools').hidden = true; return; }
  const text = normalizeSelection(selection.toString());
  if (!text) return;
  let auto = false;
  if (text !== selectedText || selectedDocumentInfo?.id !== documentInfo?.id) {
    cancelTranslation(); selectedText = text;
    selectedDocumentInfo = documentInfo;
    selectedPosition = capturePosition();
    const selectedPage = start.closest('.page');
    if (selectedPage && selectedPosition) {
      selectedPosition.page = Number(selectedPage.dataset.pageNumber);
      selectedPosition.top = (container.scrollTop - selectedPage.offsetTop) / selectedPosition.scale;
      selectedPosition.left = (container.scrollLeft - selectedPage.offsetLeft) / selectedPosition.scale;
    }
    if (!$('translation-content').hidden) {
      $('translation-source').textContent = text; $('translation-result').textContent = 'Nhấn Dịch sang tiếng Việt để dịch đoạn mới.';
      $('translation-result').classList.remove('error'); $('translation-status').textContent = ''; $('copy-result').disabled = true; $('retry-translation').hidden = false;
    }
    auto = preferences.autoTranslate;
  }
  selectedRects = selectionRects(range, pdfViewer);
  selectedPieces=[];
  for(const page of document.querySelectorAll('#viewer .page')){
    const layer=page.querySelector('.textLayer');if(!layer||!range.intersectsNode(layer))continue;
    const pageRange=document.createRange();pageRange.selectNodeContents(layer);const piece=range.cloneRange();
    if(piece.compareBoundaryPoints(Range.START_TO_START,pageRange)<0)piece.setStart(pageRange.startContainer,pageRange.startOffset);
    if(piece.compareBoundaryPoints(Range.END_TO_END,pageRange)>0)piece.setEnd(pageRange.endContainer,pageRange.endOffset);
    const text=normalizeSelection(piece.toString());if(text)selectedPieces.push({page:Number(page.dataset.pageNumber),text});
  }
  chat?.preview();if(secondary)window.parent.rmReader.chatChanged();
  selectedPosition = capturePosition(); selectedDocumentInfo = documentInfo;
  const sourcePage = start.closest('.page');
  if (sourcePage && selectedPosition) {
    selectedPosition.page = Number(sourcePage.dataset.pageNumber);
    selectedPosition.top = (container.scrollTop - sourcePage.offsetTop) / selectedPosition.scale;
    selectedPosition.left = (container.scrollLeft - sourcePage.offsetLeft) / selectedPosition.scale;
  }
  const rects = range.getClientRects(), rect = rects[rects.length - 1] || range.getBoundingClientRect();
  const viewport = container.getBoundingClientRect();
  if (rect.bottom < viewport.top || rect.top > viewport.bottom) { $('selection-tools').hidden = true; return; }
  const button = $('selection-tools'); button.hidden = false;
  button.style.left = `${Math.max(12, Math.min(window.innerWidth - button.offsetWidth - 12, rect.left))}px`;
  button.style.top = `${Math.max(75, Math.min(window.innerHeight - button.offsetHeight - 35, rect.bottom + 8))}px`;
  if (auto) { translateSelection(); button.hidden = false; }
}
document.addEventListener('selectionchange', () => { clearTimeout(selectionTimer); selectionTimer = setTimeout(updateSelection, 200); });
$('selection-translate').addEventListener('pointerdown', event => event.preventDefault());
$('selection-save').addEventListener('pointerdown', event => event.preventDefault());
$('selection-note').addEventListener('pointerdown', event => event.preventDefault());
$('selection-ai').addEventListener('pointerdown',event=>event.preventDefault());
$('selection-ai').onclick=()=>{const draft={...selectionSnapshot(),owner:secondary?'right':'left',pieces:selectedPieces};$('selection-tools').hidden=true;if(secondary)window.parent.rmReader.askAI(draft);else chat.open(draft);};
$('selection-note').onclick = () => {
  const draft = selectionSnapshot();
  if (!draft.rects.length) return toast('Hãy bôi đen đoạn cần đánh dấu trong PDF.');
  $('selection-tools').hidden = true;
  if (secondary) window.parent.rmReader.editAnnotation(draft); else annotations.openEditor(draft);
};
$('selection-save').onclick = saveSelectedVocabulary;
$('save-translated-vocab').onclick = saveSelectedVocabulary;
$('selection-translate').onclick = () => translateSelection(); $('retry-translation').onclick = () => translateSelection();
async function translateSelection() {
  if (!selectedText) return;
  if (secondary) return window.parent.rmReader.translateFromPane(selectionSnapshot());
  cancelTranslation(); const serial = translationSerial;
  const text = selectedText; requestId = crypto.randomUUID();
  const id = requestId;
  setTranslationVisible(true); $('selection-tools').hidden = true;
  chat?.showTab('translation');
  $('translation-empty').hidden = true; $('translation-content').hidden = false;
  $('translation-source').textContent = text;
  $('translation-result').classList.remove('error'); $('translation-result').replaceChildren();
  const spinner = document.createElement('span'); spinner.className = 'spinner'; $('translation-result').append(spinner, document.createTextNode(' Đang dịch theo ngữ cảnh nhúng…'));
  $('translation-status').textContent = ''; $('copy-result').disabled = true; $('retry-translation').hidden = true;
  try {
    const result = await desktop.translate({ id, text });
    if (serial !== translationSerial || text !== selectedText) return;
    $('translation-result').textContent = result.text;
    $('translation-status').textContent = result.source + (result.cached ? ' · đã lưu trong phiên' : '');
    $('copy-result').disabled = false;
  } catch (error) {
    if (serial !== translationSerial || text !== selectedText) return;
    $('translation-result').classList.add('error'); $('translation-result').textContent = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
    $('translation-status').textContent = 'Bạn vẫn có thể tiếp tục đọc và điều hướng PDF.';
    $('retry-translation').hidden = false;
  } finally { if (requestId === id) requestId = null; }
}
$('copy-source').onclick = () => navigator.clipboard.writeText($('translation-source').textContent).then(() => toast('Đã sao chép văn bản gốc.')).catch(failure);
const removeProgressListener = desktop.onTranslationProgress(({ id, message }) => { if (id === requestId) $('translation-status').textContent = message; });
$('copy-result').onclick = () => navigator.clipboard.writeText($('translation-result').textContent).then(() => toast('Đã sao chép bản dịch.')).catch(failure);

async function refreshState() {
  const state = await desktop.getState(); preferences = state.settings; recentDocuments = state.recent;
  vocabulary = state.vocabulary || []; renderVocabulary();
  annotations.update(state.annotations);
  $('app-version').textContent = `v${state.version}`;
  $('auto-translate').checked = preferences.autoTranslate;
  document.documentElement.style.setProperty('--translation-font', preferences.translationFont + 'px');
  const list = $('recent-list'); list.replaceChildren();
  $('recent-documents').hidden = !recentDocuments.length;
  recentDocuments.slice(0, 4).forEach(info => {
    const button = document.createElement('button'); const label = document.createElement('span'); label.textContent = info.name;
    button.innerHTML = icon('file'); button.append(label); button.title = info.path;
    button.onclick = async () => { try { await openDocument(await desktop.reopenPdf(info.id)); } catch (error) { failure(error); } };
    list.append(button);
  });
  if (!secondary) rightReader()?.refreshState().catch(failure);
}
function selectionSnapshot() {
  const doc = selectedDocumentInfo || documentInfo;
  return { text: selectedText, documentId: doc?.id, documentName: doc?.name, document: doc, position: selectedPosition || capturePosition(), rects: selectedRects };
}
async function saveSelectedVocabulary() {
  if (secondary) return window.parent.rmReader.saveVocabularyFromPane(selectionSnapshot());
  const doc = selectedDocumentInfo || documentInfo;
  if (!selectedText || !doc) return toast('Hãy bôi đen một từ hoặc đoạn trong PDF trước.');
  const translated = !requestId && !$('copy-result').disabled && !$('translation-result').classList.contains('error') && $('translation-source').textContent === selectedText;
  try {
    const state = await desktop.saveVocabulary({ text: selectedText, translation: translated ? $('translation-result').textContent : '', documentId: doc.id, position: selectedPosition || capturePosition() });
    vocabulary = state.vocabulary; renderVocabulary();
    toast(translated ? 'Đã lưu vocab và nghĩa tiếng Việt.' : 'Đã lưu vocab. Bạn có thể dịch rồi nhấn Lưu vocab để bổ sung nghĩa.');
  } catch (error) { failure(error); }
}
function renderVocabulary() {
  const list = $('vocabulary-list'); list.replaceChildren();
  const query = $('vocabulary-filter').value.trim().toLocaleLowerCase('vi');
  const items = vocabulary.filter(entry => `${entry.text} ${entry.translation} ${entry.documentName}`.toLocaleLowerCase('vi').includes(query));
  $('vocabulary-count').textContent = `(${vocabulary.length})`;
  if (!items.length) {
    const empty = document.createElement('p'); empty.className = 'empty-note';
    empty.textContent = vocabulary.length ? 'Không tìm thấy vocab phù hợp.' : 'Chưa có vocab. Bôi đen trong PDF rồi nhấn Lưu vocab để bắt đầu.';
    list.append(empty); return;
  }
  items.forEach(entry => {
    const card = document.createElement('article'); card.className = 'vocabulary-card';
    const word = document.createElement('h3'); word.textContent = entry.text;
    const meaning = document.createElement('p'); meaning.className = 'vocabulary-meaning' + (entry.translation ? '' : ' no-meaning');
    meaning.textContent = entry.translation || 'Chưa lưu nghĩa tiếng Việt';
    const footer = document.createElement('div'); footer.className = 'vocabulary-card-footer';
    const source = document.createElement('button'); source.className = 'vocabulary-source'; source.innerHTML = icon('file');
    const label = document.createElement('span'); label.textContent = `${entry.documentName} · Trang ${entry.page}`; source.append(label); source.title = 'Mở lại vị trí đã lưu trong PDF';
    source.onclick = async () => {
      $('vocabulary-error').textContent = '';
      try {
        const target = await desktop.openVocabulary(entry.id);
        $('vocabulary-dialog').close(); await openDocument(target.document);
        if (pdfDocument && documentInfo.id === target.document.id) {
          await queueNavigation(async () => { recordJump(); await restorePosition(target.position); });
        }
      } catch (error) { failure(error); }
    };
    const copy = document.createElement('button'); copy.className = 'icon-button'; copy.innerHTML = icon('copy'); copy.title = 'Sao chép vocab và nghĩa'; copy.setAttribute('aria-label', `Sao chép ${entry.text}`);
    copy.onclick = () => navigator.clipboard.writeText(entry.text + (entry.translation ? '\n' + entry.translation : '')).then(() => toast('Đã sao chép vocab.')).catch(failure);
    const remove = document.createElement('button'); remove.className = 'icon-button vocabulary-delete'; remove.innerHTML = icon('close'); remove.title = 'Xóa vocab'; remove.setAttribute('aria-label', `Xóa vocab ${entry.text}`);
    remove.onclick = async () => {
      try { const state = await desktop.deleteVocabulary(entry.id); vocabulary = state.vocabulary; renderVocabulary(); }
      catch (error) { $('vocabulary-error').textContent = error.message; }
    };
    footer.append(source, copy, remove); card.append(word, meaning, footer); list.append(card);
  });
}
$('vocabulary-button').onclick = async () => { await refreshState(); $('vocabulary-error').textContent = ''; $('vocabulary-dialog').showModal(); $('vocabulary-filter').focus(); };
$('vocabulary-close').onclick = () => $('vocabulary-dialog').close();
$('vocabulary-filter').oninput = renderVocabulary;
function providerFields() { const isGemini = $('provider').value === 'gemini'; $('gemini-settings').hidden = !isGemini; $('ollama-settings').hidden = isGemini; }
function showSettings() {
  $('provider').value = preferences.provider; $('model').value = preferences.model; $('endpoint').value = preferences.endpoint;
  $('api-key').value = ''; $('clear-key').checked = false; $('translation-font').value = preferences.translationFont;
  $('auto-fallback').checked = preferences.autoFallback !== false;
  $('chat-model').value=preferences.chatModel||'';$('chat-context-limit').value=preferences.chatContextChars||24000;$('chat-output-limit').value=preferences.chatOutputTokens||4096;
  $('key-status').textContent = preferences.hasApiKey ? 'Đã lưu API key. Để trống để tiếp tục dùng key hiện tại.' : 'API key được mã hóa bằng tài khoản Windows của bạn.';
  $('settings-error').textContent = ''; providerFields(); $('settings-dialog').showModal();
}
$('settings-button').onclick = showSettings;
$('settings-close').onclick = () => $('settings-dialog').close(); $('settings-cancel').onclick = () => $('settings-dialog').close();
$('provider').onchange = () => { providerFields(); $('model').value = $('provider').value === preferences.provider ? preferences.model : ($('provider').value === 'gemini' ? 'gemini-3.8-flash' : 'qwen3:8b'); };
$('get-api-key').onclick = () => desktop.openExternal('https://aistudio.google.com/apikey').catch(failure);
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); $('settings-error').textContent = '';
  try {
    cancelTranslation();
    await desktop.saveSettings({ provider: $('provider').value, apiKey: $('api-key').value, clearKey: $('clear-key').checked, model: $('model').value, endpoint: $('endpoint').value, autoTranslate: $('auto-translate').checked, autoFallback: $('auto-fallback').checked, translationFont: Number($('translation-font').value),chatModel:$('chat-model').value,chatContextChars:Number($('chat-context-limit').value),chatOutputTokens:Number($('chat-output-limit').value) });
    await refreshState(); $('settings-dialog').close(); toast('Đã lưu cài đặt dịch.');
    if (selectedText && !$('translation-content').hidden) { $('translation-result').textContent = 'Nhấn Dịch đoạn đã chọn để dùng cài đặt mới.'; $('translation-result').classList.remove('error'); $('retry-translation').hidden = false; $('copy-result').disabled = true; }
  } catch (error) { $('settings-error').textContent = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }
});
$('auto-translate').onchange = async () => {
  try { await desktop.saveSettings({ ...preferences, autoTranslate: $('auto-translate').checked }); await refreshState(); }
  catch (error) { $('auto-translate').checked = preferences.autoTranslate; failure(error); }
};
const resizer = $('translation-resizer'),panelWidthKey='rm-reader.translation-width';let resizeStart=null;
let preferredPanelWidth=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--translation-width'))||340;
if(!secondary){try{const saved=Number(localStorage.getItem(panelWidthKey));if(saved>=270&&saved<=10000)preferredPanelWidth=saved;}catch{}}
function maxTranslationWidth(){
  const sideWidth=[$('outline-panel'),$('attachments-panel')].reduce((sum,panel)=>sum+(panel.hidden?0:panel.getBoundingClientRect().width),0);
  const ratio=Math.max(.25,Math.min(.75,(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--compare-right'))||50)/100));
  const pdfWidth=comparing?Math.ceil(Math.max(226/(1-ratio),220/ratio)):300;
  return Math.max(270,Math.floor($('workspace').clientWidth-sideWidth-(parseFloat(getComputedStyle(resizer).width)||5)-pdfWidth));
}
function applyTranslationWidth(){
  if(secondary)return;
  const maximum=maxTranslationWidth(),width=Math.min(maximum,Math.max(270,preferredPanelWidth)),style=document.documentElement.style;
  for(const [property,value] of [['--translation-max-width',maximum+'px'],['--translation-width',width+'px']])if(style.getPropertyValue(property)!==value)style.setProperty(property,value);
  resizer.setAttribute('aria-valuemin','270');resizer.setAttribute('aria-valuemax',String(maximum));resizer.setAttribute('aria-valuenow',String(Math.round(width)));resizer.setAttribute('aria-valuetext',Math.round(width)+' pixel');
}
function setTranslationWidth(width){
  preferredPanelWidth=Math.min(maxTranslationWidth(),Math.max(270,width));applyTranslationWidth();
  if(!secondary)try{localStorage.setItem(panelWidthKey,String(preferredPanelWidth));}catch{}
}
resizer.onpointerdown=event=>{if(event.button!==0)return;resizeStart={x:event.clientX,width:$('translation-panel').offsetWidth};resizer.setPointerCapture(event.pointerId);event.preventDefault();};
resizer.onpointermove=event=>{if(resizeStart)setTranslationWidth(resizeStart.width+resizeStart.x-event.clientX);};
resizer.onpointerup=resizer.onpointercancel=resizer.onlostpointercapture=()=>{resizeStart=null;};
resizer.onkeydown=event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();setTranslationWidth($('translation-panel').offsetWidth+(event.key==='ArrowLeft'?20:-20));}};
if(!secondary){
  const panelResizeObserver=new ResizeObserver(applyTranslationWidth);
  for(const panel of [$('workspace'),$('outline-panel'),$('attachments-panel')])panelResizeObserver.observe(panel);
  new MutationObserver(applyTranslationWidth).observe(document.body,{attributes:true,attributeFilter:['class']});
  applyTranslationWidth();
}

document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]')) return;
  if (event.ctrlKey && event.key === 'Tab') {
    event.preventDefault(); const all = [null, ...tabs]; const index = all.indexOf(activeTab);
    activateTab(all[(index + (event.shiftKey ? -1 : 1) + all.length) % all.length]); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w' && !$('settings-dialog').open && !$('password-dialog').open) {
    event.preventDefault(); if (activeTab) closeTab(activeTab); return;
  }
  if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); navigateFocused(event.key === 'ArrowLeft' ? 'back' : 'forward'); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); choosePdf(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); showFind(true); }
  if (event.key === 'Escape' && !$('settings-dialog').open && !$('password-dialog').open) { showFind(false); $('selection-tools').hidden = true; }
});
$('document-tabs').addEventListener('keydown', event => {
  if (event.ctrlKey && event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key) && event.target.getAttribute('role') === 'tab') {
    event.preventDefault(); event.stopPropagation();
    const index = tabs.findIndex(tab => tab.info.id === event.target.dataset.documentId);
    const target = tabs[index + (event.key === 'ArrowLeft' ? -1 : 1)];
    if (target) moveTab(tabs[index].info.id, target.info.id, event.key === 'ArrowRight');
    return;
  }
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.target.getAttribute('role') !== 'tab') return;
  event.preventDefault(); const all = [null, ...tabs]; const index = all.indexOf(activeTab);
  const target = event.key === 'Home' ? null : event.key === 'End' ? all.at(-1) : all[(index + (event.key === 'ArrowLeft' ? -1 : 1) + all.length) % all.length];
  activateTab(target); $(`tab-${target?.info.id || 'start'}`)?.focus();
});
if (!secondary) desktop.onNavigate(action => {
  if (comparing && focusedPane === 'right') rightReader()?.navigate(action, true);
  else navigate(action, true);
});
document.addEventListener('mousedown', event => { if (event.button === 3 || event.button === 4) { event.preventDefault(); } }, true);
document.addEventListener('mouseup', event => { if (event.button === 3 || event.button === 4) { event.preventDefault(); navigateFocused(event.button === 3 ? 'back' : 'forward', true); } }, true);
document.addEventListener('auxclick', event => { if (event.button === 3 || event.button === 4) event.preventDefault(); }, true);
let dragDepth = 0;
document.addEventListener('dragenter', event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); dragDepth++; $('drop-overlay').hidden = false; } });
document.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
document.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; } });
document.addEventListener('drop', async event => {
  event.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true;
  const files = [...event.dataTransfer.files];
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.pdf')) { toast(`${file.name}: Vui lòng kéo thả file PDF.`); continue; }
    try { await openDocument(await desktop.openDroppedPdf(file)); } catch (error) { failure(error); }
  }
});
window.addEventListener('beforeunload', () => { savePosition().catch(() => {}); cancelTranslation(); removeProgressListener(); });

function rightReader() { return $('comparison-frame').contentWindow?.rmReader; }
function focusPane(pane) {
  if (secondary) return window.parent.rmReader.focusPane('right');
  focusedPane = pane; document.body.classList.toggle('compare-focus-right', pane === 'right');
  chat?.changed();
  if(!$('attachments-panel').hidden)attachments.useSource(focusedAttachmentSource());
}
function navigateFocused(action, mouse = false) {
  if(!secondary&&citationJump)return citationJump.then(()=>navigateFocused(action,mouse)).catch(failure);
  if(!secondary){const stack=action==='back'?citationBack:citationForward,target=stack.at(-1),context=getChatContexts().find(c=>c.focused);
    if(target&&context?.info.id===target.from&&context.historyDepth===target.depth){stack.pop();const reverse={owner:context.owner,info:context.info,position:context.position,from:target.info.id};(action==='back'?citationForward:citationBack).push(reverse);return restoreCitationOrigin(target).then(()=>{reverse.depth=getChatContexts().find(c=>c.focused)?.historyDepth;}).catch(failure);}}
  if (!secondary && comparing && focusedPane === 'right') return rightReader()?.navigate(action, mouse);
  return navigate(action, mouse);
}
container.addEventListener('pointerdown', () => focusPane(secondary ? 'right' : 'left'), { capture: true });
container.addEventListener('wheel', () => focusPane(secondary ? 'right' : 'left'), { passive: true });
container.addEventListener('focus', () => focusPane(secondary ? 'right' : 'left'));
$('primary-controls').addEventListener('pointerdown', () => focusPane(secondary ? 'right' : 'left'), { capture: true });
async function setCompare(visible) {
  if (secondary) return;
  comparing = visible; document.body.classList.toggle('comparing', visible);
  $('compare-button').setAttribute('aria-pressed', String(visible));
  $('comparison-pane').hidden = $('compare-resizer').hidden = $('left-pane-heading').hidden = !visible;
  if (!visible) {
    // Return the controls to their original position on the toolbar.
    $('open-pdf').parentElement.insertBefore($('primary-controls'), document.querySelector('.toolbar-spacer'));
    if (comparePanels) { setOutlineVisible(comparePanels.outline); setTranslationVisible(comparePanels.translation); setAttachmentsVisible(comparePanels.attachments,false); }
    focusPane('left'); return;
  }
  comparePanels = { outline: !$('outline-panel').hidden, translation: !$('translation-panel').hidden, attachments: !$('attachments-panel').hidden };
  setAttachmentsVisible(false,false);
  setOutlineVisible(false); setTranslationVisible(false);
  $('left-pane-controls').append($('primary-controls'));
  if (!comparisonReady) {
    comparisonReady = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { window.removeEventListener('message', ready); comparisonReady = null; reject(new Error('Không mở được khung PDF bên phải.')); }, 15000);
      function ready(event) { if (event.source === $('comparison-frame').contentWindow && event.data?.type === 'rm-reader-ready') { clearTimeout(timer); window.removeEventListener('message', ready); resolve(); } }
      window.addEventListener('message', ready);
      const url = new URL(location.href); url.searchParams.set('pane', 'right'); $('comparison-frame').src = url.href;
    });
  }
  try {
    await comparisonReady;
    if (!rightReader().document) {
      const other = tabs.find(tab => tab !== activeTab);
      if (other) await rightReader().openDocument(await desktop.reopenPdf(other.info.id));
      else toast('Nhấn Mở PDF ở bên phải để chọn datasheet hoặc tài liệu cần đối chiếu.');
    }
  } catch (error) { failure(error); }
}
$('compare-button').onclick = () => setCompare(!comparing);
const compareResizer = $('compare-resizer'); let compareDrag = false;
function resizeComparison(x) {
  const left = $('reader-area').getBoundingClientRect(), right = $('comparison-pane').getBoundingClientRect();
  const fraction = Math.max(.25, Math.min(.75, (x - left.left) / (right.right - left.left)));
  document.documentElement.style.setProperty('--compare-right', `${(1 - fraction) * 100}%`);
  applyTranslationWidth();
}
compareResizer.onpointerdown = event => { compareDrag = true; compareResizer.setPointerCapture(event.pointerId); event.preventDefault(); };
compareResizer.onpointermove = event => { if (compareDrag) resizeComparison(event.clientX); };
compareResizer.onpointerup = () => { compareDrag = false; };
compareResizer.onkeydown = event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); resizeComparison(compareResizer.getBoundingClientRect().left + (event.key === 'ArrowLeft' ? -30 : 30)); } };
async function jumpToAnnotation(entry) {
  if (secondary) return window.parent.rmReader.jumpToAnnotation(entry);
  const right = comparing ? rightReader() : null;
  if (right?.document?.id === entry.documentId && (focusedPane === 'right' || documentInfo?.id !== entry.documentId)) {
    focusPane('right'); return right.goToMark(entry);
  }
  if (documentInfo?.id !== entry.documentId) {
    const target = await desktop.openAnnotation(entry.id); await openDocument(target.document);
  }
  focusPane('left'); return goToMark(entry);
}
async function goToMark(entry) {
  return queueNavigation(async () => {
    recordJump(); await restorePosition(entry.position);
    const anchor = entry.rects[0], view = pdfViewer.getPageView(anchor.page - 1);
    if (view) {
      const [, y1, , y2] = viewportRect(view.viewport, anchor.rect);
      // Make the marked line visible even when the note was made across pages.
      const top = view.div.offsetTop + Math.min(y1, y2);
      if (top < container.scrollTop + 12 || top > container.scrollTop + container.clientHeight - 50) container.scrollTop = Math.max(0, top - 90);
      pdfViewer.update(); annotations.flash(entry.id); scheduleSave();
    }
  });
}
function chatContext(){return {info:documentInfo,pdf:!$('loading').hidden||pdfViewer.pdfDocument!==pdfDocument?null:pdfDocument,page:pdfViewer.currentPageNumber,owner:secondary?'right':'left',position:capturePosition(),historyDepth:history.backStack.length,selection:selectedDocumentInfo?.id===documentInfo?.id&&selectedText?{...selectionSnapshot(),pieces:selectedPieces}:null};}
function getChatContexts(){return [{...chatContext(),focused:focusedPane==='left'||!comparing},...(comparing&&rightReader()?.chatContext?[{...rightReader().chatContext(),focused:focusedPane==='right'}]:[])];}
async function goToChatSource(source){
  return queueNavigation(async()=>{recordJump();const page=source.page;pdfViewer.scrollPageIntoView({pageNumber:page});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const view=pdfViewer.getPageView(page-1);if(!view)return;
    const anchor=source.rects?.[0];if(anchor){const [x1,y1,x2,y2]=viewportRect(view.viewport,anchor.rect);container.scrollTop=Math.max(0,view.div.offsetTop+Math.min(y1,y2)-80);pdfViewer.update();for(const mark of source.rects.filter(r=>r.page===page)){const [a,b,c,d]=viewportRect(view.viewport,mark.rect),flash=document.createElement('div');flash.className='return-flash';Object.assign(flash.style,{left:Math.min(a,c)+'px',top:Math.min(b,d)+'px',width:Math.abs(c-a)+'px',height:Math.abs(d-b)+'px'});view.div.append(flash);setTimeout(()=>flash.remove(),2500);}}
    scheduleSave();
  });
}
async function restoreCitationOrigin(target){const reader=target.owner==='right'&&comparing?rightReader():window.rmReader;const info=reader.document?.id===target.info.id?null:await desktop.reopenPdf(target.info.id);if(info&&info.id!==target.info.id)throw new Error('PDF nguồn đã thay đổi.');if(info)await reader.openDocument(info);focusPane(target.owner==='right'&&comparing?'right':'left');await reader.restoreChatPosition(target.position);}
function jumpChatSource(conversationId,source){const task=performChatJump(conversationId,source);citationJump=task;task.finally(()=>{if(citationJump===task)citationJump=null;}).catch(()=>{});return task;}
async function performChatJump(conversationId,source){
  const origin=getChatContexts().find(c=>c.focused);const result=await desktop.openChatSource({conversationId,sourceId:source.id});
  if(result.image){chat.showImage(result.image);return;}
  const {document:info,source:verified}=result;
  const existing=getChatContexts().find(c=>c.info?.id===info.id),owner=existing?.owner||(source.owner==='right'&&comparing?'right':'left');const reader=owner==='right'?rightReader():window.rmReader;
  if(reader.document?.id!==info.id)await reader.openDocument(info);else desktop.releasePdf(info.token).catch(failure);
  focusPane(owner);await reader.goToChatSource(verified);
  if(chat){chat.selectedId=conversationId;chat.render();}
  if(origin?.info&&origin.info.id!==info.id){citationBack.push({owner:origin.owner,info:origin.info,position:origin.position,from:info.id,depth:reader.chatContext().historyDepth});citationForward=[];}
}
window.rmReader = { openDocument, refreshState, navigate, goToMark, focusPane, jumpToAnnotation,chatContext,goToChatSource,clearCitationForward,
  restoreChatPosition:position=>queueNavigation(()=>restorePosition(position)),
  chatChanged:()=>chat?.changed(),askAI:draft=>chat?.open(draft),askAIImage:image=>chat?.addPdfImage(image),
  beginAIImageCapture:()=>{if(chat.busy)throw new Error('Hãy đợi AI trả lời xong hoặc dừng trước khi khoanh ảnh.');chat.imageJobs++;chat.renderDrafts();},
  endAIImageCapture:()=>{chat.imageJobs--;chat.renderDrafts();},
  get document() { return documentInfo; },
  get attachmentSource() { return attachments.localSource; },
  showAttachmentsFromPane: source=>{const opened=!$('attachments-panel').hidden && attachments.source===source;focusPane('right');if(opened)setAttachmentsVisible(false);else showAttachments(source);},
  attachmentSourceChanged: source=>{if(focusedPane==='right')attachments.useSource(source);},
  editAnnotation: draft => annotations.openEditor(draft),
  translateFromPane: draft => { selectedText = draft.text; selectedPosition = draft.position; selectedDocumentInfo = draft.document; selectedRects = draft.rects; return translateSelection(); },
  saveVocabularyFromPane: draft => {
    if (selectedText !== draft.text || selectedDocumentInfo?.id !== draft.documentId) { cancelTranslation(); $('copy-result').disabled = true; }
    selectedText = draft.text; selectedPosition = draft.position; selectedDocumentInfo = draft.document; selectedRects = draft.rects; return saveSelectedVocabulary();
  }
};
if(!secondary){chat=new ChatManager({desktop,getContexts:getChatContexts,getSettings:()=>preferences,onOpen:()=>setTranslationVisible(true),onSource:jumpChatSource,onError:failure});$('chat-close').onclick=()=>setTranslationVisible(false);eventBus.on('pagechanging',()=>chat.preview());}

if (!desktop) toast('Ứng dụng này cần chạy bằng RM Reader trên Windows.');
else await refreshState().catch(failure);
renderTabs();
if (secondary) window.parent.postMessage({ type: 'rm-reader-ready' }, '*');

// Test-only hook, enabled by a query parameter in an isolated hidden test window.
if (new URLSearchParams(location.search).has('test')) {
  window.rmTest = { openDocument, activateTab: id => activateTab(id ? tabs.find(tab => tab.info.id === id) : null), closeTab: id => closeTab(tabs.find(tab => tab.info.id === id)), capturePosition, restorePosition, navigate, linkService, pdfViewer, eventBus, translate: text => { selectedText = text; return translateSelection(); }, get tabs() { return tabs.map(tab => ({ id: tab.info.id, name: tab.info.name, active: tab === activeTab })); }, get idle() { return !busyNavigating && !restoring; }, get history() { return { back: history.backStack, forward: history.forwardStack }; } };
}
