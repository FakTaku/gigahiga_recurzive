const http = require('http');
const url = require('url');
require('dotenv').config();

const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize AI clients
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}) : null;

const gemini = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

// Browser-reserved shortcuts to avoid
const browserReserved = {
  win: ['ctrl+w', 'ctrl+t', 'ctrl+n', 'ctrl+shift+n', 'ctrl+shift+t', 'ctrl+shift+w', 'ctrl+r', 'f5', 'ctrl+l', 'alt+left', 'alt+right', 'ctrl+tab', 'ctrl+shift+tab', 'f12', 'ctrl+shift+i', 'ctrl+shift+c', 'ctrl+shift+j', 'ctrl+u', 'ctrl+s', 'ctrl+p', 'ctrl+a', 'ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+z', 'ctrl+y', 'ctrl+f', 'ctrl+h', 'ctrl+g', 'ctrl+d', 'ctrl+shift+d', 'ctrl+shift+o', 'ctrl+shift+p', 'ctrl+shift+s', 'ctrl+shift+u'],
  mac: ['meta+w', 'meta+t', 'meta+n', 'meta+shift+n', 'meta+shift+t', 'meta+shift+w', 'meta+r', 'meta+l', 'meta+left', 'meta+right', 'meta+tab', 'meta+shift+tab', 'meta+shift+i', 'meta+shift+c', 'meta+shift+j', 'meta+u', 'meta+s', 'meta+p', 'meta+a', 'meta+c', 'meta+v', 'meta+x', 'meta+z', 'meta+shift+z', 'meta+f', 'meta+h', 'meta+g', 'meta+d', 'meta+shift+d', 'meta+shift+o', 'meta+shift+p', 'meta+shift+s', 'meta+shift+u']
};

function createLLMPrompt(websiteUrl, elements) {
  const domain = new URL(websiteUrl).hostname;
  const elementsDesc = elements.slice(0, 20).map(el => // Limit to first 20 elements
    `- ${el.tag}${el.role ? ` (${el.role})` : ''}: "${el.label || 'unlabeled'}"${el.textNearby ? ` [nearby: "${el.textNearby.slice(0, 50)}..."]` : ''}`
  ).join('\n');

  return `You are an expert at analyzing websites and suggesting intuitive keyboard shortcuts. 

WEBSITE: ${domain} (${websiteUrl})

ELEMENTS DETECTED:
${elementsDesc}

Your task: Suggest keyboard shortcuts for the most important actionable elements. Consider:

1. **Website Context**: What type of app is this? (drawing tool, email, code editor, social media, etc.)
2. **Element Purpose**: What does each element actually do?
3. **User Workflow**: What would users want quick access to?
4. **Shortcut Conventions**: Use familiar patterns (Ctrl+S for save, Ctrl+N for new, etc.)

INTENT CATEGORIES to choose from:
- nav.search, nav.home, nav.settings, nav.profile
- compose.open, message.send, draft.save  
- action.add, action.delete, action.edit, action.undo, action.redo
- tool.select, tool.draw, tool.text, tool.image, tool.zoom
- input.focus, palette.open

SHORTCUT GUIDELINES:
- Use Ctrl+ on Windows/Linux, Meta+ on Mac
- Avoid: Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+R, Ctrl+L (browser reserved)
- Prefer: Ctrl+Shift+X, Alt+X, or single letters like '/', 'h', 'g'
- For drawing tools: Use numbers 1-9, letters like 'v' (select), 't' (text)
- Max 3 suggestions per response

RESPOND with JSON only:
{
  "suggestions": [
    {
      "elementIndex": 0,
      "intent": "tool.select", 
      "keys": ["v", "1"],
      "confidence": 0.9,
      "reasoning": "Selection tool is primary tool in drawing apps"
    }
  ]
}`;
}

async function getLLMSuggestions(websiteUrl, elements) {
  const prompt = createLLMPrompt(websiteUrl, elements);
  
  // Try Gemini first (often faster and free)
  if (gemini && process.env.GEMINI_API_KEY) {
    try {
      console.log('Calling Gemini API...');
      const model = gemini.getGenerativeModel({ 
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash' 
      });
      
      const result = await model.generateContent(prompt);
      const response = result.response.text();
      
      if (response) {
        const parsed = JSON.parse(response.replace(/```json\n?|```\n?/g, ''));
        const suggestions = parsed.suggestions?.map(s => ({
          elementId: elements[s.elementIndex]?.id,
          intent: s.intent,
          keys: s.keys || [],
          confidence: s.confidence || 0.5,
          reasoning: s.reasoning,
          source: 'gemini'
        })).filter(s => s.elementId) || [];

        console.log(`Gemini generated ${suggestions.length} suggestions`);
        return suggestions;
      }
    } catch (error) {
      console.error('Gemini API error:', error.message);
    }
  }

  // Fall back to OpenAI
  if (openai && process.env.OPENAI_API_KEY) {
    try {
      console.log('Calling OpenAI API...');
      
      const completion = await openai.chat.completions.create({
        model: process.env.LLM_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: parseInt(process.env.LLM_MAX_TOKENS) || 1000,
        temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.1,
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) return null;

      const parsed = JSON.parse(response);
      const suggestions = parsed.suggestions?.map(s => ({
        elementId: elements[s.elementIndex]?.id,
        intent: s.intent,
        keys: s.keys || [],
        confidence: s.confidence || 0.5,
        reasoning: s.reasoning,
        source: 'openai'
      })).filter(s => s.elementId) || [];

      console.log(`OpenAI generated ${suggestions.length} suggestions`);
      return suggestions;
      
    } catch (error) {
      console.error('OpenAI API error:', error.message);
    }
  }

  console.log('No LLM API keys configured, falling back to heuristics');
  return null;
}

function getHeuristicSuggestions(elements) {
  return elements.map((el) => {
    const label = (el.label || '').toLowerCase();
    const role = (el.role || '').toLowerCase();
    const tag = (el.tag || '').toLowerCase();
    let intent = 'unknown';
    let keys = [];
    let confidence = 0.4;

    // Search-related intents
    if (label.includes('search') || label.includes('jump to') || role === 'searchbox') { 
      intent = 'nav.search'; 
      keys = ['/', 'Alt+S']; 
      confidence = 0.9;
    }
    // Navigation intents
    else if (label.includes('home') || label.includes('homepage')) { 
      intent = 'nav.home'; 
      keys = ['Alt+H']; 
      confidence = 0.8;
    }
    else if (label.includes('profile') || label.includes('account')) { 
      intent = 'nav.profile'; 
      keys = ['Alt+P']; 
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
      keys = ['Alt+N']; 
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
    // Common actions
    else if (label.includes('undo')) { 
      intent = 'action.undo'; 
      keys = ['Ctrl+Z', 'Meta+Z']; 
      confidence = 0.9;
    }
    else if (label.includes('redo')) { 
      intent = 'action.redo'; 
      keys = ['Ctrl+Y', 'Meta+Shift+Z']; 
      confidence = 0.9;
    }
    // Drawing tools
    else if (label.includes('selection') || label.includes('select')) { 
      intent = 'tool.select'; 
      keys = ['v', '1']; 
      confidence = 0.8;
    }
    else if (label.includes('text') && tag === 'input') { 
      intent = 'tool.text'; 
      keys = ['t', '8']; 
      confidence = 0.8;
    }
    else if (label.includes('rectangle')) { 
      intent = 'tool.draw'; 
      keys = ['r', '2']; 
      confidence = 0.8;
    }
    else if (label.includes('hand') || label.includes('pan')) { 
      intent = 'tool.pan'; 
      keys = ['h']; 
      confidence = 0.8;
    }

    return { elementId: el.id, intent, keys, confidence };
  }).filter(s => s.intent !== 'unknown');
}

function filterBrowserReservedKeys(suggestions, platform = 'win') {
  const reservedKeys = browserReserved[platform] || [];
  
  return suggestions.map(suggestion => {
    if (suggestion.keys && suggestion.keys.length > 0) {
      const safeKeys = suggestion.keys.filter(key => {
        const normalizedKey = key.toLowerCase().replace(/\s+/g, '');
        return !reservedKeys.some(reserved => 
          reserved === normalizedKey || 
          reserved === normalizedKey.replace('ctrl+', 'meta+') ||
          reserved === normalizedKey.replace('meta+', 'ctrl+')
        );
      });
      
      if (safeKeys.length > 0) {
        return { ...suggestion, keys: safeKeys };
      }
    }
    return suggestion;
  }).filter(s => s.keys && s.keys.length > 0);
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
    req.on('end', async () => {
      let payload = {};
      try { 
        payload = JSON.parse(raw || '{}'); 
      } catch (e) {
        return send(res, 400, { error: 'Invalid JSON' });
      }
      
      const { elements = [], url: websiteUrl, platform = 'win' } = payload;
      
      if (!elements.length) {
        return send(res, 200, { suggestions: [] });
      }

      console.log(`Processing ${elements.length} elements for ${websiteUrl || 'unknown site'}`);
      
      let suggestions = [];
      
      // Try LLM first
      if (openai && websiteUrl) {
        suggestions = await getLLMSuggestions(websiteUrl, elements);
      }
      
      // Fall back to heuristics if LLM failed
      if (!suggestions || suggestions.length === 0) {
        console.log('Using fallback heuristics');
        suggestions = getHeuristicSuggestions(elements);
      }
      
      // Filter out browser-reserved shortcuts
      const filteredSuggestions = filterBrowserReservedKeys(suggestions, platform);
      
      console.log(`Returning ${filteredSuggestions.length} suggestions`);
      return send(res, 200, { suggestions: filteredSuggestions });
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


