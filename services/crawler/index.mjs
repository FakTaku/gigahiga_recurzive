// services/crawler/index.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function sendToSuggester(snapshot, appId) {
  try {
    console.log('[crawler] Sending snapshot to suggester service...');
    const response = await fetch('http://localhost:8788/v1/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: snapshot.url, // Add the website URL for LLM context
        appId,
        appCategory: 'development', // Default category
        platform: process.platform === 'darwin' ? 'mac' : 'win',
        elements: snapshot.elements.map((el, index) => ({
          id: el.label?.toLowerCase().replace(/\s+/g, '_').slice(0, 50) || `unknown_${index}`,
          label: el.label,
          role: el.role,
          tag: el.tag,
          textNearby: el.textNearby,
          actions: el.actions,
          accessKey: el.accessKey
        })),
        nativeShortcuts: snapshot.nativeShortcuts || [], // Pass discovered native shortcuts
        reserved: { win: ['Alt+Tab'], mac: ['Meta+Q'] }
      })
    });
    
    if (response.ok) {
      const suggestions = await response.json();
      console.log(`[crawler] Received ${suggestions.suggestions?.length || 0} suggestions from suggester`);
      return suggestions;
    } else {
      console.log('[crawler] Suggester service returned error:', response.status);
      return null;
    }
  } catch (error) {
    console.log('[crawler] Failed to send to suggester:', error.message);
    return null;
  }
}

function parseCLI() {
  const args = process.argv.slice(2);
  const url = args[0] || 'https://example.com';
  const output = args[1] || path.join(process.cwd(), 'snapshot.json');

  const opts = { headed: false, chrome: false, authPath: null, waitMs: 2500, suggest: false };
  for (let i = 2; i < args.length; i++) {
    const a = args[i];
    if (a === '--headed') opts.headed = true;
    else if (a === '--chrome') opts.chrome = true;
    else if (a === '--wait' && args[i+1]) { opts.waitMs = Number(args[++i]) || 2500; }
    else if (a === '--auth' && args[i+1]) { opts.authPath = args[++i]; }
    else if (a === '--suggest') opts.suggest = true;
  }
  return { url, output, opts };
}

async function extractFromFrame(frame) {
  return frame.evaluate(() => {
    function getLabel(el) {
      const aria = el.getAttribute('aria-label');
      if (aria) return aria;
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const lab = labelledBy.split(/\s+/)
          .map(id => document.getElementById(id)?.textContent?.trim())
          .filter(Boolean).join(' ');
        if (lab) return lab;
      }
      const title = el.getAttribute('title');
      if (title) return title;
      const text = (el.textContent || '').trim();
      if (text) return text.slice(0, 120);
      return null;
    }
    function roleOf(el) {
      return el.getAttribute('role') || (el.tagName === 'BUTTON' ? 'button' :
              el.tagName === 'A' ? 'link' : undefined);
    }
    function isVisible(el){
      try {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return !!(rect.width && rect.height) && style.visibility !== 'hidden' && style.display !== 'none';
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
        const role = roleOf(el);
        const actions = [];
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') actions.push({ type: 'focus' });
        else actions.push({ type: 'click' });
        
        // Extract accesskey if present
        const accessKey = el.getAttribute('accesskey');
        
        items.push({
          selector: null,
          label, role,
          tag: el.tagName.toLowerCase(),
          actions,
          textNearby: (el.closest('label')?.textContent || '').trim().slice(0, 120),
          accessKey: accessKey || null // Add accesskey to element data
        });
      } catch {}
    }
    return items;
  });
}

async function detectNativeShortcuts(page) {
  console.log('[crawler] Detecting native shortcuts...');
  
  try {
    const nativeShortcuts = [];
    
    // Extract accesskey attributes
    const accessKeys = await page.evaluate(() => {
      const keys = new Set();
      const elementsWithAccessKey = document.querySelectorAll('[accesskey]');
      elementsWithAccessKey.forEach(el => {
        const key = el.getAttribute('accesskey');
        if (key) {
          keys.add(key.toLowerCase());
        }
      });
      return Array.from(keys);
    });
    
    accessKeys.forEach(key => {
      nativeShortcuts.push({
        type: 'accesskey',
        key: key,
        source: 'HTML attribute'
      });
    });
    
    // Site-specific shortcut detection
    const url = page.url();
    
    // GitHub-specific shortcuts
    if (url.includes('github.com')) {
      console.log('[crawler] Detecting GitHub-specific shortcuts...');
      
      // Test if "/" triggers search
      try {
        // Focus on body first to ensure we're not in an input
        await page.click('body');
        await sleep(100);
        
        // Get current active element
        const activeElementBefore = await page.evaluate(() => document.activeElement?.tagName || 'BODY');
        
        // Press "/" key
        await page.keyboard.press('/');
        await sleep(500); // Wait for potential focus change
        
        // Check if search input is now focused
        const activeElementAfter = await page.evaluate(() => {
          const active = document.activeElement;
          if (!active) return 'NONE';
          
          // Check if it's a search input - GitHub's search has various indicators
          const hasSearchIndicators = (
            active.placeholder?.toLowerCase().includes('search') ||
            active.getAttribute('aria-label')?.toLowerCase().includes('search') ||
            (active.className && active.className.includes('search')) ||
            (active.className && active.className.includes('QueryBuilder')) || // GitHub's search component - THIS IS THE KEY!
            active.closest('.search-input-container') || // Search container
            active.closest('[data-target="qbsearch-input.inputElement"]') || // GitHub search target
            active.id?.includes('search') ||
            active.name?.includes('search')
          );
          
          const isSearchInput = active.type === 'text' && hasSearchIndicators;
          
          return {
            tagName: active.tagName,
            type: active.type,
            placeholder: active.placeholder,
            ariaLabel: active.getAttribute('aria-label'),
            className: active.className,
            id: active.id,
            name: active.name,
            isSearchInput,
            hasSearchIndicators,
            debug: {
              hasQueryBuilder: active.className && active.className.includes('QueryBuilder'),
              hasSearch: active.className && active.className.includes('search'),
              isTextInput: active.type === 'text'
            },
            closest: active.closest('.search-input-container, [data-target*="search"]') ? 'found search container' : 'no search container'
          };
        });
        
        console.log('[crawler] GitHub "/" test - before:', activeElementBefore, 'after:', activeElementAfter);
        
        // If search input is focused, "/" is used natively
        if (activeElementAfter.isSearchInput) {
          nativeShortcuts.push({
            type: 'native_shortcut',
            key: '/',
            source: 'GitHub search focus test',
            verified: true
          });
          console.log('[crawler] Confirmed: GitHub uses "/" for search');
        }
        
        // Clear the search if it was focused
        if (activeElementAfter.isSearchInput) {
          await page.keyboard.press('Escape');
        }
        
      } catch (error) {
        console.log('[crawler] GitHub "/" test failed:', error.message);
      }
      
      // GitHub also commonly uses other shortcuts - add known ones
      const githubShortcuts = [
        { key: 'g', description: 'Go to shortcuts' },
        { key: 'i', description: 'Issues shortcut' },
        { key: 'p', description: 'Pull requests shortcut' },
        { key: 't', description: 'File finder' },
        { key: 'w', description: 'Branch/tag selector' },
        { key: 's', description: 'Focus search' }
      ];
      
      // Only add these if we detect GitHub has keyboard shortcuts enabled
      const hasGitHubShortcuts = await page.evaluate(() => {
        // Look for GitHub's shortcut hints or help
        const shortcutElements = document.querySelectorAll('[data-hotkey], .js-hotkey, .hotkey');
        return shortcutElements.length > 0;
      });
      
      if (hasGitHubShortcuts) {
        githubShortcuts.forEach(shortcut => {
          nativeShortcuts.push({
            type: 'known_github_shortcut',
            key: shortcut.key,
            source: `GitHub ${shortcut.description}`,
            verified: false
          });
        });
        console.log(`[crawler] Added ${githubShortcuts.length} known GitHub shortcuts`);
      }
    }
    
    // Add any detected event listeners (less specific but still useful)
    const hasKeyListeners = await page.evaluate(() => {
      // Check if there are any keydown listeners on document or body
      const body = document.body;
      const doc = document;
      
      // This is a heuristic - look for common signs of keyboard shortcuts
      const scripts = Array.from(document.scripts);
      const hasKeyboardJS = scripts.some(script => 
        script.textContent && (
          script.textContent.includes('keydown') ||
          script.textContent.includes('keypress') ||
          script.textContent.includes('addEventListener') ||
          script.textContent.includes('hotkey') ||
          script.textContent.includes('shortcut')
        )
      );
      
      return hasKeyboardJS;
    });
    
    if (hasKeyListeners) {
      nativeShortcuts.push({
        type: 'event_listeners_detected',
        key: 'unknown',
        source: 'JavaScript keyboard event listeners detected',
        verified: false
      });
    }
    
    console.log(`[crawler] Discovered ${nativeShortcuts.length} native shortcuts`);
    return nativeShortcuts;
    
  } catch (error) {
    console.error('[crawler] Error detecting native shortcuts:', error);
    return [];
  }
}

async function extractElements(page) {
  console.log('[crawler] Starting element extraction...');
  try {
    // Try main frame + any same-origin frames
    const frames = page.frames();
    const all = [];
    for (const f of frames) {
      try {
        // Skip cross-origin frames that will throw
        await f.title(); // ensures frame is accessible; will not throw on cross-origin but we’ll catch eval below
        const items = await extractFromFrame(f);
        items.forEach(it => { it._frameUrl = f.url(); });
        all.push(...items);
      } catch {}
    }
    console.log(`[crawler] Extraction complete: ${all.length} elements found`);
    return all;
  } catch (err) {
    console.error('[crawler] Extraction error:', err);
    return [];
  }
}

async function run(targetUrl, outPath, opts = {}) {
  const start = Date.now();
  console.log(`[crawler] Starting crawler for ${targetUrl}`);
  console.log(`[crawler] Output path: ${outPath}`);

  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });

  const launchOpts = { headless: !opts.headed };
  if (opts.chrome) launchOpts.channel = 'chrome';

  let browser;
  try {
    console.log('[crawler] Launching browser...');
    browser = await chromium.launch(launchOpts);

    const contextOptions = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    };
    if (opts.authPath && fs.existsSync(opts.authPath)) {
      contextOptions.storageState = opts.authPath;
      console.log(`[crawler] Using saved auth state from ${opts.authPath}`);
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    console.log(`[crawler] Navigating to ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await sleep(opts.waitMs || 2500);

    // If we're not authenticated for Gmail, guide first-time login
    const urlNow = page.url();
    const isGoogleAuth = /accounts\.google\.com/.test(urlNow);
    const isGmail = /mail\.google\.com/.test(targetUrl);

    if (isGmail && !contextOptions.storageState && isGoogleAuth) {
      if (!opts.headed) {
        console.log('[crawler] Gmail requires login. Re-run with --headed and --auth .auth/gmail.json for a one-time sign-in.');
        throw new Error('Authentication required for Gmail. Run with --headed --auth <path> to save session.');
      }
      if (!opts.authPath) {
        console.log('[crawler] Tip: Provide --auth .auth/gmail.json to persist login for future headless runs.');
      }
      console.log('[crawler] Waiting up to 5 minutes for you to complete Google login…');
      // Wait until we land on inbox (or any /mail/ URL)
      await page.waitForURL(/mail\.google\.com\/mail/i, { timeout: 300_000 });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await sleep(2000);
      if (opts.authPath) {
        fs.mkdirSync(path.dirname(opts.authPath), { recursive: true });
        await context.storageState({ path: opts.authPath });
        console.log(`[crawler] Saved auth state to ${opts.authPath}`);
      }
    }

    // Give SPA a moment to paint/settle, then lightly scroll to trigger lazy content
    await page.evaluate(() => window.scrollBy(0, 400));
    await sleep(600);

    console.log('[crawler] Extracting elements…');
    const elements = await extractElements(page);
    
    // Detect native shortcuts after elements are loaded
    const nativeShortcuts = await detectNativeShortcuts(page);

    const snapshot = {
      url: targetUrl,
      route: page.url(),
      elements,
      nativeShortcuts, // Add native shortcuts to snapshot
      capturedAt: new Date().toISOString()
    };

    console.log(`[crawler] Writing ${elements.length} elements to ${outPath}`);
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
    
    // Send to suggester if requested
    if (opts.suggest) {
      const appId = new URL(targetUrl).hostname;
      const suggestions = await sendToSuggester(snapshot, appId);
      if (suggestions) {
        // Save suggestions alongside snapshot
        const suggestionsPath = outPath.replace('.json', '_suggestions.json');
        fs.writeFileSync(suggestionsPath, JSON.stringify(suggestions, null, 2));
        console.log(`[crawler] Saved suggestions to ${suggestionsPath}`);
      }
    }
    
    console.log(`[crawler] Completed in ${Date.now() - start}ms`);

    await browser.close();
    return snapshot;
  } catch (error) {
    console.error('[crawler] Error:', error);
    const errorSnapshot = {
      url: targetUrl,
      error: String(error?.message || error),
      capturedAt: new Date().toISOString()
    };
    try {
      fs.writeFileSync(outPath, JSON.stringify(errorSnapshot, null, 2));
      console.log(`[crawler] Wrote error snapshot to ${outPath}`);
    } catch (writeError) {
      console.error('[crawler] Failed to write error snapshot:', writeError);
    }
    if (browser) await browser.close().catch(() => {});
    process.exit(1);
  }
}

// CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url, output, opts } = parseCLI();
  console.log(`[crawler] URL: ${url}`);
  console.log(`[crawler] Output: ${output}`);
  console.log(`[crawler] Options:`, opts);
  await run(url, output, opts);
}
