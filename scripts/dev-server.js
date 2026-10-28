import http from 'node:http';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
const port = Number(process.env.DRIFTCUE_TEST_PORT || 4173);
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'POST' && pathname === '/results') {
    // Only the disposable fixture's non-sensitive card metrics are accepted.
    let data = ''; for await (const part of req) { data += part; if (data.length > 100000) { res.writeHead(413).end(); return; } }
    try { JSON.parse(data); await mkdir('artifacts', { recursive: true }); await appendFile('artifacts/browser-events.jsonl', `${data}\n`); res.writeHead(204).end(); }
    catch { res.writeHead(400).end(); } return;
  }
  const routes = { '/': ['tests/fixtures/page.html','text/html; charset=utf-8'], '/fixture.js':['tests/fixtures/fixture.js','text/javascript; charset=utf-8'] };
  const uiFiles = new Set(['options.html','popup.html','ui.css','ui.js','core.js','options.js','popup.js']);
  if(pathname==='/ui/bridge.js') routes[pathname]=['tests/fixtures/ui-bridge.js','text/javascript; charset=utf-8'];
  if(pathname.startsWith('/ui/')&&uiFiles.has(pathname.slice(4))) {
    const file=pathname.slice(4),type=file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript; charset=utf-8';
    if(file.endsWith('.html')) {
      const text=await readFile(`extension/${file}`,'utf8');
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(text.replace('<script type="module"', '<script type="module" src="/ui/bridge.js"></script><script type="module"'));return;
    }
    routes[pathname]=[`extension/${file}`,type];
  }
  if (!routes[pathname]) { res.writeHead(404).end('Not found'); return; }
  try { const [file,type]=routes[pathname];res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(await readFile(file)); } catch { res.writeHead(500).end(); }
});
server.on('error', e => { console.error(e.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`本地验收页：http://localhost:${port} 和 http://127.0.0.1:${port}（Ctrl+C 停止；仅在本机监听）`));
