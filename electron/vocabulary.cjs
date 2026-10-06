const { BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
function vocabularyHtml(folder, entries, language) {
  const en = language === 'en';
  const title = folder.isDefault ? (en ? 'Unsorted' : 'Chưa phân loại') : folder.name;
  return `<!doctype html><html lang="${en?'en':'vi'}"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(title)}</title><style>
    @page{size:A4}*{box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:11pt;line-height:1.55;color:#203b36;margin:0}header{padding:0 0 16px;border-bottom:2px solid #277d6e;margin-bottom:20px}header small{font-size:9pt;color:#587d72;letter-spacing:1px}h1{font-size:23pt;margin:5px 0;overflow-wrap:anywhere}header p{margin:4px 0;color:#647d74;font-size:10pt}.word{break-inside:avoid-page;margin:0 0 14px;border:1px solid #dce8e2;border-left:4px solid #2c8373;border-radius:7px;padding:12px 15px;background:#fafcfb}.word h2{font-size:14pt;margin:0 0 6px;line-height:1.4;color:#175f53;white-space:pre-wrap;overflow-wrap:anywhere}.number{font-size:9pt;color:#718a81;margin-right:8px}.meaning{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.missing{color:#8c8070;font-style:italic}.source{font-size:8pt;color:#71867c;margin:9px 0 0;overflow-wrap:anywhere}
  </style></head><body><header><small>RM READER / ${en?'VOCABULARY':'TỪ VỰNG'}</small><h1>${esc(title)}</h1><p>${entries.length} ${en?'saved terms':'từ đã lưu'} · ${en?'Term and meaning':'Từ và nghĩa'}</p></header>
  ${entries.map((entry,index)=>`<article class="word"><h2><span class="number">${index+1}.</span>${esc(entry.text)}</h2><p class="meaning ${entry.translation?'':'missing'}">${esc(entry.translation || (en?'No meaning saved':'Chưa lưu nghĩa'))}</p><p class="source">${esc(entry.documentName || (en?'Manually added':'Thêm thủ công'))}${entry.page?` · ${en?'Page':'Trang'} ${entry.page}`:''}</p></article>`).join('')}</body></html>`;
}
module.exports = async function registerVocabulary({ app, dialog, handle, getWindow, getState, persist, publicState }) {
  const { migrateVocabulary, requireVocabFolder, validateFolderName } = await import(pathToFileURL(path.join(__dirname,'../src/core/vocabulary.mjs')).href);
  const state = getState(); migrateVocabulary(state);
  const jobs = new Set();
  handle('vocabulary:folder-save', async input => {
    const existing = input?.id ? requireVocabFolder(state, input.id) : null;
    const name = validateFolderName(input?.name, state.vocabularyFolders, existing?.id);
    if (existing) existing.name = name;
    else state.vocabularyFolders.push({ id:randomUUID(), name, createdAt:Date.now() });
    await persist(); return publicState();
  });
  handle('vocabulary:folder-delete', async id => {
    const folder = requireVocabFolder(state,id);
    if (folder.isDefault || folder.id === 'default') throw new Error('Thư mục mặc định được giữ để chứa vocab chưa phân loại.');
    if (state.vocabulary.some(entry => entry.folderId === id)) throw new Error('Hãy chuyển các từ sang thư mục khác trước khi xóa thư mục.');
    state.vocabularyFolders = state.vocabularyFolders.filter(folder => folder.id !== id);
    await persist(); return publicState();
  });
  handle('vocabulary:edit', async input => {
    const entry = state.vocabulary.find(entry => entry.id === input?.id);
    if (!entry) throw new Error('Không tìm thấy vocab đã lưu.');
    const folder = requireVocabFolder(state,input.folderId);
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    const translation = typeof input.translation === 'string' ? input.translation.trim() : '';
    if (!text || text.length > 12000 || translation.length > 24000) throw new Error('Từ hoặc nghĩa vượt quá độ dài cho phép.');
    if (state.vocabulary.some(other => other.id !== entry.id && other.folderId === folder.id && other.documentId === entry.documentId && other.text.toLocaleLowerCase('vi') === text.toLocaleLowerCase('vi'))) throw new Error('Từ này đã có trong thư mục đích.');
    Object.assign(entry,{text,translation,folderId:folder.id,updatedAt:Date.now()});
    await persist(); return publicState();
  });
  handle('vocabulary:study-record', async input => {
    requireVocabFolder(state,input?.folderId);
    if (!['flashcards','typing','matching'].includes(input?.mode) || !Array.isArray(input.answers) || input.answers.length > 2000) throw new Error('Kết quả bài học không hợp lệ.');
    for (const answer of input.answers) {
      if (typeof answer.correct !== 'boolean' || !state.vocabulary.some(entry => entry.id === answer.id && entry.folderId === input.folderId)) throw new Error('Kết quả bài học không thuộc thư mục đã chọn.');
    }
    for (const answer of input.answers) {
      const stats = state.vocabularyStudy[answer.id] ||= { correct:0, wrong:0 };
      stats[answer.correct?'correct':'wrong']++; stats.lastStudied = Date.now();
    }
    await persist(); return true;
  });
  handle('vocabulary:export-pdf', input => {
    const job = (async () => {
      const folder = requireVocabFolder(state,input?.folderId);
      const entries = state.vocabulary.filter(entry => entry.folderId === folder.id).map(entry=>({...entry}));
      if (!entries.length) throw new Error('Thư mục này chưa có vocab để xuất PDF.');
      const en = state.uiLanguage === 'en';
      const safeName = folder.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100) || 'vocab';
      const choice = await dialog.showSaveDialog(getWindow(),{title:en?'Export vocabulary folder to PDF':'Xuất thư mục vocab ra PDF',defaultPath:path.join(app.getPath('documents'),safeName+'-vocab.pdf'),filters:[{name:'PDF',extensions:['pdf']}]});
      if (choice.canceled || !choice.filePath) return {canceled:true};
      const target = /\.pdf$/i.test(choice.filePath) ? choice.filePath : choice.filePath+'.pdf';
      const printer = new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
      printer.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      try {
        await printer.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(vocabularyHtml(folder,entries,state.uiLanguage)));
        const buffer = await printer.webContents.printToPDF({pageSize:'A4',printBackground:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="width:100%;text-align:center;font-family:Arial;font-size:9px;color:#6c8177">RM Reader &nbsp; <span class="pageNumber"></span> / <span class="totalPages"></span></div>',margins:{top:0.6,bottom:0.6,left:0.6,right:0.6}});
        await fs.writeFile(target,buffer); return {canceled:false,path:target,count:entries.length,folderId:folder.id};
      } finally { printer.destroy(); }
    })();
    jobs.add(job); job.finally(()=>jobs.delete(job)).catch(()=>{}); return job;
  });
  return () => Promise.allSettled([...jobs]);
};
module.exports.vocabularyHtml = vocabularyHtml;
