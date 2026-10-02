import fs from 'node:fs/promises';
import { PDFDocument,PDFName,PDFString,PDFHexString,PDFArray } from 'pdf-lib';
import { createFixture } from './fixture.mjs';

function zip(entries) {
  const files=[],directory=[];let offset=0;
  for(const [name,text] of entries) {
    const filename=Buffer.from(name),data=Buffer.from(text);let crc=0xffffffff;
    for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
    files.push(local,filename,data);directory.push(central,filename);offset+=local.length+filename.length+data.length;
  }
  const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...files,central,end]);
}
export async function attachmentFixture(filename,embeddedFilename) {
  await createFixture(filename,8);await createFixture(embeddedFilename,10);
  const workbook=zip([
    ['[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Memory Map" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Register</t></is></c><c r="B1" t="inlineStr"><is><t>Address</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>GPIOA</t></is></c><c r="B2" t="inlineStr"><is><t>0x40020000</t></is></c></row></sheetData></worksheet>']
  ]);
  const pdf=await PDFDocument.load(await fs.readFile(filename)),embedded=await fs.readFile(embeddedFilename);
  const named=[
    ['S32K_Memory_Map.xlsx',workbook,'Bản đồ thanh ghi và địa chỉ GPIOA'],
    ['nested-datasheet.pdf',embedded,'Datasheet PDF để mở thành tab'],
    ['../../S32K_Memory_Map.xlsx',workbook,'Tệp trùng tên trong một đường dẫn nhúng'],
    ['script.cmd',Buffer.from('@echo fixture\r\n'),'Tệp chỉ hỗ trợ lưu'],
    ['empty.txt',Buffer.alloc(0),'Tệp rỗng']
  ];
  for(const [name,bytes,description] of named)await pdf.attach(bytes,name,{description});
  const ready=await PDFDocument.load(await pdf.save()),ctx=ready.context;
  const names=ready.catalog.lookup(PDFName.of('Names')).lookup(PDFName.of('EmbeddedFiles')).lookup(PDFName.of('Names'));
  let pdfRef;
  for(let i=0;i<names.size();i+=2)if(names.get(i).decodeText()==='nested-datasheet.pdf')pdfRef=names.get(i+1);
  const addAnnotation=(page,ref)=>{
    const mark=ctx.register(ctx.obj({Type:'Annot',Subtype:'FileAttachment',Rect:[480,730,505,755],FS:ref,Name:'Paperclip'}));
    const annots=page.node.lookupMaybe(PDFName.of('Annots'),PDFArray) || ctx.obj([]);annots.push(mark);page.node.set(PDFName.of('Annots'),annots);
  };
  addAnnotation(ready.getPage(0),pdfRef);
  const pageBytes=Buffer.from('Write 1 to clear the interrupt flag.\n');
  const stream=ctx.register(ctx.flateStream(pageBytes,{Type:'EmbeddedFile'}));
  const pageFile=ctx.register(ctx.obj({Type:'Filespec',F:PDFString.of('Page_note.txt'),UF:PDFHexString.fromText('Page_note.txt'),EF:{F:stream},Desc:PDFHexString.fromText('Ghi chú gắn ở trang cuối')}));
  addAnnotation(ready.getPage(7),pageFile);
  await fs.writeFile(filename,await ready.save());return {workbook,embedded,pageBytes};
}
