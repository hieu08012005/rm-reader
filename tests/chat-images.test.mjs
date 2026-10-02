import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildChatContents,streamChat,CHAT_INSTRUCTIONS} from '../src/core/chat.mjs';
import {imagePayload,imageSourceFields,sourceLabel,MAX_CHAT_IMAGE_BYTES} from '../src/core/chat-images.mjs';
const imageSource=id=>({id:'source-'+id,kind:'image',documentId:'manual',documentName:'manual.pdf',page:7,text:'Clock tree',image:{id,mimeType:'image/png',bytes:MAX_CHAT_IMAGE_BYTES,width:600,height:400,name:'Clock tree'}});
test('Image sources retain PDF page and external images never get fictitious page labels',()=>{
  assert.match(sourceLabel(imageSource('a')),/manual.pdf · Trang 7 · Vùng ảnh/);
  assert.equal(sourceLabel({documentId:null,image:{name:'clock.png'}}),'Ảnh: clock.png');
  assert.match(CHAT_INSTRUCTIONS,/đọc được các ảnh thực sự được đính kèm/);
});
test('Multimodal history keeps the actual earlier image attached to the cited source',()=>{
  const source=imageSource('a');
  const built=buildChatContents([{role:'user',text:'Explain this',sources:[source]},{role:'assistant',text:'Explanation [SRC:source-a]',status:'complete'}],{role:'user',text:'What does the divider do?',sources:[]});
  assert.equal(built.contents.length,3);assert.equal(built.contents[0].parts[2].imageId,'a');
  assert.match(built.contents[0].parts[1].text,/SRC:source-a/);assert.deepEqual(built.historySources,[source]);
});
test('History image budget drops whole older turns rather than partially dropping images or citations',()=>{
  const old=imageSource('old'),recent=[imageSource('a'),imageSource('b'),imageSource('c')];
  const built=buildChatContents([{role:'user',text:'old',sources:[old]},{role:'assistant',text:'old answer',status:'complete'},{role:'user',text:'recent',sources:recent},{role:'assistant',text:'recent answer',status:'complete'}],{role:'user',text:'new',sources:[imageSource('new')]});
  assert.equal(built.contents.length,3);assert.equal(built.historySources.length,3);assert.ok(!JSON.stringify(built).includes('source-old'));assert.equal(built.trimmed,true);
});
test('Incomplete answers do not enter image history',()=>{
  const built=buildChatContents([{role:'user',text:'x',sources:[imageSource('a')]},{role:'assistant',text:'partial',status:'stopped'}],{role:'user',text:'new',sources:[]});
  assert.deepEqual(built.historySources,[]);assert.equal(built.contents.length,1);
});
test('Image payload rejects unsupported MIME, invalid base64, oversized data and malformed crop rectangles',()=>{
  assert.throws(()=>imagePayload({mimeType:'image/svg+xml',data:'YWJj'}),/Ảnh/);
  assert.throws(()=>imagePayload({mimeType:'image/png',data:'not base64'}),/Ảnh/);
  assert.throws(()=>imagePayload({mimeType:'image/png',data:'A'.repeat(17*1024*1024)}),/Ảnh/);
  assert.throws(()=>imageSourceFields({page:1,rects:[{page:2,rect:[0,0,10,10]}]}),/Vùng ảnh/);
  assert.throws(()=>imageSourceFields({page:1,rects:[{page:1,rect:[0,0,Infinity,10]}]}),/Vùng ảnh/);
  assert.equal(imagePayload({mimeType:'image/png',data:'YWJj'}).mimeType,'image/png');
  assert.equal(imageSourceFields(null).page,null);
});
test('Stream request sends inline image bytes with text and keeps the API key out of its body',async()=>{
  const parts=[{text:'Explain image [SRC:source-a]'},{inlineData:{mimeType:'image/png',data:'YWJj'}}];let request;
  await streamChat({apiKey:'test-secret',settings:{model:'vision-test',autoFallback:false},contents:[{role:'user',parts}],fetchImpl:async(url,options)=>{request=JSON.parse(options.body);return new Response('data: '+JSON.stringify({candidates:[{content:{parts:[{text:'Clock [SRC:source-a]'}]},finishReason:'STOP'}]})+'\n\n');}});
  assert.deepEqual(request.contents[0].parts,parts);assert.ok(!JSON.stringify(request).includes('test-secret'));
});
