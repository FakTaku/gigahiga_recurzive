const http = require('http');
const url = require('url');

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }
  const parsed = url.parse(req.url, true);
  const parts = (parsed.pathname || '/').split('/').filter(Boolean);
  if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'suggest') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(raw || '{}'); } catch (_) {}
      const { appCategory = 'generic', elements = [], reserved = {} } = payload;
      // Simple heuristic stub: map labels to intents and common keys
      const suggestions = elements.map((el) => {
        const label = (el.label || '').toLowerCase();
        let intent = 'unknown';
        let keys = [];
        if (label.includes('search')) { intent = 'nav.search'; keys = ['/', 'Ctrl+K']; }
        else if (label.includes('compose') || label.includes('new')) { intent = 'compose.open'; keys = ['Ctrl+N']; }
        else if (label.includes('send')) { intent = 'message.send'; keys = ['Ctrl+Enter', 'Meta+Enter']; }
        return { elementId: el.id, intent, keys, confidence: intent === 'unknown' ? 0.4 : 0.8 };
      });
      return send(res, 200, { suggestions });
    });
    return;
  }
  res.writeHead(404);
  res.end('Not Found');
});

const port = process.env.SUGGESTER_PORT || 8788;
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Suggester service listening on http://localhost:${port}`);
});


