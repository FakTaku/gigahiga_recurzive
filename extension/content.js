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

  function onKeydown(e) {
    if (paletteOpen) {
      // While palette is open, ignore global shortcuts to avoid interference
      return;
    }
    const combo = normalizeCombo(e);
    const hit = effectiveIndex.get(combo);
    if (hit) {
      e.preventDefault();
      e.stopPropagation();
      dispatchIntent(hit.intent);
      return;
    }
    if (matchesPalette(e)) {
      e.preventDefault();
      e.stopPropagation();
      // Placeholder: open a minimal palette stub
      showPalette();
      return;
    }
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
  });
  mo.observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('hashchange', indexBindings);

  loadArtifactAndOverrides();
  window.addEventListener('keydown', onKeydown, true);

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


