# 🚀 Crawler Extension Integration

The enhanced crawler system is now fully integrated into the browser extension! You can trigger crawls directly from the extension UI.

## ✨ Features

### 🎛️ **Three-Tab Interface**
- **Commands**: View and execute existing shortcuts
- **Suggestions**: Browse AI-generated shortcut recommendations  
- **Crawler**: Trigger new crawls with custom settings

### 🔧 **Crawler Tab Capabilities**

#### URL Input
- Pre-filled with current site's origin
- Supports any valid URL with http/https protocol
- Real-time validation

#### Mode Selection
- **Legacy (Fast, 5-15s)**: Quick basic element extraction
- **Enhanced (Deep, 30-60s)**: Deep analysis with state discovery
- **Hybrid (Complete, 45-90s)**: Combines both approaches

#### Advanced Options
- **Max Depth**: Control exploration depth (1-3 levels)
- Collapsible interface to keep UI clean

#### Real-Time Progress
- Live progress bar with elapsed time
- Status updates during crawling
- Success/error notifications

## 🔄 **Complete Workflow**

### 1. **Start Crawl**
```
Extension UI → API Call → Server-Side Crawler → Suggestions
```

### 2. **API Endpoints**
- `POST /v1/crawl` - Start new crawl job
- `GET /v1/crawl/{jobId}` - Check job status

### 3. **Auto-Processing**
- Crawl completes → Suggestions generated automatically
- Results stored in `services/crawler/snapshots/`
- Extension auto-refreshes suggestions tab

## 🛠️ **Setup Instructions**

### 1. Start Services
```bash
# Terminal 1: Suggester service (port 8788)
cd services/suggester
node server.js

# Terminal 2: Config service (port 8787) 
cd services/config
node server.js
```

### 2. Install Extension
- Load the extension in your browser
- Navigate to any website
- Press `Ctrl+K` (or `Cmd+K` on Mac) to open command palette

### 3. Use Crawler
1. Click **"Crawler"** tab
2. Enter URL (defaults to current site)
3. Select crawling mode
4. Optionally adjust advanced settings
5. Click **"Start Crawling"**
6. Watch real-time progress
7. Check **"Suggestions"** tab when complete

## 📊 **API Details**

### Start Crawl Request
```json
POST http://localhost:8788/v1/crawl
{
  "url": "https://github.com",
  "mode": "enhanced",
  "options": {
    "maxDepth": 2,
    "waitMs": 3000
  }
}
```

### Response
```json
{
  "jobId": "github_com_enhanced_1704123456789",
  "status": "started", 
  "message": "Crawler started for https://github.com in enhanced mode",
  "estimatedDuration": "30-60 seconds"
}
```

### Status Check
```json
GET http://localhost:8788/v1/crawl/{jobId}
{
  "id": "github_com_enhanced_1704123456",
  "url": "https://github.com", 
  "mode": "enhanced",
  "status": "completed", // or "running", "failed"
  "startTime": 1704123456789,
  "endTime": 1704123500123
}
```

## 🎯 **User Experience**

### Visual Feedback
- **Progress Bar**: Shows crawl progress (10% → 100%)
- **Status Text**: Real-time updates ("Crawling...", "Completed!")
- **Color Coding**: Blue (progress), Green (success), Red (error)

### Auto-Integration
- **Smart Defaults**: Pre-fills current site URL
- **Mode Descriptions**: Explains each crawling mode
- **Auto-Refresh**: Suggestions update automatically on completion
- **Success Notifications**: Guides user to check suggestions

### Error Handling
- **URL Validation**: Prevents invalid URLs
- **Service Checks**: Graceful handling if services are down
- **Progress Recovery**: Shows errors with retry option

## 🚀 **Example Usage**

### Quick Current Site Analysis
1. Open extension (`Ctrl+K`)
2. Go to "Crawler" tab
3. Keep default URL (current site)
4. Select "Enhanced" mode
5. Click "Start Crawling"
6. Wait 30-60 seconds
7. Check "Suggestions" tab for new shortcuts

### Deep External Site Analysis
1. Open extension
2. Go to "Crawler" tab  
3. Enter target URL (e.g., `https://mail.google.com`)
4. Select "Hybrid" mode for maximum coverage
5. Set Max Depth to 3 for thorough exploration
6. Click "Start Crawling"
7. Wait 45-90 seconds
8. Review comprehensive suggestions

### Quick Comparison
1. Crawl same site with "Legacy" mode (fast)
2. Note suggestions generated
3. Crawl again with "Enhanced" mode
4. Compare quality and quantity of suggestions

## 🔧 **Technical Integration**

### Server-Side Processing
```javascript
// In suggester/server.js
const { runUnifiedCrawler } = await import('../crawler/unified-crawler.mjs');

const result = await runUnifiedCrawler(url, outputPath, {
  mode,
  headed: false,
  suggest: true,
  maxDepth,
  enableStateCrawling: true
});
```

### Extension API Calls
```javascript
// In extension/content.js
const response = await fetch('http://localhost:8788/v1/crawl', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url, mode, options })
});
```

### Automatic Suggestions
```javascript
// Auto-refresh suggestions when crawl completes
if (job.status === 'completed') {
  loadSuggestions(); // Reload suggestions
  showGlobalMessage('✅ Crawl completed! Check Suggestions tab.', 'success');
}
```

## 🎉 **Benefits**

### For Users
- **No Command Line**: Trigger crawls from browser UI
- **Real-Time Feedback**: See progress and status live
- **Smart Integration**: Results automatically available as suggestions
- **Flexible Options**: Choose speed vs. thoroughness

### For Developers  
- **Server-Side Execution**: Crawls run on server with full Playwright capabilities
- **Job Management**: Track multiple concurrent crawls
- **API Integration**: RESTful endpoints for external tools
- **Error Resilience**: Graceful handling of failures

### For AI Quality
- **Rich Context**: Enhanced crawler provides better element context
- **Multi-Mode Analysis**: Compare different crawling approaches
- **Fresh Data**: Generate new suggestions on-demand
- **Site-Specific**: Analyze exactly the sites you use

The crawler is now a first-class feature of the extension, making it easy to generate AI-powered shortcuts for any website! 🕷️✨
