# Native Shortcut Detection Improvements

## Overview

This document describes the enhancements made to detect and respect native website shortcuts, preventing conflicts between our suggested shortcuts and existing site functionality.

## Problem Solved

Previously, the system would suggest shortcuts like `/` for search on GitHub, but GitHub already uses `/` natively to focus the search box. This caused conflicts and poor user experience.

## Enhancements Made

### 1. Enhanced Crawler (`services/crawler/index.mjs`)

#### New Function: `detectNativeShortcuts(page)`
- **Event Listener Hooking**: Intercepts `addEventListener` calls to detect keydown/keyup/keypress listeners
- **Access Key Extraction**: Scans DOM for `accesskey` attributes
- **Dynamic Shortcut Detection**: Waits for JavaScript to register shortcuts before extraction

#### Key Features:
```javascript
// Hooks into addEventListener to track keyboard event listeners
EventTarget.prototype.addEventListener = function(type, listener, options) {
  if (type === 'keydown' || type === 'keyup' || type === 'keypress') {
    // Track listener information
    window.__keydownListeners.push(listenerInfo);
  }
  return originalAddEventListener.call(this, type, listener, options);
};
```

#### Output:
```json
{
  "nativeShortcuts": [
    {
      "type": "accesskey",
      "key": "s",
      "source": "HTML attribute"
    },
    {
      "type": "event_listener", 
      "key": "unknown",
      "source": "document element",
      "hasKeyBinding": true
    }
  ]
}
```

### 2. Enhanced Suggester (`services/suggester/server.js`)

#### Improved LLM Prompt
- **Native Shortcut Context**: Includes existing shortcuts in the prompt
- **Conflict Avoidance Instructions**: Explicitly tells LLM not to override existing shortcuts
- **Alternative Suggestions**: Guides LLM to suggest alternatives when conflicts exist

#### Enhanced Heuristic Logic
- **Conflict Detection**: Checks against native shortcuts before suggesting keys
- **Alternative Keys**: Provides fallback shortcuts when preferred keys are taken
- **Confidence Adjustment**: Reduces confidence when using alternative keys

#### Example Conflict Resolution:
```javascript
// Before: Always suggests "/" for search
if (label.includes('search')) {
  keys = ['/', 'Alt+S']; 
}

// After: Checks for conflicts and suggests alternatives
if (label.includes('search')) {
  if (existingKeys.has('/')) {
    keys = ['Alt+S', 'Ctrl+Shift+F']; // Alternative shortcuts
    confidence = 0.7;
  } else {
    keys = ['/', 'Alt+S']; 
    confidence = 0.9;
  }
}
```

#### Enhanced Filtering
- **Native Shortcut Respect**: Filters out suggestions that conflict with site shortcuts
- **Browser + Site Reserved**: Combines browser-reserved and site-native shortcuts

### 3. Data Flow

```
Crawler → Detects native shortcuts → Snapshot includes nativeShortcuts
    ↓
Suggester → Receives nativeShortcuts → LLM prompt includes existing shortcuts
    ↓
Heuristics → Check against native shortcuts → Avoid conflicts
    ↓
Filtering → Remove conflicting suggestions → Final clean suggestions
```

## Testing

### Basic Test
```bash
node test_native_shortcuts.js
```
Tests basic accesskey and event listener detection with a simple HTML page.

### GitHub Test
```bash
node test_github_shortcuts.js
```
Tests real-world scenario with GitHub's `/` search shortcut.

## Benefits

1. **No More Conflicts**: Suggested shortcuts won't override existing site functionality
2. **Better User Experience**: Users can use both native and suggested shortcuts
3. **Smarter Suggestions**: LLM and heuristics make better decisions with context
4. **Future-Proof**: Automatically adapts to new shortcuts added by sites

## Limitations

1. **Event Listener Keys**: Can't easily extract specific keys from JavaScript event listeners
2. **Dynamic Shortcuts**: Some shortcuts registered after page load might be missed
3. **Library Detection**: Limited detection of shortcut libraries like Mousetrap

## Future Improvements

1. **Better Key Extraction**: Parse JavaScript to extract specific key bindings
2. **Library Detection**: Add support for common shortcut libraries
3. **Shortcut Testing**: Actually test shortcuts to verify they work
4. **User Feedback**: Allow users to report conflicts for manual resolution

## Usage

### Running Enhanced Crawler
```bash
cd services/crawler
node index.mjs https://github.com --suggest
```

### Testing Suggester
```bash
cd services/suggester
node server.js
```

The system now automatically detects and respects native shortcuts, providing a much better user experience without conflicts.
