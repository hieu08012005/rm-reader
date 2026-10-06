import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateVocabulary, validateFolderName, requireVocabFolder, normalizeStudyAnswer, studyEntries, uniqueMatchingEntries, shuffled } from '../src/core/vocabulary.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),{vocabularyHtml}=require('../electron/vocabulary.cjs');
test('Legacy vocab migrates to a default folder without changing IDs, meaning or source',()=>{
  const original={id:'old',text:'IRQ',translation:'Ngắt',documentId:'pdf',position:{page:3}};
  const state={vocabulary:[{...original}],vocabularyFolders:[]};migrateVocabulary(state);
  assert.deepEqual(state.vocabulary[0],{...original,folderId:'default'});assert.equal(state.vocabularyFolders[0].id,'default');
  migrateVocabulary(state);assert.equal(state.vocabularyFolders.length,1);
  const custom={vocabulary:[{id:'custom',folderId:'gpio'},{id:'orphan',folderId:'missing'}],vocabularyFolders:[{id:'gpio',name:'GPIO'}]};migrateVocabulary(custom);assert.equal(custom.vocabulary[0].folderId,'gpio');assert.equal(custom.vocabulary[1].folderId,'default');
});
test('Folder names preserve Unicode and reject duplicates or blank names; scope must be explicit',()=>{
  assert.equal(validateFolderName('  Bài học 1  ',[]),'Bài học 1');
  for(const name of ['', ' ', 'a\nb', 'x'.repeat(81)])assert.throws(()=>validateFolderName(name,[]));
  assert.throws(()=>validateFolderName('gpio',[{id:'a',name:'GPIO'}]));
  assert.equal(validateFolderName('GPIO',[{id:'a',name:'GPIO'}],'a'),'GPIO');
  assert.throws(()=>requireVocabFolder({vocabularyFolders:[{id:'a',name:'GPIO'}]},null));
});
test('Study excludes missing meanings and matching avoids ambiguous duplicates',()=>{
  const entries=[{id:'1',text:'IRQ',translation:'Ngắt'},{id:'2',text:' irq ',translation:'Ngắt khác'},{id:'3',text:'ISR',translation:'NGẮT'},{id:'4',text:'PLL',translation:''},{id:'5',text:'CLK',translation:'Clock'}];
  assert.equal(studyEntries(entries).length,4);assert.deepEqual(uniqueMatchingEntries(entries).map(entry=>entry.id),['1','5']);
  assert.equal(normalizeStudyAnswer('  INTERRUPT\n FLAG '),'interrupt flag');assert.notEqual(normalizeStudyAnswer('ngắt'),normalizeStudyAnswer('ngat'));
  const copy=shuffled(entries,()=>0);assert.equal(copy.length,entries.length);assert.notEqual(copy,entries);assert.equal(entries[0].id,'1');
});
test('PDF layout escapes word, meaning and folder HTML while retaining Vietnamese and separated cards',()=>{
  const html=vocabularyHtml({name:'GPIO <script>',id:'a'},[{text:'<img src=x>',translation:'Cờ ngắt & tín hiệu',documentName:'RM.pdf',page:3}],'vi');
  assert.ok(html.includes('GPIO &lt;script&gt;'));assert.ok(html.includes('&lt;img src=x&gt;'));assert.ok(html.includes('Cờ ngắt &amp; tín hiệu'));assert.ok(html.includes('class="word"'));assert.ok(html.includes('break-inside:avoid-page'));assert.ok(!html.includes('<script>'));
});
