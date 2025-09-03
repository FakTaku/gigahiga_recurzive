(async function(){
  const input = document.getElementById('key');
  const save = document.getElementById('save');
  const status = document.getElementById('status');

  function getDomain(url) {
    try { return new URL(url).hostname; } catch(_) { return null; }
  }

  async function getActiveTabUrl() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url || '';
  }

  const url = await getActiveTabUrl();
  const appId = getDomain(url);
  if (!appId) {
    status.textContent = 'No active tab domain.';
    return;
  }

  const storeKey = 'gh_overrides';
  const existing = await chrome.storage.sync.get([storeKey]);
  const all = existing && existing[storeKey] ? existing[storeKey] : {};
  const current = all[appId] || { appId, overrides: [], updatedAt: new Date().toISOString() };

  save.addEventListener('click', async () => {
    const combo = (input.value || '').trim();
    if (!combo) return;
    // Upsert palette.open override
    const others = (current.overrides || []).filter(o => o.intent !== 'palette.open');
    const next = {
      appId,
      overrides: [...others, { key: combo, intent: 'palette.open', source: 'user_override' }],
      updatedAt: new Date().toISOString()
    };
    all[appId] = next;
    await chrome.storage.sync.set({ [storeKey]: all });
    status.textContent = `Saved for ${appId}: ${combo}`;
  });
})();


