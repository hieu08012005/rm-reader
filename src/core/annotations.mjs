export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'];

export function viewportRect(viewport, rect) {
  return [...viewport.convertToViewportPoint(rect[0], rect[1]), ...viewport.convertToViewportPoint(rect[2], rect[3])];
}

export function validateAnnotation(input, { document, existing } = {}) {
  const kind = existing?.kind || input?.kind || 'highlight';
  if (kind !== 'highlight') return validateGraphic(input, { document, existing, kind });
  const note = typeof input?.note === 'string' ? input.note.trim() : '';
  if (note.length > 8000) throw new Error('Ghi chú tối đa 8.000 ký tự.');
  if (!HIGHLIGHT_COLORS.includes(input?.color)) throw new Error('Màu đánh dấu không hợp lệ.');
  if (existing) return { ...existing, color: input.color, note };
  const text = typeof input?.text === 'string' ? input.text.trim() : '';
  const position = input?.position;
  const rects = input?.rects;
  if (!document || !text || text.length > 12000 || !position || position.documentId !== document.id || !Number.isInteger(position.page) || position.page < 1 || ![position.top, position.left, position.scale].every(Number.isFinite) || position.scale <= 0) throw new Error('Hãy bôi đen đoạn văn trong PDF để đánh dấu.');
  if (!Array.isArray(rects) || !rects.length || rects.length > 2000 || rects.some(item => !Number.isInteger(item.page) || item.page < 1 || !Array.isArray(item.rect) || item.rect.length !== 4 || !item.rect.every(value => Number.isFinite(value) && Math.abs(value) < 1000000) || item.rect[0] === item.rect[2] || item.rect[1] === item.rect[3])) throw new Error('Không xác định được vị trí đoạn văn. Hãy chọn lại đoạn cần đánh dấu.');
  return { text, note, color: input.color, documentId: document.id, documentName: document.name, path: document.path,
    position: { documentId: document.id, page: position.page, top: position.top, left: position.left, scale: position.scale },
    rects: rects.map(item => ({ page: item.page, rect: [...item.rect] })) };
}

const finite = value => Number.isFinite(value) && Math.abs(value) < 1000000;
const validRect = rect => Array.isArray(rect) && rect.length === 4 && rect.every(finite) && rect[0] !== rect[2] && rect[1] !== rect[3];
export function validateGraphic(input, { document, existing, kind }) {
  if (!['ink', 'textbox'].includes(kind)) throw new Error('Loại ghi chú không hợp lệ.');
  const data = { ...existing, ...input }, position = existing?.position || input.position;
  document ||= existing && { id: existing.documentId, name: existing.documentName, path: existing.path };
  if (!document || !position || position.documentId !== document.id || !Number.isInteger(position.page) || position.page < 1 || ![position.top, position.left, position.scale].every(finite) || position.scale <= 0) throw new Error('Hãy chọn vị trí trên PDF.');
  if (!/^#[0-9a-f]{6}$/i.test(data.color)) throw new Error('Màu bút không hợp lệ.');
  const note = typeof data.note === 'string' ? data.note.trim() : '';
  if (note.length > 8000) throw new Error('Ghi chú tối đa 8.000 ký tự.');
  const rects = data.rects;
  if (!Array.isArray(rects) || rects.length !== 1 || !Number.isInteger(rects[0].page) || rects[0].page < 1 || !validRect(rects[0].rect)) throw new Error('Vị trí ghi chú không hợp lệ.');
  const base = { ...existing, kind, color: data.color, note, documentId: document.id, documentName: document.name, path: document.path,
    position: { documentId: document.id, page: position.page, top: position.top, left: position.left, scale: position.scale }, rects: structuredClone(rects) };
  if (kind === 'textbox') {
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (!text || text.length > 8000 || !Number.isFinite(data.fontSize) || data.fontSize < 8 || data.fontSize > 48) throw new Error('Hộp văn bản cần nội dung (tối đa 8.000 ký tự) và cỡ chữ 8–48.');
    return { ...base, text, fontSize: data.fontSize };
  }
  if (!Number.isFinite(data.width) || data.width < 0.5 || data.width > 24 || !Array.isArray(data.paths) || !data.paths.length || data.paths.length > 5000 || data.paths.reduce((sum, points) => sum + (Array.isArray(points) ? points.length : 100001), 0) > 100000 || data.paths.some(points => !Array.isArray(points) || points.length < 2 || points.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(finite)))) throw new Error('Nét vẽ không hợp lệ hoặc quá dài.');
  return { ...base, text: 'Nét vẽ', width: data.width, paths: structuredClone(data.paths) };
}

const bounds = rect => [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
export function subtractRect(rect, brush) {
  const [x1, y1, x2, y2] = bounds(rect), [a, b, c, d] = bounds(brush);
  const l = Math.max(x1, a), t = Math.max(y1, b), r = Math.min(x2, c), z = Math.min(y2, d);
  if (l >= r || t >= z) return [rect];
  return [[x1,y1,x2,t], [x1,z,x2,y2], [x1,t,l,z], [r,t,x2,z]].filter(box => box[2] - box[0] > 0.05 && box[3] - box[1] > 0.05);
}

// Clip each line segment against a square eraser, preserving both outside fragments.
export function cutPath(points, brush, width = 0) {
  const [x1,y1,x2,y2] = bounds(brush), margin = width / 2;
  const box = [x1-margin,y1-margin,x2+margin,y2+margin];
  const result = []; let path = [];
  const append = (a,b) => {
    const last = path.at(-1);
    if (last && Math.hypot(last[0]-a[0], last[1]-a[1]) > 0.0001) { if (path.length > 1) result.push(path); path = []; }
    if (!path.length) path.push(a); path.push(b);
  };
  for (let i=1; i<points.length; i++) {
    const a=points[i-1], b=points[i], dx=b[0]-a[0], dy=b[1]-a[1]; let lo=0, hi=1, hit=true;
    for (const [p,q] of [[-dx,a[0]-box[0]], [dx,box[2]-a[0]], [-dy,a[1]-box[1]], [dy,box[3]-a[1]]]) {
      if (!p) { if (q < 0) hit=false; }
      else { const t=q/p; if (p<0) lo=Math.max(lo,t); else hi=Math.min(hi,t); }
    }
    hit &&= lo<=hi;
    if (!hit) { append(a,b); continue; }
    const at = t => [a[0]+dx*t, a[1]+dy*t];
    if (lo > 0) append(a,at(lo));
    if (path.length > 1) result.push(path); path=[];
    if (hi < 1) append(at(hi),b);
  }
  if (path.length > 1) result.push(path);
  return result;
}

export function eraseAnnotations(entries, { documentId, page, rects }) {
  if (typeof documentId !== 'string' || !Number.isInteger(page) || page < 1 || !Array.isArray(rects) || !rects.length || rects.length > 10000 || rects.some(rect => !validRect(rect))) throw new Error('Vùng tẩy không hợp lệ.');
  return entries.flatMap(entry => {
    if (entry.documentId !== documentId || !entry.rects.some(item => item.page === page) || entry.kind === 'textbox') return [entry];
    let paths = entry.paths, marks = entry.rects;
    if (entry.kind === 'ink') {
      for (const brush of rects) paths = paths.flatMap(path => cutPath(path, brush, entry.width));
      if (!paths.length) return [];
      const box=paths.flat().reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
      marks=[{ page, rect:[box[0]-entry.width/2,box[1]-entry.width/2,box[2]+entry.width/2,box[3]+entry.width/2] }];
    } else {
      for (const brush of rects) marks=marks.flatMap(item => item.page === page ? subtractRect(item.rect,brush).map(rect => ({page,rect})) : [item]);
      if (!marks.length) return [];
    }
    return [{ ...entry, ...(paths ? {paths} : {}), rects:marks, position:{...entry.position,page:marks[0].page} }];
  });
}

// Store PDF coordinates, rather than screen pixels, so zoom/rotation cannot move a mark.
export function selectionRects(range, viewer) {
  const rects = [], seen = new Set();
  const pages = [...viewer.viewer.querySelectorAll('.page')];
  for (const box of range.getClientRects()) {
    if (box.width < 1 || box.height < 1) continue;
    for (const page of pages) {
      const bounds = page.getBoundingClientRect();
      const left = Math.max(box.left, bounds.left), top = Math.max(box.top, bounds.top);
      const right = Math.min(box.right, bounds.right), bottom = Math.min(box.bottom, bounds.bottom);
      if (right - left < 1 || bottom - top < 1) continue;
      const number = Number(page.dataset.pageNumber), viewport = viewer.getPageView(number - 1)?.viewport;
      if (!viewport) continue;
      const rect = [...viewport.convertToPdfPoint(left - bounds.left, top - bounds.top), ...viewport.convertToPdfPoint(right - bounds.left, bottom - bounds.top)];
      const key = number + ':' + rect.map(value => value.toFixed(2)).join(',');
      if (!seen.has(key)) { seen.add(key); rects.push({ page: number, rect }); }
    }
  }
  return rects.slice(0, 2000);
}
