// Debug script to see what the extension sends to suggester
// Run this in browser console on GitHub to see the data

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
    
    items.push({
      id: (label || 'unlabeled').toLowerCase().replace(/\s+/g, '_').slice(0, 50),
      label,
      role,
      tag: el.tagName.toLowerCase(),
      actions
    });
  }
  return items;
}

// Test what extension actually sends
const payload = {
  appId: location.hostname,
  platform: navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'mac' : 'win',
  route: location.pathname + location.hash,
  url: location.href,
  elements: collectElements().slice(0, 20), // First 20 elements
  reserved: { mac: ['Meta+Q'], win: ['Alt+Tab'] }
};

console.log('Extension payload to suggester:', payload);
console.log('Number of elements found:', payload.elements.length);
console.log('Sample elements:', payload.elements.slice(0, 5));
