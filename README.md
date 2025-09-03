gigahiga is here

Quickstart

- Config service: Node.js HTTP server serving a sample artifact for `mail.google.com`.
  - Run: `node services/config/server.js`
  - Get artifact: `http://localhost:8787/v1/config/mail.google.com`

- Core library: schema and resolver under `packages/core`.

- Browser extension (MV3): minimal content script captures Ctrl/Meta+K and shows a palette stub.
  - Load unpacked: open chrome://extensions, enable Developer mode, Load Unpacked → `extension/`.

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
- Extend extension to fetch artifact and resolve bindings per route.