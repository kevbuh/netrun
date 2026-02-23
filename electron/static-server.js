// static-server.js — HTTP file server, MIME types, port management
const http = require('http');
const fs = require('fs');
const path = require('path');
const favicon = require('./favicon');

const MIME_TYPES = {
  '.html': 'text/html', '.htm': 'text/html',
  '.css': 'text/css', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.pdf': 'application/pdf', '.xml': 'application/xml', '.txt': 'text/plain',
  '.map': 'application/json', '.webp': 'image/webp',
};

let _staticServer = null;

function startStaticServer(port, staticDir, dataDir) {
  const uploadsDir = path.join(dataDir, 'uploads');

  return new Promise((resolve, reject) => {
    _staticServer = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);

      // Serve favicon proxy (privacy: no domain leak to Google)
      if (urlPath === '/api/favicon') {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const domain = params.get('domain');
        if (!domain) { res.writeHead(400); res.end('Missing domain'); return; }
        favicon.serveFavicon(domain, res);
        return;
      }

      // Serve TTS audio from temp directory
      if (urlPath.startsWith('/tts-audio/')) {
        const filename = path.basename(urlPath);
        const tmpDir = require('os').tmpdir();
        const filePath = path.join(tmpDir, filename);
        if (fs.existsSync(filePath) && filePath.startsWith(tmpDir)) {
          res.writeHead(200, { 'Content-Type': 'audio/wav' });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      // Serve uploaded files
      if (urlPath.startsWith('/uploads/')) {
        const filename = path.basename(urlPath);
        const filePath = path.join(uploadsDir, filename);
        if (fs.existsSync(filePath)) {
          const ext = path.extname(filename).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      // Static file serving
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(staticDir, urlPath);

      // Security: prevent path traversal
      if (!filePath.startsWith(staticDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      } else {
        // SPA fallback — serve index.html for unknown paths
        const indexPath = path.join(staticDir, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          fs.createReadStream(indexPath).pipe(res);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      }
    });

    _staticServer.on('error', (err) => {
      reject(err);
    });

    _staticServer.listen(port, '127.0.0.1', () => {
      console.log(`Static server listening on http://127.0.0.1:${port}`);
      resolve(port);
    });
  });
}

function stopStaticServer() {
  if (_staticServer) {
    _staticServer.close();
    _staticServer = null;
  }
}

async function killProcessOnPort(port) {
  return new Promise((resolve) => {
    let cmd;
    if (process.platform === 'darwin' || process.platform === 'linux') {
      cmd = `lsof -ti:${port} | xargs kill -9 2>/dev/null || true`;
    } else {
      cmd = `FOR /F "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a 2>nul || echo.`;
    }

    const { exec } = require('child_process');
    exec(cmd, (error) => {
      if (error) {
        console.log(`No process found on port ${port} or could not kill it`);
      } else {
        console.log(`Killed process on port ${port}`);
      }
      setTimeout(resolve, 500);
    });
  });
}

module.exports = { startStaticServer, stopStaticServer, killProcessOnPort };
