# dsh-deepseek-capture

**DeepSeek Harness plugin: auto-capture your DeepSeek web conversations, store them 100% locally, import selected messages into workspace sessions, and see how many tokens you've saved.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[中文说明](README.zh.md)

## What it does

| Capability | Description |
|---|---|
| **Auto-capture** | Companion MV3 browser extension watches `chat.deepseek.com`, pulls conversations via the official `history_messages` API, and syncs them to this plugin automatically. |
| **Local storage** | Data lives in `$DSH_HOME/capture/` (JSON, one file per conversation + `index.json`). **Zero upload** — and it's plain JSON, readable by any developer. |
| **Token savings stats** | Cumulative tokens saved / conversation count / today's captures / estimated savings (with the counting method stated on the page). |
| **Message-level import** | Don't import whole conversations — open a capture, **check individual messages** (quick-select "first 3 / last 3"), then import = **create a new Harness session** in the current workspace with those messages as its history. Continue chatting from there. |

## Architecture

```
Browser extension (MV3)                dsh plugin (this repo)
┌──────────────────────┐   POST   ┌──────────────────────────────┐
│ content script       │ ────────▶ │ lib/index.js  server half    │
│ · chat.deepseek.com  │ /capture │ · /capture/ingest    ingest   │
│ · official API pull  │          │ · /capture/sessions  list     │
│ · batched reporting  │          │ · /capture/messages  detail   │
└──────────────────────┘          │ · /capture/stats     stats    │
                                  │ · /capture/import    new sess │
                                  │ lib/client.js  Web sidebar    │
                                  │   sidebar.footer.action slot  │
                                  └──────────────────────────────┘
```

## Install

```bash
# 1. Install the plugin (after npm publish; for local dev use the same
#    link: approach as dsh-md-quiz)
dsh plugin --profile web add dsh-deepseek-capture
# Restart dsh web, refresh the browser.

# 2. Load the browser extension (extension/ ships inside the npm package;
#    also available from this repo)
#    Path: node_modules/dsh-deepseek-capture/extension/  (or repo extension/)
#    chrome://extensions → enable Developer mode → Load unpacked → pick extension/
#    Optional: click the extension icon → Options → confirm the backend URL
#    is http://127.0.0.1:3080 (the dsh web port).
```

> Note: Chrome deliberately blocks command-line loading of unpacked extensions;
> the manual "Load unpacked" step above is required (it's the standard flow).

## Usage

1. With the extension enabled, just chat on `chat.deepseek.com` — the extension syncs automatically.
2. A "⛁ DeepSeek Capture" button appears at the bottom of the Web sidebar:
   - Stat cards: total tokens saved / conversations / today's captures / estimated savings
   - Capture list: title, message count, tokens, import status
3. Click a conversation → **message-level picker**: check the messages you want (quick-select "first 3 / last 3 / all / clear").
4. Click "Import selected → new session (N)" — a new session appears in the sidebar; its history is exactly the messages you picked. Continue chatting there.

A `/capture` command also shows the stats overview right in the chat.

## API

| Method | Path | Description |
|---|---|---|
| POST | `/capture/ingest` | Extension reports a conversation `{source,url,title,captured_at,messages[]}`; idempotent merge by url, dedup by message_id |
| GET | `/capture/sessions` | Capture asset list (with import status) |
| GET | `/capture/messages?id=` | Full messages of one capture |
| GET | `/capture/stats` | Stats |
| GET | `/capture/search?q=` | Full-text search (SQLite FTS5 + LIKE fallback) |
| POST | `/capture/import` | `{id, indexes[]}` → create a new Harness session, returns `sessionId` |
| DELETE | `/capture/sessions?id=` | Delete a capture |

## Token accounting

- Prefers DeepSeek's official `accumulated_token_count` (the extension writes per-message `token_count`).
- Falls back to the Harness-style heuristic: 4 chars/token + structural overhead (same as `dsh-token-meter`).
- The stats page/command output always states the method; estimated savings use a `$0.02 / 1k tokens` reference price.

## Development

```bash
# Local link install (same as dsh-md-quiz):
# add "dsh-deepseek-capture": "link:E:/项目/dsh-deepseek-capture" to the
# profile's package.json dependencies, then:
dsh plugin --profile web add dsh-deepseek-capture   # triggers reconcile
```

Server-side changes (`lib/index.js`) require restarting `dsh web`; client-side
(`lib/client.js`) is read live without cache — just refresh the browser.

### Tests

```bash
npm test              # all suites except extension-e2e
npm run test:e2e      # extension→plugin full chain (needs dsh web running)
npm run pack:check    # inspect what npm pack would publish
```

## Roadmap

- [x] Plugin skeleton + storage + API + import-to-session + Web panel
- [x] Browser extension (official DeepSeek API capture + batched reporting)
- [x] End-to-end verified against a real `dsh web` (ingest/stats/import + client bundle injection)
- [x] SQLite full-text index (`node:sqlite` FTS5 + LIKE fallback, `/capture/search`)
- [x] Consecutive same-role message merging (import quality)
- [x] Panel search box
- [x] Chrome verification (popup render, manifest structure, extension logic tests)
- [x] Real headless-profile compatibility (loads without webServer, doesn't break startup)
- [ ] npm publish + `dsh-plugin` topic listing
- [ ] Chrome Web Store submission
- [ ] Real-account browser trial (requires loading the extension manually)
