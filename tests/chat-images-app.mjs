import {_electron as electron,expect} from 'playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PDFDocument} from 'pdf-lib';
import {createFixture} from './fixture.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(project,'test-results');
await fs.mkdir(output,{recursive:true});
const packaged=process.argv.includes('--packaged'),profile=path.join(output,`chat-images-profile-${Date.now()}`);
const env={...process.env,RM_TEST_MODE:'1',RM_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
const launch=()=>electron.launch({args:packaged?[]:[project],...(packaged?{executablePath:'E:/App_RM/release/win-unpacked/RM Reader.exe'}:{}),cwd:project,env,timeout:60000});
const checks=[],errors=[];let app,page;
const mark=name=>{checks.push(name);console.log('PASS '+name);};
const cropPdf=path.join(output,'clock-image-only.pdf'),imageFile=path.join(output,'clock-image.png'),textPdf=path.join(output,'image-text-context.pdf');
async function mock(){await app.evaluate(()=>{
  globalThis.imageCalls=[];globalThis.imageDelay=250;
  globalThis.fetch=async(url,options)=>{
    if(!String(url).includes('generativelanguage'))throw new Error('No live request in image smoke tests');
    const body=JSON.parse(options.body);globalThis.imageCalls.push(body);
    const sources=body.contents.flatMap(c=>c.parts.filter(p=>p.text?.includes('<SOURCES>')).flatMap(p=>p.text.split('<SOURCES>\n')[1].split('\n</SOURCES>')[0].split('\n').filter(Boolean).map(line=>JSON.parse(line))));
    const refs=sources.slice(-3).map(s=>`[SRC:${s.id}]`).join(' ');
    let timer;return new Response(new ReadableStream({start(controller){timer=setTimeout(()=>{controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({candidates:[{content:{parts:[{text:`Theo ảnh: PLL và bộ chia tạo clock cho ngoại vi. ${refs}`} ]},finishReason:'STOP'}]})+'\n\n'));controller.close();},globalThis.imageDelay);options.signal?.addEventListener('abort',()=>{clearTimeout(timer);controller.error(new Error('aborted'));},{once:true});}}));
  };
});}
async function start(){
  app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.rmTest);
  await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(1440,960);win.showInactive();});await mock();
  await page.evaluate(async()=>{const state=await window.desktop.getState();await window.desktop.saveSettings({...state.settings,apiKey:'isolated-image-test',autoFallback:false,autoTranslate:false,chatModel:'gemini-vision-test'});await window.rmReader.refreshState();});
}
async function open(file){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await page.click('#open-pdf');await expect(page.locator('#loading')).toBeHidden();await expect(page.locator('#document-name')).toHaveText(path.basename(file));}
async function ask(question){await page.fill('#chat-input',question);await page.click('#chat-send');await expect(page.locator('#chat-send')).toBeEnabled({timeout:30000});}
async function crop(frame=page){
  await frame.locator('#tool-ai-image').click();
  const box=await frame.evaluate(()=>{const view=window.rmTest.pdfViewer.getPageView(1),b=view.div.getBoundingClientRect(),r=[...view.viewport.convertToViewportPoint(220,60),...view.viewport.convertToViewportPoint(804,450)];return {x1:b.left+Math.min(r[0],r[2]),y1:b.top+Math.min(r[1],r[3]),x2:b.left+Math.max(r[0],r[2]),y2:b.top+Math.max(r[1],r[3])};});
  if(frame!==page){const outer=await page.locator('#comparison-frame').boundingBox();for(const key of ['x1','x2'])box[key]+=outer.x;for(const key of ['y1','y2'])box[key]+=outer.y;}
  await page.mouse.move(box.x1,box.y1);await page.mouse.down();await page.mouse.move(box.x2,box.y2,{steps:8});await page.mouse.up();
  await expect(page.locator('.chat-image-draft')).toHaveCount(1);await expect(page.locator('#chat-send')).toBeEnabled();
}
try{
  await start();
  await createFixture(textPdf,8);
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1024;c.height=512;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1024,512);ctx.fillStyle='#ff0000';ctx.fillRect(0,0,200,512);ctx.fillStyle='#0000ff';ctx.fillRect(824,0,200,512);ctx.strokeStyle='#222';ctx.lineWidth=3;ctx.strokeRect(280,150,160,110);ctx.strokeRect(560,150,180,110);ctx.beginPath();ctx.moveTo(440,205);ctx.lineTo(560,205);ctx.lineTo(550,195);ctx.moveTo(560,205);ctx.lineTo(550,215);ctx.stroke();ctx.fillStyle='#111';ctx.font='26px sans-serif';ctx.fillText('PLL 80 MHz',285,190);ctx.fillText('/2 40 MHz',565,190);ctx.fillText('CODE_7391',390,350);return c.toDataURL('image/png').split(',')[1];});
  await fs.writeFile(imageFile,Buffer.from(png,'base64'));const pdf=await PDFDocument.create(),embedded=await pdf.embedPng(Buffer.from(png,'base64'));for(let i=0;i<3;i++)pdf.addPage([1024,512]).drawImage(embedded,{x:0,y:0,width:1024,height:512});await fs.writeFile(cropPdf,await pdf.save());
  await open(cropPdf);await page.selectOption('#zoom','0.75');await page.evaluate(()=>window.rmTest.linkService.goToPage(2));await expect(page.locator('#page-number')).toHaveValue('2');
  await crop();await expect(page.locator('#chat-view')).toBeVisible();await expect(page.locator('#chat-input')).toHaveValue('Giải thích hình/bảng này');
  assert.equal(await app.evaluate(()=>globalThis.imageCalls.length),0);
  await expect(page.locator('#chat-source-preview')).toContainText('clock-image-only.pdf · Trang 2');
  await expect.poll(()=>page.locator('.chat-image-draft img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(100);
  await page.locator('.chat-image-draft .chat-image-thumb').click();await expect(page.locator('#chat-image-dialog')).toBeVisible();await page.click('#chat-image-zoom');await expect(page.locator('#chat-image-zoom')).toHaveAttribute('aria-pressed','true');await page.keyboard.press('Escape');
  mark('Dragging a region of an image-only PDF creates a readable preview with page 2, zoom and no AI request');
  await page.click('#chat-toggle-history');await page.click('#chat-toggle-options');await expect(page.locator('#chat-suggestions')).toBeHidden();await expect(page.locator('.chat-image-draft')).toBeVisible();
  await page.screenshot({path:path.join(output,`chat-image-preview-${packaged?'packaged':'source'}.png`)});
  mark('Image preview and Send remain visible with conversation and source controls collapsed');
  await page.click('#chat-toggle-history');
  await app.evaluate(()=>{const fs=globalThis.process.mainModule.require('node:fs/promises'),rename=fs.rename;globalThis.simulatedImageSaveLock=false;fs.rename=async(...args)=>{if(!globalThis.simulatedImageSaveLock&&String(args[0]).endsWith('chats.json.tmp')){globalThis.simulatedImageSaveLock=true;const error=new Error('simulated temporary Windows file lock');error.code='EPERM';throw error;}return rename(...args);};});
  await page.click('#chat-send');await page.evaluate(()=>window.rmTest.linkService.goToPage(3));await expect(page.locator('#chat-send')).toBeEnabled();
  const first=await app.evaluate(()=>globalThis.imageCalls[0]),firstImage=first.contents[0].parts.find(p=>p.inlineData).inlineData;
  assert.equal(firstImage.mimeType,'image/png');assert.ok(!JSON.stringify(first).includes('isolated-image-test'));
  const saved=JSON.parse(await fs.readFile(path.join(profile,'chats.json'),'utf8')),cropSource=saved[0].messages[0].sources.find(s=>s.image);assert.equal(cropSource.page,2);assert.equal(cropSource.rects.length,1);assert.ok(cropSource.image.width>1000&&cropSource.image.width<2000);
  const pixel=await app.evaluate(({nativeImage},data)=>[...nativeImage.createFromBuffer(Buffer.from(data,'base64')).toBitmap().subarray(0,4)],firstImage.data);assert.deepEqual(pixel,[255,255,255,255]);
  assert.ok(!JSON.stringify(saved).includes(firstImage.data));assert.ok((await fs.stat(path.join(profile,'chat-images',cropSource.image.id+'.bin'))).size>0);
  await expect(page.locator('.chat-message.assistant')).toContainText('PLL');await expect(page.locator('.chat-message.assistant .chat-citation').first()).toContainText('Trang 2');
  mark('Send includes real cropped image bytes without outside margins, freezes page/region and stores media separately from history');
  assert.equal(await app.evaluate(()=>globalThis.simulatedImageSaveLock),true);mark('A transient Windows history file lock is retried without losing the completed answer');
  const position=await page.evaluate(()=>window.rmTest.capturePosition());await page.locator('.chat-message.assistant .chat-citation').first().click();await expect(page.locator('#page-number')).toHaveValue('2');await expect(page.locator('.return-flash')).toBeVisible();await page.evaluate(()=>document.dispatchEvent(new MouseEvent('mouseup',{button:3,bubbles:true})));await page.waitForFunction(p=>window.rmTest.idle&&window.rmTest.capturePosition().page===p.page&&Math.abs(window.rmTest.capturePosition().scrollTop-p.scrollTop)<2,position);
  mark('Image citation returns to the exact PDF region and Back restores the reading position');
  await ask('Giải thích tiếp bộ chia');const second=await app.evaluate(()=>globalThis.imageCalls[1]);assert.equal(second.contents.flatMap(c=>c.parts).find(p=>p.inlineData).inlineData.data,firstImage.data);
  await page.click('#chat-retry');await expect(page.locator('#chat-send')).toBeEnabled();const retry=await app.evaluate(()=>globalThis.imageCalls[2]);assert.equal(retry.contents.flatMap(c=>c.parts).find(p=>p.inlineData).inlineData.data,firstImage.data);
  mark('Follow-up and Retry retain the original image rather than using the newly viewed page');
  const cropId=await page.inputValue('#chat-history');
  await page.click('#chat-new');await page.locator('#chat-image-file').setInputFiles(imageFile);await expect(page.locator('.chat-image-draft')).toHaveCount(1);await page.locator('.chat-image-remove').click();await expect(page.locator('.chat-image-draft')).toHaveCount(0);assert.equal(await app.evaluate(()=>globalThis.imageCalls.length),3);
  mark('An attached image can be removed before Send without making an AI request');
  await page.evaluate(async()=>{for(const tab of [...window.rmTest.tabs])await window.rmTest.closeTab(tab.id);});await page.locator('#chat-image-file').setInputFiles(imageFile);await expect(page.locator('.chat-image-draft')).toHaveCount(1);await ask('Giải thích sơ đồ đính kèm');
  const externalId=await page.inputValue('#chat-history');await expect(page.locator('.chat-message.assistant .chat-citation').first()).toContainText('Ảnh: clock-image.png');assert.ok(!(await page.locator('.chat-message.assistant .chat-citation').first().textContent()).includes('Trang'));
  await page.locator('.chat-message.assistant .chat-citation').first().click();await expect(page.locator('#chat-image-dialog')).toBeVisible();await page.click('#chat-image-close');
  await ask('Đường nối này làm gì?');assert.ok((await app.evaluate(()=>globalThis.imageCalls.at(-1))).contents.flatMap(c=>c.parts).some(p=>p.inlineData));
  mark('Image-only conversations work without a PDF, open the image as source and keep it for follow-up');
  await page.click('#chat-new');await page.evaluate(data=>{const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)),file=new File([bytes],'pasted-clock.png',{type:'image/png'}),transfer=new DataTransfer();transfer.items.add(file);document.getElementById('chat-input').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));},png);await expect(page.locator('.chat-image-draft')).toHaveCount(1);await page.locator('#chat-image-file').setInputFiles([imageFile,imageFile]);await expect(page.locator('.chat-image-draft')).toHaveCount(3);await expect(page.locator('#chat-add-image')).toBeDisabled();
  const before=await app.evaluate(()=>globalThis.imageCalls.length);await page.locator('#chat-image-file').setInputFiles(imageFile);await expect(page.locator('#chat-status')).toContainText('tối đa 3');assert.equal(await app.evaluate(()=>globalThis.imageCalls.length),before);
  mark('Clipboard paste and multiple attachments work, and a fourth image is rejected before sending');
  await page.evaluate(()=>document.documentElement.style.setProperty('--translation-width','280px'));
  const narrow=await page.evaluate(()=>{const panel=document.getElementById('chat-view'),b=panel.getBoundingClientRect(),send=document.getElementById('chat-send').getBoundingClientRect();return {overflow:panel.scrollWidth-panel.clientWidth,sendFits:send.left>=b.left&&send.right<=b.right&&send.bottom<=b.bottom};});assert.ok(narrow.overflow<=1&&narrow.sendFits);
  await page.screenshot({path:path.join(output,`chat-three-images-${packaged?'packaged':'source'}.png`)});
  await page.evaluate(()=>document.documentElement.style.setProperty('--translation-width','510px'));
  mark('Three-image preview fits a narrow 280px chat panel while keeping Send accessible');
  await page.click('#chat-new');await page.selectOption('#chat-history',cropId);await open(cropPdf);await page.click('#compare-button');await page.waitForFunction(()=>!!document.getElementById('comparison-frame').contentWindow?.rmReader);
  const right=page.frames().find(f=>f.url().includes('pane=right'));await right.evaluate(async id=>window.rmReader.openDocument(await window.parent.desktop.reopenPdf(id)),await page.evaluate(()=>window.rmReader.document.id));await right.evaluate(()=>window.rmTest.linkService.goToPage(2));await expect(right.locator('#page-number')).toHaveValue('2');await page.click('#toggle-translation');
  await page.click('#chat-new');await right.selectOption('#zoom','page-fit');await right.evaluate(()=>window.rmTest.linkService.goToPage(2));await crop(right);await expect(page.locator('#chat-source-preview')).toContainText('Trang 2');await ask('Giải thích hình ở khung phải');
  const rightChats=JSON.parse(await fs.readFile(path.join(profile,'chats.json'),'utf8')),rightId=await page.inputValue('#chat-history');assert.equal(rightChats.find(c=>c.id===rightId).messages[0].sources[0].owner,'right');
  mark('Region selection in the comparison pane sends that pane image and correct source owner');
  const rejection=await page.evaluate(async()=>{try{await window.desktop.addChatImage({mimeType:'image/png',data:'YWJj',name:'invalid.png'});return '';}catch(e){return e.message;}});assert.match(rejection,/Định dạng/);
  const forged=await page.evaluate(async id=>{try{return await window.desktop.sendChat({conversationId:id,question:'forged',sources:[],imageIds:['not-an-image']});}catch(e){return e.message;}},externalId);assert.match(forged,/Không tìm thấy ảnh/);
  mark('Backend rejects forged attachment IDs and invalid image bytes');
  await page.click('#compare-button');await page.click('#chat-new');await page.evaluate(()=>{window.rmTest.pdfViewer.pagesRotation=90;window.rmTest.pdfViewer.currentScaleValue='page-fit';window.rmTest.linkService.goToPage(2);});await page.waitForFunction(()=>window.rmTest.pdfViewer.getPageView(1).viewport.rotation===90);
  await crop();const rotated=await page.locator('.chat-image-draft img').evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight}));assert.ok(rotated.width<rotated.height);await page.locator('.chat-image-remove').click();
  await page.locator('#tool-ai-image').click();const cancelBox=await page.locator('.page[data-page-number="2"]').boundingBox();await page.mouse.move(cancelBox.x+100,cancelBox.y+100);await page.mouse.down();await page.mouse.move(cancelBox.x+200,cancelBox.y+200);await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('.chat-image-draft')).toHaveCount(0);await expect(page.locator('.ai-image-region')).toHaveCount(0);
  mark('Rotated PDF crops preserve orientation and Escape cancels an unfinished selection');
  await page.evaluate(()=>{window.rmTest.pdfViewer.pagesRotation=0;});await page.selectOption('#zoom','0.75');await page.selectOption('#chat-history',cropId);await page.evaluate(()=>document.documentElement.style.setProperty('--translation-width','510px'));await page.screenshot({path:path.join(output,`chat-images-${packaged?'packaged':'source'}.png`)});
  await app.close();await start();await page.click('#right-tab-chat');await page.selectOption('#chat-history',cropId);await expect.poll(()=>page.locator('.chat-message-image img').first().evaluate(img=>img.naturalWidth)).toBeGreaterThan(100);await ask('Tiếp tục giải thích sơ đồ đã lưu');assert.ok((await app.evaluate(()=>globalThis.imageCalls.at(-1))).contents.flatMap(c=>c.parts).some(p=>p.inlineData));
  mark('Image previews, original source and usable image history survive restart');
  await page.selectOption('#chat-history',externalId);const external=JSON.parse(await fs.readFile(path.join(profile,'chats.json'),'utf8')).find(c=>c.id===externalId),asset=external.messages[0].sources[0].image.id;await page.click('#chat-delete');await assert.rejects(fs.stat(path.join(profile,'chat-images',asset+'.bin')),/ENOENT/);
  mark('Deleting a conversation removes image files no longer referenced by history');
  await page.click('#chat-toggle-options');await open(textPdf);await page.click('#chat-new');await page.selectOption('#chat-scope','page');await page.selectOption('#chat-pane-source','left');await page.locator('#chat-image-file').setInputFiles(imageFile);await page.check('#chat-include-pdf');await ask('Giải thích ảnh và đoạn PDF đã chọn');
  const mixed=await app.evaluate(()=>globalThis.imageCalls.at(-1));assert.ok(mixed.contents.at(-1).parts.some(p=>p.inlineData));assert.ok(mixed.contents.at(-1).parts[0].text.includes('Write one to clear'));assert.ok(mixed.contents.at(-1).parts[0].text.includes('image-text-context.pdf'));
  mark('Explicitly enabling PDF context sends both the chosen text and image in one question');
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,`chat-image-checks-${packaged?'packaged':'source'}.json`),JSON.stringify({checks,errors,packaged},null,2));console.log(`${checks.length} image chat checks passed.`);
}catch(error){console.error(error);if(page){console.error('Chat status:',await page.locator('#chat-status').textContent().catch(()=>''));await page.screenshot({path:path.join(output,'chat-images-failure.png')}).catch(()=>{});}process.exitCode=1;}finally{await app?.close().catch(()=>{});}
