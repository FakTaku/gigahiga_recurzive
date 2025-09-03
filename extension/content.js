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

  function getDomainAppId() {
    try {
      return location.hostname;
    } catch (_) {
      return '';
    }
  }

  function normalize(k) { return k.trim().toLowerCase(); }

  function indexBindings() {
    effectiveIndex.clear();
    if (!artifact) return;
    const platform = isMac ? 'mac' : 'win';
    const route = (location.pathname || '/') + (location.hash || '');
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
    // Overlay user overrides
    if (overrides && Array.isArray(overrides.overrides)) {
      for (const b of overrides.overrides) {
        const platformOk = !b.platform || b.platform.includes(platform);
        if (!platformOk) continue;
        effectiveIndex.set(normalize(b.key), { ...b, source: 'user_override', scopeName: 'user' });
      }
    }
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
      window.addEventListener('keydown', onHotkeyKeydown, true);
      __hk.listenerAttached = true;
    }
  }
  function hotkeysUnbindAll() {
    __hk.registry.clear();
  }
  function onHotkeyKeydown(e) {
    const isPalette = matchesPalette(e);
    if (paletteOpen && !isPalette) return;
    const combo = normalizeCombo(e);
    const handler = __hk.registry.get(combo);
    if (handler) {
      e.preventDefault();
      e.stopPropagation();
      handler(e);
      return;
    }
    if (isPalette) {
      e.preventDefault();
      e.stopPropagation();
      showPalette();
    }
  }

  function applyBindingsWithHotkeys() {
    hotkeysUnbindAll();
    for (const [combo, b] of effectiveIndex.entries()) {
      hotkeysBind(combo, () => dispatchIntent(b.intent));
    }
    // Ensure palette toggle is always bound
    const paletteCombo = isMac ? 'meta+k' : 'ctrl+k';
    hotkeysBind(paletteCombo, () => showPalette());
  }

  function showPalette() {
    const existing = document.getElementById('__gigahiga_palette');
    if (existing) { existing.remove(); return; }

    const wrapper = document.createElement('div');
    wrapper.id = '__gigahiga_palette';
    paletteOpen = true;
    Object.assign(wrapper.style, {
      position: 'fixed', left: '50%', top: '20%', transform: 'translateX(-50%)', zIndex: '2147483647',
      background: 'white', color: '#111', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
      padding: '12px 14px', minWidth: '480px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
    });

    // Add tab system
    const tabs = document.createElement('div');
    Object.assign(tabs.style, { display: 'flex', borderBottom: '1px solid #eee', marginBottom: '12px' });
    
    const commandsTab = document.createElement('button');
    Object.assign(commandsTab, { textContent: 'Commands' });
    Object.assign(commandsTab.style, { 
      padding: '8px 16px', border: 'none', background: 'transparent', cursor: 'pointer', borderBottom: '2px solid #007acc',
      color: '#007acc', fontWeight: '600'
    });
    
    const suggestionsTab = document.createElement('button');
    Object.assign(suggestionsTab, { textContent: 'Suggestions' });
    Object.assign(suggestionsTab.style, { 
      padding: '8px 16px', border: 'none', background: 'transparent', cursor: 'pointer', color: '#666'
    });
    
    tabs.appendChild(commandsTab);
    tabs.appendChild(suggestionsTab);
    
    // Content areas
    const commandsContent = document.createElement('div');
    const suggestionsContent = document.createElement('div');
    Object.assign(suggestionsContent.style, { display: 'none' });

    const input = document.createElement('input');
    Object.assign(input, { type: 'text', placeholder: 'Search actions… (Esc to close, Enter to run)' });
    Object.assign(input.style, { width: '100%', padding: '10px 12px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '14px' });

    const list = document.createElement('div');
    list.style.marginTop = '8px';

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
      currentItems = getCommands().filter(c => c.title.toLowerCase().includes(f) || c.intent.toLowerCase().includes(f));
      selectedIndex = Math.min(selectedIndex, Math.max(0, currentItems.length - 1));
      const view = currentItems.slice(0, 8);
      view.forEach((c, idx) => {
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', padding: '6px 4px', borderBottom: '1px solid #f2f2f2', cursor: 'pointer', background: idx === selectedIndex ? '#f6f6f6' : 'transparent' });
        row.textContent = '';
        const left = document.createElement('span');
        left.textContent = c.title;
        const right = document.createElement('code');
        right.textContent = c.key;
        row.appendChild(left); row.appendChild(right);
        row.__intent = c.intent;
        row.addEventListener('mouseenter', () => { selectedIndex = idx; highlightRows(); });
        row.addEventListener('click', () => { dispatchIntent(c.intent); closePalette(wrapper); });
        list.appendChild(row);
      });
      if (currentItems.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No actions';
        empty.style.color = '#777';
        empty.style.padding = '6px 4px';
        list.appendChild(empty);
      }
    }

    function highlightRows() {
      const rows = Array.from(list.children);
      rows.forEach((row, i) => {
        row.style.background = i === selectedIndex ? '#f6f6f6' : 'transparent';
      });
    }

    input.addEventListener('keydown', (ev) => {
      ev.stopImmediatePropagation();
      ev.stopPropagation();
      if (ev.key === 'Escape') { closePalette(wrapper); return; }
      if (ev.key === 'ArrowDown') { selectedIndex = Math.min(selectedIndex + 1, Math.max(0, currentItems.length - 1)); highlightRows(); ev.preventDefault(); return; }
      if (ev.key === 'ArrowUp') { selectedIndex = Math.max(selectedIndex - 1, 0); highlightRows(); ev.preventDefault(); return; }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const choice = currentItems && currentItems[selectedIndex];
        if (choice) { dispatchIntent(choice.intent); closePalette(wrapper); return; }
      }
    });

    input.addEventListener('input', () => render(input.value));

    commandsContent.appendChild(input);
    commandsContent.appendChild(list);

    // Suggestions tab content
    const suggestionsList = document.createElement('div');
    const refreshBtn = document.createElement('button');
    Object.assign(refreshBtn, { textContent: 'Refresh Suggestions' });
    Object.assign(refreshBtn.style, { 
      padding: '8px 12px', marginBottom: '12px', border: '1px solid #ccc', borderRadius: '4px', 
      background: '#f8f9fa', cursor: 'pointer'
    });
    
    let suggestions = [];
    
    async function loadSuggestions() {
      try {
        const payload = buildActionGraph();
        if (!payload || !payload.elements || payload.elements.length === 0) return;
        
        const res = await fetch('http://localhost:8788/v1/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) return;
        
        const data = await res.json();
        suggestions = data.suggestions || [];
        renderSuggestions();
      } catch (error) {
        console.log('[gigahiga] Failed to load suggestions:', error);
      }
    }
    
    function renderSuggestions() {
      suggestionsList.innerHTML = '';
      
      if (suggestions.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No suggestions available. Click "Refresh Suggestions" to get AI-generated shortcuts.';
        empty.style.color = '#777';
        empty.style.padding = '12px';
        empty.style.textAlign = 'center';
        suggestionsList.appendChild(empty);
        return;
      }
      
      // Simple list without confidence grouping
      suggestions.forEach(suggestion => {
        const row = document.createElement('div');
        Object.assign(row.style, { 
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
          padding: '8px 0', borderBottom: '1px solid #f0f0f0' 
        });
        
        const left = document.createElement('div');
        const title = document.createElement('div');
        Object.assign(title, { textContent: suggestion.intent || 'Unknown Action' });
        Object.assign(title.style, { fontWeight: '500', marginBottom: '2px' });
        
        const subtitle = document.createElement('div');
        Object.assign(subtitle, { textContent: `Confidence: ${Math.round(suggestion.confidence * 100)}%` });
        Object.assign(subtitle.style, { fontSize: '12px', color: '#666' });
        
        left.appendChild(title);
        left.appendChild(subtitle);
        
        const right = document.createElement('div');
        Object.assign(right.style, { display: 'flex', alignItems: 'center', gap: '8px' });
        
        const keys = document.createElement('code');
        Object.assign(keys, { textContent: suggestion.keys?.join(', ') || 'No keys' });
        Object.assign(keys.style, { 
          padding: '4px 8px', background: '#f0f0f0', borderRadius: '4px', fontSize: '12px' 
        });
        
        const acceptBtn = document.createElement('button');
        Object.assign(acceptBtn, { textContent: 'Accept' });
        Object.assign(acceptBtn.style, { 
          padding: '4px 8px', border: '1px solid #28a745', borderRadius: '4px', 
          background: '#28a745', color: 'white', cursor: 'pointer', fontSize: '12px' 
        });
        
        acceptBtn.addEventListener('click', (event) => acceptSuggestion(suggestion, event));
        
        right.appendChild(keys);
        right.appendChild(acceptBtn);
        
        row.appendChild(left);
        row.appendChild(right);
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
        
        // Force reload from storage to ensure consistency
        await loadArtifactAndOverrides();
        
        console.log('[gigahiga] After reload - effectiveIndex size:', effectiveIndex.size);
        console.log('[gigahiga] After reload - overrides:', overrides);
        
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
        showGlobalMessage(`✅ "${intentTitle(suggestion.intent)}" shortcut (${suggestion.keys[0]}) is now active!`, 'success');
        
        // Force refresh of Commands tab if it's currently shown
        if (commandsContent.style.display !== 'none') {
          render('');
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
    
    refreshBtn.addEventListener('click', loadSuggestions);
    suggestionsContent.appendChild(refreshBtn);
    suggestionsContent.appendChild(suggestionsList);
    
    // Tab switching
    function showTab(tabName) {
      if (tabName === 'commands') {
        commandsContent.style.display = 'block';
        suggestionsContent.style.display = 'none';
        commandsTab.style.borderBottomColor = '#007acc';
        commandsTab.style.color = '#007acc';
        commandsTab.style.fontWeight = '600';
        suggestionsTab.style.borderBottomColor = 'transparent';
        suggestionsTab.style.color = '#666';
        suggestionsTab.style.fontWeight = 'normal';
        input.focus();
      } else {
        commandsContent.style.display = 'none';
        suggestionsContent.style.display = 'block';
        suggestionsTab.style.borderBottomColor = '#007acc';
        suggestionsTab.style.color = '#007acc';
        suggestionsTab.style.fontWeight = '600';
        commandsTab.style.borderBottomColor = 'transparent';
        commandsTab.style.color = '#666';
        commandsTab.style.fontWeight = 'normal';
      }
    }
    
    commandsTab.addEventListener('click', () => showTab('commands'));
    suggestionsTab.addEventListener('click', () => showTab('suggestions'));
    
    wrapper.appendChild(tabs);
    wrapper.appendChild(commandsContent);
    wrapper.appendChild(suggestionsContent);
    document.documentElement.appendChild(wrapper);
    
    showTab('commands');
    render('');
    
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
      case 'nav.search': return 'Search';
      case 'nav.home': return 'Home';
      case 'nav.profile': return 'Profile';
      case 'nav.settings': return 'Settings';
      
      // Composition and messaging
      case 'compose.open': return 'Compose';
      case 'message.send': return 'Send';
      case 'draft.save': return 'Save Draft';
      
      // GitHub/Development
      case 'nav.pull_requests': return 'Pull Requests';
      case 'nav.issues': return 'Issues';
      case 'nav.repository': return 'Repository';
      case 'nav.code': return 'Code';
      
      // Common actions
      case 'action.add': return 'Add';
      case 'action.delete': return 'Delete';
      case 'action.edit': return 'Edit';
      case 'action.undo': return 'Undo';
      case 'action.redo': return 'Redo';
      
      // Drawing tools (for apps like Excalidraw)
      case 'tool.select': return 'Selection Tool';
      case 'tool.draw': return 'Drawing Tool';
      case 'tool.text': return 'Text Tool';
      case 'tool.image': return 'Image Tool';
      case 'tool.zoom': return 'Zoom Tool';
      case 'tool.pan': return 'Pan Tool';
      
      // Form inputs
      case 'input.focus': return 'Focus Input';
      
      // Legacy/additional intents
      case 'nav.homepage': return 'Homepage';
      case 'nav.preferences': return 'Preferences';
      case 'nav.account': return 'Account';
      case 'nav.compose': return 'Compose';
      case 'nav.new': return 'New';
      case 'nav.create': return 'Create';
      case 'nav.send': return 'Send';
      case 'nav.submit': return 'Submit';
      case 'nav.save': return 'Save';
      case 'nav.store': return 'Store';
      case 'nav.bug': return 'Bug Report';
      case 'nav.pr': return 'Pull Request';
      case 'nav.source': return 'Source Code';
      case 'nav.plus': return 'Add New';
      case 'nav.remove': return 'Remove';
      case 'nav.modify': return 'Modify';
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
        const stored = await chrome.storage.sync.get(['gh_overrides']);
        const all = stored && stored.gh_overrides ? stored.gh_overrides : {};
        overrides = all[appId] || null;
      }
    } catch (error) {
      if (!handleExtensionError(error, 'loadArtifactAndOverrides')) {
        console.warn('[gigahiga] Failed to load overrides:', error.message);
      }
      overrides = null;
    }
    
    indexBindings();
  }

  // Re-index on route changes for SPAs
  const mo = new MutationObserver(() => {
    indexBindings();
    applyBindingsWithHotkeys();
  });
  mo.observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('hashchange', () => { indexBindings(); applyBindingsWithHotkeys(); });

  loadArtifactAndOverrides();
  // Initial apply after first index
  applyBindingsWithHotkeys();

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


