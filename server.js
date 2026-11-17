const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const publicRoot = path.join(__dirname, 'public');
const dataRoot = path.join(__dirname, 'data');
const port = Number(process.env.PORT || 3000);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.csv':'text/csv; charset=utf-8','.png':'image/png','.mp4':'video/mp4'};

http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const isDataPath = pathname.startsWith('/data/');
  const root = isDataPath ? dataRoot : publicRoot;
  const relative = isDataPath ? pathname.slice('/data/'.length) : pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) {
    response.writeHead(403); response.end('Forbidden'); return;
  }
  fs.stat(target, (error, stats) => {
    if (error || !stats.isFile()) { response.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); response.end('Not found'); return; }
    response.writeHead(200, {'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control':'no-cache'});
    fs.createReadStream(target).pipe(response);
  });
}).listen(port, '0.0.0.0', () => console.log(`FILTROX preview listening on port ${port}`));
