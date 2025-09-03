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

function createLLMPrompt(websiteUrl, elements, nativeShortcuts = []) {
  const domain = new URL(websiteUrl).hostname;
  const elementsDesc = elements.slice(0, 50).map(el => // Limit to first 50 elements for better coverage
    `- ${el.tag}${el.role ? ` (${el.role})` : ''}: "${el.label || 'unlabeled'}"${el.textNearby ? ` [nearby: "${el.textNearby.slice(0, 50)}..."]` : ''}${el.accessKey ? ` [accesskey: "${el.accessKey}"]` : ''}`
  ).join('\n');

  // Format native shortcuts for the prompt
  const nativeShortcutsDesc = nativeShortcuts.length > 0 
    ? `\n\nEXISTING NATIVE SHORTCUTS (DO NOT OVERRIDE THESE):\n${nativeShortcuts.map(s => 
        `- ${s.type === 'accesskey' ? `Access key "${s.key}"` : `Event listener on ${s.source}`}`
      ).join('\n')}`
    : '\n\nEXISTING NATIVE SHORTCUTS: None detected';

     return `You are an expert UX designer specializing in keyboard shortcuts.
 Your task: Suggest intuitive, conflict-free shortcuts for a given website.
 
 ### WEBSITE CONTEXT
 URL: ${websiteUrl}
 Domain: ${domain}
 
 ### DETECTED ELEMENTS (Top 20 prioritized)
 ${elementsDesc}
 
 ### EXISTING SHORTCUTS (Do NOT override)
 ${nativeShortcutsDesc}
 
 ### CONSTRAINTS
 - Avoid browser-reserved keys: Ctrl+R, Ctrl+W, Ctrl+T, Ctrl+Tab, F5, etc.
 - Avoid OS-reserved keys: Cmd+Q, Alt+F4, etc.
 - Avoid overriding existing site shortcuts above.
 - Use common UX patterns:
     - Search → "/" (but check conflicts first)
     - New item → Ctrl+N or Alt+N
     - Save → Ctrl+S
     - Compose → Alt+N
     - Navigation → single letters (g for GitHub-style navigation)
     - For design tools: v for select, t for text
 - If a conflict exists, propose an alternative (e.g., Alt+Shift+X).
 - Max 8 most useful actions based on user workflow.
- Avoid duplicate suggestions for the same intent.
 
 ### WHAT TO RETURN
 JSON only, in this format:
{
  "suggestions": [
    {
      "elementIndex": 0,
      "intent": "nav.search",
      "keys": ["/", "Alt+S"],
      "reasoning": "Search is primary; / is widely used."
    }
  ]
}`;
}

async function getLLMSuggestions(websiteUrl, elements, nativeShortcuts = []) {
  const prompt = createLLMPrompt(websiteUrl, elements, nativeShortcuts);
  
  // Try Gemini first (often faster and free)
  if (gemini && process.env.GEMINI_API_KEY) {
    try {
      console.log('Calling Gemini API...');
      const model = gemini.getGenerativeModel({ 
        model: process.env.GEMINI_MODEL || 'gemini-2.5-pro' 
      });
      
      const result = await model.generateContent(prompt);
      const response = result.response.text();
      
      if (response) {
        const parsed = JSON.parse(response.replace(/```json\n?|```\n?/g, ''));
        const suggestions = parsed.suggestions?.map(s => ({
          elementId: elements[s.elementIndex]?.id,
          intent: s.intent,
          keys: s.keys || [],
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

function getHeuristicSuggestions(elements, nativeShortcuts = []) {
  // Extract existing keys to avoid conflicts
  const existingKeys = new Set();
  const verifiedKeys = new Set(); // Keys we've verified work natively
  
  nativeShortcuts.forEach(shortcut => {
    if (shortcut.key && shortcut.key !== 'unknown') {
      existingKeys.add(shortcut.key.toLowerCase());
      // Mark verified shortcuts separately
      if (shortcut.verified === true || shortcut.type === 'native_shortcut') {
        verifiedKeys.add(shortcut.key.toLowerCase());
      }
    }
  });
  
  // Also check accesskey attributes on elements
  elements.forEach(el => {
    if (el.accessKey) {
      existingKeys.add(el.accessKey.toLowerCase());
    }
  });

  console.log(`[suggester] Avoiding ${existingKeys.size} existing keys:`, Array.from(existingKeys));
  console.log(`[suggester] Verified native keys:`, Array.from(verifiedKeys));

  return elements.map((el) => {
    const label = (el.label || '').toLowerCase();
    const role = (el.role || '').toLowerCase();
    const tag = (el.tag || '').toLowerCase();
    let intent = 'unknown';
    let keys = [];

    
    // Search-related intents
    if (label.includes('search') || label.includes('jump to') || role === 'searchbox') { 
      intent = 'nav.search'; 
      // Check if "/" is already used natively (especially if verified)
      if (existingKeys.has('/') || verifiedKeys.has('/')) {
        // Avoid "/" if detected as native shortcut
        keys = ['Alt+S', 'Ctrl+Shift+F']; 
        console.log(`[suggester] AVOIDING native "/" key for search element: ${label}`);
      } else {
        keys = ['/', 'Alt+S']; 
        console.log(`[suggester] Using "/" key for search element: ${label} (no conflict detected)`);
      }
    }
    // Navigation intents
    else if (label.includes('home') || label.includes('homepage')) { 
      intent = 'nav.home'; 
      if (existingKeys.has('h')) {
        keys = ['Alt+H', 'Ctrl+Shift+H']; 
      } else {
        keys = ['Alt+H', 'h']; 
      }
    }
    else if (label.includes('profile') || label.includes('account')) { 
      intent = 'nav.profile'; 
      if (existingKeys.has('p')) {
        keys = ['Alt+P', 'Ctrl+Shift+P']; 
      } else {
        keys = ['Alt+P', 'p']; 
      }
    }
    else if (label.includes('settings') || label.includes('preferences')) { 
      intent = 'nav.settings'; 
      keys = ['Ctrl+,', 'Meta+,']; 
    }
    // Action intents
    else if (label.includes('compose') || label.includes('new') || label.includes('create')) { 
      intent = 'compose.open'; 
      if (existingKeys.has('n')) {
        keys = ['Alt+N', 'Ctrl+Shift+N']; 
      } else {
        keys = ['Alt+N', 'n']; 
      }
    }
    else if (label.includes('send') || label.includes('submit')) { 
      intent = 'message.send'; 
      keys = ['Ctrl+Enter', 'Meta+Enter']; 
    }
    else if (label.includes('save') || label.includes('store')) { 
      intent = 'draft.save'; 
      keys = ['Ctrl+S', 'Meta+S']; 
    }
    // Common actions
    else if (label.includes('undo')) { 
      intent = 'action.undo'; 
      keys = ['Ctrl+Z', 'Meta+Z']; 
    }
    else if (label.includes('redo')) { 
      intent = 'action.redo'; 
      keys = ['Ctrl+Y', 'Meta+Shift+Z']; 
    }
    // Drawing tools
    else if (label.includes('selection') || label.includes('select')) { 
      intent = 'tool.select'; 
      if (existingKeys.has('v')) {
        keys = ['1', 'Ctrl+Shift+V']; 
      } else {
        keys = ['v', '1']; 
      }
    }
    else if (label.includes('text') && tag === 'input') { 
      intent = 'tool.text'; 
      if (existingKeys.has('t')) {
        keys = ['8', 'Ctrl+Shift+T']; 
      } else {
        keys = ['t', '8']; 
      }
    }
    else if (label.includes('rectangle')) { 
      intent = 'tool.draw'; 
      if (existingKeys.has('r')) {
        keys = ['2', 'Ctrl+Shift+R']; 
      } else {
        keys = ['r', '2']; 
      }
    }
    else if (label.includes('hand') || label.includes('pan')) { 
      intent = 'tool.pan'; 
      if (existingKeys.has('h')) {
        keys = ['Ctrl+Shift+H', '9']; 
      } else {
        keys = ['h']; 
      }
    }

    return { elementId: el.id, intent, keys };
  }).filter(s => s.intent !== 'unknown');
}

function filterBrowserReservedKeys(suggestions, platform = 'win', nativeShortcuts = []) {
  const reservedKeys = browserReserved[platform] || [];
  
  // Also add native shortcuts to the reserved list
  const nativeKeys = nativeShortcuts
    .filter(s => s.key && s.key !== 'unknown')
    .map(s => s.key.toLowerCase());
  
  const allReservedKeys = [...reservedKeys, ...nativeKeys];
  
  return suggestions.map(suggestion => {
    if (suggestion.keys && suggestion.keys.length > 0) {
      const safeKeys = suggestion.keys.filter(key => {
        const normalizedKey = key.toLowerCase().replace(/\s+/g, '');
        return !allReservedKeys.some(reserved => 
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
      
      const { elements = [], url: websiteUrl, platform = 'win', nativeShortcuts = [] } = payload;
      
      if (!elements.length) {
        return send(res, 200, { suggestions: [] });
      }

      console.log(`Processing ${elements.length} elements for ${websiteUrl || 'unknown site'}`);
      console.log(`Found ${nativeShortcuts.length} native shortcuts to respect`);
      
      let suggestions = [];
      
      // Try LLM first
      if ((openai || gemini) && websiteUrl) {
        suggestions = await getLLMSuggestions(websiteUrl, elements, nativeShortcuts);
      }
      
      // Fall back to heuristics if LLM failed
      if (!suggestions || suggestions.length === 0) {
        console.log('Using fallback heuristics');
        suggestions = getHeuristicSuggestions(elements, nativeShortcuts);
      }
      
      // Filter out browser-reserved shortcuts AND native shortcuts
      const filteredSuggestions = filterBrowserReservedKeys(suggestions, platform, nativeShortcuts);
      
      // Deduplicate suggestions by intent and element
      const deduplicatedSuggestions = filteredSuggestions.reduce((acc, current) => {
        const existing = acc.find(s => s.intent === current.intent && s.elementId === current.elementId);
        if (!existing) {
          acc.push(current);
        } else if (current.confidence && (!existing.confidence || current.confidence > existing.confidence)) {
          // Replace with higher confidence suggestion
          const index = acc.indexOf(existing);
          acc[index] = current;
        }
        return acc;
      }, []);
      
      console.log(`Returning ${deduplicatedSuggestions.length} suggestions (${filteredSuggestions.length - deduplicatedSuggestions.length} duplicates removed)`);
      return send(res, 200, { suggestions: deduplicatedSuggestions });
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


