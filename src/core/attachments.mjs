const OPENABLE = new Set(['pdf','xlsx','xls','xlsm','xlsb','ods','csv','doc','docx','odt','rtf','ppt','pptx','odp','txt','md','json','xml','log','png','jpg','jpeg','gif','bmp','webp','tif','tiff','zip','7z']);
export function attachmentName(value) {
  let name = String(value || '').split(/[\\/]/).at(-1).normalize('NFC').replace(/[<>:"|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/g, '').trim();
  if (!name || name === '.' || name === '..') name = 'tep-dinh-kem';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  if (name.length > 180) { const dot=name.lastIndexOf('.'), ext=dot>0 && name.length-dot<=20 ? name.slice(dot) : ''; name=name.slice(0,180-ext.length)+ext; }
  return name;
}
export function attachmentType(name) { return attachmentName(name).split('.').at(-1).toLowerCase(); }
export function canOpenAttachment(name) { return OPENABLE.has(attachmentType(name)); }
export function attachmentLabel(name) {
  const type=attachmentType(name);
  if (['xlsx','xls','xlsm','xlsb','ods','csv'].includes(type)) return 'Excel / bảng tính';
  if (type==='pdf') return 'PDF';
  if (['doc','docx','odt','rtf'].includes(type)) return 'Văn bản';
  return type.length<12 ? type.toUpperCase() : 'Tệp';
}
