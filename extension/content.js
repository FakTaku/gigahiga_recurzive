(function () {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

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
    if (existing) {
      existing.remove();
      return;
    }
    const wrapper = document.createElement('div');
    wrapper.id = '__gigahiga_palette';
    wrapper.style.position = 'fixed';
    wrapper.style.left = '50%';
    wrapper.style.top = '20%';
    wrapper.style.transform = 'translateX(-50%)';
    wrapper.style.zIndex = '2147483647';
    wrapper.style.background = 'white';
    wrapper.style.color = '#111';
    wrapper.style.border = '1px solid #ddd';
    wrapper.style.borderRadius = '8px';
    wrapper.style.boxShadow = '0 10px 30px rgba(0,0,0,0.2)';
    wrapper.style.padding = '12px 14px';
    wrapper.style.minWidth = '420px';
    wrapper.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type a command… (Esc to close)';
    input.style.width = '100%';
    input.style.padding = '10px 12px';
    input.style.border = '1px solid #ccc';
    input.style.borderRadius = '6px';
    input.style.fontSize = '14px';
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        wrapper.remove();
      }
    });

    wrapper.appendChild(input);
    document.documentElement.appendChild(wrapper);
    input.focus();
  }

  window.addEventListener('keydown', onKeydown, true);
})();


