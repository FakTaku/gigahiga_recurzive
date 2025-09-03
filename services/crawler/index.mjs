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
        appId,
        appCategory: 'development', // Default category
        elements: snapshot.elements.map(el => ({
          id: el.label?.toLowerCase().replace(/\s+/g, '_') || 'unknown',
          label: el.label,
          role: el.role,
          tag: el.tag,
          actions: el.actions
        })),
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
        items.push({
          selector: null,
          label, role,
          tag: el.tagName.toLowerCase(),
          actions,
          textNearby: (el.closest('label')?.textContent || '').trim().slice(0, 120)
        });
      } catch {}
    }
    return items;
  });
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

    // If we’re not authenticated for Gmail, guide first-time login
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

    const snapshot = {
      url: targetUrl,
      route: page.url(),
      elements,
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
