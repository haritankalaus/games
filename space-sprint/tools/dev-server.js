// Local dev server: serves the game and lets ?covers mode save PNGs into store-assets/.
// Usage: node tools/dev-server.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.argv[2]) || 8123;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.json': 'application/json', '.md': 'text/plain; charset=utf-8', '.zip': 'application/zip',
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/__save') {
    const name = path.basename(url.searchParams.get('name') || '');
    if (!/^[\w.-]+\.png$/.test(name)) { res.writeHead(400); res.end('bad name'); return; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const dir = path.join(root, 'store-assets');
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
        console.log(`saved store-assets/${name}`);
        res.end('ok');
      } catch (err) {
        // e.g. the file is open in another program on Windows
        console.error(`could not save store-assets/${name}: ${err.message}`);
        res.writeHead(500);
        res.end('save failed');
      }
    });
    return;
  }

  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`Game running at http://localhost:${port}`));
