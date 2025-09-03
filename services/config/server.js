const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const artifactsDir = path.join(__dirname, 'artifacts');

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function loadArtifact(appId) {
  const safeName = appId.replace(/[^a-zA-Z0-9._-]/g, '');
  const filePath = path.join(artifactsDir, `${safeName}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const parts = (parsed.pathname || '/').split('/').filter(Boolean);

  // GET /v1/config/:appId/:version or /v1/config/:appId/latest
  if (req.method === 'GET' && parts[0] === 'v1' && parts[1] === 'config' && parts[2]) {
    const appId = decodeURIComponent(parts[2]);
    const artifact = loadArtifact(appId);
    if (!artifact) return sendJson(res, 404, { error: 'artifact_not_found' });
    return sendJson(res, 200, artifact);
  }

  if (req.method === 'GET' && parts[0] === 'healthz') {
    res.writeHead(204);
    return res.end();
  }

  res.writeHead(404);
  res.end('Not Found');
});

const port = process.env.PORT || 8787;
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Config service listening on http://localhost:${port}`);
});


