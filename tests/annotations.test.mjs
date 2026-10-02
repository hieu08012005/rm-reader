import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnnotation, selectionRects, subtractRect, cutPath, eraseAnnotations } from '../src/core/annotations.mjs';
const document = { id: 'doc-a', name: 'manual.pdf', path: 'E:/manual.pdf' };
const input = { text: 'Write one to clear.', color: 'yellow', note: 'Ghi 1 để xóa.', position: { documentId: 'doc-a', page: 3, top: 20, left: 0, scale: 1.5 }, rects: [{ page: 3, rect: [50, 700, 200, 680] }] };
test('annotation validates text, source and stable PDF coordinates', () => {
  const entry = validateAnnotation(input, { document });
  assert.equal(entry.documentId, document.id); assert.equal(entry.note, input.note);
  assert.deepEqual(entry.rects, input.rects); assert.notEqual(entry.rects[0].rect, input.rects[0].rect);
});
test('editing a note preserves its source and rectangles', () => {
  const existing = { ...validateAnnotation(input, { document }), id: 'mark-1' };
  const edited = validateAnnotation({ color: 'pink', note: 'Ghi 1, không phải ghi 0.', rects: [] }, { existing });
  assert.equal(edited.id, existing.id); assert.equal(edited.color, 'pink'); assert.deepEqual(edited.rects, existing.rects);
  assert.equal(edited.documentId, document.id);
});
test('invalid colors, coordinates and document ownership are rejected', () => {
  for (const bad of [{ ...input, color: 'red' }, { ...input, rects: [] }, { ...input, rects: [{ page: 3, rect: [NaN, 0, 10, 10] }] }, { ...input, position: { ...input.position, documentId: 'wrong-doc' } }]) assert.throws(() => validateAnnotation(bad, { document }));
});
test('selection converts clipped rectangles to PDF coordinates and removes duplicates', () => {
  const box = { left: 120, top: 240, right: 220, bottom: 270, width: 100, height: 30 };
  const page = { dataset: { pageNumber: '3' }, getBoundingClientRect: () => ({ left: 100, top: 200, right: 900, bottom: 1200 }) };
  const viewer = { viewer: { querySelectorAll: () => [page] }, getPageView: () => ({ viewport: { convertToPdfPoint: (x, y) => [x / 2, 842 - y / 2] } }) };
  assert.deepEqual(selectionRects({ getClientRects: () => [box, box] }, viewer), [{ page: 3, rect: [10, 822, 60, 807] }]);
});

test('square eraser removes only the intersecting part of a highlight', () => {
  const pieces=subtractRect([0,10,100,0],[40,-5,60,15]);
  assert.deepEqual(pieces,[[0,0,40,10],[60,0,100,10]]);
  assert.equal(pieces.reduce((sum,r)=>sum+(r[2]-r[0])*(r[3]-r[1]),0),800);
  assert.deepEqual(subtractRect([0,0,10,10],[20,20,30,30]),[[0,0,10,10]]);
});
test('eraser splits a sparse long pen segment without joining across the removed region', () => {
  assert.deepEqual(cutPath([[0,0],[100,0]],[40,-5,60,5],2),[[[0,0],[39,0]],[[61,0],[100,0]]]);
  assert.deepEqual(cutPath([[45,0],[55,0]],[40,-5,60,5]),[]);
  assert.deepEqual(cutPath([[0,10],[100,10]],[40,-5,60,5]),[[[0,10],[100,10]]]);
});
test('eraser leaves other documents, pages, notes and text boxes intact', () => {
  const source=validateAnnotation(input,{document});
  const other={...source,documentId:'doc-b'}, box={...source,kind:'textbox'};
  const result=eraseAnnotations([source,other,box],{documentId:document.id,page:3,rects:[[100,670,120,710]]});
  assert.equal(result.length,3);assert.equal(result[0].note,input.note);assert.equal(result[0].rects.length,2);assert.equal(result[1],other);assert.equal(result[2],box);
  assert.deepEqual(source.rects,input.rects);
});
test('erasing a whole mark deletes it and validates eraser coordinates', () => {
  const source=validateAnnotation(input,{document});
  assert.deepEqual(eraseAnnotations([source],{documentId:document.id,page:3,rects:[[0,0,1000,1000]]}),[]);
  assert.throws(()=>eraseAnnotations([source],{documentId:document.id,page:3,rects:[[NaN,0,1,2]]}));
});
test('pen strokes validate color, width and finite points while retaining source ownership', () => {
  const ink={...input,kind:'ink',color:'#ff0000',width:4,paths:[[[50,700],[150,700]]]};
  const saved=validateAnnotation(ink,{document});assert.deepEqual(saved.paths,ink.paths);assert.notEqual(saved.paths,ink.paths);
  for(const change of [{width:0},{paths:[[[NaN,0],[1,2]]]},{color:'red'},{kind:'invalid'}])assert.throws(()=>validateAnnotation({...ink,...change},{document}));
  const edited=validateAnnotation({...saved,color:'#0000ff',note:'Bút xanh',documentId:'doc-b'},{existing:saved});assert.equal(edited.documentId,document.id);
});
test('text boxes preserve newlines and resize with validated PDF coordinates', () => {
  const saved=validateAnnotation({...input,kind:'textbox',text:'Ghi 1\nđể xóa',color:'#102030',fontSize:16},{document});
  const rects=[{page:3,rect:[50,700,300,600]}];
  const edited=validateAnnotation({...saved,text:'Ghi 1\nKhông ghi 0',rects},{existing:saved});assert.deepEqual(edited.rects,rects);assert.equal(edited.text,'Ghi 1\nKhông ghi 0');
  assert.throws(()=>validateAnnotation({...saved,text:''},{existing:saved}));
});
