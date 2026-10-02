import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentName,canOpenAttachment,attachmentLabel } from '../src/core/attachments.mjs';
test('attachment filenames discard paths, drive prefixes and Windows control characters',()=>{
  assert.equal(attachmentName('../../S32K_Map.xlsx'),'S32K_Map.xlsx');
  assert.equal(attachmentName('C:\\private\\S32K.pdf'),'S32K.pdf');
  assert.equal(attachmentName('Map:1?.xlsx'),'Map_1_.xlsx');
  assert.equal(attachmentName('bad\0file.txt'),'bad_file.txt');
});
test('attachment names handle reserved devices, blank names and trailing dots',()=>{
  assert.equal(attachmentName('CON.xlsx'),'_CON.xlsx');assert.equal(attachmentName('LPT1'),'_LPT1');
  assert.equal(attachmentName('...'),'tep-dinh-kem');assert.equal(attachmentName('Map.xlsx. '),'Map.xlsx');
  assert.equal(attachmentName('a'.repeat(400)+'.xlsx').length,180);assert.ok(attachmentName('a'.repeat(400)+'.xlsx').endsWith('.xlsx'));
});
test('attachments open document types while executable and shortcut files support save only',()=>{
  for(const name of ['Map.xlsx','Manual.PDF','table.csv','note.txt','image.png'])assert.equal(canOpenAttachment(name),true);
  for(const name of ['map.xlsx.exe','startup.lnk','script.cmd','script.ps1','installer.msi','web.hta'])assert.equal(canOpenAttachment(name),false);
  assert.equal(attachmentLabel('map.xlsx'),'Excel / bảng tính');assert.equal(attachmentLabel('manual.pdf'),'PDF');
});
