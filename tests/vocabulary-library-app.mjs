import { _electron as electron, expect } from 'playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createFixture } from './fixture.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output='E:/App_RM/updates/1.8.0';
const packaged=process.argv.includes('--packaged'),mode=packaged?'packaged':'source';
const profile=`${output}/vocab-profile-${mode}-${Date.now()}`,fixture=`${output}/vocab-source.pdf`;
const pdfOutput=`E:/App_RM/output/pdf/vocab-folder-${mode}.pdf`;
await createFixture(fixture,8);await fs.mkdir(profile,{recursive:true});await fs.mkdir(path.dirname(pdfOutput),{recursive:true});
const legacyKey='opaque-legacy-key-not-used',legacyWord={id:'legacy-word',text:'legacy-only-word',translation:'Nghĩa cũ: cờ ngắt',documentId:'legacy-doc',documentName:'vocab-source.pdf',path:fixture,page:1,position:{documentId:'legacy-doc',page:1,top:0,left:0,scale:1}};
await fs.writeFile(`${profile}/preferences.json`,JSON.stringify({encryptedKey:legacyKey,vocabulary:[legacyWord]}));
const env={...process.env,RM_TEST_MODE:'1',RM_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
const checks=[],errors=[];let app,page;
const mark=name=>{checks.push(name);console.log('PASS '+name);};
const state=()=>page.evaluate(()=>window.desktop.getState());
async function start(){app=await electron.launch({args:packaged?[]:[project],...(packaged?{executablePath:'E:/App_RM/release/win-unpacked/RM Reader.exe'}:{}),cwd:project,env,timeout:60000});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.rmTest);await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(1360,1000);win.showInactive();});}
async function folder(name){await page.click('#vocabulary-folder-new');await page.fill('#vocabulary-folder-name',name);await page.locator('#vocabulary-folder-form button[type=submit]').click();await expect(page.locator('#vocabulary-folder-dialog')).toBeHidden();return(await state()).vocabularyFolders.find(f=>f.name===name).id;}
async function add(text,meaning){await page.click('#vocabulary-add');await page.fill('#vocabulary-word',text);await page.fill('#vocabulary-meaning',meaning);await page.click('#vocabulary-save-confirm');await expect(page.locator('#vocabulary-save-dialog')).toBeHidden();return(await state()).vocabulary.find(entry=>entry.text===text&&entry.folderId===a)?.id;}
let a,b;
try{
  await start();const initial=await state();assert.equal(initial.vocabulary[0].folderId,'default');assert.equal(initial.vocabulary[0].translation,legacyWord.translation);assert.equal(initial.vocabulary[0].id,legacyWord.id);mark('Legacy vocabulary migrates to Unsorted without losing meaning, IDs or PDF sources');
  await page.click('#settings-button');await page.fill('#api-key','unsaved-dialog-value');await page.selectOption('#ui-language','en');
  await expect(page.locator('#open-pdf')).toHaveText('Open PDF');await expect(page.locator('#settings-dialog h2')).toHaveText('AI and translation settings');await expect(page.locator('#api-key')).toHaveValue('unsaved-dialog-value');await expect(page.locator('#chat-history option').first()).toHaveText('New conversation');
  await page.click('#settings-cancel');assert.deepEqual((await state()).settings,initial.settings);assert.equal(JSON.parse(await fs.readFile(`${profile}/preferences.json`,'utf8')).encryptedKey,legacyKey);mark('Interface switches to English without altering AI settings, unsaved inputs or encrypted keys');
  await page.click('#vocabulary-button');await expect(page.locator('#vocabulary-heading')).toContainText('My vocabulary');a=await folder('GPIO & Ngắt');b=await folder('UART');
  await page.selectOption('#vocabulary-folder',a);
  const definitions=new Map([['interrupt','Tín hiệu ngắt báo cho CPU'],['register','Thanh ghi lưu trạng thái phần cứng'],['prescaler','Bộ chia tần số xung nhịp'],['Gửi','Nội dung người dùng giữ nguyên']]);
  const ids={};for(const [word,meaning]of definitions)ids[word]=await add(word,meaning);await add('without meaning','');
  await expect(page.locator('.vocabulary-card')).toHaveCount(5);await expect(page.locator('.vocabulary-card h3').filter({hasText:/^Gửi$/})).toHaveText('Gửi');mark('Folder selection isolates vocabulary and retains user text that resembles interface labels');
  await page.selectOption('#vocabulary-folder',b);await add('outside-folder-unique','Không được xuất trong folder GPIO');await expect(page.locator('.vocabulary-card')).toHaveCount(1);
  const outside=(await state()).vocabulary.find(entry=>entry.text==='outside-folder-unique');await page.locator(`[data-entry-id="${outside.id}"] .vocabulary-edit`).click();await page.selectOption('#vocabulary-save-folder',a);await page.click('#vocabulary-save-confirm');await expect(page.locator('#vocabulary-save-dialog')).toBeHidden();
  await page.locator(`[data-entry-id="${outside.id}"] .vocabulary-edit`).click();await page.selectOption('#vocabulary-save-folder',b);await page.click('#vocabulary-save-confirm');await expect(page.locator('#vocabulary-save-dialog')).toBeHidden();
  await page.click('#vocabulary-folder-delete');await expect(page.locator('#vocabulary-error')).toContainText('Move the terms');assert.ok((await state()).vocabularyFolders.some(folder=>folder.id===b));mark('Words move between folders; deleting a nonempty folder never drops its words');
  const temp=await folder('Empty folder');await page.click('#vocabulary-folder-rename');await page.fill('#vocabulary-folder-name','Renamed folder');await page.locator('#vocabulary-folder-form button[type=submit]').click();await expect(page.locator('#vocabulary-folder-dialog')).toBeHidden();assert.equal((await state()).vocabularyFolders.find(f=>f.id===temp).name,'Renamed folder');await page.click('#vocabulary-folder-delete');await expect.poll(async()=>Boolean((await state()).vocabularyFolders.find(f=>f.id===temp))).toBe(false);
  await page.selectOption('#vocabulary-folder',a);await page.screenshot({path:`${output}/vocabulary-library-${mode}.png`});
  await page.click('#vocabulary-flashcards');await expect(page.locator('#vocabulary-study-note')).toContainText('Skipped 1');
  for(let index=0;index<4;index++){const word=await page.locator('.study-card-text').innerText();assert.ok(definitions.has(word));await page.click('#study-flip');await expect(page.locator('.study-card-text')).toHaveText(definitions.get(word));await page.click('#study-known');}
  await expect(page.locator('.study-score')).toHaveText('Finished: 4/4 correct');await expect.poll(async()=>Object.values((await state()).vocabularyStudy).reduce((sum,s)=>sum+s.correct,0)).toBe(4);await page.click('#vocabulary-study-close');mark('Flashcards reveal the right meanings, stay within the folder and save review results');
  await page.click('#vocabulary-typing');
  for(let index=0;index<4;index++){const meaning=await page.locator('.study-prompt').innerText();const word=[...definitions].find(([,value])=>value===meaning)[0];await page.fill('#study-typing-answer',index===0?'wrong answer':`  ${word.toUpperCase()}  `);await page.click('#study-typing-check');await expect(page.locator(index===0?'.study-wrong':'.study-correct')).toBeVisible();await page.click('#study-typing-check');}
  await expect(page.locator('.study-score')).toHaveText('Finished: 3/4 correct');await page.click('#vocabulary-study-close');mark('Typing tests grade wrong and correct answers, ignore case/extra whitespace, and show words to review');
  await page.click('#vocabulary-matching');await expect(page.locator('.study-match-word')).toHaveCount(4);
  const pairs=await page.locator('.study-match-word').evaluateAll(nodes=>nodes.map(node=>node.dataset.entryId));
  await page.locator(`.study-match-word[data-entry-id="${pairs[0]}"]`).click();await page.locator(`.study-match-meaning[data-entry-id="${pairs[1]}"]`).click();await expect(page.locator('#vocabulary-study-result')).toHaveText('Not a match. Try again.');
  for(const id of pairs){await page.locator(`.study-match-word[data-entry-id="${id}"]`).click();await page.locator(`.study-match-meaning[data-entry-id="${id}"]`).click();}
  await expect(page.locator('.study-score')).toHaveText('Finished: 3/4 correct');await page.screenshot({path:`${output}/vocabulary-study-${mode}.png`});await page.click('#vocabulary-study-close');mark('Matching shuffles meanings, detects mistakes and records scores for the selected folder only');
  const larger=await folder('Matching rounds');
  for(let i=1;i<=7;i++)await add(`pair-${i}`,`Nghĩa riêng ${i}`);
  await page.click('#vocabulary-matching');await expect(page.locator('.study-match-word')).toHaveCount(6);
  for(const count of [6,1]){const round=await page.locator('.study-match-word').evaluateAll(nodes=>nodes.map(node=>node.dataset.entryId));assert.equal(round.length,count);for(const id of round){await page.locator(`.study-match-word[data-entry-id="${id}"]`).click();await page.locator(`.study-match-meaning[data-entry-id="${id}"]`).click();}}
  await expect(page.locator('.study-score')).toHaveText('Finished: 7/7 correct');await expect.poll(async()=>Object.entries((await state()).vocabularyStudy).filter(([id])=>id&&(typeof id==='string')).length).toBe(11);await page.click('#vocabulary-study-close');mark('Matching covers a larger folder in successive rounds instead of dropping terms beyond six');
  await page.click('#vocabulary-close');
  await app.evaluate(({dialog},filename)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filename]});},fixture);await page.click('#open-pdf');await expect(page.locator('#loading')).toBeHidden();
  const span=page.locator('.page[data-page-number="1"] .textLayer span').filter({hasText:/^interrupt$/}).first();await span.waitFor();
  await page.evaluate(()=>{const span=[...document.querySelectorAll('.textLayer span')].find(node=>node.textContent==='interrupt');const range=document.createRange();range.selectNodeContents(span);getSelection().removeAllRanges();getSelection().addRange(range);});
  await expect(page.locator('#selection-save')).toBeVisible();await page.click('#selection-save');await expect(page.locator('#vocabulary-save-dialog')).toBeVisible();await page.selectOption('#vocabulary-save-folder',b);await page.fill('#vocabulary-meaning','Ngắt được lưu từ trang PDF');await page.click('#vocabulary-save-confirm');await expect(page.locator('#vocabulary-save-dialog')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>getSelection().toString())).toBe('interrupt');
  const fromPdf=(await state()).vocabulary.find(entry=>entry.text==='interrupt'&&entry.path);assert.equal(fromPdf.folderId,b);assert.equal(fromPdf.page,1);assert.ok(fromPdf.position);mark('Saving a real PDF selection asks for its folder, restores the selection and keeps a clickable source location');
  await page.click('#vocabulary-button');await page.selectOption('#vocabulary-folder',b);await page.locator(`[data-entry-id="${fromPdf.id}"] .vocabulary-source`).click();await expect(page.locator('#vocabulary-dialog')).toBeHidden();await expect(page.locator('#page-number')).toHaveValue('1');
  await page.click('#settings-button');await page.selectOption('#ui-language','vi');await expect(page.locator('#open-pdf')).toHaveText('Mở PDF');await page.selectOption('#ui-language','en');await expect(page.locator('#open-pdf')).toHaveText('Open PDF');await page.click('#settings-cancel');await expect(span).toHaveText('interrupt');
  assert.equal((await state()).vocabulary.find(entry=>entry.id===ids['Gửi']).text,'Gửi');mark('Switching languages back and forth leaves PDF text and saved Vietnamese definitions unchanged');
  for(let i=1;i<=18;i++)await page.evaluate(async({folderId,i})=>window.desktop.saveVocabulary({manual:true,folderId,text:`GPIO_TERM_${i}`,translation:`Từ vựng minh họa ${i}: ghi 1 để xóa cờ ngắt; giữ nguyên tên thanh ghi và địa chỉ phần cứng.`}),{folderId:a,i});
  await assert.rejects(()=>page.evaluate(()=>window.desktop.exportVocabularyPdf(null)));await assert.rejects(()=>page.evaluate(()=>window.desktop.recordVocabularyStudy({folderId:'default',mode:'typing',answers:[{id:'not-in-folder',correct:true}]})));
  await app.evaluate(({dialog},pdfOutput)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:pdfOutput});},pdfOutput);
  await page.click('#vocabulary-button');await page.selectOption('#vocabulary-folder',a);await page.click('#vocabulary-export');await expect(page.locator('#vocabulary-export')).toBeEnabled({timeout:30000});assert.ok((await fs.stat(pdfOutput)).size>1000);mark('PDF export requires one folder, saves to the chosen path and rejects unscoped exports');
  const pdfBeforeCancel=await fs.readFile(pdfOutput);await app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true});});await page.click('#vocabulary-export');await expect(page.locator('#vocabulary-export')).toBeEnabled();assert.deepEqual(await fs.readFile(pdfOutput),pdfBeforeCancel);mark('Canceling the save dialog leaves the exported file and vocabulary untouched');
  const beforeRestart=await state();await page.click('#vocabulary-close');await app.close();app=null;await start();const restored=await state();assert.equal(restored.uiLanguage,'en');assert.equal(restored.vocabulary.length,beforeRestart.vocabulary.length);assert.deepEqual(restored.vocabularyStudy,beforeRestart.vocabularyStudy);assert.equal(restored.vocabulary.find(entry=>entry.id===legacyWord.id).translation,legacyWord.translation);await expect(page.locator('#open-pdf')).toHaveText('Open PDF');
  assert.equal(JSON.parse(await fs.readFile(`${profile}/preferences.json`,'utf8')).encryptedKey,legacyKey);mark('Folders, legacy vocab, review scores and interface language survive restart; API keys remain unchanged');
  assert.deepEqual(errors,[]);mark('No renderer errors across language changes, folder operations, all study modes and PDF export');
  await fs.writeFile(`${output}/vocabulary-checks-${mode}.json`,JSON.stringify({passed:checks.length,checks,errors,pdf:pdfOutput,folderId:a},null,2));
}finally{if(app)await app.close();}
