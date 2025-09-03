(function () {
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

    // Tag top row with intent for Enter behavior
    const origAppend = list.appendChild.bind(list);
    list.appendChild = (el) => {
      const children = list.children;
      if (el && el.addEventListener) {
        // infer intent stored in click handler closure by patching
      }
      return origAppend(el);
    };

    wrapper.appendChild(input);
    wrapper.appendChild(list);
    document.documentElement.appendChild(wrapper);
    input.focus();
    render('');
    // Fetch AI suggestions on open (non-blocking)
    try {
      collectElementsAndSuggest().catch(() => {});
    } catch (_) {}
    // nothing else
  }

  function closePalette(wrapper) {
    try { wrapper.remove(); } catch(_) {}
    paletteOpen = false;
  }

  function intentTitle(intent) {
    switch (intent) {
      case 'palette.open': return 'Open Command Palette';
      case 'nav.search': return 'Search';
      case 'compose.open': return 'Compose';
      case 'message.send': return 'Send';
      case 'draft.save': return 'Save Draft';
      default: return null;
    }
  }

  async function loadArtifactAndOverrides() {
    const appId = getDomainAppId();
    try {
      const res = await fetch(CONFIG_ENDPOINT + encodeURIComponent(appId));
      if (res.ok) {
        artifact = await res.json();
      }
    } catch (_) {}
    try {
      const stored = await chrome.storage.sync.get(['gh_overrides']);
      const all = stored && stored.gh_overrides ? stored.gh_overrides : {};
      overrides = all[appId] || null;
    } catch (_) {
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
      default:
        // no-op for unimplemented intents
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
})();


