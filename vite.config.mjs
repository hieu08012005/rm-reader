import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const assetDirs = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const item of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, item.name), to = path.join(destination, item.name);
    if (item.isDirectory()) copyDirectory(from, to);
    else fs.copyFileSync(from, to);
  }
}
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  plugins: [{
    name: 'pdf-resources',
    configureServer(server) {
      server.middlewares.use('/pdf-assets', (req, res, next) => {
        const root = path.resolve('node_modules/pdfjs-dist');
        const assetPath=decodeURIComponent(req.url.split('?')[0]);
        const file = path.resolve(root, (assetPath.startsWith('/images/') ? './web' : '.') + assetPath);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      for (const dir of assetDirs) {
        const source = path.resolve('node_modules/pdfjs-dist', dir);
        if (fs.existsSync(source)) copyDirectory(source, path.resolve('dist/pdf-assets', dir));
      }
      copyDirectory(path.resolve('node_modules/pdfjs-dist/web/images'),path.resolve('dist/pdf-assets/images'));
    }
  }]
});
