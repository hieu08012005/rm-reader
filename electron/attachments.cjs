const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

module.exports = async function registerAttachments({ app, dialog, shell, handle, documents, registerPdf, getWindow }) {
  const { attachmentName, attachmentType, canOpenAttachment } = await import(require('node:url').pathToFileURL(path.join(__dirname,'../src/core/attachments.mjs')).href);
  const writes = new Map(), pending = new Set();
  function attachmentHandle(channel,work) {
    handle(channel,async input=>{const task=Promise.resolve().then(()=>work(input));pending.add(task);try{return await task;}finally{pending.delete(task);}});
  }
  function checked(input) {
    const doc = documents.get(input?.token);
    if (!doc) throw new Error('Tài liệu nguồn đã đóng. Hãy mở lại PDF để lấy tệp đính kèm.');
    if (!(input?.content instanceof Uint8Array) || input.content.byteLength > 512*1024*1024) throw new Error('Tệp đính kèm không hợp lệ hoặc lớn hơn 512 MB.');
    return { doc, name: attachmentName(input.name), data: Buffer.from(input.content) };
  }
  async function extract(file) {
    const hash=createHash('sha256').update(file.name).update(file.data).digest('hex');
    const folder=path.join(app.getPath('userData'),'attachments',file.doc.id,hash), filename=path.join(folder,file.name);
    if (!writes.has(filename)) {
      const write=(async()=>{await fs.mkdir(folder,{recursive:true});try{await fs.writeFile(filename,file.data,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}return filename;})();
      writes.set(filename,write);write.catch(()=>writes.delete(filename));
    }
    return writes.get(filename);
  }
  attachmentHandle('attachments:open',async input=>{
    const file=checked(input);
    if (!canOpenAttachment(file.name)) throw new Error('Loại tệp này hỗ trợ Lưu ra máy.');
    const filename=await extract(file);
    if (attachmentType(file.name)==='pdf') return { document:await registerPdf(filename) };
    const error=await shell.openPath(filename);
    if (error) throw new Error('Không mở được tệp. Hãy cài ứng dụng phù hợp hoặc Lưu ra máy để mở thủ công.');
    return { opened:true,name:file.name };
  });
  attachmentHandle('attachments:save',async input=>{
    const file=checked(input);
    const result=await dialog.showSaveDialog(getWindow(),{title:'Lưu tệp đính kèm',defaultPath:path.join(app.getPath('documents'),file.name)});
    if (result.canceled || !result.filePath) return { canceled:true };
    if (path.resolve(result.filePath).toLowerCase()===path.resolve(file.doc.path).toLowerCase()) throw new Error('Hãy chọn tên khác với PDF nguồn.');
    await fs.writeFile(result.filePath,file.data);return { saved:true,name:file.name };
  });
  attachmentHandle('attachments:save-all',async inputs=>{
    if (!Array.isArray(inputs) || !inputs.length || inputs.length>1000) throw new Error('Danh sách tệp không hợp lệ.');
    const files=inputs.map(checked);
    if (files.reduce((sum,file)=>sum+file.data.length,0)>1024*1024*1024) throw new Error('Hãy lưu từng tệp khi tổng dung lượng lớn hơn 1 GB.');
    const result=await dialog.showOpenDialog(getWindow(),{title:'Chọn thư mục lưu tất cả tệp đính kèm',properties:['openDirectory','createDirectory']});
    if (result.canceled || !result.filePaths[0])return {canceled:true};
    const folder=result.filePaths[0];let saved=0;
    for (const file of files) {
      const ext=path.extname(file.name),stem=file.name.slice(0,file.name.length-ext.length);
      for (let suffix=0;suffix<10000;suffix++) {
        const filename=path.join(folder,suffix?`${stem} (${suffix})${ext}`:file.name);
        try {await fs.writeFile(filename,file.data,{flag:'wx'});saved++;break;}
        catch(error){if(error.code!=='EEXIST')throw new Error(`Đã lưu ${saved} tệp; không lưu được ${file.name}: ${error.message}`);if(suffix===9999)throw new Error('Có quá nhiều tệp trùng tên trong thư mục.');}
      }
    }
    return { saved };
  });
  return ()=>Promise.allSettled([...pending]);
};
