(function () {
  // Check if extension context is available
  function isExtensionContextValid() {
    try {
      return !!(chrome && chrome.storage && chrome.storage.sync);
    } catch (e) {
      return false;
    }
  }

  // Global error handler for extension context issues
  function handleExtensionError(error, context = '') {
    console.error(`[gigahiga] Extension error in ${context}:`, error);
    if (error.message.includes('Extension context invalidated')) {
      console.warn('[gigahiga] Extension context invalidated. Some features may not work until page reload.');
      return true; // Handled
    }
    return false; // Not handled
  }

  const CONFIG_ENDPOINT = 'http://localhost:8787/v1/config/';
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  let artifact = null;
  let overrides = null;
  let effectiveIndex = new Map(); // key -> {intent, scope}
  let paletteOpen = false;
  
  // Initialize domain tracking
  window.gigahigaCurrentDomain = getDomainAppId();
  window.gigahigaSuggestions = [];

  function getDomainAppId() {
    try {
      return location.hostname;
    } catch (_) {
      return '';
    }
  }

  function getWebsiteName(domain) {
    if (!domain) return null;
    
    // Extract main website name from domain
    // e.g., github.com -> github, mail.google.com -> gmail, excalidraw.com -> excalidraw
    const specialCases = {
      'mail.google.com': 'gmail',
      'gmail.com': 'gmail'
    };
    
    if (specialCases[domain]) {
      return specialCases[domain];
    }
    
    // For regular domains, take the main part before .com/.org/.net etc
    const parts = domain.split('.');
    if (parts.length >= 2) {
      // Handle cases like github.com, youtube.com, excalidraw.com
      return parts[parts.length - 2];
    }
    
    return parts[0];
  }

  function normalize(k) { return k.trim().toLowerCase(); }

  function indexBindings() {
    effectiveIndex.clear();
    const platform = isMac ? 'mac' : 'win';
    const route = (location.pathname || '/') + (location.hash || '');
    
    // Process artifact bindings (if available)
    if (artifact) {
      const when = {};
      const ctx = { routePath: route, platform, when };
      // Simple inlined resolution: iterate scopes and bindings
      for (const scope of artifact.scopes || []) {
        if (!scope.routes || !Array.isArray(scope.routes)) continue;
        if (!scope.routes.some((p) => routeMatches(p, route))) continue;
        for (const b of scope.bindings || []) {
          if (b.platform && !b.platform.includes(platform)) continue;
          const key = normalize(b.key);
          const existing = effectiveIndex.get(key);
          const candidate = { ...b, scopeName: scope.name };
          if (!existing) {
            effectiveIndex.set(key, candidate);
          } else if (precedenceRank(candidate.source) > precedenceRank(existing.source)) {
            effectiveIndex.set(key, candidate);
          } else if ((candidate.priority || 0) > (existing.priority || 0)) {
            effectiveIndex.set(key, candidate);
          }
        }
      }
    }
    
    // Always process user overrides (even if no artifact)
    if (overrides && Array.isArray(overrides.overrides)) {
      console.log('[gigahiga] Processing', overrides.overrides.length, 'user overrides');
      for (const b of overrides.overrides) {
        const platformOk = !b.platform || b.platform.includes(platform);
        if (!platformOk) continue;
        const binding = { ...b, source: 'user_override', scopeName: 'user' };
        effectiveIndex.set(normalize(b.key), binding);
        console.log('[gigahiga] Added user override:', normalize(b.key), '→', b.intent);
      }
    } else {
      console.log('[gigahiga] No user overrides found');
    }
    
    console.log('[gigahiga] Total bindings indexed:', effectiveIndex.size);
  }

  function routeMatches(pattern, path) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$').test(path);
  }

  function precedenceRank(src) {
    if (src === 'user_override') return 3;
    if (src === 'developer_default') return 2;
    if (src === 'site_native') return 1;
    return 0;
  }

  function normalizeCombo(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.metaKey) parts.push('meta');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
    parts.push(key);
    return parts.join('+');
  }

  function matchesPalette(e) {
    // Ctrl+K on Win/Linux, Meta+K on Mac
    const key = e.key.toLowerCase();
    if (key !== 'k') return false;
    if (isMac) return e.metaKey && !e.ctrlKey;
    return e.ctrlKey && !e.metaKey;
  }

  // --- Lightweight hotkeys-style binding registry ---
  const __hk = { registry: new Map(), listenerAttached: false };
  function hotkeysBind(combo, handler) {
    const key = (combo || '').toLowerCase().trim();
    if (!key) return;
    __hk.registry.set(key, handler);
    if (!__hk.listenerAttached) {
      // Add multiple event listeners to ensure capture
      document.addEventListener('keydown', onHotkeyKeydown, true);
      window.addEventListener('keydown', onHotkeyKeydown, true);
      __hk.listenerAttached = true;
      console.log('[gigahiga] Hotkey listeners attached');
    }
  }
  function hotkeysUnbindAll() {
    __hk.registry.clear();
  }
  function onHotkeyKeydown(e) {
    const isPalette = matchesPalette(e);
    
    // Simple debug logging for Ctrl+K
    if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) {
      console.log('[gigahiga] Ctrl/Meta+K detected, isPalette:', isPalette);
    }
    
    // Only handle Ctrl+K/Meta+K for palette toggle
    if (isPalette) {
      console.log('[gigahiga] Palette toggle shortcut detected');
      e.preventDefault();
      e.stopPropagation();
      showPalette();
    }
  }

  function applyBindingsWithHotkeys() {
    hotkeysUnbindAll();
    
    // ONLY bind Ctrl+K/Meta+K for palette toggle - nothing else
    const paletteCombo = isMac ? 'meta+k' : 'ctrl+k';
    hotkeysBind(paletteCombo, () => {
      console.log('[gigahiga] Palette toggle triggered via:', paletteCombo);
      showPalette();
    });
    
    console.log('[gigahiga] Applied ONLY palette binding:', {
      paletteCombo,
      isMac,
      registrySize: __hk.registry.size
    });
  }

  function showPalette() {
    const existing = document.getElementById('__gigahiga_palette');
    if (existing) { 
      console.log('[gigahiga] Palette already open, closing it');
      existing.remove(); 
      paletteOpen = false;
      console.log('[gigahiga] Palette closed, state reset');
      return; 
    }

    const wrapper = document.createElement('div');
    wrapper.id = '__gigahiga_palette';
    paletteOpen = true;
    Object.assign(wrapper.style, {
      position: 'fixed', left: '50%', top: '15%', transform: 'translateX(-50%)', zIndex: '2147483647',
      background: 'rgba(28, 30, 33, 0.95)', color: '#e8e9ea', border: '1px solid rgba(255, 255, 255, 0.1)', 
      borderRadius: '12px', boxShadow: '0 20px 40px rgba(0,0,0,0.4), 0 8px 16px rgba(0,0,0,0.2)',
      padding: '16px 18px', minWidth: '580px', maxWidth: '720px', 
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
      backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      outline: 'none' // Prevent focus outline
    });
    
    // Make wrapper focusable and capture all events
    wrapper.setAttribute('tabindex', '-1');
    
    // Capture all keyboard events at wrapper level to prevent leakage
    wrapper.addEventListener('keydown', (ev) => {
      ev.stopImmediatePropagation();
      ev.stopPropagation();
      // Don't prevent default here, let specific handlers manage it
    });
    
    wrapper.addEventListener('keypress', (ev) => {
      ev.stopImmediatePropagation();
      ev.stopPropagation();
    });
    
    wrapper.addEventListener('keyup', (ev) => {
      ev.stopImmediatePropagation();
      ev.stopPropagation();
    });
    
    // Prevent any mouse events from bubbling up
    wrapper.addEventListener('click', (ev) => {
      ev.stopPropagation();
    });
    
    wrapper.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
    });
    
    wrapper.addEventListener('mouseup', (ev) => {
      ev.stopPropagation();
    });

    // Add tab system
    const tabs = document.createElement('div');
    Object.assign(tabs.style, { display: 'flex', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', marginBottom: '16px' });
    
    const commandsTab = document.createElement('button');
    Object.assign(commandsTab, { textContent: 'Commands' });
    Object.assign(commandsTab.style, { 
      padding: '10px 20px', border: 'none', background: 'transparent', cursor: 'pointer', 
      borderBottom: '2px solid #4f9eff', color: '#4f9eff', fontWeight: '600', borderRadius: '4px 4px 0 0',
      transition: 'all 0.2s ease'
    });
    
    const suggestionsTab = document.createElement('button');
    Object.assign(suggestionsTab, { textContent: 'Suggestions' });
    Object.assign(suggestionsTab.style, { 
      padding: '10px 20px', border: 'none', background: 'transparent', cursor: 'pointer', 
      color: '#a8a9aa', borderRadius: '4px 4px 0 0', transition: 'all 0.2s ease'
    });
    
    // Create crawler tab
    const crawlerTab = document.createElement('button');
    Object.assign(crawlerTab, { textContent: 'Crawler' });
    Object.assign(crawlerTab.style, { 
      padding: '10px 20px', border: 'none', background: 'transparent', cursor: 'pointer', 
      color: '#a8a9aa', borderRadius: '4px 4px 0 0', transition: 'all 0.2s ease'
    });

    tabs.appendChild(commandsTab);
    tabs.appendChild(suggestionsTab);
    tabs.appendChild(crawlerTab);
    
    // Content areas
    const commandsContent = document.createElement('div');
    const suggestionsContent = document.createElement('div');
    const crawlerContent = document.createElement('div');
    Object.assign(suggestionsContent.style, { display: 'none' });
    Object.assign(crawlerContent.style, { display: 'none' });

    const input = document.createElement('input');
    Object.assign(input, { type: 'text', placeholder: 'Search actions… (Esc to close, Enter to run)' });
    Object.assign(input.style, { 
      width: '100%', padding: '12px 16px', border: '1px solid rgba(255, 255, 255, 0.1)', 
      borderRadius: '8px', fontSize: '15px', background: 'rgba(255, 255, 255, 0.05)', 
      color: '#e8e9ea', outline: 'none', transition: 'all 0.2s ease'
    });

    const list = document.createElement('div');
    Object.assign(list.style, { 
      marginTop: '12px', maxHeight: '300px', overflowY: 'auto', overflowX: 'hidden'
    });
    
    // Add custom scrollbar styling
    const scrollbarStyles = `
      #__gigahiga_palette div::-webkit-scrollbar {
        width: 8px;
      }
      #__gigahiga_palette div::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 4px;
      }
      #__gigahiga_palette div::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 4px;
      }
      #__gigahiga_palette div::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.3);
      }
    `;
    
    if (!document.getElementById('gigahiga-scrollbar-styles')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'gigahiga-scrollbar-styles';
      styleEl.textContent = scrollbarStyles;
      document.head.appendChild(styleEl);
    }

    function getCommands() {
      const cmds = [];
      // From effectiveIndex → combine into actions (intent -> key)
      for (const [key, b] of effectiveIndex.entries()) {
        const title = intentTitle(b.intent);
        if (!title) continue;
        cmds.push({ title, intent: b.intent, key });
      }
      // Deduplicate by intent, prefer shorter key strings
      const byIntent = new Map();
      for (const c of cmds) {
        const ex = byIntent.get(c.intent);
        if (!ex || c.key.length < ex.key.length) byIntent.set(c.intent, c);
      }
      return Array.from(byIntent.values());
    }

    let currentItems = [];
    let selectedIndex = 0;
    function render(filter) {
      list.innerHTML = '';
      const f = (filter || '').toLowerCase();
      const allCommands = getCommands();
      console.log('[gigahiga] render() called - all commands:', allCommands.length, allCommands);
      currentItems = allCommands.filter(c => c.title.toLowerCase().includes(f) || c.intent.toLowerCase().includes(f));
      console.log('[gigahiga] render() filtered commands:', currentItems.length, currentItems);
      selectedIndex = Math.min(selectedIndex, Math.max(0, currentItems.length - 1));
      const view = currentItems.slice(0, 4);
      view.forEach((c, idx) => {
        const row = document.createElement('div');
        Object.assign(row.style, { 
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 16px', margin: '4px 0', borderRadius: '8px', cursor: 'pointer', 
          background: idx === selectedIndex ? 'rgba(79, 158, 255, 0.15)' : 'rgba(255, 255, 255, 0.03)',
          border: '1px solid ' + (idx === selectedIndex ? 'rgba(79, 158, 255, 0.3)' : 'rgba(255, 255, 255, 0.05)'),
          transition: 'all 0.2s ease', minHeight: '48px'
        });
        row.textContent = '';
        const left = document.createElement('span');
        left.textContent = c.title;
        Object.assign(left.style, { fontSize: '15px', fontWeight: '500' });
        const right = document.createElement('code');
        right.textContent = c.key;
        Object.assign(right.style, { 
          background: 'rgba(255, 255, 255, 0.1)', padding: '6px 10px', 
          borderRadius: '6px', fontSize: '13px', color: '#4f9eff', fontWeight: '600'
        });
        row.appendChild(left); row.appendChild(right);
        row.__intent = c.intent;
        row.addEventListener('mouseenter', () => { selectedIndex = idx; highlightRows(); });
        row.addEventListener('click', () => { dispatchIntent(c.intent); wrapper.__closePalette(); });
        list.appendChild(row);
      });
      if (currentItems.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No actions';
        Object.assign(empty.style, { 
          color: '#a8a9aa', padding: '12px 16px', textAlign: 'center', 
          fontSize: '14px', fontStyle: 'italic'
        });
        list.appendChild(empty);
      }
    }

    function highlightRows() {
      const rows = Array.from(list.children);
      rows.forEach((row, i) => {
        if (row.textContent === 'No actions') return; // Skip empty state
        row.style.background = i === selectedIndex ? 'rgba(79, 158, 255, 0.15)' : 'rgba(255, 255, 255, 0.03)';
        row.style.border = i === selectedIndex ? '1px solid rgba(79, 158, 255, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)';
      });
    }

    input.addEventListener('keydown', (ev) => {
      ev.stopImmediatePropagation();
      ev.stopPropagation();
      ev.preventDefault(); // Prevent any default browser behavior
      
      if (ev.key === 'Escape') { 
        wrapper.__closePalette(); 
        return; 
      }
      if (ev.key === 'ArrowDown') { 
        selectedIndex = Math.min(selectedIndex + 1, Math.max(0, currentItems.length - 1)); 
        highlightRows(); 
        return; 
      }
      if (ev.key === 'ArrowUp') { 
        selectedIndex = Math.max(selectedIndex - 1, 0); 
        highlightRows(); 
        return; 
      }
      if (ev.key === 'Enter') {
        const choice = currentItems && currentItems[selectedIndex];
        if (choice) { 
          dispatchIntent(choice.intent); 
          wrapper.__closePalette(); 
        }
        return; 
      }
      
      // For all other keys, handle them as normal input
      if (ev.key.length === 1 || ev.key === 'Backspace' || ev.key === 'Delete') {
        // Don't prevent default for actual text input
        ev.preventDefault();
        const currentValue = input.value;
        let newValue = currentValue;
        
        if (ev.key === 'Backspace') {
          newValue = currentValue.slice(0, -1);
        } else if (ev.key === 'Delete') {
          // For simplicity, treat Delete like Backspace
          newValue = currentValue.slice(0, -1);
        } else if (ev.key.length === 1) {
          newValue = currentValue + ev.key;
        }
        
        input.value = newValue;
        render(newValue);
        selectedIndex = 0; // Reset selection on new input
      }
    });

    input.addEventListener('input', (ev) => {
      ev.stopImmediatePropagation();
      ev.stopPropagation();
      render(input.value);
    });
    
    // Capture all keyboard events on the input to prevent leakage
    input.addEventListener('keypress', (ev) => {
      ev.stopImmediatePropagation();
      ev.stopPropagation();
    });
    
    input.addEventListener('keyup', (ev) => {
      ev.stopImmediatePropagation();
      ev.stopPropagation();
    });

    commandsContent.appendChild(input);
    commandsContent.appendChild(list);

    // Suggestions tab content
    const suggestionsList = document.createElement('div');
    Object.assign(suggestionsList.style, { 
      maxHeight: '320px', overflowY: 'auto', overflowX: 'hidden'
          });


      
      let suggestions = window.gigahigaSuggestions || [];
    let currentDomain = window.gigahigaCurrentDomain;
    
    async function loadSuggestions() {
      try {
        const domain = getDomainAppId();
        const websiteName = getWebsiteName(domain);
        
        // If domain changed, clear previous suggestions
        if (currentDomain && currentDomain !== domain) {
          console.log('[gigahiga] Domain changed from', currentDomain, 'to', domain, '- clearing suggestions');
          suggestions = [];
          window.gigahigaSuggestions = [];
          currentDomain = domain;
          window.gigahigaCurrentDomain = domain;
        } else {
          currentDomain = domain;
          window.gigahigaCurrentDomain = domain;
        }
        
        if (!websiteName) {
          console.log('[gigahiga] No website name extracted from domain:', domain);
          return;
        }
        
        console.log('[gigahiga] Loading suggestions for website:', websiteName, 'from domain:', domain);
        
        // Load suggestions from website-specific JSON file
        const suggestionsFile = `${websiteName}_suggestions.json`;
        const res = await fetch(`http://localhost:8788/suggestions/${suggestionsFile}`);
        
        if (!res.ok) {
          console.log(`[gigahiga] No suggestions file found for ${websiteName} (tried ${suggestionsFile})`);
          return;
        }
        
        const data = await res.json();
        
        // Store suggestions with domain association
        suggestions = (data.suggestions || []).map(s => ({
          ...s,
          domain: domain,
          website: websiteName,
          loadedAt: new Date().toISOString()
        }));
        
        // Sync with global variable
        window.gigahigaSuggestions = suggestions;
        
        console.log(`[gigahiga] Loaded ${suggestions.length} suggestions for ${websiteName} from ${suggestionsFile}`);
        renderSuggestions();
      } catch (error) {
        console.log('[gigahiga] Failed to load suggestions:', error);
      }
    }
    
    function renderSuggestions() {
      suggestionsList.innerHTML = '';
      
      const domain = getDomainAppId();
      
      // Filter suggestions to only show those for current domain
      const domainSuggestions = suggestions.filter(s => !s.domain || s.domain === domain);
      
      if (domainSuggestions.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No suggestions available. Click "Refresh Suggestions" to get AI-generated shortcuts.';
        Object.assign(empty.style, { 
          color: '#a8a9aa', padding: '16px', textAlign: 'center', 
          fontSize: '14px', fontStyle: 'italic'
        });
        suggestionsList.appendChild(empty);
        return;
      }
      
      // Simple list without confidence grouping
      domainSuggestions.forEach(suggestion => {
        const row = document.createElement('div');
        Object.assign(row.style, { 
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
          padding: '12px 16px', margin: '6px 0', borderRadius: '8px',
          background: 'rgba(255, 255, 255, 0.03)', 
          border: '1px solid rgba(255, 255, 255, 0.05)',
          transition: 'all 0.2s ease'
        });
        
        const left = document.createElement('div');
        const title = document.createElement('div');
        Object.assign(title, { textContent: intentTitle(suggestion.intent) || 'Unknown Action' });
        Object.assign(title.style, { fontWeight: '500', marginBottom: '4px', fontSize: '15px', color: '#e8e9ea' });
        
        const subtitle = document.createElement('div');
        Object.assign(subtitle, { textContent: `Confidence: ${Math.round(suggestion.confidence * 100)}%` });
        Object.assign(subtitle.style, { fontSize: '13px', color: '#a8a9aa' });
        
        left.appendChild(title);
        left.appendChild(subtitle);
        
        const right = document.createElement('div');
        Object.assign(right.style, { display: 'flex', alignItems: 'center', gap: '12px' });
        
        const keys = document.createElement('code');
        Object.assign(keys, { textContent: suggestion.keys?.join(', ') || 'No keys' });
        Object.assign(keys.style, { 
          padding: '6px 12px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '6px', 
          fontSize: '13px', color: '#4f9eff', fontWeight: '600', minWidth: '60px', textAlign: 'center'
        });
        
        const acceptBtn = document.createElement('button');
        Object.assign(acceptBtn, { textContent: 'Accept' });
        Object.assign(acceptBtn.style, { 
          padding: '8px 16px', border: '1px solid #00d26a', borderRadius: '6px', 
          background: '#00d26a', color: 'white', cursor: 'pointer', fontSize: '13px',
          fontWeight: '600', transition: 'all 0.2s ease'
        });
        
        acceptBtn.addEventListener('click', (event) => acceptSuggestion(suggestion, event));
        acceptBtn.addEventListener('mouseenter', () => {
          acceptBtn.style.background = '#00b85c';
          acceptBtn.style.transform = 'translateY(-1px)';
        });
        acceptBtn.addEventListener('mouseleave', () => {
          acceptBtn.style.background = '#00d26a';
          acceptBtn.style.transform = 'translateY(0)';
        });
        
        right.appendChild(keys);
        right.appendChild(acceptBtn);
        
        row.appendChild(left);
        row.appendChild(right);
        
        // Add hover effects for suggestion rows
        row.addEventListener('mouseenter', () => {
          row.style.background = 'rgba(255, 255, 255, 0.08)';
          row.style.border = '1px solid rgba(255, 255, 255, 0.15)';
        });
        row.addEventListener('mouseleave', () => {
          row.style.background = 'rgba(255, 255, 255, 0.03)';
          row.style.border = '1px solid rgba(255, 255, 255, 0.05)';
        });
        
        suggestionsList.appendChild(row);
      });
    }
    
    async function acceptSuggestion(suggestion, event) {
      const btn = event.target;
      const originalText = btn.textContent;
      
      try {
        console.log('[gigahiga] Accepting suggestion:', suggestion);
        
        // Validate suggestion has required fields
        if (!suggestion.intent || !suggestion.keys || suggestion.keys.length === 0) {
          console.error('[gigahiga] Invalid suggestion:', suggestion);
          showButtonError(btn, originalText, 'Invalid suggestion');
          return;
        }
        
        // Check if extension context is still valid
        if (!isExtensionContextValid()) {
          console.error('[gigahiga] Extension context invalidated - storage API unavailable');
          showButtonError(btn, originalText, 'Please reload page');
          showGlobalMessage('Extension was reloaded. Please refresh the page to accept suggestions.', 'error');
          return;
        }
        
        // Save as user override
        const appId = getDomainAppId();
        const storeKey = 'gh_overrides';
        
        console.log('[gigahiga] Getting stored overrides for appId:', appId);
        const stored = await chrome.storage.sync.get([storeKey]);
        console.log('[gigahiga] Stored data:', stored);
        
        const all = stored && stored[storeKey] ? stored[storeKey] : {};
        const current = all[appId] || { appId, overrides: [], updatedAt: new Date().toISOString() };
        
        console.log('[gigahiga] Current overrides for appId:', current);
        
        // Add the accepted suggestion
        const newOverride = {
          key: suggestion.keys[0],
          intent: suggestion.intent,
          source: 'user_override',
          selector: suggestion.selector || null
        };
        
        console.log('[gigahiga] New override:', newOverride);
        
        // Remove any existing override for this intent
        const others = current.overrides.filter(o => o.intent !== suggestion.intent);
        current.overrides = [...others, newOverride];
        current.updatedAt = new Date().toISOString();
        
        all[appId] = current;
        
        console.log('[gigahiga] Saving to storage:', { [storeKey]: all });
        await chrome.storage.sync.set({ [storeKey]: all });
        
        // Update local state and rebind
        overrides = current;
        console.log('[gigahiga] Updated local overrides:', overrides);
        
        // Force re-indexing to ensure new bindings are available
        console.log('[gigahiga] About to call indexBindings() directly with overrides:', overrides);
        indexBindings();
        
        // Re-apply hotkey bindings so the new shortcut actually works
        applyBindingsWithHotkeys();
        
        console.log('[gigahiga] After reload - effectiveIndex size:', effectiveIndex.size);
        console.log('[gigahiga] After reload - overrides:', overrides);
        
        // Get updated commands list for debugging
        const updatedCommands = [];
        for (const [key, b] of effectiveIndex.entries()) {
          const title = intentTitle(b.intent);
          if (title) {
            updatedCommands.push({ title, intent: b.intent, key, source: b.source });
          }
        }
        console.log('[gigahiga] Available commands after acceptance:', updatedCommands);
        
        // Show success message
        btn.textContent = 'Accepted!';
        btn.style.background = '#6c757d';
        btn.disabled = true;
        
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '#28a745';
          btn.disabled = false;
        }, 2000);
        
        console.log('[gigahiga] Successfully accepted suggestion');
        
        // Refresh the suggestions list to show updated state
        renderSuggestions();
        
        // Show message that it's now available in Commands tab
        showGlobalMessage(`✅ Shortcut "${suggestion.keys[0]}" for "${intentTitle(suggestion.intent)}" is ready! Check Commands tab.`, 'success');
        
        // Force refresh of Commands tab regardless of which tab is shown
        console.log('[gigahiga] Refreshing Commands tab with new binding');
        console.log('[gigahiga] effectiveIndex size before render:', effectiveIndex.size);
        
        // Show current commands for debugging
        const currentCommands = [];
        for (const [key, b] of effectiveIndex.entries()) {
          const title = intentTitle(b.intent);
          if (title) {
            currentCommands.push({ title, intent: b.intent, key, source: b.source });
          }
        }
        console.log('[gigahiga] Commands before render:', currentCommands);
        
        render('');
        
        // If currently on Suggestions tab, briefly show user the Commands tab
        if (suggestionsContent.style.display !== 'none') {
          // Add a subtle notification to check Commands tab
          setTimeout(() => {
            const notification = document.createElement('div');
            notification.textContent = '💡 Check the Commands tab to see your new shortcut!';
            Object.assign(notification.style, {
              padding: '8px',
              margin: '8px 0',
              background: '#e3f2fd',
              color: '#1565c0',
              border: '1px solid #bbdefb',
              borderRadius: '4px',
              fontSize: '12px',
              textAlign: 'center',
              cursor: 'pointer'
            });
            
            notification.addEventListener('click', () => {
              showTab('commands');
              notification.remove();
            });
            
            suggestionsList.insertBefore(notification, suggestionsList.firstChild);
            
            // Auto-remove after 8 seconds
            setTimeout(() => {
              if (notification.parentNode) notification.remove();
            }, 8000);
          }, 1000);
        }
        
      } catch (error) {
        console.error('[gigahiga] Failed to accept suggestion:', error);
        console.error('[gigahiga] Error details:', error.message, error.stack);
        
        // Handle specific Chrome extension errors
        if (handleExtensionError(error, 'acceptSuggestion')) {
          showButtonError(btn, originalText, 'Reload page');
          showGlobalMessage('Extension was reloaded. Please refresh the page to accept suggestions.', 'error');
        } else if (error.message.includes('storage')) {
          showButtonError(btn, originalText, 'Storage error');
          showGlobalMessage('Failed to save shortcut. Please try again.', 'error');
        } else {
          showButtonError(btn, originalText, 'Error!');
          showGlobalMessage('Failed to accept suggestion. Please try again.', 'error');
        }
      }
    }
    
    function showButtonError(btn, originalText, errorText) {
      btn.textContent = errorText;
      btn.style.background = '#dc3545';
      btn.disabled = true;
      
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '#28a745';
        btn.disabled = false;
      }, 3000);
    }
    
    function showGlobalMessage(text, type = 'info') {
      // Remove any existing global messages
      const existing = suggestionsList.querySelector('.gigahiga-global-message');
      if (existing) existing.remove();
      
      const message = document.createElement('div');
      message.className = 'gigahiga-global-message';
      message.textContent = text;
      
      const colors = {
        success: { bg: '#d4edda', color: '#155724', border: '#c3e6cb' },
        error: { bg: '#f8d7da', color: '#721c24', border: '#f5c6cb' },
        info: { bg: '#d1ecf1', color: '#0c5460', border: '#bee5eb' }
      };
      
      const style = colors[type] || colors.info;
      Object.assign(message.style, {
        padding: '12px',
        margin: '8px 0',
        background: style.bg,
        color: style.color,
        border: `1px solid ${style.border}`,
        borderRadius: '4px',
        fontSize: '13px',
        textAlign: 'center',
        fontWeight: '500'
      });
      
      suggestionsList.insertBefore(message, suggestionsList.firstChild);
      
      // Auto-remove after 5 seconds
      setTimeout(() => {
        if (message.parentNode) message.remove();
      }, 5000);
    }
    

    
    // Add input focus effects and prevent focus loss
    input.addEventListener('focus', () => {
      input.style.border = '1px solid rgba(79, 158, 255, 0.5)';
      input.style.background = 'rgba(255, 255, 255, 0.08)';
    });
    
    input.addEventListener('blur', (ev) => {
      // Prevent blur if it's happening within our extension
      const activeElement = document.activeElement;
      const palette = document.getElementById('__gigahiga_palette');
      if (palette && !palette.contains(activeElement)) {
        // Focus lost to outside element, restore it
        setTimeout(() => {
          if (document.getElementById('__gigahiga_palette')) {
            input.focus();
          }
        }, 0);
      } else {
        // Normal blur within extension
        input.style.border = '1px solid rgba(255, 255, 255, 0.1)';
        input.style.background = 'rgba(255, 255, 255, 0.05)';
      }
    });
    
    // Force focus back to input if clicked anywhere in the extension
    wrapper.addEventListener('click', (ev) => {
      // If click is not on a button or interactive element, focus the input
      if (!ev.target.matches('button, input, [contenteditable]')) {
        setTimeout(() => input.focus(), 0);
      }
    });
    suggestionsContent.appendChild(suggestionsList);
    
    // Crawler UI Form
    const crawlerForm = document.createElement('div');
    Object.assign(crawlerForm.style, { 
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    });

    // URL input
    const urlLabel = document.createElement('label');
    urlLabel.textContent = 'Website URL:';
    Object.assign(urlLabel.style, { 
      fontWeight: '600', 
      fontSize: '13px', 
      color: '#333' 
    });

    const urlInput = document.createElement('input');
    Object.assign(urlInput, {
      type: 'url',
      placeholder: 'https://example.com',
      value: location.href // Default to current page
    });
    Object.assign(urlInput.style, {
      padding: '8px',
      border: '1px solid #ccc',
      borderRadius: '4px',
      fontSize: '13px'
    });

    // Mode selector
    const modeLabel = document.createElement('label');
    modeLabel.textContent = 'Crawler Mode:';
    Object.assign(modeLabel.style, { 
      fontWeight: '600', 
      fontSize: '13px', 
      color: '#333' 
    });

    const modeSelect = document.createElement('select');
    ['enhanced', 'legacy', 'hybrid'].forEach(mode => {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
      if (mode === 'enhanced') option.selected = true;
      modeSelect.appendChild(option);
    });
    Object.assign(modeSelect.style, {
      padding: '8px',
      border: '1px solid #ccc',
      borderRadius: '4px',
      fontSize: '13px'
    });

    // Mode descriptions
    const modeDesc = document.createElement('div');
    modeDesc.innerHTML = `
      <small style="color: #666; line-height: 1.4;">
        <strong>Enhanced:</strong> Deep crawling with state exploration (30-60s)<br>
        <strong>Legacy:</strong> Fast basic element extraction (10-20s)<br>
        <strong>Hybrid:</strong> Combines both approaches (45-90s)
      </small>
    `;

    // Crawl button
    const crawlBtn = document.createElement('button');
    Object.assign(crawlBtn, { textContent: 'Start Crawl' });
    Object.assign(crawlBtn.style, {
      padding: '10px 16px',
      backgroundColor: '#4f9eff',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer'
    });

    // Status display
    const statusDiv = document.createElement('div');
    Object.assign(statusDiv.style, {
      padding: '12px',
      border: '1px solid #e0e0e0',
      borderRadius: '4px',
      backgroundColor: '#f9f9f9',
      fontSize: '13px',
      display: 'none'
    });

    // Results display
    const resultsDiv = document.createElement('div');
    Object.assign(resultsDiv.style, {
      marginTop: '12px',
      padding: '12px',
      border: '1px solid #e0e0e0',
      borderRadius: '4px',
      backgroundColor: '#f0f8ff',
      fontSize: '13px',
      display: 'none'
    });

    // Assemble form
    crawlerForm.appendChild(urlLabel);
    crawlerForm.appendChild(urlInput);
    crawlerForm.appendChild(modeLabel);
    crawlerForm.appendChild(modeSelect);
    crawlerForm.appendChild(modeDesc);
    crawlerForm.appendChild(crawlBtn);
    crawlerForm.appendChild(statusDiv);
    crawlerForm.appendChild(resultsDiv);

    crawlerContent.appendChild(crawlerForm);

    // Crawler functionality
    let currentCrawlJob = null;
    let statusCheckInterval = null;

    async function startCrawl() {
      const url = urlInput.value.trim();
      const mode = modeSelect.value;

      // Validation
      if (!url) {
        showCrawlerMessage('Please enter a valid URL', 'error');
        return;
      }

      try {
        new URL(url); // Validate URL format
      } catch (e) {
        showCrawlerMessage('Please enter a valid URL format', 'error');
        return;
      }

      // Update UI
      crawlBtn.textContent = 'Starting...';
      crawlBtn.disabled = true;
      statusDiv.style.display = 'block';
      resultsDiv.style.display = 'none';

      try {
        // Call crawler API
        const response = await fetch('http://localhost:8788/v1/crawl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, mode })
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`API Error: ${response.status} - ${error}`);
        }

        const result = await response.json();
        currentCrawlJob = result.jobId;

        // Show initial status
        statusDiv.innerHTML = `
          <div style="color: #4f9eff; font-weight: 600;">🔄 Crawl Started</div>
          <div style="margin-top: 4px;">Mode: ${mode.charAt(0).toUpperCase() + mode.slice(1)}</div>
          <div style="margin-top: 4px;">URL: ${url}</div>
          <div style="margin-top: 4px;">Job ID: ${currentCrawlJob}</div>
          <div style="margin-top: 4px;">Estimated time: ${result.estimatedDuration}</div>
        `;

        // Start status polling
        startStatusPolling(currentCrawlJob);

      } catch (error) {
        console.error('[gigahiga] Crawler start failed:', error);
        showCrawlerMessage(`Failed to start crawler: ${error.message}`, 'error');
        resetCrawlButton();
      }
    }

    function startStatusPolling(jobId) {
      if (statusCheckInterval) clearInterval(statusCheckInterval);
      
      statusCheckInterval = setInterval(async () => {
        try {
          const response = await fetch(`http://localhost:8788/v1/crawl/${jobId}`);
          if (!response.ok) {
            throw new Error(`Status check failed: ${response.status}`);
          }

          const job = await response.json();
          updateCrawlStatus(job);

          if (job.status === 'completed' || job.status === 'failed') {
            clearInterval(statusCheckInterval);
            statusCheckInterval = null;
            handleCrawlComplete(job);
          }
        } catch (error) {
          console.error('[gigahiga] Status check failed:', error);
          clearInterval(statusCheckInterval);
          statusCheckInterval = null;
          showCrawlerMessage(`Status check failed: ${error.message}`, 'error');
          resetCrawlButton();
        }
      }, 2000); // Check every 2 seconds
    }

    function updateCrawlStatus(job) {
      const duration = job.endTime ? 
        `${Math.round((job.endTime - job.startTime) / 1000)}s` : 
        `${Math.round((Date.now() - job.startTime) / 1000)}s`;

      statusDiv.innerHTML = `
        <div style="color: ${job.status === 'running' ? '#4f9eff' : job.status === 'completed' ? '#28a745' : '#dc3545'}; font-weight: 600;">
          ${job.status === 'running' ? '🔄' : job.status === 'completed' ? '✅' : '❌'} 
          ${job.status.charAt(0).toUpperCase() + job.status.slice(1)}
        </div>
        <div style="margin-top: 4px;">Mode: ${job.mode}</div>
        <div style="margin-top: 4px;">URL: ${job.url}</div>
        <div style="margin-top: 4px;">Duration: ${duration}</div>
        ${job.status === 'failed' && job.error ? 
          `<div style="margin-top: 4px; color: #dc3545;">Error: ${job.error}</div>` : ''}
      `;
    }

    function handleCrawlComplete(job) {
      resetCrawlButton();

      if (job.status === 'completed') {
        showCrawlerMessage('✅ Crawl completed successfully!', 'success');
        displayCrawlResults(job);
      } else {
        showCrawlerMessage(`❌ Crawl failed: ${job.error || 'Unknown error'}`, 'error');
      }
    }

    function displayCrawlResults(job) {
      // Try to load suggestions file if available
      const domain = new URL(job.url).hostname.replace(/[^a-zA-Z0-9]/g, '_');
      const suggestionsFile = `${domain}_${job.mode}_suggestions.json`;

      resultsDiv.innerHTML = `
        <div style="font-weight: 600; color: #28a745; margin-bottom: 8px;">
          🎉 Crawl Results
        </div>
        <div style="margin-bottom: 8px;">
          <strong>Snapshot saved:</strong> ${job.outputPath ? job.outputPath.split('/').pop() : 'Unknown'}
        </div>
        <div style="margin-bottom: 12px;">
          <strong>Suggestions file:</strong> ${suggestionsFile}
        </div>
        <button id="refreshSuggestionsBtn" style="
          padding: 6px 12px;
          background: #28a745;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
        ">Refresh Suggestions</button>
      `;
      resultsDiv.style.display = 'block';

      // Add event listener for refresh suggestions button
      const refreshSuggestionsBtn = resultsDiv.querySelector('#refreshSuggestionsBtn');
      refreshSuggestionsBtn.addEventListener('click', () => {
        // Switch to suggestions tab and refresh
        showTab('suggestions');
        loadSuggestions(); // This function already exists in the suggestions code
      });
    }

    function showCrawlerMessage(message, type = 'info') {
      const color = type === 'error' ? '#dc3545' : 
                   type === 'success' ? '#28a745' : '#4f9eff';
      
      statusDiv.innerHTML = `<div style="color: ${color}; font-weight: 600;">${message}</div>`;
      statusDiv.style.display = 'block';
    }

    function resetCrawlButton() {
      crawlBtn.textContent = 'Start Crawl';
      crawlBtn.disabled = false;
    }

    // Add button event listener
    crawlBtn.addEventListener('click', startCrawl);
    
    // Tab switching
    function showTab(tabName) {
      // Hide all content areas
      commandsContent.style.display = 'none';
      suggestionsContent.style.display = 'none';
      crawlerContent.style.display = 'none';
      
      // Reset all tab styles
      [commandsTab, suggestionsTab, crawlerTab].forEach(tab => {
        tab.style.borderBottomColor = 'transparent';
        tab.style.color = '#a8a9aa';
        tab.style.fontWeight = 'normal';
        tab.style.background = 'transparent';
      });
      
      if (tabName === 'commands') {
        commandsContent.style.display = 'block';
        commandsTab.style.borderBottomColor = '#4f9eff';
        commandsTab.style.color = '#4f9eff';
        commandsTab.style.fontWeight = '600';
        commandsTab.style.background = 'rgba(79, 158, 255, 0.1)';
        // Always focus input when switching to commands
        setTimeout(() => input.focus(), 0);
      } else if (tabName === 'suggestions') {
        suggestionsContent.style.display = 'block';
        suggestionsTab.style.borderBottomColor = '#4f9eff';
        suggestionsTab.style.color = '#4f9eff';
        suggestionsTab.style.fontWeight = '600';
        suggestionsTab.style.background = 'rgba(79, 158, 255, 0.1)';
        // Focus wrapper when on suggestions tab to maintain event capture
        setTimeout(() => wrapper.focus(), 0);
      } else if (tabName === 'crawler') {
        crawlerContent.style.display = 'block';
        crawlerTab.style.borderBottomColor = '#4f9eff';
        crawlerTab.style.color = '#4f9eff';
        crawlerTab.style.fontWeight = '600';
        crawlerTab.style.background = 'rgba(79, 158, 255, 0.1)';
        // Focus URL input when switching to crawler
        setTimeout(() => urlInput.focus(), 0);
      }
    }
    
    // Now define the showTab function after all elements are created
    showTab = function(tabName) {
      // Hide all content areas (with null checks)
      if (commandsContent) commandsContent.style.display = 'none';
      if (suggestionsContent) suggestionsContent.style.display = 'none';
      if (crawlerContent) crawlerContent.style.display = 'none';
      
      // Reset all tab styles (with null checks)
      [commandsTab, suggestionsTab, crawlerTab].filter(Boolean).forEach(tab => {
        if (tab) {
          tab.style.borderBottomColor = 'transparent';
          tab.style.color = '#a8a9aa';
          tab.style.fontWeight = 'normal';
          tab.style.background = 'transparent';
        }
      });
      
      if (tabName === 'commands' && commandsContent && commandsTab) {
        commandsContent.style.display = 'block';
        commandsTab.style.borderBottomColor = '#4f9eff';
        commandsTab.style.color = '#4f9eff';
        commandsTab.style.fontWeight = '600';
        commandsTab.style.background = 'rgba(79, 158, 255, 0.1)';
        // Always focus input when switching to commands
        setTimeout(() => input && input.focus(), 0);
      } else if (tabName === 'suggestions' && suggestionsContent && suggestionsTab) {
        suggestionsContent.style.display = 'block';
        suggestionsTab.style.borderBottomColor = '#4f9eff';
        suggestionsTab.style.color = '#4f9eff';
        suggestionsTab.style.fontWeight = '600';
        suggestionsTab.style.background = 'rgba(79, 158, 255, 0.1)';
        // Focus wrapper when on suggestions tab to maintain event capture
        setTimeout(() => wrapper && wrapper.focus(), 0);
      } else if (tabName === 'crawler' && crawlerContent && crawlerTab) {
        crawlerContent.style.display = 'block';
        crawlerTab.style.borderBottomColor = '#4f9eff';
        crawlerTab.style.color = '#4f9eff';
        crawlerTab.style.fontWeight = '600';
        crawlerTab.style.background = 'rgba(79, 158, 255, 0.1)';
        // Focus URL input when switching to crawler
        setTimeout(() => urlInput && urlInput.focus(), 0);
      }
    };
    
    // Add content to wrapper
    wrapper.appendChild(tabs);
    wrapper.appendChild(commandsContent);
    wrapper.appendChild(suggestionsContent);
    wrapper.appendChild(crawlerContent);
    document.documentElement.appendChild(wrapper);
    
    // Add tab event listeners (after all elements are created)
    commandsTab.addEventListener('click', () => showTab('commands'));
    suggestionsTab.addEventListener('click', () => showTab('suggestions'));
    crawlerTab.addEventListener('click', () => showTab('crawler'));
    
    // Store cleanup function reference after adding to DOM
    const paletteElement = document.getElementById('__gigahiga_palette');
    if (paletteElement) {
      paletteElement.__closePalette = wrapper.__closePalette;
    }
    
    showTab('commands');
    render('');
    
    // Ensure initial focus on the input field
    setTimeout(() => {
      input.focus();
      input.select(); // Select any existing text
    }, 0);
    
    // Add global escape handler as backup
    const globalEscapeHandler = (ev) => {
      if (ev.key === 'Escape' && document.getElementById('__gigahiga_palette')) {
        ev.stopImmediatePropagation();
        ev.stopPropagation();
        ev.preventDefault();
        const palette = document.getElementById('__gigahiga_palette');
        if (palette && palette.__closePalette) {
          palette.__closePalette();
        } else {
          wrapper.__closePalette();
        }
      }
    };
    document.addEventListener('keydown', globalEscapeHandler, true);
    
    // Add global focus trap to prevent focus from leaving the extension
    const focusTrap = (ev) => {
      const palette = document.getElementById('__gigahiga_palette');
      if (palette && !palette.contains(ev.target)) {
        ev.preventDefault();
        ev.stopPropagation();
        // Return focus to input
        setTimeout(() => {
          if (document.getElementById('__gigahiga_palette')) {
            input.focus();
          }
        }, 0);
      }
    };
    document.addEventListener('focusin', focusTrap, true);
    
    // Clean up event listeners when palette is closed
    const originalClosePalette = () => {
      document.removeEventListener('keydown', globalEscapeHandler, true);
      document.removeEventListener('focusin', focusTrap, true);
      try { wrapper.remove(); } catch(_) {}
      paletteOpen = false;
      console.log('[gigahiga] Palette closed, state reset');
    };
    
    // Store the cleanup function on wrapper
    wrapper.__closePalette = originalClosePalette;
    
    // Fetch AI suggestions on open (non-blocking)
    try {
      loadSuggestions().catch(() => {});
    } catch (_) {}
  }

  function closePalette(wrapper) {
    try { wrapper.remove(); } catch(_) {}
    paletteOpen = false;
  }

  function intentTitle(intent) {
    switch (intent) {
      // Core palette and navigation
      case 'palette.open': return 'Open Command Palette';
      case 'nav.search': return 'Go to Search';
      case 'nav.home': return 'Go to Home';
      case 'nav.profile': return 'Go to Profile';
      case 'nav.settings': return 'Open Settings';
      
      // Composition and messaging
      case 'compose.open': return 'Create New';
      case 'message.send': return 'Send Message';
      case 'draft.save': return 'Save Draft';
      
      // GitHub/Development
      case 'nav.pull_requests': return 'View Pull Requests';
      case 'nav.issues': return 'View Issues';
      case 'nav.repository': return 'Go to Repository';
      case 'nav.code': return 'View Code';
      
      // Common actions
      case 'action.add': return 'Add Item';
      case 'action.delete': return 'Delete Item';
      case 'action.edit': return 'Edit Item';
      case 'action.undo': return 'Undo Last Action';
      case 'action.redo': return 'Redo Last Action';
      
      // Drawing tools (for apps like Excalidraw)
      case 'tool.select': return 'Select Tool';
      case 'tool.draw': return 'Drawing Tool';
      case 'tool.text': return 'Text Tool';
      case 'tool.image': return 'Insert Image';
      case 'tool.zoom': return 'Zoom Tool';
      case 'tool.pan': return 'Pan Tool';
      
      // Media controls
      case 'media.playpause': return 'Play/Pause Video';
      case 'media.fullscreen': return 'Toggle Fullscreen';
      case 'media.skip_forward': return 'Skip Forward';
      case 'media.skip_backward': return 'Skip Backward';
      case 'media.volume_up': return 'Volume Up';
      case 'media.volume_down': return 'Volume Down';
      
      // Email actions
      case 'message.reply': return 'Reply to Message';
      case 'message.forward': return 'Forward Message';
      case 'action.archive': return 'Archive Item';
      
      // Form inputs
      case 'input.focus': return 'Focus Input Field';
      
      // Legacy/additional intents
      case 'nav.homepage': return 'Go to Homepage';
      case 'nav.preferences': return 'Open Preferences';
      case 'nav.account': return 'Go to Account';
      case 'nav.compose': return 'Create New';
      case 'nav.new': return 'Create New';
      case 'nav.create': return 'Create Item';
      case 'nav.send': return 'Send';
      case 'nav.submit': return 'Submit Form';
      case 'nav.save': return 'Save';
      case 'nav.store': return 'Save to Storage';
      case 'nav.bug': return 'Report Bug';
      case 'nav.pr': return 'View Pull Request';
      case 'nav.source': return 'View Source Code';
      case 'nav.plus': return 'Add New Item';
      case 'nav.remove': return 'Remove Item';
      case 'nav.modify': return 'Edit Item';
      case 'nav.textbox': return 'Focus Text Input';
      
      // Smart fallback for any other intents
      default: return intent.replace(/\./g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
  }

  async function loadArtifactAndOverrides() {
    const appId = getDomainAppId();
    
    // Load artifact configuration
    try {
      const res = await fetch(CONFIG_ENDPOINT + encodeURIComponent(appId));
      if (res.ok) {
        artifact = await res.json();
      }
    } catch (error) {
      console.warn('[gigahiga] Failed to load artifact:', error.message);
    }
    
    // Load user overrides
    try {
      if (!isExtensionContextValid()) {
        console.warn('[gigahiga] Extension context invalid, cannot load overrides');
        overrides = null;
      } else {
        console.log('[gigahiga] Loading overrides for appId:', appId);
        const stored = await chrome.storage.sync.get(['gh_overrides']);
        console.log('[gigahiga] Raw stored data:', stored);
        const all = stored && stored.gh_overrides ? stored.gh_overrides : {};
        console.log('[gigahiga] All overrides:', all);
        overrides = all[appId] || null;
        console.log('[gigahiga] Overrides for', appId, ':', overrides);
      }
    } catch (error) {
      if (!handleExtensionError(error, 'loadArtifactAndOverrides')) {
        console.warn('[gigahiga] Failed to load overrides:', error.message);
      }
      overrides = null;
    }
    
    console.log('[gigahiga] About to call indexBindings() with overrides:', overrides);
    indexBindings();
  }

  // Re-index on route changes for SPAs and clear suggestions if domain changes
  const mo = new MutationObserver(() => {
    const newDomain = getDomainAppId();
    if (window.gigahigaCurrentDomain && window.gigahigaCurrentDomain !== newDomain) {
      console.log('[gigahiga] Domain changed during navigation - clearing suggestions');
      window.gigahigaCurrentDomain = newDomain;
      // Clear any cached suggestions for the old domain
      if (window.gigahigaSuggestions) {
        window.gigahigaSuggestions = [];
      }
    } else {
      window.gigahigaCurrentDomain = newDomain;
    }
    indexBindings();
    applyBindingsWithHotkeys();
  });
  mo.observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('hashchange', () => { 
    const newDomain = getDomainAppId();
    if (window.gigahigaCurrentDomain && window.gigahigaCurrentDomain !== newDomain) {
      console.log('[gigahiga] Domain changed via hashchange - clearing suggestions');
      window.gigahigaCurrentDomain = newDomain;
      if (window.gigahigaSuggestions) {
        window.gigahigaSuggestions = [];
      }
    }
    indexBindings(); 
    applyBindingsWithHotkeys(); 
  });

  // Initialize the extension
  console.log('[gigahiga] Initializing extension...');
  
  // Force immediate hotkey binding for palette
  // No emergency binding needed - let applyBindingsWithHotkeys handle it
  
  loadArtifactAndOverrides();
  // Initial apply after first index
  applyBindingsWithHotkeys();
  
  console.log('[gigahiga] Extension initialization complete');
  
  // Palette binding is already handled in applyBindingsWithHotkeys()
  console.log('[gigahiga] Palette shortcut ready via applyBindingsWithHotkeys');

  // Remove the backup handler since we only want one clean Ctrl+K handler
  console.log('[gigahiga] Simplified Ctrl+K handling - using only main hotkey binding');

  // Test function for debugging
  window.gigahigaTest = function() {
    console.log('[gigahiga] Test function called - opening palette');
    showPalette();
  };
  
  console.log('[gigahiga] Test function available: window.gigahigaTest()');

  // Listen for messages from background script
  if (isExtensionContextValid()) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('[gigahiga] Message received:', message);
      
      if (message.action === 'open_palette') {
        console.log('[gigahiga] Opening palette via background command');
        showPalette();
        sendResponse({ success: true });
        return true;
      }
    });
    console.log('[gigahiga] Message listener registered');
  }

  // --- Suggestions wiring ---
  async function collectElementsAndSuggest() {
    const payload = buildActionGraph();
    if (!payload || !payload.elements || payload.elements.length === 0) return;
    try {
      const res = await fetch('http://localhost:8788/v1/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) return;
      const data = await res.json();
      // For now, just log suggestions; UI integration comes next
      console.log('[gigahiga] suggestions', data);
    } catch (_) {}
  }

  function buildActionGraph() {
    try {
      const appId = getDomainAppId();
      const platform = isMac ? 'mac' : 'win';
      const route = (location.pathname || '/') + (location.hash || '');
      const elements = collectElements();
      const reserved = { mac: ['Meta+Q'], win: ['Alt+Tab'] };
      return { appId, platform, route, reserved, elements };
    } catch (_) {
      return null;
    }
  }

  function collectElements() {
    const nodes = Array.from(document.querySelectorAll(
      'a,button,input,textarea,select,[role],[onclick],[tabindex],.btn,.button'
    ));
    const items = [];
    const isVisible = (el) => {
      try {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return !!(rect.width && rect.height) && style.visibility !== 'hidden' && style.display !== 'none';
      } catch { return false; }
    };
    const getLabel = (el) => {
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
    };
    const roleOf = (el) => el.getAttribute('role') || (el.tagName === 'BUTTON' ? 'button' : el.tagName === 'A' ? 'link' : undefined);

    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const label = getLabel(el);
      const role = roleOf(el);
      const actions = [];
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') actions.push({ type: 'focus' });
      else actions.push({ type: 'click' });
      const selector = buildStableSelector(el);
      const elementId = (label || role || el.tagName.toLowerCase() || 'el')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
      items.push({ elementId, selector, role, label, actions });
      if (items.length >= 200) break; // cap for perf
    }
    return items;
  }

  function buildStableSelector(el) {
    // Prefer data-testid, aria, id, then class/tag path
    const attr = (name) => el.getAttribute(name);
    const prefer = [
      'data-testid','data-test','data-qa','aria-label','aria-controls','id','name','title'
    ];
    for (const a of prefer) {
      const v = attr(a);
      if (v) {
        const q = `[${a}=${JSON.stringify(v)}]`;
        try { if (document.querySelector(q) === el) return q; } catch(_) {}
      }
    }
    // fallback: tag.class path (shallow)
    const tag = el.tagName.toLowerCase();
    const cls = (el.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (cls) return `${tag}.${cls}`;
    return tag;
  }

  function dispatchIntent(intent) {
    switch (intent) {
      case 'palette.open':
        showPalette();
        break;
      case 'nav.search':
        focusSearch();
        break;
      case 'compose.open':
        clickCompose();
        break;
      case 'nav.home':
      case 'nav.homepage':
        navigateHome();
        break;
      case 'nav.profile':
      case 'nav.account':
        navigateProfile();
        break;
      case 'nav.settings':
      case 'nav.preferences':
        navigateSettings();
        break;
      case 'nav.repository':
        navigateRepository();
        break;
      case 'nav.issues':
        navigateIssues();
        break;
      case 'nav.pull_requests':
      case 'nav.pr':
        navigatePullRequests();
        break;
      case 'nav.code':
      case 'nav.source':
        navigateCode();
        break;
      case 'action.add':
      case 'nav.new':
      case 'nav.create':
      case 'nav.plus':
        clickAddNew();
        break;
      case 'action.delete':
      case 'nav.remove':
        clickDelete();
        break;
      case 'action.edit':
      case 'nav.modify':
        clickEdit();
        break;
      case 'input.focus':
      case 'nav.textbox':
        focusNextInput();
        break;
      case 'message.send':
      case 'nav.send':
        clickSend();
        break;
      case 'draft.save':
      case 'nav.save':
      case 'nav.store':
        clickSave();
        break;
      case 'nav.bug':
        navigateBugReport();
        break;
      case 'nav.compose':
        clickCompose();
        break;
      case 'nav.submit':
        clickSubmit();
        break;
      default:
        console.log('[gigahiga] Unhandled intent:', intent);
        break;
    }
  }

  function focusSearch() {
    // Heuristics: prefer role/textbox with search label, then input[type=search], then common selectors
    const candidates = [
      "[role='search'] input, [aria-label*='search' i], input[placeholder*='search' i]",
      "input[type='search']",
      "input[name='q']",
      "[data-testid*='search' i]",
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && typeof el.focus === 'function') {
        el.focus();
        if (el.select) try { el.select(); } catch(_) {}
        return;
      }
    }
  }

  function clickCompose() {
    // Gmail-friendly heuristic
    const candidates = [
      "[aria-label='Compose']",
      "[aria-label*='compose' i]",
      "button:contains('Compose')",
      "[data-testid*='compose' i]",
    ];
    for (const sel of candidates) {
      // :contains not supported in querySelector; handle text matching fallback
      if (sel.includes(":contains")) {
        const text = 'compose';
        const buttons = Array.from(document.querySelectorAll('button'));
        const match = buttons.find(b => (b.textContent || '').trim().toLowerCase().includes(text));
        if (match) { match.click(); return; }
        continue;
      }
      const el = document.querySelector(sel);
      if (el) { el.click(); return; }
    }
    // Fallback for Gmail when not logged-in UI differs or element not found: force compose via hash param
    try {
      const h = location.hash || '#inbox';
      if (!/compose=/.test(h)) {
        const next = h.includes('?') ? h + '&compose=new' : h + '?compose=new';
        location.hash = next;
      }
    } catch (_) {}
  }

  // Navigation intent handlers
  function navigateHome() {
    const candidates = [
      "a[href='/']",
      "a[href='/home']",
      "[aria-label*='home' i]",
      "[data-testid*='home' i]",
      "a:contains('Home')",
      "a:contains('Homepage')"
    ];
    clickFirstMatch(candidates);
  }

  function navigateProfile() {
    const candidates = [
      "a[href*='/profile']",
      "a[href*='/account']",
      "[aria-label*='profile' i]",
      "[aria-label*='account' i]",
      "[data-testid*='profile' i]",
      "[data-testid*='account' i]",
      "a:contains('Profile')",
      "a:contains('Account')"
    ];
    clickFirstMatch(candidates);
  }

  function navigateSettings() {
    const candidates = [
      "a[href*='/settings']",
      "a[href*='/preferences']",
      "[aria-label*='settings' i]",
      "[aria-label*='preferences' i]",
      "[data-testid*='settings' i]",
      "a:contains('Settings')",
      "a:contains('Preferences')"
    ];
    clickFirstMatch(candidates);
  }

  function navigateRepository() {
    const candidates = [
      "a[href*='/repo']",
      "a[href*='/repository']",
      "[aria-label*='repository' i]",
      "[data-testid*='repository' i]",
      "a:contains('Repository')",
      "a:contains('Repo')"
    ];
    clickFirstMatch(candidates);
  }

  function navigateIssues() {
    const candidates = [
      "a[href*='/issues']",
      "[aria-label*='issues' i]",
      "[data-testid*='issues' i]",
      "a:contains('Issues')",
      "a:contains('Bug')"
    ];
    clickFirstMatch(candidates);
  }

  function navigatePullRequests() {
    const candidates = [
      "a[href*='/pulls']",
      "a[href*='/pull-requests']",
      "[aria-label*='pull request' i]",
      "[data-testid*='pull' i]",
      "a:contains('Pull Request')",
      "a:contains('PR')"
    ];
    clickFirstMatch(candidates);
  }

  function navigateCode() {
    const candidates = [
      "a[href*='/tree']",
      "a[href*='/blob']",
      "[aria-label*='code' i]",
      "[aria-label*='source' i]",
      "[data-testid*='code' i]",
      "a:contains('Code')",
      "a:contains('Source')"
    ];
    clickFirstMatch(candidates);
  }

  function navigateBugReport() {
    const candidates = [
      "a[href*='/issues/new']",
      "a[href*='/bug']",
      "[aria-label*='bug' i]",
      "[aria-label*='report' i]",
      "[data-testid*='bug' i]",
      "a:contains('Bug')",
      "a:contains('Report')"
    ];
    clickFirstMatch(candidates);
  }

  // Action intent handlers
  function clickAddNew() {
    const candidates = [
      "button:contains('Add')",
      "button:contains('New')",
      "button:contains('Create')",
      "button:contains('+')",
      "[aria-label*='add' i]",
      "[aria-label*='new' i]",
      "[aria-label*='create' i]",
      "[data-testid*='add' i]",
      "[data-testid*='new' i]",
      "[data-testid*='create' i]"
    ];
    clickFirstMatch(candidates);
  }

  function clickDelete() {
    const candidates = [
      "button:contains('Delete')",
      "button:contains('Remove')",
      "[aria-label*='delete' i]",
      "[aria-label*='remove' i]",
      "[data-testid*='delete' i]",
      "[data-testid*='remove' i]"
    ];
    clickFirstMatch(candidates);
  }

  function clickEdit() {
    const candidates = [
      "button:contains('Edit')",
      "button:contains('Modify')",
      "[aria-label*='edit' i]",
      "[aria-label*='modify' i]",
      "[data-testid*='edit' i]",
      "[data-testid*='modify' i]"
    ];
    clickFirstMatch(candidates);
  }

  function clickSend() {
    const candidates = [
      "button:contains('Send')",
      "button:contains('Submit')",
      "[aria-label*='send' i]",
      "[aria-label*='submit' i]",
      "[data-testid*='send' i]",
      "[data-testid*='submit' i]"
    ];
    clickFirstMatch(candidates);
  }

  function clickSave() {
    const candidates = [
      "button:contains('Save')",
      "button:contains('Store')",
      "[aria-label*='save' i]",
      "[aria-label*='store' i]",
      "[data-testid*='save' i]",
      "[data-testid*='store' i]"
    ];
    clickFirstMatch(candidates);
  }

  function clickSubmit() {
    const candidates = [
      "button:contains('Submit')",
      "input[type='submit']",
      "[aria-label*='submit' i]",
      "[data-testid*='submit' i]"
    ];
    clickFirstMatch(candidates);
  }

  function focusNextInput() {
    // Focus the first available input or textarea
    const candidates = [
      "input[type='text']",
      "input[type='search']",
      "input[type='email']",
      "textarea",
      "input:not([type='hidden']):not([type='submit']):not([type='button'])"
    ];
    
    for (const selector of candidates) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        if (isVisible(el) && typeof el.focus === 'function') {
          el.focus();
          if (el.select) try { el.select(); } catch(_) {}
          return;
        }
      }
    }
  }

  function isVisible(el) {
    try {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return !!(rect.width && rect.height) && style.visibility !== 'hidden' && style.display !== 'none';
    } catch { return false; }
  }

  // Helper function to click the first matching element
  function clickFirstMatch(candidates) {
    for (const selector of candidates) {
      if (selector.includes(":contains")) {
        // Handle text matching manually
        const text = selector.match(/:contains\('([^']+)'\)/)?.[1]?.toLowerCase();
        if (text) {
          const elements = Array.from(document.querySelectorAll(selector.replace(/:contains\([^)]+\)/, '')));
          const match = elements.find(el => (el.textContent || '').trim().toLowerCase().includes(text));
          if (match && isVisible(match)) { match.click(); return; }
        }
        continue;
      }
      
      const el = document.querySelector(selector);
      if (el && isVisible(el)) { 
        el.click(); 
        return; 
      }
    }
  }
})();


