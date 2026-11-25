// Minimal static server for local testing: node tools/serve.js [port]
// Serves the project root. Use your laptop's LAN IP on the Fire to test on the tablet.
var http = require('http');
var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var port = parseInt(process.argv[2], 10) || 8080;
var types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml'
};

http.createServer(function (req, res) {
  var p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  var file = path.join(root, p);
  if (file.indexOf(root) !== 0) { res.writeHead(403); return res.end(); }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(port, function () { console.log('Scorebook on http://localhost:' + port); });
