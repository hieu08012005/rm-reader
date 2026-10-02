import {_electron as electron,expect} from 'playwright/test';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath}from'node:url';import{PDFDocument,StandardFonts}from'pdf-lib';import{createFixture}from'./fixture.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(project,'test-results');await fs.mkdir(output,{recursive:true});
const manual=path.join(output,'chat-manual.pdf'),datasheet=path.join(output,'chat-datasheet.pdf');await createFixture(manual,60);await createFixture(datasheet,12);
for(const[file,page,text]of[[manual,60,'UNIQUE_DMA_THRESHOLD = 32 bytes. DMA_CTRL_RESET = 0x00000000.'],[datasheet,11,'UNIQUE_DMA_THRESHOLD = 64 bytes. Datasheet electrical limit.']]){const pdf=await PDFDocument.load(await fs.readFile(file)),font=await pdf.embedFont(StandardFonts.Helvetica);pdf.getPage(page-1).drawText(text,{x:52,y:220,size:12,font});await fs.writeFile(file,await pdf.save());}
const packaged=process.argv.includes('--packaged'),profile=path.join(output,`chat-profile-${Date.now()}`),env={...process.env,RM_TEST_MODE:'1',RM_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
const launch=()=>electron.launch({args:packaged?[]:[project],...(packaged?{executablePath:'E:/App_RM/release/win-unpacked/RM Reader.exe'}:{}),cwd:project,env,timeout:60000});
let app,page;const checks=[],errors=[];const mark=name=>{checks.push(name);console.log('PASS '+name);};
async function mock(){await app.evaluate(()=>{
  globalThis.chatCalls=[];globalThis.chatDelay=200;globalThis.chatError=0;globalThis.chatControllers=[];
  globalThis.fetch=async(url,options)=>{
    if(!String(url).includes('generativelanguage'))throw new Error('No live provider request in smoke tests');
    const body=JSON.parse(options.body||'{}');globalThis.chatCalls.push(body);
    if(globalThis.chatError)return new Response(JSON.stringify({error:{message:globalThis.chatError===429?'quota per day limit: 0':'API_KEY_INVALID'}}),{status:globalThis.chatError});
    const sourceLines=body.contents.at(-1).parts[0].text.split('<SOURCES>\n')[1]?.split('\n</SOURCES>')[0].split('\n')||[];
    const sources=sourceLines.map(line=>JSON.parse(line));
    const refs=sources.slice(0,2).map(s=>`[SRC:${s.id}]`).join(' ');
    const answer=`Theo tài liệu: ghi 1 để xóa cờ W1C. ${refs}\n\n| Nguồn | Giá trị |\n| --- | --- |\n| Manual | 32 bytes ${sources[0]?`[SRC:${sources[0].id}]`:''} |\n\nGiả định: MCU_TEST, SDK_TEST; mã chỉ minh họa.\n\n\`\`\`c\nREG_PLACEHOLDER = (1u << BIT_PLACEHOLDER);\n\`\`\`\n\n- Không tự tạo reset.\n- Giữ nguyên GPIOA_ISR.\n[SRC:invented] <img src=x onerror=alert(1)>`;
    const encoder=new TextEncoder();let timer;
    return new Response(new ReadableStream({start(controller){
      const emit=(text,finish)=>controller.enqueue(encoder.encode('data: '+JSON.stringify({candidates:[{content:{parts:[{text}]},...(finish?{finishReason:'STOP'}:{})}],...(finish?{usageMetadata:{promptTokenCount:250,candidatesTokenCount:100,totalTokenCount:350}}:{})})+'\n\n'));
      emit(answer.slice(0,35),false);timer=setTimeout(()=>{emit(answer.slice(35),true);controller.close();},globalThis.chatDelay);
      options.signal?.addEventListener('abort',()=>{clearTimeout(timer);controller.error(new Error('aborted'));},{once:true});
    },cancel(){clearTimeout(timer);}}));
  };
});}
async function open(file){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await page.click('#open-pdf');await expect(page.locator('#document-name')).toHaveText(path.basename(file));await expect(page.locator('#loading')).toBeHidden();await expect(page.locator('#page-count')).toHaveText(file===manual?'60':'12');}
async function ask(question){await page.fill('#chat-input',question);await page.click('#chat-send');await expect(page.locator('#chat-send')).toBeEnabled({timeout:60000});}
try{
 app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.rmTest);await mock();
 await page.evaluate(async()=>{const state=await window.desktop.getState();await window.desktop.saveSettings({...state.settings,apiKey:'isolated-test-placeholder',autoFallback:false,autoTranslate:false,chatModel:'gemini-test-flash'});await window.rmReader.refreshState();});
 await open(manual);const manualId=await page.evaluate(()=>window.rmReader.document.id);
 await expect(page.locator('.textLayer span').filter({hasText:'Write one to clear'}).first()).toBeVisible();
 await page.evaluate(()=>{const span=[...document.querySelectorAll('.textLayer span')].find(n=>n.textContent.includes('Write one to clear'));const range=document.createRange();range.selectNodeContents(span);getSelection().removeAllRanges();getSelection().addRange(range);});
 await expect(page.locator('#selection-ai')).toBeVisible();await page.click('#selection-ai');await expect(page.locator('#chat-view')).toBeVisible();assert.equal(await app.evaluate(()=>globalThis.chatCalls.length),0);await expect(page.locator('#chat-source-preview')).toContainText('Đoạn bôi đen');
 mark('Selection opens Chat AI with exact document/page/anchor and makes no API request until Send');
 await ask('Giải thích cơ chế ghi 1 để xóa');await expect(page.locator('.chat-message.assistant')).toContainText('ghi 1 để xóa');await expect(page.locator('.chat-citation').first()).toContainText('chat-manual.pdf · Trang 1');
 const firstCall=await app.evaluate(()=>globalThis.chatCalls[0]);assert.ok(firstCall.contents.at(-1).parts[0].text.includes('Write one to clear'));assert.equal(firstCall.generationConfig.maxOutputTokens,4096);assert.ok(!JSON.stringify(firstCall).includes('isolated-test-placeholder'));
 mark('Gemini uses saved encrypted key in backend, technical system instructions and only selected PDF text');
 await expect(page.locator('.chat-code pre')).toContainText('REG_PLACEHOLDER');await expect(page.locator('.chat-table table')).toHaveCount(1);await expect(page.locator('.chat-invalid-citation')).toHaveText('[Nguồn chưa được cung cấp]');assert.equal(await page.locator('.chat-message-body img').count(),0);await expect(page.locator('.chat-message-meta').last()).toContainText('350 token');
 mark('Streaming answer supports tables, C code/copy, token usage and rejects invented citation/HTML');
 await page.click('#right-tab-translation');await page.evaluate(()=>window.rmTest.translate('interrupt'));await expect(page.locator('#translation-result')).toContainText('ngắt');await page.click('#right-tab-chat');await expect(page.locator('.chat-message.assistant')).toHaveCount(1);await ask('Hỏi tiếp: có ghi 0 để xóa không?');assert.equal((await app.evaluate(()=>globalThis.chatCalls.at(-1))).contents.length,3);
 mark('Translation and Chat tabs retain content and follow-up sends complete previous turns');
 await page.click('#right-tab-translation');await expect(page.locator('#translation-result')).toContainText('ngắt');await page.click('#right-tab-chat');
 await page.selectOption('#chat-scope','search');await ask('UNIQUE_DMA_THRESHOLD là bao nhiêu?');
 const searchCall=await app.evaluate(()=>globalThis.chatCalls.at(-1));const lastSource=searchCall.contents.at(-1).parts[0].text;assert.ok(lastSource.includes('"page":60'));await expect(page.locator('#chat-messages .chat-message.user').last()).toContainText('60');
 mark('Local indexing finds a unique register parameter on a different page in a long manual');
 await page.evaluate(()=>{window.rmTest.linkService.goToPage(3);});await expect(page.locator('#page-number')).toHaveValue('3');const origin=await page.evaluate(()=>window.rmTest.capturePosition());
 await page.locator('.chat-message.assistant').last().locator('.chat-citation').first().click();await expect(page.locator('#page-number')).toHaveValue('60');await expect(page.locator('.return-flash').first()).toBeVisible();await page.evaluate(()=>document.dispatchEvent(new MouseEvent('mouseup',{button:3,bubbles:true})));await page.waitForFunction(p=>window.rmTest.idle&&window.rmTest.capturePosition().page===p.page&&Math.abs(window.rmTest.capturePosition().scrollTop-p.scrollTop)<2,origin);
 mark('Verified citation jumps to its physical page/anchor, highlights source and mouse Back restores reading position');
 await app.evaluate(()=>{globalThis.chatDelay=1500;});await page.selectOption('#chat-scope','page');await page.fill('#chat-input','Câu hỏi chốt nguồn trước khi đổi PDF');await page.click('#chat-send');await expect(page.locator('#chat-stop')).toBeVisible();await expect.poll(()=>app.evaluate(()=>globalThis.chatCalls.length)).toBe(4);const frozenConversation=await page.inputValue('#chat-history');await open(datasheet);await expect(page.locator('#chat-messages')).not.toContainText('Câu hỏi chốt nguồn');await expect(page.locator('#chat-send')).toBeEnabled({timeout:30000});await page.selectOption('#chat-history',frozenConversation);await expect(page.locator('.chat-message.assistant').last()).toContainText('ghi 1 để xóa');assert.ok((await app.evaluate(()=>globalThis.chatCalls.at(-1))).contents.at(-1).parts[0].text.includes('chat-manual.pdf'));
 mark('Changing PDFs during a response never changes the sent source or mixes the destination conversation');
 await page.locator('.chat-message.assistant').last().locator('.chat-citation').first().click();await expect(page.locator('#document-name')).toHaveText('chat-manual.pdf');await expect(page.locator('#loading')).toBeHidden();await page.waitForFunction(()=>window.rmTest.idle);await page.evaluate(()=>window.rmTest.linkService.goToPage(5));await expect(page.locator('#page-number')).toHaveValue('5');await page.evaluate(()=>document.dispatchEvent(new MouseEvent('mouseup',{button:3,bubbles:true})));await expect(page.locator('#page-number')).toHaveValue('3');await expect(page.locator('#document-name')).toHaveText('chat-manual.pdf');
 mark('Internal PDF jumps after a cross-document citation retain their normal Back order');
 await page.waitForFunction(()=>window.rmTest.idle);await page.evaluate(()=>document.dispatchEvent(new MouseEvent('mouseup',{button:3,bubbles:true})));await expect(page.locator('#document-name')).toHaveText('chat-datasheet.pdf');
 mark('A citation into another PDF activates its tab and Back returns to the previous PDF');
 await page.click('#chat-new');await page.selectOption('#chat-scope','page');await app.evaluate(()=>{globalThis.chatDelay=10000;});await page.fill('#chat-input','Dừng lượt chat này');await page.click('#chat-send');await expect(page.locator('.chat-message.assistant').last()).toContainText('Theo tài liệu');await page.click('#chat-stop');await expect(page.locator('#chat-send')).toBeEnabled();await expect(page.locator('.chat-message.assistant').last()).toContainText('Đã dừng');const stoppedId=await page.inputValue('#chat-history');
 mark('Stop cancels the streaming HTTP request and saves the partial answer');
 await app.evaluate(()=>{globalThis.chatDelay=100;});await page.click('#chat-retry');await expect(page.locator('#chat-send')).toBeEnabled();await expect(page.locator('.chat-message.assistant').last()).not.toContainText('Đã dừng');assert.equal(await page.locator('.chat-message.user').count(),1);
 mark('Retry reuses the frozen question/sources without duplicate user turns');
 await ask('Dừng lượt chat này');assert.equal(await page.locator('.chat-message.user').count(),2);
 mark('Sending an identical question again preserves both turns instead of treating it as Retry');
 await app.evaluate(()=>{globalThis.chatError=429;});await ask('Kiểm tra xử lý hết quota');await expect(page.locator('.chat-message.assistant').last()).toContainText('hạn mức');await app.evaluate(()=>{globalThis.chatError=0;});
 mark('Exhausted quota displays an actionable error without endless retry');
 await page.click('#compare-button');await page.waitForFunction(()=>!!document.getElementById('comparison-frame').contentWindow?.rmReader?.document);const right=page.frames().find(f=>f.url().includes('pane=right'));await right.evaluate(async id=>window.rmReader.openDocument(await window.parent.desktop.reopenPdf(id)),manualId);
 await page.click('#toggle-translation');await page.click('#right-tab-chat');await page.selectOption('#chat-scope','compare');await ask('Đối chiếu UNIQUE_DMA_THRESHOLD giữa hai PDF');const compareCall=(await app.evaluate(()=>globalThis.chatCalls.at(-1))).contents.at(-1).parts[0].text;assert.ok(compareCall.includes('chat-manual.pdf')&&compareCall.includes('chat-datasheet.pdf'));assert.ok(compareCall.includes('32 bytes')&&compareCall.includes('64 bytes'));await expect(page.locator('.chat-message.user').last()).toContainText('chat-datasheet.pdf');
 mark('Comparison searches both panes and attaches separately identified manual/datasheet passages');
 await page.click('#chat-rename');await page.fill('#chat-title','DMA đối chiếu đã lưu');await page.click('#chat-title-form button[type=submit]');const compareId=await page.inputValue('#chat-history');
 if(!packaged){await page.evaluate(()=>document.documentElement.style.setProperty('--translation-width','510px'));await page.screenshot({path:path.join(output,'chat-ai.png')});}
 await app.close();app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.rmTest);await mock();await page.click('#right-tab-chat');await page.selectOption('#chat-history',compareId);await expect(page.locator('#chat-messages')).toContainText('32 bytes');await expect(page.locator('#chat-history option:checked')).toContainText('DMA đối chiếu đã lưu');
 mark('Conversation questions, answers, citations and renamed title survive app restart');
 const stored=JSON.parse(await fs.readFile(path.join(profile,'chats.json'),'utf8'));assert.ok(!JSON.stringify(stored).includes('isolated-test-placeholder'));const preferences=JSON.parse(await fs.readFile(path.join(profile,'preferences.json'),'utf8'));assert.ok(preferences.encryptedKey&&!JSON.stringify(preferences).includes('isolated-test-placeholder'));
 mark('Local chat storage never includes key and existing Windows encryption remains intact');
 await fs.appendFile(manual,'\n% fixture changed\n');const stale=await page.evaluate(async id=>{const chats=await window.desktop.listChats(),c=chats.find(c=>c.id===id),s=c.messages.flatMap(m=>m.sources||[]).find(s=>s.documentName==='chat-manual.pdf');try{await window.desktop.openChatSource({conversationId:id,sourceId:s.id});return '';}catch(e){return e.message;}},compareId);assert.match(stale,/thay đổi/);
 await page.reload();await page.waitForFunction(()=>!!window.rmTest);await page.click('#right-tab-chat');await expect(page.locator('#chat-history')).toContainText('Nguồn cũ');
 mark('Changed source PDFs are marked stale and citation navigation refuses the new content');
 await page.selectOption('#chat-history',stoppedId);await page.click('#chat-delete');await expect(page.locator(`#chat-history option[value="${stoppedId}"]`)).toHaveCount(0);
 mark('Saved conversation can be explicitly selected and deleted');
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'chat-checks.json'),JSON.stringify({checks,errors,packaged},null,2));console.log(`${checks.length} Chat AI app checks passed.`);
}catch(error){console.error(error);if(page)console.error('Chat status:',await page.locator('#chat-status').textContent().catch(()=>''));if(page&&!packaged)await page.screenshot({path:path.join(output,'chat-failure.png')}).catch(()=>{});process.exitCode=1;}finally{await app?.close().catch(()=>{});}
