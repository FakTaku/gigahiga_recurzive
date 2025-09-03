// Enhanced Crawler with Deep Crawling and Multipage Support
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Enhanced state management
class CrawlerState {
  constructor() {
    this.visitedStates = new Map(); // stateId -> stateData
    this.stateGraph = new Map(); // stateId -> [childStateIds]
    this.actionQueue = []; // Queue of actions to perform
    this.currentStateId = null;
    this.maxDepth = 3; // Configurable depth limit
    this.currentDepth = 0;
  }

  generateStateId(url, domHash) {
    return crypto.createHash('md5').update(url + domHash).digest('hex');
  }

  hasVisited(stateId) {
    return this.visitedStates.has(stateId);
  }

  addState(stateId, stateData) {
    this.visitedStates.set(stateId, stateData);
    if (!this.stateGraph.has(stateId)) {
      this.stateGraph.set(stateId, []);
    }
  }

  addStateTransition(fromStateId, toStateId, action) {
    if (this.stateGraph.has(fromStateId)) {
      this.stateGraph.get(fromStateId).push({ stateId: toStateId, action });
    }
  }

  exportGraph() {
    return {
      states: Object.fromEntries(this.visitedStates),
      transitions: Object.fromEntries(this.stateGraph)
    };
  }
}

// Enhanced element extraction with deep context
async function extractEnhancedElements(frame, stateId) {
  return frame.evaluate((stateId) => {
    // Enhanced label extraction with hierarchy
    function getEnhancedLabel(el) {
      const labelSources = [];
      
      // ARIA labels
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) labelSources.push({ source: 'aria-label', value: ariaLabel });
      
      const ariaLabelledBy = el.getAttribute('aria-labelledby');
      if (ariaLabelledBy) {
        const labels = ariaLabelledBy.split(/\s+/)
          .map(id => document.getElementById(id)?.textContent?.trim())
          .filter(Boolean);
        if (labels.length) labelSources.push({ source: 'aria-labelledby', value: labels.join(' ') });
      }
      
      const ariaDescribedBy = el.getAttribute('aria-describedby');
      if (ariaDescribedBy) {
        const descriptions = ariaDescribedBy.split(/\s+/)
          .map(id => document.getElementById(id)?.textContent?.trim())
          .filter(Boolean);
        if (descriptions.length) labelSources.push({ source: 'aria-describedby', value: descriptions.join(' ') });
      }
      
      // Title attribute
      const title = el.getAttribute('title');
      if (title) labelSources.push({ source: 'title', value: title });
      
      // Placeholder for inputs
      const placeholder = el.getAttribute('placeholder');
      if (placeholder) labelSources.push({ source: 'placeholder', value: placeholder });
      
      // Text content
      const textContent = el.textContent?.trim();
      if (textContent && textContent.length <= 200) {
        labelSources.push({ source: 'textContent', value: textContent });
      }
      
      // Associated label element
      const labelEl = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
      if (labelEl && labelEl !== el) {
        const labelText = labelEl.textContent?.trim();
        if (labelText) labelSources.push({ source: 'label-element', value: labelText });
      }
      
      // Nearby text (parent context)
      let parent = el.parentElement;
      let depth = 0;
      while (parent && depth < 3) {
        const parentText = Array.from(parent.childNodes)
          .filter(node => node.nodeType === Node.TEXT_NODE)
          .map(node => node.textContent?.trim())
          .filter(Boolean)
          .join(' ');
        if (parentText) {
          labelSources.push({ source: `parent-text-${depth}`, value: parentText });
          break;
        }
        parent = parent.parentElement;
        depth++;
      }
      
      return {
        primary: labelSources[0]?.value || null,
        all: labelSources
      };
    }

    // Enhanced role detection
    function getEnhancedRole(el) {
      const explicitRole = el.getAttribute('role');
      if (explicitRole) return explicitRole;
      
      // Semantic HTML roles
      const tagRoles = {
        'button': 'button',
        'a': 'link',
        'input': el.type === 'submit' ? 'button' : 'textbox',
        'textarea': 'textbox',
        'select': 'combobox',
        'img': 'img',
        'nav': 'navigation',
        'header': 'banner',
        'main': 'main',
        'aside': 'complementary',
        'footer': 'contentinfo',
        'h1': 'heading',
        'h2': 'heading',
        'h3': 'heading',
        'h4': 'heading',
        'h5': 'heading',
        'h6': 'heading'
      };
      
      return tagRoles[el.tagName.toLowerCase()] || 'generic';
    }

    // Detect interaction capabilities
    function detectInteractions(el) {
      const interactions = [];
      
      // Basic interactions
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        interactions.push({ type: 'type', target: 'value' });
        interactions.push({ type: 'focus' });
        interactions.push({ type: 'blur' });
      }
      
      if (el.tagName === 'SELECT') {
        interactions.push({ type: 'select', target: 'option' });
      }
      
      // Click interactions
      const clickableElements = ['BUTTON', 'A', 'INPUT'];
      const hasClickHandler = el.onclick || el.getAttribute('onclick') || 
                             el.hasAttribute('data-action') || 
                             el.classList.contains('btn') || 
                             el.classList.contains('button');
      
      if (clickableElements.includes(el.tagName) || hasClickHandler || el.getAttribute('role') === 'button') {
        interactions.push({ type: 'click' });
      }
      
      // Hover interactions
      const hasHoverEffects = getComputedStyle(el).getPropertyValue('--hover') || 
                             [...el.classList].some(cls => cls.includes('hover'));
      if (hasHoverEffects) {
        interactions.push({ type: 'hover' });
      }
      
      // Drag and drop
      if (el.draggable || el.getAttribute('draggable') === 'true') {
        interactions.push({ type: 'drag' });
      }
      
      // Custom data attributes that suggest interactions
      const dataAttrs = Array.from(el.attributes)
        .filter(attr => attr.name.startsWith('data-'))
        .map(attr => ({ name: attr.name, value: attr.value }));
      
      if (dataAttrs.length) {
        interactions.push({ type: 'data-driven', attributes: dataAttrs });
      }
      
      return interactions;
    }

    // Get DOM hierarchy path
    function getDOMPath(el) {
      const path = [];
      let current = el;
      
      while (current && current !== document.body) {
        const tagName = current.tagName.toLowerCase();
        let selector = tagName;
        
        // Add ID if present
        if (current.id) {
          selector += `#${current.id}`;
        }
        
        // Add classes if present
        if (current.className && typeof current.className === 'string') {
          const classes = current.className.split(' ').filter(Boolean);
          if (classes.length) {
            selector += '.' + classes.slice(0, 3).join('.'); // Limit to 3 classes
          }
        }
        
        // Add position among siblings if needed for uniqueness
        if (!current.id) {
          const siblings = Array.from(current.parentElement?.children || [])
            .filter(sibling => sibling.tagName === current.tagName);
          if (siblings.length > 1) {
            const index = siblings.indexOf(current);
            selector += `:nth-of-type(${index + 1})`;
          }
        }
        
        path.unshift(selector);
        current = current.parentElement;
      }
      
      return path.join(' > ');
    }

    // Generate robust CSS selector
    function generateSelector(el) {
      // Try ID first
      if (el.id) {
        return `#${el.id}`;
      }
      
      // Try unique class combination
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.split(' ').filter(Boolean);
        for (let i = 1; i <= Math.min(classes.length, 3); i++) {
          const selector = '.' + classes.slice(0, i).join('.');
          if (document.querySelectorAll(selector).length === 1) {
            return selector;
          }
        }
      }
      
      // Try attribute selectors
      const uniqueAttrs = ['data-testid', 'data-id', 'aria-label', 'name'];
      for (const attr of uniqueAttrs) {
        const value = el.getAttribute(attr);
        if (value) {
          const selector = `[${attr}="${value}"]`;
          if (document.querySelectorAll(selector).length === 1) {
            return selector;
          }
        }
      }
      
      // Fall back to DOM path
      return getDOMPath(el);
    }

    // Enhanced visibility check
    function isEnhancedVisible(el) {
      try {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        
        const isGeometricallyVisible = rect.width > 0 && rect.height > 0;
        const isStyleVisible = style.visibility !== 'hidden' && 
                              style.display !== 'none' && 
                              style.opacity !== '0';
        const isInViewport = rect.top < window.innerHeight && 
                            rect.bottom > 0 && 
                            rect.left < window.innerWidth && 
                            rect.right > 0;
        
        return {
          visible: isGeometricallyVisible && isStyleVisible,
          inViewport: isInViewport,
          dimensions: { width: rect.width, height: rect.height },
          position: { top: rect.top, left: rect.left }
        };
      } catch {
        return { visible: false, inViewport: false };
      }
    }

    // Main extraction logic
    const selectors = [
      // Interactive elements
      'a', 'button', 'input', 'textarea', 'select',
      // ARIA roles
      '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="combobox"]',
      '[role="tab"]', '[role="menuitem"]', '[role="option"]',
      // Common interactive patterns
      '[onclick]', '[data-action]', '[data-click]', '[data-toggle]',
      '.btn', '.button', '.link', '.clickable',
      // Navigation elements
      'nav a', '.nav a', '.navigation a', '.menu a',
      // Form controls
      'form input', 'form button', 'form textarea', 'form select',
      // Content actions
      '[contenteditable="true"]', '[tabindex]'
    ];

    const nodes = new Set();
    selectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(el => nodes.add(el));
      } catch (e) {
        console.warn(`Invalid selector: ${selector}`, e);
      }
    });

    const elements = [];
    let elementIndex = 0;

    Array.from(nodes).forEach(el => {
      try {
        const visibility = isEnhancedVisible(el);
        if (!visibility.visible) return;

        const labels = getEnhancedLabel(el);
        const role = getEnhancedRole(el);
        const interactions = detectInteractions(el);
        const selector = generateSelector(el);
        const domPath = getDOMPath(el);

        // Enhanced element data
        const elementData = {
          index: elementIndex++,
          selector,
          domPath,
          labels,
          role,
          tag: el.tagName.toLowerCase(),
          interactions,
          attributes: {
            id: el.id || null,
            className: el.className || null,
            accessKey: el.getAttribute('accesskey') || null,
            tabIndex: el.tabIndex !== -1 ? el.tabIndex : null,
            disabled: el.disabled || null,
            required: el.required || null,
            href: el.href || null,
            target: el.target || null,
            type: el.type || null,
            name: el.name || null,
            value: el.value || null,
            placeholder: el.placeholder || null
          },
          aria: {
            label: el.getAttribute('aria-label'),
            labelledby: el.getAttribute('aria-labelledby'),
            describedby: el.getAttribute('aria-describedby'),
            expanded: el.getAttribute('aria-expanded'),
            selected: el.getAttribute('aria-selected'),
            checked: el.getAttribute('aria-checked'),
            disabled: el.getAttribute('aria-disabled'),
            hidden: el.getAttribute('aria-hidden'),
            live: el.getAttribute('aria-live'),
            controls: el.getAttribute('aria-controls'),
            owns: el.getAttribute('aria-owns')
          },
          data: Object.fromEntries(
            Array.from(el.attributes)
              .filter(attr => attr.name.startsWith('data-'))
              .map(attr => [attr.name, attr.value])
          ),
          visibility,
          boundingBox: {
            x: visibility.position.left,
            y: visibility.position.top,
            width: visibility.dimensions.width,
            height: visibility.dimensions.height
          },
          computedStyle: {
            cursor: getComputedStyle(el).cursor,
            pointerEvents: getComputedStyle(el).pointerEvents,
            userSelect: getComputedStyle(el).userSelect
          },
          context: {
            stateId,
            frameUrl: window.location.href,
            timestamp: new Date().toISOString()
          }
        };

        elements.push(elementData);
      } catch (error) {
        console.warn('Error processing element:', error);
      }
    });

    return elements;
  }, stateId);
}

// Detect page state changes
async function detectStateChange(page) {
  return page.evaluate(() => {
    // Create a simple DOM hash to detect changes
    const bodyHTML = document.body.innerHTML;
    const hash = Array.from(bodyHTML).reduce((hash, char) => {
      return ((hash << 5) - hash + char.charCodeAt(0)) & 0xffffffff;
    }, 0);
    
    return {
      url: window.location.href,
      title: document.title,
      domHash: hash.toString(),
      readyState: document.readyState,
      timestamp: new Date().toISOString()
    };
  });
}

// Enhanced navigation detection
async function findNavigationalElements(page) {
  return page.evaluate(() => {
    const navElements = [];
    
    // Find elements that likely cause navigation
    const navigationSelectors = [
      'a[href]:not([href^="#"]):not([href^="javascript:"])',
      'button[type="submit"]',
      '[data-navigate]',
      '[data-route]',
      '.nav-link',
      '.menu-item',
      '.tab',
      '[role="tab"]',
      '[role="menuitem"]'
    ];
    
    navigationSelectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach((el, index) => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            navElements.push({
              selector: selector,
              index,
              element: el,
              text: el.textContent?.trim().slice(0, 100),
              href: el.href,
              type: el.tagName.toLowerCase(),
              likelyNavigation: true
            });
          }
        });
      } catch (e) {
        console.warn(`Navigation selector error: ${selector}`, e);
      }
    });
    
    return navElements.map(nav => ({
      selector: nav.selector,
      index: nav.index,
      text: nav.text,
      href: nav.href,
      type: nav.type
    }));
  });
}

// Simulate user interactions to discover hidden states
async function simulateInteractions(page, elements, state) {
  const discoveries = [];
  
  // Limit interactions to prevent infinite loops
  const maxInteractions = Math.min(elements.length, 10);
  const interactableElements = elements
    .filter(el => el.interactions.some(int => ['click', 'hover'].includes(int.type)))
    .slice(0, maxInteractions);
  
  for (const element of interactableElements) {
    try {
      // Get current state
      const beforeState = await detectStateChange(page);
      
      // Try to find the element on the page
      const elementHandle = await page.$(element.selector).catch(() => null);
      if (!elementHandle) continue;
      
      // Try hover first to reveal hidden content
      if (element.interactions.some(int => int.type === 'hover')) {
        await elementHandle.hover();
        await sleep(500);
        
        const afterHover = await detectStateChange(page);
        if (afterHover.domHash !== beforeState.domHash) {
          discoveries.push({
            type: 'hover-revealed',
            element: element.selector,
            stateBefore: beforeState,
            stateAfter: afterHover
          });
        }
      }
      
      // Try click for navigation/modals
      if (element.interactions.some(int => int.type === 'click')) {
        // Check if this might open a modal or navigate
        const isLikelyModal = element.labels.primary?.toLowerCase().includes('settings') ||
                             element.labels.primary?.toLowerCase().includes('help') ||
                             element.attributes.role === 'button';
        
        const isLikelyNavigation = element.tag === 'a' && element.attributes.href;
        
        if (isLikelyModal || isLikelyNavigation) {
          await elementHandle.click();
          await sleep(1000);
          
          // Wait for potential navigation or DOM changes
          await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
          
          const afterClick = await detectStateChange(page);
          if (afterClick.domHash !== beforeState.domHash || afterClick.url !== beforeState.url) {
            discoveries.push({
              type: 'click-navigation',
              element: element.selector,
              stateBefore: beforeState,
              stateAfter: afterClick,
              actionTaken: 'click'
            });
            
            // If we navigated, this is a new state to explore
            if (afterClick.url !== beforeState.url) {
              return {
                newState: true,
                state: afterClick,
                discoveries
              };
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Interaction simulation failed for ${element.selector}:`, error.message);
    }
  }
  
  return { newState: false, discoveries };
}

// Enhanced native shortcut detection
async function detectAdvancedShortcuts(page) {
  console.log('[enhanced-crawler] Detecting advanced shortcuts...');
  
  const shortcuts = [];
  const url = page.url();
  
  try {
    // Common keyboard shortcuts to test
    const testShortcuts = [
      { keys: '/', description: 'Search focus' },
      { keys: 'Escape', description: 'Close modal/escape' },
      { keys: '?', description: 'Help/shortcuts' },
      { keys: 'g', description: 'Navigation prefix' },
      { keys: 'n', description: 'New item' },
      { keys: 'c', description: 'Compose' },
      { keys: 'r', description: 'Reply' },
      { keys: 'f', description: 'Forward' },
      { keys: 'Tab', description: 'Tab navigation' },
      { keys: 'Enter', description: 'Confirm/submit' }
    ];
    
    // Test each shortcut
    for (const shortcut of testShortcuts) {
      try {
        // Get state before
        const beforeState = await page.evaluate(() => ({
          activeElement: document.activeElement?.tagName,
          activeId: document.activeElement?.id,
          activeClass: document.activeElement?.className,
          url: window.location.href
        }));
        
        // Press the key
        await page.keyboard.press(shortcut.keys);
        await sleep(300);
        
        // Get state after
        const afterState = await page.evaluate(() => ({
          activeElement: document.activeElement?.tagName,
          activeId: document.activeElement?.id,
          activeClass: document.activeElement?.className,
          url: window.location.href
        }));
        
        // Check for changes
        const hasChange = JSON.stringify(beforeState) !== JSON.stringify(afterState);
        
        if (hasChange) {
          shortcuts.push({
            type: 'keyboard_shortcut',
            key: shortcut.keys,
            description: shortcut.description,
            effect: {
              before: beforeState,
              after: afterState
            },
            verified: true,
            source: 'keyboard_test'
          });
          
          console.log(`[enhanced-crawler] Detected shortcut: ${shortcut.keys} - ${shortcut.description}`);
        }
      } catch (error) {
        console.warn(`Shortcut test failed for ${shortcut.keys}:`, error.message);
      }
    }
    
    // Detect accesskey attributes
    const accessKeys = await page.evaluate(() => {
      const keys = [];
      document.querySelectorAll('[accesskey]').forEach(el => {
        const key = el.getAttribute('accesskey');
        if (key) {
          keys.push({
            key,
            element: el.tagName.toLowerCase(),
            id: el.id,
            label: el.textContent?.trim() || el.getAttribute('aria-label') || 'unlabeled'
          });
        }
      });
      return keys;
    });
    
    accessKeys.forEach(ak => {
      shortcuts.push({
        type: 'accesskey',
        key: ak.key,
        description: `Access key for ${ak.label}`,
        element: ak.element,
        elementId: ak.id,
        verified: true,
        source: 'html_attribute'
      });
    });
    
    console.log(`[enhanced-crawler] Detected ${shortcuts.length} shortcuts total`);
    return shortcuts;
    
  } catch (error) {
    console.error('[enhanced-crawler] Advanced shortcut detection failed:', error);
    return [];
  }
}

// Main enhanced crawler function
async function runEnhancedCrawler(targetUrl, outputPath, options = {}) {
  const {
    headed = false,
    chrome = false,
    authPath = null,
    waitMs = 2500,
    suggest = false,
    maxDepth = 3,
    maxInteractions = 10,
    enableStateCrawling = true,
    enableInteractionSimulation = true
  } = options;
  
  console.log(`[enhanced-crawler] Starting enhanced crawl of ${targetUrl}`);
  console.log(`[enhanced-crawler] Max depth: ${maxDepth}, Interactions: ${maxInteractions}`);
  
  const state = new CrawlerState();
  state.maxDepth = maxDepth;
  
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
      console.log(`[enhanced-crawler] Using auth state: ${authPath}`);
    }
    
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    
    // Navigate to initial page
    console.log(`[enhanced-crawler] Navigating to ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await sleep(waitMs);
    
    // Handle authentication if needed (similar to existing logic)
    const urlNow = page.url();
    const isGoogleAuth = /accounts\.google\.com/.test(urlNow);
    const isGmail = /mail\.google\.com/.test(targetUrl);
    
    if (isGmail && !contextOptions.storageState && isGoogleAuth) {
      if (!headed) {
        throw new Error('Gmail authentication required. Run with --headed --auth <path>');
      }
      console.log('[enhanced-crawler] Waiting for Gmail authentication...');
      await page.waitForURL(/mail\.google\.com\/mail/i, { timeout: 300000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await sleep(2000);
      
      if (authPath) {
        fs.mkdirSync(path.dirname(authPath), { recursive: true });
        await context.storageState({ path: authPath });
        console.log(`[enhanced-crawler] Saved auth state to ${authPath}`);
      }
    }
    
    // Start the enhanced crawling process
    const crawlQueue = [{ url: page.url(), depth: 0, parentAction: null }];
    const allStates = [];
    
    while (crawlQueue.length > 0 && state.currentDepth < state.maxDepth) {
      const currentCrawl = crawlQueue.shift();
      state.currentDepth = currentCrawl.depth;
      
      console.log(`[enhanced-crawler] Crawling depth ${currentCrawl.depth}: ${currentCrawl.url}`);
      
      // Detect current state
      const pageState = await detectStateChange(page);
      const stateId = state.generateStateId(pageState.url, pageState.domHash);
      
      if (state.hasVisited(stateId)) {
        console.log(`[enhanced-crawler] State already visited: ${stateId}`);
        continue;
      }
      
      // Light scroll to trigger lazy content
      await page.evaluate(() => window.scrollBy(0, 400));
      await sleep(600);
      
      // Extract enhanced elements
      console.log(`[enhanced-crawler] Extracting elements for state: ${stateId}`);
      const elements = await extractEnhancedElements(page, stateId);
      
      // Detect shortcuts
      const shortcuts = await detectAdvancedShortcuts(page);
      
      // Find navigational elements
      const navElements = await findNavigationalElements(page);
      
      // Create state data
      const stateData = {
        id: stateId,
        url: pageState.url,
        title: pageState.title,
        depth: currentCrawl.depth,
        parentAction: currentCrawl.parentAction,
        elements,
        shortcuts,
        navigation: navElements,
        metadata: {
          elementCount: elements.length,
          interactiveCount: elements.filter(el => el.interactions.length > 0).length,
          timestamp: new Date().toISOString()
        }
      };
      
      state.addState(stateId, stateData);
      allStates.push(stateData);
      
      // Simulate interactions to discover new states
      if (enableInteractionSimulation && currentCrawl.depth < state.maxDepth) {
        console.log(`[enhanced-crawler] Simulating interactions...`);
        const interactionResult = await simulateInteractions(page, elements, state);
        
        if (interactionResult.newState && enableStateCrawling) {
          const newStateUrl = interactionResult.state.url;
          if (!crawlQueue.some(item => item.url === newStateUrl)) {
            crawlQueue.push({
              url: newStateUrl,
              depth: currentCrawl.depth + 1,
              parentAction: {
                type: 'user_interaction',
                fromState: stateId,
                details: interactionResult.discoveries
              }
            });
            console.log(`[enhanced-crawler] Discovered new state: ${newStateUrl}`);
          }
        }
      }
    }
    
    // Compile final snapshot
    const finalSnapshot = {
      targetUrl,
      crawlMetadata: {
        totalStates: allStates.length,
        maxDepthReached: Math.max(...allStates.map(s => s.depth), 0),
        totalElements: allStates.reduce((sum, s) => sum + s.elements.length, 0),
        crawlDuration: Date.now() - Date.now(), // Will be set below
        options: {
          maxDepth,
          enableStateCrawling,
          enableInteractionSimulation
        }
      },
      states: allStates,
      stateGraph: state.exportGraph(),
      capturedAt: new Date().toISOString()
    };
    
    // Write enhanced snapshot
    console.log(`[enhanced-crawler] Writing enhanced snapshot with ${allStates.length} states`);
    fs.writeFileSync(outputPath, JSON.stringify(finalSnapshot, null, 2));
    
    // Send to suggester if requested
    if (suggest) {
      // Flatten all elements for suggester
      const allElements = allStates.flatMap(s => s.elements.map(el => ({
        ...el,
        stateId: s.id,
        stateDepth: s.depth
      })));
      
      const suggesterPayload = {
        url: targetUrl,
        elements: allElements.slice(0, 100), // Limit for API
        nativeShortcuts: allStates.flatMap(s => s.shortcuts),
        metadata: finalSnapshot.crawlMetadata
      };
      
      const suggestions = await sendToSuggester(suggesterPayload);
      if (suggestions) {
        const suggestionsPath = outputPath.replace('.json', '_enhanced_suggestions.json');
        fs.writeFileSync(suggestionsPath, JSON.stringify(suggestions, null, 2));
        console.log(`[enhanced-crawler] Saved enhanced suggestions to ${suggestionsPath}`);
      }
    }
    
    console.log(`[enhanced-crawler] Enhanced crawl complete!`);
    console.log(`  - States discovered: ${allStates.length}`);
    console.log(`  - Total elements: ${finalSnapshot.crawlMetadata.totalElements}`);
    console.log(`  - Output: ${outputPath}`);
    
    await browser.close();
    return finalSnapshot;
    
  } catch (error) {
    console.error('[enhanced-crawler] Error:', error);
    
    const errorSnapshot = {
      targetUrl,
      error: error.message,
      capturedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(errorSnapshot, null, 2));
    
    if (browser) await browser.close().catch(() => {});
    throw error;
  }
}

// Utility function to send to suggester (copy from existing)
async function sendToSuggester(payload, appId) {
  try {
    console.log('[enhanced-crawler] Sending enhanced payload to suggester...');
    const response = await fetch('http://localhost:8788/v1/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        appId: appId || new URL(payload.url).hostname,
        appCategory: 'enhanced',
        platform: process.platform === 'darwin' ? 'mac' : 'win'
      })
    });
    
    if (response.ok) {
      const suggestions = await response.json();
      console.log(`[enhanced-crawler] Received ${suggestions.suggestions?.length || 0} enhanced suggestions`);
      return suggestions;
    }
  } catch (error) {
    console.log('[enhanced-crawler] Suggester failed:', error.message);
  }
  return null;
}

// CLI handling
function parseEnhancedCLI() {
  const args = process.argv.slice(2);
  const url = args[0] || 'https://example.com';
  const output = args[1] || path.join(process.cwd(), 'enhanced-snapshot.json');
  
  const opts = {
    headed: false,
    chrome: false,
    authPath: null,
    waitMs: 2500,
    suggest: false,
    maxDepth: 3,
    maxInteractions: 10,
    enableStateCrawling: true,
    enableInteractionSimulation: true
  };
  
  for (let i = 2; i < args.length; i++) {
    const a = args[i];
    if (a === '--headed') opts.headed = true;
    else if (a === '--chrome') opts.chrome = true;
    else if (a === '--wait' && args[i+1]) opts.waitMs = Number(args[++i]) || 2500;
    else if (a === '--auth' && args[i+1]) opts.authPath = args[++i];
    else if (a === '--suggest') opts.suggest = true;
    else if (a === '--max-depth' && args[i+1]) opts.maxDepth = Number(args[++i]) || 3;
    else if (a === '--max-interactions' && args[i+1]) opts.maxInteractions = Number(args[++i]) || 10;
    else if (a === '--no-state-crawling') opts.enableStateCrawling = false;
    else if (a === '--no-interactions') opts.enableInteractionSimulation = false;
  }
  
  return { url, output, opts };
}

// Export for module use
export { runEnhancedCrawler, CrawlerState, extractEnhancedElements, detectAdvancedShortcuts };

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url, output, opts } = parseEnhancedCLI();
  console.log(`[enhanced-crawler] Target: ${url}`);
  console.log(`[enhanced-crawler] Output: ${output}`);
  console.log(`[enhanced-crawler] Options:`, opts);
  
  try {
    await runEnhancedCrawler(url, output, opts);
    process.exit(0);
  } catch (error) {
    console.error('[enhanced-crawler] Fatal error:', error);
    process.exit(1);
  }
}
