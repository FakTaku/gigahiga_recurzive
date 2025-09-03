# Enhanced Web Crawler

A powerful, multi-mode web crawler built with Playwright that can perform deep crawling with state discovery and user interaction simulation.

## Features

### 🚀 **Three Crawling Modes**

1. **Enhanced Mode** (Default) - Deep crawling with state discovery
2. **Legacy Mode** - Simple, fast crawling for basic element extraction  
3. **Hybrid Mode** - Combines both approaches for comprehensive results

### 🎯 **Key Capabilities**

- **Deep Crawl**: Simulates user interactions (click, hover, scroll)
- **State Discovery**: Explores multiple page states and UI transitions
- **Event Mapping**: Captures interactive elements and their capabilities
- **Context Awareness**: Extracts DOM hierarchy, ARIA attributes, and data attributes
- **Multi-page Support**: Follows navigation to discover subpages and modals
- **Enhanced Shortcuts**: Detects native keyboard shortcuts and access keys
- **AI Integration**: Sends rich snapshots to suggester service for intelligent shortcut recommendations

## Quick Start

### Basic Usage

```bash
# Enhanced crawling (default)
node enhanced-crawler.mjs https://github.com output.json --suggest

# Unified crawler with mode selection
node unified-crawler.mjs https://mail.google.com gmail.json --mode enhanced --suggest

# Legacy crawler (fast, simple)
node unified-crawler.mjs https://example.com example.json --mode legacy
```

### With Authentication

```bash
# Gmail with authentication
node unified-crawler.mjs https://mail.google.com gmail.json --headed --auth .auth/gmail.json --suggest

# GitHub with session
node enhanced-crawler.mjs https://github.com github.json --auth .auth/github.json --max-depth 3
```

## Command Line Options

### Universal Options
- `--mode <legacy|enhanced|hybrid>` - Crawling mode (unified-crawler only)
- `--headed` - Run browser in headed mode (visible)
- `--chrome` - Use Chrome instead of Chromium
- `--auth <path>` - Path to save/load authentication state
- `--wait <ms>` - Wait time after page load (default: 2500ms)
- `--suggest` - Send results to suggester service for AI recommendations

### Enhanced/Hybrid Mode Options
- `--max-depth <number>` - Maximum crawling depth (default: 3)
- `--max-interactions <number>` - Maximum interactions per state (default: 10)
- `--no-state-crawling` - Disable multi-state exploration
- `--no-interactions` - Disable interaction simulation
- `--no-fallback` - Disable fallback to legacy mode on errors

## Output Formats

### Enhanced Snapshot Format

```json
{
  "targetUrl": "https://example.com",
  "crawlMetadata": {
    "totalStates": 3,
    "maxDepthReached": 2,
    "totalElements": 150,
    "crawlDuration": 15000
  },
  "states": [
    {
      "id": "abc123",
      "url": "https://example.com",
      "depth": 0,
      "elements": [
        {
          "index": 0,
          "selector": "#search-input",
          "domPath": "html > body > header > form > input",
          "labels": {
            "primary": "Search repositories",
            "all": [
              {"source": "aria-label", "value": "Search repositories"},
              {"source": "placeholder", "value": "Search or jump to..."}
            ]
          },
          "role": "textbox",
          "tag": "input",
          "interactions": [
            {"type": "type", "target": "value"},
            {"type": "focus"}
          ],
          "attributes": {
            "id": "search-input",
            "type": "text",
            "placeholder": "Search or jump to...",
            "accessKey": "/"
          },
          "aria": {
            "label": "Search repositories",
            "expanded": "false"
          },
          "boundingBox": {
            "x": 100, "y": 50, "width": 200, "height": 30
          }
        }
      ],
      "shortcuts": [
        {
          "type": "keyboard_shortcut",
          "key": "/",
          "description": "Search focus",
          "verified": true
        }
      ]
    }
  ],
  "stateGraph": {
    "states": {"abc123": {...}},
    "transitions": {"abc123": []}
  }
}
```

### Legacy Snapshot Format

```json
{
  "url": "https://example.com",
  "route": "https://example.com/",
  "elements": [
    {
      "selector": null,
      "label": "Search repositories",
      "role": "textbox",
      "tag": "input",
      "actions": [{"type": "focus"}],
      "textNearby": "",
      "accessKey": "/"
    }
  ],
  "nativeShortcuts": [
    {
      "type": "accesskey",
      "key": "/",
      "source": "HTML attribute"
    }
  ]
}
```

## Use Cases

### 🎯 **For Simple Element Extraction**
```bash
node unified-crawler.mjs https://example.com output.json --mode legacy
```
- Fast execution
- Basic element detection
- Simple shortcut discovery
- Minimal resource usage

### 🔍 **For Deep Application Analysis** 
```bash
node enhanced-crawler.mjs https://app.example.com app.json --max-depth 3 --suggest
```
- Multi-state exploration
- Interaction simulation
- Rich context extraction
- AI-powered shortcut suggestions

### 🎭 **For Comprehensive Coverage**
```bash
node unified-crawler.mjs https://complex-app.com complete.json --mode hybrid --suggest
```
- Combines both approaches
- Maximum element coverage
- Fallback resilience
- Best of both worlds

## Architecture

### Enhanced Crawler Components

1. **CrawlerState**: Manages visited states and transition graph
2. **Enhanced Element Extraction**: Deep context analysis with DOM hierarchy
3. **Interaction Simulation**: Clicks, hovers, and form interactions
4. **State Discovery**: BFS/DFS traversal of application states
5. **Advanced Shortcut Detection**: Keyboard testing and event listener detection

### Integration Points

- **Suggester Service**: Receives rich snapshots for AI analysis
- **Config Service**: Stores crawler artifacts and configurations
- **Browser Extension**: Consumes suggestions for shortcut implementation

## Performance Guidelines

### Memory Usage
- Enhanced mode: ~50-100MB per state
- Legacy mode: ~10-20MB total
- Hybrid mode: ~60-120MB total

### Execution Time
- Legacy: 5-15 seconds
- Enhanced (depth 2): 30-60 seconds  
- Enhanced (depth 3): 60-180 seconds
- Hybrid: 45-90 seconds

### Recommendations
- Use `--max-depth 2` for most applications
- Limit `--max-interactions 5-8` for faster execution
- Use legacy mode for CI/CD pipelines
- Use enhanced mode for thorough analysis

## Troubleshooting

### Common Issues

**"Target page has been closed"**
```bash
# Add longer wait time
node enhanced-crawler.mjs url output.json --wait 5000
```

**"Authentication required"**
```bash
# Use headed mode for first-time login
node enhanced-crawler.mjs url output.json --headed --auth .auth/session.json
```

**"Too many states discovered"**
```bash
# Limit depth and interactions
node enhanced-crawler.mjs url output.json --max-depth 2 --max-interactions 5
```

**"Suggester service unavailable"**
```bash
# Start suggester service first
cd ../suggester && node server.js
```

## Development

### Running Tests
```bash
# Test enhanced crawler
npm run crawl-enhanced https://github.com test-github.json --suggest

# Test unified crawler
npm run crawl-unified https://mail.google.com test-gmail.json --mode hybrid

# Test legacy compatibility  
npm run crawl https://example.com test-legacy.json --suggest
```

### Adding New Features

1. **New Interaction Types**: Add to `detectInteractions()` in enhanced-crawler.mjs
2. **New Shortcut Detection**: Extend `detectAdvancedShortcuts()`
3. **New State Transitions**: Modify `simulateInteractions()`
4. **New Output Formats**: Update snapshot generation logic

## API Reference

### `runEnhancedCrawler(url, outputPath, options)`
- **url**: Target URL to crawl
- **outputPath**: JSON output file path  
- **options**: Configuration object

### `runUnifiedCrawler(url, outputPath, options)`
- **url**: Target URL to crawl
- **outputPath**: JSON output file path
- **options**: Configuration object with mode selection

### Options Object
```javascript
{
  mode: 'enhanced',           // legacy|enhanced|hybrid
  headed: false,              // Show browser window
  chrome: false,              // Use Chrome vs Chromium
  authPath: null,             // Authentication state file
  waitMs: 2500,              // Page load wait time
  suggest: false,             // Send to suggester service
  maxDepth: 3,               // Maximum crawl depth
  maxInteractions: 10,        // Max interactions per state
  enableStateCrawling: true,  // Enable multi-state exploration
  enableInteractionSimulation: true, // Enable interaction testing
  legacyFallback: true       // Fallback to legacy on errors
}
```
