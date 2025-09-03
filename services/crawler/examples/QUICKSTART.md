# 🚀 Enhanced Crawler Quick Start

Get started with the new enhanced crawler in 5 minutes!

## Quick Test

```bash
# Navigate to crawler directory
cd services/crawler

# Test enhanced crawler on GitHub
node enhanced-crawler.mjs https://github.com github-test.json --suggest

# Test unified crawler with all modes
node examples/test-unified.mjs

# Test Gmail with authentication
node examples/gmail-example.mjs --headed
```

## What's New vs Legacy Crawler

| Feature | Legacy Crawler | Enhanced Crawler |
|---------|---------------|------------------|
| **Element Detection** | Basic querySelector | Deep DOM analysis with hierarchy |
| **Interactions** | Click/focus only | Click, hover, type, drag, data-driven |
| **State Discovery** | Single page state | Multi-page/modal state exploration |
| **Context** | Basic labels | Full ARIA, data attributes, DOM paths |
| **AI Integration** | Simple element list | Rich context for better suggestions |
| **Performance** | ~5-15 seconds | ~30-180 seconds (configurable) |
| **Output Size** | ~50KB | ~500KB-2MB |

## Choosing the Right Mode

### 🏃 Use **Legacy Mode** when:
- You need fast results (CI/CD pipelines)
- Simple element extraction is sufficient
- Resource usage must be minimal
- Quick prototyping

```bash
node unified-crawler.mjs https://example.com output.json --mode legacy
```

### 🔍 Use **Enhanced Mode** when:
- You want comprehensive application analysis
- Deep interaction discovery is needed
- AI-powered suggestions are important
- You have time for thorough crawling

```bash
node enhanced-crawler.mjs https://app.example.com output.json --max-depth 3 --suggest
```

### 🎭 Use **Hybrid Mode** when:
- You want maximum coverage
- You need both approaches for comparison
- Fallback resilience is important
- You're analyzing complex applications

```bash
node unified-crawler.mjs https://complex-app.com output.json --mode hybrid --suggest
```

## Real-World Examples

### 📧 Gmail Analysis
```bash
# First time (requires login)
node examples/gmail-example.mjs --headed

# Subsequent runs (uses saved auth)
node unified-crawler.mjs https://mail.google.com gmail.json --mode enhanced --auth .auth/gmail.json --suggest
```

### 🐙 GitHub Repository Analysis
```bash
# Quick scan
node unified-crawler.mjs https://github.com/owner/repo repo.json --mode legacy

# Deep analysis with multi-page exploration
node enhanced-crawler.mjs https://github.com/owner/repo repo-deep.json --max-depth 3 --max-interactions 10 --suggest
```

### 🎨 Design Tool Analysis (Figma, Excalidraw)
```bash
# Enhanced mode is best for design tools (lots of interactive elements)
node enhanced-crawler.mjs https://excalidraw.com excalidraw.json --max-depth 2 --suggest
```

## Performance Tuning

### For Speed
```bash
# Fastest - legacy mode
node unified-crawler.mjs URL output.json --mode legacy

# Fast enhanced - limit interactions
node enhanced-crawler.mjs URL output.json --max-depth 1 --max-interactions 3
```

### For Thoroughness
```bash
# Maximum discovery
node enhanced-crawler.mjs URL output.json --max-depth 3 --max-interactions 15 --suggest

# Hybrid with fallback
node unified-crawler.mjs URL output.json --mode hybrid --max-depth 3 --suggest
```

### For CI/CD
```bash
# Headless, fast, no suggestions
node unified-crawler.mjs URL output.json --mode legacy --no-interactions --wait 1000
```

## Output Analysis

### Enhanced Snapshot Structure
```json
{
  "targetUrl": "https://example.com",
  "crawlMetadata": {
    "totalStates": 3,
    "totalElements": 150,
    "maxDepthReached": 2
  },
  "states": [
    {
      "id": "state-abc123", 
      "url": "https://example.com",
      "depth": 0,
      "elements": [
        {
          "selector": "#search-input",
          "domPath": "html > body > form > input",
          "labels": {
            "primary": "Search repositories",
            "all": [...]
          },
          "interactions": [
            {"type": "type", "target": "value"},
            {"type": "focus"}
          ],
          "boundingBox": {"x": 100, "y": 50, "width": 200, "height": 30}
        }
      ],
      "shortcuts": [...]
    }
  ],
  "stateGraph": {...}
}
```

### AI Suggestions Analysis
```json
{
  "suggestions": [
    {
      "elementId": "search_repositories",
      "intent": "nav.search", 
      "keys": ["/", "Alt+S"],
      "reasoning": "Search is primary; / is widely used.",
      "confidence": 0.9
    }
  ]
}
```

## Troubleshooting

### Common Issues

**❌ "Authentication required"**
```bash
# Use headed mode for first-time login
node enhanced-crawler.mjs URL output.json --headed --auth .auth/session.json
```

**❌ "Too many states discovered"**
```bash
# Limit depth and interactions
node enhanced-crawler.mjs URL output.json --max-depth 2 --max-interactions 5
```

**❌ "Suggester service unavailable"**
```bash
# Start suggester service
cd ../suggester && node server.js
```

**❌ "Memory usage too high"**
```bash
# Use legacy mode or limit scope
node unified-crawler.mjs URL output.json --mode legacy
# OR
node enhanced-crawler.mjs URL output.json --max-depth 1 --no-state-crawling
```

## Integration with Extension

1. **Generate suggestions:**
```bash
node enhanced-crawler.mjs https://github.com github.json --suggest
```

2. **Start services:**
```bash
cd ../suggester && node server.js  # Port 8788
cd ../config && node server.js     # Port 8787
```

3. **Install extension** and open GitHub - suggestions will be loaded automatically

4. **Use shortcuts:**
   - `Ctrl+K` (or `Cmd+K` on Mac) to open command palette
   - Browse AI-suggested shortcuts in "Suggestions" tab
   - Accept suggestions to create custom shortcuts

## Best Practices

### ✅ DO
- Start with legacy mode to test basic functionality
- Use enhanced mode for thorough analysis
- Save authentication states for repeated crawls
- Limit depth and interactions for better performance
- Use suggest flag for AI-powered shortcuts

### ❌ DON'T  
- Run enhanced mode with max depth > 3 on large sites
- Forget to start suggester service when using --suggest
- Run headed mode in CI/CD environments
- Skip authentication for sites requiring login

## Next Steps

1. **Explore examples:** Run the test scripts in `examples/`
2. **Customize crawler:** Modify interaction simulation in `enhanced-crawler.mjs`
3. **Enhance AI prompts:** Update LLM prompts in `../suggester/server.js`
4. **Build extensions:** Integrate with your browser extension using the snapshot data
5. **Add new sites:** Create site-specific crawling strategies

Happy crawling! 🕷️✨
