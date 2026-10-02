// Give the existing artwork the full Windows icon area without redrawing it.
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const input = nativeImage.createFromPath(path.join(project, 'public/app-icon.png'));
if (input.isEmpty()) throw new Error('Không đọc được ảnh biểu tượng.');
const { width, height } = input.getSize();
const bitmap = input.toBitmap(), columns = new Uint32Array(width), rows = new Uint32Array(height);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  if (bitmap[(y * width + x) * 4 + 3] >= 128) { columns[x]++; rows[y]++; }
}
// Ignore isolated transparent speckles when finding the visual bounds.
const firstX = columns.findIndex(count => count >= Math.max(2, height * 0.008));
const firstY = rows.findIndex(count => count >= Math.max(2, width * 0.008));
const lastX = columns.findLastIndex(count => count >= Math.max(2, height * 0.008));
const lastY = rows.findLastIndex(count => count >= Math.max(2, width * 0.008));
if (firstX < 0 || firstY < 0) throw new Error('Không xác định được hình logo.');
const contentSize = Math.max(lastX - firstX + 1, lastY - firstY + 1);
const side = Math.min(width, height, Math.ceil(contentSize * 1.035));
const crop = { x: Math.max(0, Math.min(width - side, Math.round((firstX + lastX + 1 - side) / 2))),
  y: Math.max(0, Math.min(height - side, Math.round((firstY + lastY + 1 - side) / 2))), width: side, height: side };
const taskbarImage = input.crop(crop);
fs.writeFileSync(path.join(project, 'public/app-taskbar.png'), taskbarImage.toPNG());
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(size => taskbarImage.resize({ width: size, height: size, quality: 'best' }).toPNG());
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((data, index) => {
  const entry = 6 + index * 16, size = sizes[index];
  header[entry] = size === 256 ? 0 : size; header[entry + 1] = header[entry];
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(data.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += data.length;
});
fs.mkdirSync(path.join(project, 'build'), { recursive: true });
fs.writeFileSync(path.join(project, 'build/app-icon.ico'), Buffer.concat([header, ...images]));
console.log(JSON.stringify({ crop, enlargement: Number((width / side).toFixed(2)), sizes }));
app.exit(0);
