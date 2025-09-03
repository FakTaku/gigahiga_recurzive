gigahiga is here

Quickstart

- Config service: Node.js HTTP server serving a sample artifact for `mail.google.com`.
  - Run: `node services/config/server.js`
  - Get artifact: `http://localhost:8787/v1/config/mail.google.com`
  - Also available: `http://localhost:8787/v1/config/github.com`

- Core library: schema and resolver under `packages/core`.

- Browser extension (MV3): minimal content script captures Ctrl/Meta+K and shows a palette stub.
  - Load unpacked: open chrome://extensions, enable Developer mode, Load Unpacked → `extension/`.
  - Optional: click the extension icon to set a custom key for palette (stored as user override).
  - Intent execution: `nav.search` tries to focus search boxes; `compose.open` clicks Gmail compose.
Suggester service (stub)

- Run: `node services/suggester/server.js`
- Endpoint: `POST http://localhost:8788/v1/suggest`
- Body example:
```json
{
  "appCategory": "email",
  "elements": [{"id":"compose_btn","label":"Compose"}],
  "reserved": {"mac":["Meta+Q"],"win":["Alt+Tab"]}
}
```
Returns a simple heuristic suggestion list.

Structure

```
packages/core
  └─ src/{schema.ts,resolver.ts}
services/config
  ├─ server.js
  └─ artifacts/mail.google.com.json
extension
  ├─ manifest.json
  └─ content.js
```

Next steps

- Add LLM suggester service and Studio UI.
- Extend extension intents execution (DOM actions, navigation adapters).