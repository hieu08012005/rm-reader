const { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID, createHash } = require('node:crypto');
const { Readable } = require('node:stream');

protocol.registerSchemesAsPrivileged([{ scheme: 'rm-pdf', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
if (process.env.RM_TEST_DATA) app.setPath('userData', process.env.RM_TEST_DATA);
let win, stateFile, state, translateEmbedded, validateSettings, validateAnnotation, eraseAnnotations, writeQueue = Promise.resolve();
let waitForAttachments=()=>Promise.resolve();
let waitForChat=()=>Promise.resolve();
const documents = new Map(), requests = new Map(), cache = new Map();
const defaults = { provider: 'gemini', model: 'gemini-3.8-flash', endpoint: 'http://127.0.0.1:11434', autoTranslate: false, autoFallback: true, translationFont: 16 };
if (process.env.RM_TEST_MODE !== '1' && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

function validSender(event) { return event.sender === win?.webContents && event.senderFrame === win.webContents.mainFrame; }
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!validSender(event)) throw new Error('Nguồn yêu cầu không hợp lệ.');
    return fn(...args);
  });
}
function publicState() {
  return { version: app.getVersion(), settings: { ...state.settings, hasApiKey: Boolean(state.encryptedKey) }, recent: Object.values(state.documents).sort((a,b) => b.lastOpened - a.lastOpened).slice(0, 8), vocabulary: state.vocabulary, annotations: state.annotations };
}
function persist() {
  const snapshot = JSON.stringify(state, null, 2);
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    await fsp.mkdir(path.dirname(stateFile), { recursive: true });
    await fsp.writeFile(stateFile + '.tmp', snapshot, 'utf8');
    await fsp.rename(stateFile + '.tmp', stateFile);
  });
  return writeQueue;
}
async function registerPdf(filename) {
  const absolute = path.resolve(filename);
  const stat = await fsp.stat(absolute);
  if (!stat.isFile() || path.extname(absolute).toLowerCase() !== '.pdf') throw new Error('Vui lòng chọn một file PDF.');
  const head = Buffer.alloc(1024);
  const fd = await fsp.open(absolute, 'r');
  try { await fd.read(head, 0, 1024, 0); } finally { await fd.close(); }
  if (!head.includes(Buffer.from('%PDF-'))) throw new Error('File không có định dạng PDF hợp lệ.');
  const id = createHash('sha256').update(absolute + ':' + stat.size + ':' + stat.mtimeMs).digest('hex');
  const previous = state.documents[id];
  const token = randomUUID();
  documents.set(token, { path: absolute, size: stat.size, id });
  state.documents[id] = { id, name: path.basename(absolute), path: absolute, size: stat.size, lastOpened: Date.now(), position: previous?.position ?? null };
  const oldest = Object.values(state.documents).sort((a,b) => b.lastOpened - a.lastOpened).slice(40);
  oldest.forEach(doc => delete state.documents[doc.id]);
  await persist();
  return { id, token, name: path.basename(absolute), url: `rm-pdf://document/${token}`, position: previous?.position ?? null, size: stat.size };
}

app.whenReady().then(async () => {
  ({ translateEmbedded, validateSettings } = await import(pathToFileURL(path.join(__dirname, '../src/core/translation.mjs')).href));
  ({ validateAnnotation, eraseAnnotations } = await import(pathToFileURL(path.join(__dirname, '../src/core/annotations.mjs')).href));
  stateFile = path.join(app.getPath('userData'), 'preferences.json');
  try { state = JSON.parse(await fsp.readFile(stateFile, 'utf8')); } catch { state = {}; }
  state.settings = { ...defaults, ...state.settings };
  state.documents ||= {};
  state.vocabulary = Array.isArray(state.vocabulary) ? state.vocabulary : [];
  state.annotations = Array.isArray(state.annotations) ? state.annotations : [];
  protocol.handle('rm-pdf', async request => {
    const token = new URL(request.url).pathname.slice(1);
    const doc = documents.get(token);
    if (!doc) return new Response('Not found', { status: 404 });
    const headers = { 'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    let start = 0, end = doc.size - 1, status = 200;
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) return new Response(null, { status: 416 });
      start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end;
      if (start > end || start >= doc.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${doc.size}` } });
      headers['Content-Range'] = `bytes ${start}-${end}/${doc.size}`; status = 206;
    }
    headers['Content-Length'] = String(end - start + 1);
    if (request.method === 'HEAD') return new Response(null, { status, headers });
    const stream = fs.createReadStream(doc.path, { start, end });
    request.signal.addEventListener('abort', () => stream.destroy(), { once: true });
    return new Response(Readable.toWeb(stream), { status, headers });
  });
  handle('pdf:open', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Mở tài liệu PDF', properties: ['openFile'], filters: [{ name: 'Tài liệu PDF', extensions: ['pdf'] }] });
    return result.canceled ? null : registerPdf(result.filePaths[0]);
  });
  handle('pdf:open-many', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Mở tài liệu PDF trong các tab', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Tài liệu PDF', extensions: ['pdf'] }] });
    if (result.canceled) return [];
    const files = [];
    for (const filename of result.filePaths) {
      try { files.push({ document: await registerPdf(filename) }); }
      catch (error) { files.push({ error: `${path.basename(filename)}: ${error.message}` }); }
    }
    return files;
  });
  handle('pdf:drop', filename => registerPdf(filename));
  handle('pdf:reopen', id => {
    if (!state.documents[id]) throw new Error('Không tìm thấy tài liệu trong danh sách gần đây.');
    return registerPdf(state.documents[id].path);
  });
  handle('pdf:release', token => { documents.delete(token); return true; });
  waitForAttachments=await require('./attachments.cjs')({app,dialog,shell,handle,documents,registerPdf,getWindow:()=>win});
  waitForChat=await require('./chat.cjs')({app,handle,documents,registerPdf,getWindow:()=>win,getSettings:()=>state.settings,getApiKey:()=>{
    if(!state.encryptedKey)return '';
    try{return safeStorage.decryptString(Buffer.from(state.encryptedKey,'base64'));}catch{throw new Error('Không đọc được API key đã lưu. Hãy nhập lại trong Cài đặt.');}
  }});
  handle('state:get', () => publicState());
  handle('state:position', async ({ id, position }) => {
    if (!state.documents[id]) return;
    if (!position || !Number.isFinite(position.page) || !Number.isFinite(position.top) || !Number.isFinite(position.left) || !Number.isFinite(position.scale)) return;
    state.documents[id].position = position;
    await persist();
  });
  handle('vocabulary:save', async input => {
    const text = typeof input?.text === 'string' ? input.text.trim() : '';
    const doc = state.documents[input?.documentId];
    const position = input?.position;
    if (!text || text.length > 12000 || !doc || !position || !Number.isInteger(position.page) || position.page < 1 || ![position.top, position.left, position.scale].every(Number.isFinite)) throw new Error('Hãy bôi đen văn bản trong PDF để lưu vocab.');
    const translation = typeof input.translation === 'string' ? input.translation.trim().slice(0, 24000) : '';
    const existing = state.vocabulary.find(item => item.documentId === doc.id && item.text.toLocaleLowerCase('vi') === text.toLocaleLowerCase('vi'));
    if (existing) {
      if (translation) existing.translation = translation;
      existing.updatedAt = Date.now();
    } else {
      state.vocabulary.unshift({ id: randomUUID(), text, translation, documentId: doc.id, documentName: doc.name, path: doc.path, page: position.page,
        position: { documentId: doc.id, page: position.page, top: position.top, left: position.left, scale: position.scale }, createdAt: Date.now(), updatedAt: Date.now() });
    }
    await persist(); return publicState();
  });
  handle('vocabulary:delete', async id => {
    state.vocabulary = state.vocabulary.filter(item => item.id !== id);
    await persist(); return publicState();
  });
  handle('vocabulary:open', async id => {
    const entry = state.vocabulary.find(item => item.id === id);
    if (!entry) throw new Error('Không tìm thấy vocab đã lưu.');
    const info = await registerPdf(entry.path);
    return { document: info, position: { ...entry.position, documentId: info.id } };
  });
  handle('annotations:save', async input => {
    const existing = input?.id ? state.annotations.find(entry => entry.id === input.id) : null;
    if (input?.id && !existing) throw new Error('Không tìm thấy ghi chú.');
    const entry = validateAnnotation(input, { existing, document: state.documents[input?.documentId] });
    entry.id = existing?.id || randomUUID(); entry.createdAt = existing?.createdAt || Date.now(); entry.updatedAt = Date.now();
    if (existing) state.annotations[state.annotations.indexOf(existing)] = entry;
    else state.annotations.unshift(entry);
    await persist(); return publicState();
  });
  handle('annotations:delete', async id => {
    state.annotations = state.annotations.filter(entry => entry.id !== id);
    await persist(); return publicState();
  });
  handle('annotations:erase', async input => {
    if (!state.documents[input?.documentId]) throw new Error('Không tìm thấy tài liệu.');
    state.annotations = eraseAnnotations(state.annotations, input);
    await persist(); return publicState();
  });
  handle('annotations:open', async id => {
    const entry = state.annotations.find(item => item.id === id);
    if (!entry) throw new Error('Không tìm thấy ghi chú.');
    const info = await registerPdf(entry.path);
    if (info.id !== entry.documentId) { documents.delete(info.token); throw new Error('PDF nguồn đã thay đổi. Ghi chú này thuộc phiên bản PDF cũ.'); }
    return { document: info, annotation: entry };
  });
  handle('settings:save', async input => {
    const settings = validateSettings(input);
    if (input.clearKey) state.encryptedKey = null;
    else if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows chưa sẵn sàng lưu API key được mã hóa. Hãy thử lại.');
      state.encryptedKey = safeStorage.encryptString(input.apiKey.trim()).toString('base64');
    }
    state.settings = settings; cache.clear();
    requests.forEach(controller => controller.abort());
    await persist(); return publicState();
  });
  handle('translate', async ({ id, text }) => {
    if (typeof text !== 'string' || typeof id !== 'string') throw new Error('Yêu cầu dịch không hợp lệ.');
    const key = JSON.stringify([state.settings, text]);
    if (cache.has(key)) return { ...cache.get(key), cached: true };
    const controller = new AbortController(); requests.set(id, controller);
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      let apiKey = '';
      if (state.encryptedKey) {
        try { apiKey = safeStorage.decryptString(Buffer.from(state.encryptedKey, 'base64')); }
        catch { throw new Error('Không đọc được API key đã lưu. Vui lòng nhập lại trong Cài đặt.'); }
      }
      const result = await translateEmbedded({ text, settings: state.settings, apiKey, signal: controller.signal, onProgress: message => { if (!controller.signal.aborted && !win.isDestroyed()) win.webContents.send('translate:progress', { id, message }); } });
      if (controller.signal.aborted) throw new Error('Đã hủy yêu cầu dịch.');
      cache.set(key, result); if (cache.size > 200) cache.delete(cache.keys().next().value);
      return result;
    } finally { clearTimeout(timer); requests.delete(id); }
  });
  ipcMain.on('translate:cancel', (event, id) => { if (validSender(event)) requests.get(id)?.abort(); });
  handle('external:open', async url => {
    const parsed = new URL(url);
    if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) throw new Error('Liên kết này không được hỗ trợ.');
    await shell.openExternal(parsed.href);
  });
  win = new BrowserWindow({
    width: 1440, height: 940, minWidth: 960, minHeight: 650, title: 'RM Reader', backgroundColor: '#f5f6f8',
    icon: path.join(__dirname, '../dist/app-taskbar.png'),
    show: process.env.RM_TEST_MODE !== '1', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: process.env.RM_TEST_MODE !== '1' }
  });
  app.setAppUserModelId('vn.rmreader.desktop');
  win.on('app-command', (event, command) => {
    if (command === 'browser-backward' || command === 'browser-forward') {
      event.preventDefault(); win.webContents.send('navigate', command === 'browser-backward' ? 'back' : 'forward');
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  if (process.env.RM_DEV_URL) await win.loadURL(process.env.RM_DEV_URL);
  else await win.loadFile(path.join(__dirname, '../dist/index.html'), process.env.RM_TEST_MODE === '1' ? { query: { test: '1' } } : {});
});
app.on('window-all-closed', () => app.quit());
let quitting = false;
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); quitting = true;
  requests.forEach(controller => controller.abort());
  Promise.allSettled([waitForAttachments(),waitForChat()]).then(()=>writeQueue).catch(() => {}).finally(() => app.quit());
});
