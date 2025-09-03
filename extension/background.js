// Background script for handling commands
chrome.commands.onCommand.addListener((command) => {
  console.log('[gigahiga] Command received:', command);
  
  if (command === 'open_palette') {
    // Send message to active tab to open palette
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'open_palette' }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('[gigahiga] Could not send message to content script:', chrome.runtime.lastError.message);
          }
        });
      }
    });
  }
});

console.log('[gigahiga] Background script loaded');
