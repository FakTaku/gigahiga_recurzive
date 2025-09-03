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
      // Enhanced heuristic mapping: map labels to intents and common keys
      const suggestions = elements.map((el) => {
        const label = (el.label || '').toLowerCase();
        const role = (el.role || '').toLowerCase();
        const tag = (el.tag || '').toLowerCase();
        let intent = 'unknown';
        let keys = [];
        let confidence = 0.4;

        // Search-related intents
        if (label.includes('search') || label.includes('jump to') || role === 'searchbox') { 
          intent = 'nav.search'; 
          keys = ['/', 'Ctrl+K']; 
          confidence = 0.9;
        }
        // Navigation intents
        else if (label.includes('home') || label.includes('homepage')) { 
          intent = 'nav.home'; 
          keys = ['Ctrl+H', 'Meta+H']; 
          confidence = 0.8;
        }
        else if (label.includes('profile') || label.includes('account')) { 
          intent = 'nav.profile'; 
          keys = ['Ctrl+P', 'Meta+P']; 
          confidence = 0.8;
        }
        else if (label.includes('settings') || label.includes('preferences')) { 
          intent = 'nav.settings'; 
          keys = ['Ctrl+,', 'Meta+,']; 
          confidence = 0.8;
        }
        // Action intents
        else if (label.includes('compose') || label.includes('new') || label.includes('create')) { 
          intent = 'compose.open'; 
          keys = ['Ctrl+N', 'Meta+N']; 
          confidence = 0.8;
        }
        else if (label.includes('send') || label.includes('submit')) { 
          intent = 'message.send'; 
          keys = ['Ctrl+Enter', 'Meta+Enter']; 
          confidence = 0.8;
        }
        else if (label.includes('save') || label.includes('store')) { 
          intent = 'draft.save'; 
          keys = ['Ctrl+S', 'Meta+S']; 
          confidence = 0.8;
        }
        // GitHub-specific intents
        else if (label.includes('repository') || label.includes('repo')) { 
          intent = 'nav.repository'; 
          keys = ['Ctrl+R', 'Meta+R']; 
          confidence = 0.7;
        }
        else if (label.includes('issue') || label.includes('bug')) { 
          intent = 'nav.issues'; 
          keys = ['Ctrl+I', 'Meta+I']; 
          confidence = 0.7;
        }
        else if (label.includes('pull request') || label.includes('pr')) { 
          intent = 'nav.pull_requests'; 
          keys = ['Ctrl+Shift+P', 'Meta+Shift+P']; 
          confidence = 0.7;
        }
        else if (label.includes('code') || label.includes('source')) { 
          intent = 'nav.code'; 
          keys = ['Ctrl+Shift+C', 'Meta+Shift+C']; 
          confidence = 0.7;
        }
        // Common UI patterns
        else if (role === 'button' && (label.includes('add') || label.includes('plus'))) { 
          intent = 'action.add'; 
          keys = ['Ctrl+Plus', 'Meta+Plus']; 
          confidence = 0.6;
        }
        else if (role === 'button' && (label.includes('delete') || label.includes('remove'))) { 
          intent = 'action.delete'; 
          keys = ['Delete', 'Backspace']; 
          confidence = 0.6;
        }
        else if (role === 'button' && (label.includes('edit') || label.includes('modify'))) { 
          intent = 'action.edit'; 
          keys = ['Ctrl+E', 'Meta+E']; 
          confidence = 0.6;
        }
        // Form elements
        else if (tag === 'input' && role === 'textbox') { 
          intent = 'input.focus'; 
          keys = ['Tab', 'Enter']; 
          confidence = 0.5;
        }
        else if (tag === 'textarea') { 
          intent = 'input.focus'; 
          keys = ['Tab', 'Enter']; 
          confidence = 0.5;
        }

        return { elementId: el.id, intent, keys, confidence };
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


