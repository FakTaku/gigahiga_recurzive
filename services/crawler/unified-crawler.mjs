// Unified Crawler - Combines legacy and enhanced crawling approaches
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runEnhancedCrawler } from './enhanced-crawler.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Import legacy crawler functions
async function sendToSuggester(snapshot, appId) {
  try {
    console.log('[unified-crawler] Sending snapshot to suggester service...');
    const response = await fetch('http://localhost:8788/v1/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: snapshot.url,
        appId,
        appCategory: 'unified',
        platform: process.platform === 'darwin' ? 'mac' : 'win',
        elements: snapshot.elements.map((el, index) => ({
          id: el.label?.toLowerCase().replace(/\s+/g, '_').slice(0, 50) || `element_${index}`,
          label: el.label || el.labels?.primary,
          role: el.role,
          tag: el.tag,
          textNearby: el.textNearby || el.labels?.all?.find(l => l.source.includes('parent'))?.value,
          actions: el.actions || el.interactions?.map(i => ({ type: i.type })),
          accessKey: el.accessKey || el.attributes?.accessKey
        })),
        nativeShortcuts: snapshot.nativeShortcuts || snapshot.shortcuts || [],
        reserved: { win: ['Alt+Tab'], mac: ['Meta+Q'] }
      })
    });
    
    if (response.ok) {
      const suggestions = await response.json();
      console.log(`[unified-crawler] Received ${suggestions.suggestions?.length || 0} suggestions`);
      return suggestions;
    } else {
      console.log('[unified-crawler] Suggester service error:', response.status);
      return null;
    }
  } catch (error) {
    console.log('[unified-crawler] Suggester failed:', error.message);
    return null;
  }
}

// Unified crawler that can use both approaches
async function runUnifiedCrawler(targetUrl, outputPath, options = {}) {
  const {
    mode = 'enhanced', // 'legacy', 'enhanced', or 'hybrid'
    headed = false,
    chrome = false,
    authPath = null,
    waitMs = 2500,
    suggest = false,
    maxDepth = 2,
    maxInteractions = 8,
    enableStateCrawling = true,
    enableInteractionSimulation = true,
    legacyFallback = true
  } = options;
  
  console.log(`[unified-crawler] Starting unified crawl in ${mode} mode`);
  console.log(`[unified-crawler] Target: ${targetUrl}`);
  
  const startTime = Date.now();
  
  try {
    if (mode === 'enhanced') {
      // Use enhanced crawler
      console.log('[unified-crawler] Using enhanced crawler');
      const enhancedResult = await runEnhancedCrawler(targetUrl, outputPath, {
        headed,
        chrome,
        authPath,
        waitMs,
        suggest,
        maxDepth,
        maxInteractions,
        enableStateCrawling,
        enableInteractionSimulation
      });
      
      console.log(`[unified-crawler] Enhanced crawl completed in ${Date.now() - startTime}ms`);
      return enhancedResult;
      
    } else if (mode === 'legacy') {
      // Use legacy crawler (import and run the existing logic)
      console.log('[unified-crawler] Using legacy crawler');
      return await runLegacyCrawl(targetUrl, outputPath, options);
      
    } else if (mode === 'hybrid') {
      // Run both and combine results
      console.log('[unified-crawler] Using hybrid mode - running both crawlers');
      
      // Run enhanced crawler first
      const enhancedPath = outputPath.replace('.json', '_enhanced.json');
      const enhancedResult = await runEnhancedCrawler(targetUrl, enhancedPath, {
        headed,
        chrome,
        authPath,
        waitMs,
        suggest: false, // Don't suggest yet
        maxDepth: Math.min(maxDepth, 2), // Limit depth for hybrid
        maxInteractions: Math.min(maxInteractions, 5),
        enableStateCrawling,
        enableInteractionSimulation
      });
      
      // Run legacy crawler
      const legacyPath = outputPath.replace('.json', '_legacy.json');
      const legacyResult = await runLegacyCrawl(targetUrl, legacyPath, {
        ...options,
        suggest: false
      });
      
      // Combine results
      const hybridSnapshot = {
        url: targetUrl,
        mode: 'hybrid',
        enhanced: {
          states: enhancedResult.states,
          stateGraph: enhancedResult.stateGraph,
          metadata: enhancedResult.crawlMetadata
        },
        legacy: {
          elements: legacyResult.elements,
          nativeShortcuts: legacyResult.nativeShortcuts
        },
        combined: {
          totalElements: enhancedResult.crawlMetadata.totalElements + legacyResult.elements.length,
          uniqueStates: enhancedResult.states.length,
          crawlDuration: Date.now() - startTime
        },
        capturedAt: new Date().toISOString()
      };
      
      // Write combined snapshot
      fs.writeFileSync(outputPath, JSON.stringify(hybridSnapshot, null, 2));
      
      // Send to suggester if requested
      if (suggest) {
        const combinedElements = [
          ...enhancedResult.states.flatMap(s => s.elements),
          ...legacyResult.elements
        ];
        
        const suggesterSnapshot = {
          url: targetUrl,
          elements: combinedElements.slice(0, 150), // Larger limit for hybrid
          nativeShortcuts: [
            ...enhancedResult.states.flatMap(s => s.shortcuts || []),
            ...legacyResult.nativeShortcuts || []
          ]
        };
        
        const suggestions = await sendToSuggester(suggesterSnapshot, new URL(targetUrl).hostname);
        if (suggestions) {
          const suggestionsPath = outputPath.replace('.json', '_hybrid_suggestions.json');
          fs.writeFileSync(suggestionsPath, JSON.stringify(suggestions, null, 2));
          console.log(`[unified-crawler] Saved hybrid suggestions to ${suggestionsPath}`);
        }
      }
      
      console.log(`[unified-crawler] Hybrid crawl completed in ${Date.now() - startTime}ms`);
      return hybridSnapshot;
    }
    
  } catch (error) {
    console.error(`[unified-crawler] ${mode} mode failed:`, error.message);
    
    if (legacyFallback && mode === 'enhanced') {
      console.log('[unified-crawler] Falling back to legacy crawler...');
      try {
        return await runLegacyCrawl(targetUrl, outputPath, options);
      } catch (fallbackError) {
        console.error('[unified-crawler] Legacy fallback also failed:', fallbackError.message);
        throw fallbackError;
      }
    }
    
    throw error;
  }
}

// Legacy crawler implementation (simplified version of existing logic)
async function runLegacyCrawl(targetUrl, outputPath, options = {}) {
  const {
    headed = false,
    chrome = false,
    authPath = null,
    waitMs = 2500,
    suggest = false
  } = options;
  
  console.log(`[unified-crawler] Running legacy crawl for ${targetUrl}`);
  
  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });
  
  const launchOpts = { headless: !headed };
  if (chrome) launchOpts.channel = 'chrome';
  
  let browser;
  try {
    browser = await chromium.launch(launchOpts);
    
    const contextOptions = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    };
    
    if (authPath && fs.existsSync(authPath)) {
      contextOptions.storageState = authPath;
    }
    
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await sleep(waitMs);
    
    // Handle Gmail auth (simplified)
    const urlNow = page.url();
    const isGoogleAuth = /accounts\.google\.com/.test(urlNow);
    const isGmail = /mail\.google\.com/.test(targetUrl);
    
    if (isGmail && !contextOptions.storageState && isGoogleAuth && headed) {
      console.log('[unified-crawler] Waiting for Gmail authentication...');
      await page.waitForURL(/mail\.google\.com\/mail/i, { timeout: 300000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await sleep(2000);
      
      if (authPath) {
        fs.mkdirSync(path.dirname(authPath), { recursive: true });
        await context.storageState({ path: authPath });
      }
    }
    
    // Light scroll to trigger lazy content
    await page.evaluate(() => window.scrollBy(0, 400));
    await sleep(600);
    
    // Extract elements (simplified legacy extraction)
    const elements = await extractLegacyElements(page);
    
    // Detect native shortcuts (simplified)
    const nativeShortcuts = await detectLegacyShortcuts(page);
    
    const snapshot = {
      url: targetUrl,
      route: page.url(),
      elements,
      nativeShortcuts,
      mode: 'legacy',
      capturedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2));
    
    if (suggest) {
      const suggestions = await sendToSuggester(snapshot, new URL(targetUrl).hostname);
      if (suggestions) {
        const suggestionsPath = outputPath.replace('.json', '_legacy_suggestions.json');
        fs.writeFileSync(suggestionsPath, JSON.stringify(suggestions, null, 2));
        console.log(`[unified-crawler] Saved legacy suggestions to ${suggestionsPath}`);
      }
    }
    
    await browser.close();
    return snapshot;
    
  } catch (error) {
    console.error('[unified-crawler] Legacy crawl error:', error);
    if (browser) await browser.close().catch(() => {});
    throw error;
  }
}

// Simplified legacy element extraction
async function extractLegacyElements(page) {
  try {
    const frames = page.frames();
    const all = [];
    
    for (const frame of frames) {
      try {
        await frame.title(); // Test frame accessibility
        const items = await frame.evaluate(() => {
          function getLabel(el) {
            const aria = el.getAttribute('aria-label');
            if (aria) return aria;
            const title = el.getAttribute('title');
            if (title) return title;
            const text = (el.textContent || '').trim();
            if (text) return text.slice(0, 120);
            return null;
          }
          
          function isVisible(el) {
            try {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return !!(rect.width && rect.height) && 
                     style.visibility !== 'hidden' && 
                     style.display !== 'none';
            } catch { return false; }
          }
          
          const nodes = Array.from(document.querySelectorAll(
            'a,button,input,textarea,select,[role],[onclick],[tabindex],.btn,.button'
          ));
          
          const items = [];
          for (const el of nodes) {
            try {
              if (!isVisible(el)) continue;
              const label = getLabel(el);
              const role = el.getAttribute('role') || 
                          (el.tagName === 'BUTTON' ? 'button' :
                           el.tagName === 'A' ? 'link' : undefined);
              const actions = [];
              if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                actions.push({ type: 'focus' });
              } else {
                actions.push({ type: 'click' });
              }
              
              items.push({
                selector: null,
                label,
                role,
                tag: el.tagName.toLowerCase(),
                actions,
                textNearby: (el.closest('label')?.textContent || '').trim().slice(0, 120),
                accessKey: el.getAttribute('accesskey') || null
              });
            } catch {}
          }
          return items;
        });
        
        items.forEach(item => { item._frameUrl = frame.url(); });
        all.push(...items);
      } catch {}
    }
    
    return all;
  } catch {
    return [];
  }
}

// Simplified legacy shortcut detection
async function detectLegacyShortcuts(page) {
  try {
    const nativeShortcuts = [];
    
    // Extract accesskey attributes
    const accessKeys = await page.evaluate(() => {
      const keys = new Set();
      document.querySelectorAll('[accesskey]').forEach(el => {
        const key = el.getAttribute('accesskey');
        if (key) keys.add(key.toLowerCase());
      });
      return Array.from(keys);
    });
    
    accessKeys.forEach(key => {
      nativeShortcuts.push({
        type: 'accesskey',
        key,
        source: 'HTML attribute'
      });
    });
    
    // Test "/" for search (simplified GitHub test)
    const url = page.url();
    if (url.includes('github.com')) {
      try {
        await page.click('body');
        await sleep(100);
        
        const activeElementBefore = await page.evaluate(() => document.activeElement?.tagName || 'BODY');
        await page.keyboard.press('/');
        await sleep(500);
        
        const activeElementAfter = await page.evaluate(() => {
          const active = document.activeElement;
          const hasSearchIndicators = active && (
            active.placeholder?.toLowerCase().includes('search') ||
            active.getAttribute('aria-label')?.toLowerCase().includes('search') ||
            (active.className && active.className.includes('QueryBuilder'))
          );
          return {
            tagName: active?.tagName,
            isSearchInput: active?.type === 'text' && hasSearchIndicators
          };
        });
        
        if (activeElementAfter.isSearchInput) {
          nativeShortcuts.push({
            type: 'native_shortcut',
            key: '/',
            source: 'GitHub search focus test',
            verified: true
          });
          await page.keyboard.press('Escape'); // Clear search
        }
      } catch {}
    }
    
    return nativeShortcuts;
  } catch {
    return [];
  }
}

// CLI parsing for unified crawler
function parseUnifiedCLI() {
  const args = process.argv.slice(2);
  const url = args[0] || 'https://example.com';
  const output = args[1] || path.join(process.cwd(), 'unified-snapshot.json');
  
  const opts = {
    mode: 'enhanced', // Default to enhanced
    headed: false,
    chrome: false,
    authPath: null,
    waitMs: 2500,
    suggest: false,
    maxDepth: 2,
    maxInteractions: 8,
    enableStateCrawling: true,
    enableInteractionSimulation: true,
    legacyFallback: true
  };
  
  for (let i = 2; i < args.length; i++) {
    const a = args[i];
    if (a === '--mode' && args[i+1]) {
      const mode = args[++i];
      if (['legacy', 'enhanced', 'hybrid'].includes(mode)) {
        opts.mode = mode;
      }
    }
    else if (a === '--headed') opts.headed = true;
    else if (a === '--chrome') opts.chrome = true;
    else if (a === '--wait' && args[i+1]) opts.waitMs = Number(args[++i]) || 2500;
    else if (a === '--auth' && args[i+1]) opts.authPath = args[++i];
    else if (a === '--suggest') opts.suggest = true;
    else if (a === '--max-depth' && args[i+1]) opts.maxDepth = Number(args[++i]) || 2;
    else if (a === '--max-interactions' && args[i+1]) opts.maxInteractions = Number(args[++i]) || 8;
    else if (a === '--no-state-crawling') opts.enableStateCrawling = false;
    else if (a === '--no-interactions') opts.enableInteractionSimulation = false;
    else if (a === '--no-fallback') opts.legacyFallback = false;
  }
  
  return { url, output, opts };
}

// Export for module use
export { runUnifiedCrawler, runLegacyCrawl };

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url, output, opts } = parseUnifiedCLI();
  
  console.log(`[unified-crawler] URL: ${url}`);
  console.log(`[unified-crawler] Output: ${output}`);
  console.log(`[unified-crawler] Mode: ${opts.mode}`);
  console.log(`[unified-crawler] Options:`, opts);
  
  try {
    await runUnifiedCrawler(url, output, opts);
    console.log('[unified-crawler] Crawl completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('[unified-crawler] Crawl failed:', error.message);
    process.exit(1);
  }
}
