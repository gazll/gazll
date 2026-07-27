// Minimal static server so the page runs on http://localhost (a secure context,
// which the Clipboard API requires). Usage: node serve.js [port]
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 8081;
// Serve the deployed copy directly, so local testing and GitHub Pages always
// run the exact same file and cannot drift apart.
const ROOT = path.join(__dirname, '..', 'public', 'fshare-tool');
const TYPES = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
               '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8'};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[\\/])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream'});
    res.end(buf);
  });
}).listen(PORT, () => console.log('http://localhost:' + PORT));
