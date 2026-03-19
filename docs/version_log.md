# Version Log - PersonalClaw 📜

All notable changes to the PersonalClaw agent will be documented in this file.

## [12.2.0] - 2026-03-19

### Dashboard Overhaul & Workspace System

#### Edit Agent — Reports To Dropdown
- Edit Agent modal now includes a "Reports To" dropdown listing all other agents in the org (name + role)
- Current agent excluded from the list; selecting "Nobody" clears the reporting line
- Agent cards now show the actual manager name instead of just "Set"

#### Notification Null Guard Fix
- Fixed `[undefined] undefined: Proposed change to undefined` toast errors
- Root cause: `org:proposal:created` event handler was spreading proposal fields directly as notification fields, missing `orgName` and `agentName`
- Added null guards to all notification emission points: `org:proposal:created`, `org:blocker:created`, `org:notification`, and `formatActivitySummary`
- All notification fields now have fallback values

#### Proposals Tab — Code Only
- Proposals tab now filters to show only code change proposals (no `submissionType`)
- Documents, plans, and hiring decisions are auto-approved when `org_submit_for_review` is called (unless `requiresApproval: true` is explicitly set)
- Auto-approved submissions stored with `status: 'approved'`, `resolvedBy: 'auto'`

#### New Workspace Tab
- New tab between Board and Activity in the org workspace
- Files organised by agent role — each agent gets a collapsible section showing files they created (matched by role slug prefix in filenames)
- Inline file editor — click any file to open a textarea editor with save functionality
- Human comment system — leave comments on any file via input below the editor
- Comments stored as sidecar `{filename}.comments.json` files in the same directory
- Sidecar files automatically hidden from workspace file listings
- Agent system prompt injection — unread comments on agent's files are included in the next run's system prompt, then marked as read
- Path traversal protection — file read/write validates paths are within the workspace directory
- 6 new socket events: `org:workspace:files:all`, `org:workspace:file:read`, `org:workspace:file:write`, `org:workspace:file:comment`, `org:workspace:file:comments:read`, `org:workspace:file:content`

#### Board Tab Improvements
- Agent health cards are now clickable — expand on click to show full run summary, all file activity with timestamps, and run history (last 10 runs)
- Removed "Pending Code Proposals" section (proposals have their own tab)
- Removed workspace browser from Board (workspace has its own tab)

#### Git Protection Fix
- `snapshotGitFiles()` in `updateProtection()` now runs from `org.rootDir` instead of `org.workspaceDir`
- Fixes incorrect file count (0 files) when rootDir differs from workspaceDir

#### Protection Settings Visibility
- Settings tab now shows a "View all protected files" expandable section when git/both mode is active
- Files displayed in a scrollable code block, grouped by directory
- File count shown in the header
- Git file list updates when "Refresh from git" is clicked

---

## [12.0.0] - 2026-03-18

### Autonomous AI Company Orchestration System

#### Organisation Layer
- Create up to 10 AI organisations with name, mission, and root directory
- Orgs fully isolated — no cross-org awareness or shared state
- Org data persisted to `memory/orgs/{orgId}/` on disk
- Create orgs via Dashboard UI form or PersonalClaw chat (`manage_org` skill)
- Pause/resume per org (freezes all agent heartbeats)
- Soft-delete (data archived to `_deleted_{orgId}` directory)

#### Agent Personas
- Fully custom roles — CEO, CTO, Marketing, Developer, or anything you define
- Each agent: name, role, personality, responsibilities, goals, autonomy level, heartbeat cron, reporting line
- Per-agent persistent memory file — agents remember what they did last run
- Shared org memory — company-wide context visible to all agents
- Pause/resume per agent

#### Heartbeat Engine
- Cron schedule per agent (e.g. CEO weekly Monday 9am, Dev every 15 min)
- Event-triggered heartbeat — delegation wakes target agent automatically
- Manual trigger from dashboard (⚡ Run) or chat
- Skip-if-running — concurrent heartbeat skipped, not stacked
- All heartbeats stopped cleanly on graceful shutdown

#### Ticket System
- Full Kanban board per org: open → in_progress → blocked → done
- Priority levels: low, medium, high, critical
- Any agent can create/update/assign tickets
- Human can create tickets via dashboard or chat
- Full comment and history trail per ticket
- Write-lock protected — concurrent agents never corrupt ticket data

#### Org Agent Runner
- Org agents run as persona-injected Brain instances, outside ConversationManager
- System prompt: org mission, identity, colleagues, memory, shared memory, task queue
- Full access to all 15 existing skills (manage_scheduler excluded)
- Can spawn sub-agent workers via existing AgentRegistry
- Session history written to per-agent directory (not global memory/)
- Self-learning engine skips org agent runs

#### Direct Agent Chat
- Click 💬 Chat on any agent card to open a direct chat pane
- Persistent Brain per chat session — agent remembers full conversation context
- Chat pane is separate from the 3-pane Command Center limit
- Closing pane cleanly destroys the Brain and frees memory

## [11.1.0] - 2026-03-17

### Added
- **Per-Chat Stop Buttons**: Each chat pane now has an independent **⬛ Stop** button.
  - **Surgical Abort**: Instantly stops the primary brain's tool loop and kills all associated sub-agent workers for that specific chat window.
  - **Context-Friendly**: Preserves conversation history; the chat window remains open and ready for the next message after stopping.
  - **Backend Support**: New `Brain.resetAbort()`, `ConversationManager.abort()`, and `conversation:abort` socket event.
  - **Activity Feed**: Abort actions are now logged to the activity feed as "Conversation aborted".

### Fixed
- **Chat History Lost on Refresh**: Chat messages no longer disappear when the dashboard page is refreshed. The frontend now requests conversation history from the backend on connect via a new `conversation:history` socket event. New `ConversationManager.getMessages()` converts Gemini API history to frontend format, stripping system prompts, tool calls, and internal entries.
- **Stale Conversations**: Fixed "Conversation not found" error after server restarts by resyncing conversation IDs from the `init` socket event and re-requesting the list on reconnect.
- **Agent Offline Indicator**: Fixed a regression where the "Agent" status showed "Offline" even when connected. Refactored `useConversations.ts` listeners to use named handlers for surgical cleanup, preserving unrelated listeners like the connectivity status.

## [11.0.0] - 2026-03-17

### Removed
- **Paperclip AI** — entire integration removed. `src/skills/paperclip.ts`,
  `PaperClip/` directory, `docs/PAPERCLIP_SOP.md`, `docs/PAPERCLIP_SKILL.md` deleted.
  All references removed from brain, skill registry, and documentation.

### Multi-Chat — 3 Independent Panes
- Dashboard splits into up to 3 resizable chat panes via `react-resizable-panels`
- Each pane has its own isolated `Brain` instance, conversation history, and input
- Panes auto-numbered Chat 1 / Chat 2 / Chat 3 — label reused when pane is closed
- `+` button opens new pane (hidden when 3 are open), `x` closes (hidden on last pane)
- On close, conversation history auto-saved to SessionManager (retrievable via `/sessions`)
- Dashboard reconnect syncs pane state; server restart starts fresh (sessions on disk)

### Multi-Agent — 5 Sub-Agent Workers Per Pane
- New `spawn_agent` skill — primary brains spawn up to 5 parallel workers per conversation
- Workers: task string only, no history, no ability to spawn further agents
- Worker overflow queues automatically, runs when a slot frees
- Worker hard timeout: 5 minutes — resolves with error string, never crashes
- Collapsible sub-agent side panel per pane — slides in from right on worker activity
- Worker statuses: queued / running / waiting_for_lock / completed / failed / timed_out
- Superuser raw log viewer: `Alt+Shift+S` toggles, View Logs on completed worker cards

### Skill Lock System — Concurrent Resource Protection
- New `src/core/skill-lock.ts` — ExclusiveLock + ReadWriteLock
- Locks held per-execution only — acquired at run() entry, released in finally block
- `browser` + `vision` share `browser_vision` exclusive lock (all 3 browser modes covered)
- `clipboard` exclusive lock
- `memory` + `scheduler` read-write locks
- `files` + `pdf` per-path write locks
- `waiting_for_lock` worker status with holder info shown in UI (amber pulsing dot)
- `GET /api/locks` exposes current lock state

### Infrastructure
- `Brain` refactored from singleton to instantiable class
- `SkillMeta` passed to every skill invocation (agentId, conversationId, conversationLabel, isWorker)
- `src/core/telegram-brain.ts` — Telegram isolated Brain, outside ConversationManager
- `POST /api/chat` preserved — routes to Chat 1, creates if needed
- 6 new REST endpoints, 5 new socket events, 12 new Event Bus constants
- Tool streaming re-wired via Event Bus (not onUpdate callback)
- Graceful shutdown saves all open conversations before exit
- Worker system prompt guardrail prevents destructive operations by autonomous agents
- All 8 pre-build circular dependency and runtime issues resolved

## [10.4.1] - 2026-03-17

### Image Generation Enhancements
- **Local Serving**: The `outputs/` directory is now served as a static asset by the Express server.
- **Skill Integration**: The `generate_image` skill now returns an `output_url` (http://localhost:3000/outputs/...) for generated images.
- **Brain Rule**: Updated the system prompt (Rule 6) to ensure the AI always displays generated images using markdown `![image](output_url)`.

## [10.4.0] - 2026-03-16


### New Multi-Media Skills
Implemented two powerful new skills for handling PDF documents and AI image generation.

#### New: `src/skills/pdf.ts` — PDF Management
- **`manage_pdf`** skill with 8 high-level actions:
  - `extract_text` — Full text extraction via `pdfjs-dist`.
  - `metadata` — Inspect title, author, page count, and version.
  - `merge` — Combine multiple PDFs into a single file.
  - `split` — Split PDFs by page ranges.
  - `rotate` — Batch rotate pages (90/180/270 degrees).
  - `watermark` — Add diagonal text watermarks with translucency.
  - `create` — Generate new PDFs from plain text/markdown content.
  - `extract_pages` — Slice specific pages into a new document.
- Built using `pdf-lib` for modification and `pdfjs-dist` (v5) for extraction.

#### New: `src/skills/imagegen.ts` — AI Image Generation
- **`generate_image`** skill with dual-model intelligent fallback:
  - **Imagen 3** (`imagen-3.0-generate-002`) — High-fidelity, photorealistic generations with support for aspect ratios (1:1, 16:9, etc.) and multiple variants.
  - **Gemini 2.0 Flash** (`gemini-2.0-flash-preview-image-generation`) — Lightning-fast creative generations.
- Features `auto` mode that attempts Imagen 3 first and falls back to Gemini Flash on any failure.
- Auto-saves all generated images to the `outputs/` directory.

#### Changed: `src/skills/index.ts`
- Registered both `pdfSkill` and `imagegenSkill` into the global skill registry.

## [10.3.0] - 2026-03-16

### PersonalClaw Browser Relay Extension

New Chrome MV3 extension that bridges PersonalClaw to the user's real Chrome tabs — no `--remote-debugging-port` flag needed.

#### New: `extension/` — Chrome MV3 Extension
- **`manifest.json`** — MV3 manifest with tabs, activeTab, scripting permissions.
- **`background.js`** — Service worker maintaining WebSocket connection to `ws://127.0.0.1:3000/relay`. Handles tab management, navigation, screenshot capture via Chrome APIs. Auto-reconnects with heartbeat.
- **`content.js`** — Injected on all pages. Rich DOM interaction: click (text/selector matching), type (character-by-character), scrape (text + links + forms + metadata), scroll, evaluate JS, get interactive elements, highlight. Visual indicator badge.
- **`popup.html/popup.js`** — Connection status popup with configurable relay server URL.

#### New: `src/core/relay.ts` — Extension Relay Server
- **`ExtensionRelay`** class — WebSocket server attached to main HTTP server at `/relay` path. Manages extension connections, tab state, and command routing.
- Promise-based command execution with timeout handling.
- Convenience methods: `listTabs()`, `navigate()`, `click()`, `type()`, `scrape()`, `screenshot()`, `switchTab()`, `openTab()`, `closeTab()`, `evaluate()`, `scroll()`, `getElements()`, `highlight()`.
- Singleton `extensionRelay` instance auto-started by the server.

#### Changed: `src/skills/browser.ts`
- 12 new relay actions: `relay_tabs`, `relay_navigate`, `relay_click`, `relay_type`, `relay_scrape`, `relay_screenshot`, `relay_switch_tab`, `relay_open_tab`, `relay_close_tab`, `relay_evaluate`, `relay_scroll`, `relay_elements`.
- `tab_id` parameter for targeting specific Chrome tabs.
- Updated skill description with three-mode decision guide.

#### Changed: `src/core/brain.ts`
- **`/relay`** slash command — shows extension connection status and open tabs list.
- System prompt updated with Extension Relay mode documentation and decision guide.
- `/relay` added to help table and known commands.

#### Changed: `src/index.ts`
- Extension relay attaches to main HTTP server at `/relay` WebSocket path.
- Relay shutdown on graceful exit.
- `GET /api/relay` REST endpoint for relay status.
- Relay events in activity feed (connected, disconnected, tabs updated).
- Startup banner shows relay WebSocket port.

#### Changed: `src/core/events.ts`
- New event constants: `RELAY_CONNECTED`, `RELAY_DISCONNECTED`, `RELAY_TABS_UPDATE`.

#### How to Use
```
# 1. Load extension in Chrome:
#    chrome://extensions → Developer Mode → Load Unpacked → select extension/ folder

# 2. Extension auto-connects to PersonalClaw (ws://127.0.0.1:3000/relay)

# 3. Check status:
/relay

# 4. Use relay actions in chat:
# "List my open tabs"  → AI uses relay_tabs
# "Scrape the active tab" → AI uses relay_scrape
# "Click the Submit button" → AI uses relay_click
```

## [10.2.1] - 2026-03-16

### Added
- **`setup.bat`** — One-click automated setup. Installs all dependencies (brain, browser, dashboard) and interactively configures `.env` with API keys.
- **`start.bat`** — One-click launcher for the entire system (Brain + Dashboard).
- **Resilient Boot** — Improved startup logs and error handling for missing API keys or disabled Telegram interface.

## [10.2.0] - 2026-03-16

### Chrome Native MCP & Dual-Mode Browser

PersonalClaw can now connect to the user's **real running Chrome session** — not a new instance, but the actual browser with all real logins, cookies, and active tabs.

#### New: `src/core/chrome-mcp.ts`
- **`ChromeNativeAdapter`** — connects to Chrome via two methods (auto-selects best):
  1. **Chrome 146+ native MCP server** — SSE transport to Chrome's built-in DevTools MCP. Exposes Chrome's own tools directly to the brain (prefixed `chrome_*`).
  2. **CDP fallback** — `chromium.connectOverCDP()` for any Chrome with remote debugging. Full Playwright API on the real session.
- **`ChromeNativeAdapter.probe(port)`** — static check for Chrome availability without connecting.

#### Changed: `src/core/browser.ts`
- **`getPage()`** now prioritizes native Chrome CDP page when connected, falls back to Playwright.
- **`connectNative(port?)`** — connect to real Chrome (delegates to `ChromeNativeAdapter`).
- **`disconnectNative()`** — revert to Playwright-managed mode.
- **`getStatus()`** — reports current mode and probes Chrome availability.

#### Changed: `src/skills/browser.ts`
- 4 new actions: `connect_native`, `disconnect_native`, `status`, `chrome_call`.
- Updated skill description with decision guide (native Chrome vs Playwright).
- `chrome_call` enables direct invocation of Chrome MCP tools by name.

#### Changed: `src/core/brain.ts`
- **Dynamic tool registration** — `createModel()` now includes Chrome MCP tools when connected.
- **`refreshModel()`** — reloads Gemini model with updated tool definitions after connect/disconnect.
- **`chrome_*` tool routing** — agentic loop routes Chrome MCP tool calls to `chromeNativeAdapter`.
- **`/chrome [port]`** slash command — probes Chrome, connects, shows status. `/chrome disconnect` to revert.
- **System prompt updated** — dual-mode browser explanation with decision rules for the AI.

#### How to Use
```
/chrome              # connect to Chrome on port 9222
/chrome 9229         # custom port
/chrome disconnect   # back to Playwright

# Or via browser skill:
browser(action="connect_native")
browser(action="status")
browser(action="disconnect_native")
```

#### Prerequisites
```
# Option 1: Launch Chrome with remote debugging
chrome.exe --remote-debugging-port=9222 --user-data-dir=%TEMP%\chrome-debug

# Option 2: Chrome 146+ auto-connection
chrome://inspect/#remote-debugging → enable "Discover network targets"
```

---

## [10.1.1] - 2026-03-16

### Bug Fixes
- **Browser Viewport**: Fixed the "fixed viewport" issue in the `BrowserManager`. By setting `viewport: null` and adding `--start-maximized`, the browser now scales naturally with the window size and provides a better interactive experience.

---

## [10.1.0] - 2026-03-15

### 🧹 Codebase Cleanup
- **Browser Consolidation**: Removed redundant `src/skills/relay.ts`, `src/skills/stagehand.ts`, and the `extension/` directory. Unified browser logic now resides in `src/skills/browser.ts`.
- **Workspace Declutter**:
  - Deleted obsolete root-level documentation exports (`PersonalClaw_Overview.md`, `PersonalClaw_Overview.pdf`, etc.) and temporary images.
  - Relocated utility scripts (`check_ssl.ps1`, `list_models.js`, `test_vision.js`) from the project root to the `scripts/` directory for better organization.
- **Persona Management**: Cleaned up unused agent personas.
- **Infrastructure**: Purged the `dist/` directory and temporary `browser_data/`.

---

## [10.0.0] - 2026-03-15

### MASSIVE UPGRADE: v1 → v10 Transformation

#### 🎯 New Core Systems (3 files)
- **Event Bus** (`src/core/events.ts`) — Central publish/subscribe nervous system. All subsystems communicate via typed events. Real-time event logging, statistics, wildcard listeners.
- **Audit Logger** (`src/core/audit.ts`) — Comprehensive action logging (tools, errors, failovers, sessions). JSONL format with automatic rotation (max 10 files, 1000 entries each). Auto-subscribes to event bus.
- **Session Manager** (`src/core/sessions.ts`) — Browse, search, restore, and clean up past conversations. Full-text search across session history. Session statistics.

#### 🚀 New Skills (4 additions, 13 total)
1. **HTTP Requests** (`src/skills/http.ts`) — GET/POST/PUT/PATCH/DELETE with headers, body, auth. Response truncation (10KB max), timing info, error handling.
2. **Network Diagnostics** (`src/skills/network.ts`) — 9 actions: ping, traceroute, DNS, port check, connections, interfaces, ARP, routing, WHOIS.
3. **Process Manager** (`src/skills/process-manager.ts`) — 10 actions: list, search, kill, start/stop/restart services, startup apps, resource hogs.
4. **Deep System Info** (`src/skills/system-info.ts`) — 12 actions: overview, hardware, storage, software, updates, drivers, events, security, battery, environment, uptime, users.

#### 🧠 Brain Massive Upgrades
- **Performance Tracker** — Records response times, P50/P95 latency, tool calls per request, model usage breakdown
- **8 New Slash Commands** — `/perf` (performance stats), `/audit` (audit log), `/sessions` (browse), `/restore <id>` (load session), `/search <query>` (search), `/ip` (network), `/procs` (processes)
- **Session Restore** — `/restore session_12345` loads entire conversation history and context
- **Full-Text Search** — `/search DNS issues` finds relevant past conversations with snippets
- **Event Bus Integration** — Every message, tool call, failover, session event dispatched to event bus
- **Uptime Tracking** — `uptime` getter for system health
- **Tool Counter** — `toolCallCount` tracks total calls across session
- **Public API** — Getters for `currentModel`, `currentSessionId`, `turns`, `uptime`, `toolCallCount`, `performanceStats`
- **Response Metadata** — Model, turns, tool calls sent with every response

#### 🌐 Server Complete Overhaul (`src/index.ts`)
- **9 REST API Endpoints** — `/api/chat`, `/api/skills`, `/api/sessions`, `/api/sessions/search`, `/api/sessions/stats`, `/api/perf`, `/api/metrics`, `/api/audit`, `/api/activity`
- **Real-Time Activity Feed** — Events broadcast to all dashboards. Max 100 recent items.
- **Disk Metrics** — Added disk usage (used GB, total GB) to metrics broadcast
- **Socket.io Init Event** — Sends version, model, skills, activity, metrics on dashboard connect
- **Streaming Tool Updates** — Tool progress sent to dashboard in real-time via `tool_update` event
- **Graceful Shutdown** — SIGINT/SIGTERM handlers flush audit log, close connections, exit cleanly
- **Exception Handling** — Uncaught exceptions and unhandled rejections logged to audit
- **ASCII Startup Banner** — Clean formatted startup info with port, model, skills count

#### 🎨 Dashboard Complete Overhaul (`dashboard/src/`)
- **Command Palette (Ctrl+K)** — 17 quick commands, searchable by label or command text
- **Activity Feed Tab** — Real-time event stream (type, timestamp, source, summary). Color-coded dots (green=success, red=error, blue=info)
- **Skills & Config Tab** — Browse all 13 loaded skills with descriptions. Quick command cards for all 17 commands
- **Tool Progress Updates** — Shows which tools are running while bot is "thinking" with execution times
- **Connection Status** — Live WiFi icon and connected/offline indicator in sidebar
- **Toast Notifications** — Non-intrusive success/error alerts for connect/disconnect
- **Sparkline Charts** — Mini CPU and RAM trend graphs (last 30 data points)
- **Command History** — Arrow Up/Down cycles through past messages (stored in component state)
- **Auto-Resize Textarea** — Grows dynamically as you type (up to 160px)
- **Disk Usage Metric** — 4th card on status bar (C: drive used/total)
- **Improved Code Blocks** — Better syntax highlighting, monospace font, borders, background
- **Table Rendering** — Markdown tables render properly with borders and alternating row backgrounds
- **Message Avatars** — Rounded square containers for bot/user icons
- **Responsive Design** — Sidebar collapses on screens < 900px
- **Custom Scrollbars** — Thin, minimal scrollbars with hover effects
- **Redesigned Navigation** — Terminal icon, version badge "v10.0", improved spacing, cleaner styling
- **Metrics Cards** — CPU/RAM/Disk/Session info with sparklines and detailed breakdown

#### 📊 Dashboard Enhancements
- **Modern Styling** — Refreshed color palette, better contrast, glassmorphism
- **Keyboard Shortcuts** — Ctrl+K for command palette, Escape to close
- **Focus Management** — Command palette auto-focuses input
- **Drag-and-Drop** — File drop detection (placeholder for future enhancement)
- **Session Metadata** — Display model, turns, tools info on every response
- **Real-Time Status** — Connection indicator updates immediately
- **Activity Timestamping** — All activities show formatted time (HH:MM:SS)

#### 🔧 Infrastructure
- **TypeScript Strict Mode** — Full strict typing, zero build errors
- **Event-Driven Architecture** — All subsystems communicate via typed events
- **Audit Trail** — Complete action history for compliance/debugging
- **Performance Tracking** — Detailed latency and throughput metrics
- **Graceful Degradation** — Model failover never causes crashes
- **Memory Management** — Auto-compaction at 800k tokens

#### 📈 Metrics & Stats
- **13 Loaded Skills** (up from 9)
- **23 Slash Commands** (up from 15)
- **5 Model Options** with automatic failover
- **1M Token Context** with 800k auto-compact threshold
- **9 REST Endpoints** for external integration
- **0 Build Errors** — Full TypeScript compilation

### Changed
- **Dashboard Port** — Still 5173 (Vite dev server)
- **Backend Port** — Still 3000 (Express)
- **Model Defaults** — Still cascades through Gemini 3.1 Pro → Flash variants
- **Skill Architecture** — Enhanced with event logging

### Removed
- Nothing removed — all v1.17 features preserved
- Deprecated "legacy" skills remain for compatibility

### Internal
- **Code Quality** — Refactored for clarity and performance
- **Error Messages** — Enhanced with actionable context
- **Logging** — Structured via event bus + audit logger
- **Testing** — All features compile without errors

---

## [1.17.0] - 2026-03-14
### Added
- **🧬 Self-Learning Engine**: PersonalClaw now passively learns from every conversation.
  - **User Profile**: Auto-detects name, role, company, expertise level.
  - **Communication Style**: Learns tone, verbosity, emoji usage, abbreviations/shorthand dictionary.
  - **Intent Patterns**: Maps "when user says X, they mean Y" with confidence scores.
  - **Workflow Patterns**: Remembers multi-step processes the user frequently performs.
  - **Tool Preferences**: Learns which tools the user prefers and what to avoid.
  - **Self-Correction**: Tracks mistakes and lessons to avoid repeating them.
  - **Domain Knowledge**: Builds a dictionary of user-specific terms and jargon.
  - Runs **fully asynchronous** using `gemini-2.5-flash` — never blocks user responses.
  - All learned data persisted to `memory/self_learned.json`.
  - Learning log tracked in `memory/learning_log.json`.
- **📋 New Commands**: `/learned`, `/learned log`, `/learned clear` for self-learning visibility.
- **🧠 Prompt Injection**: Learned knowledge is auto-injected into every system prompt — the AI gets smarter with every conversation.

---

## [1.16.0] - 2026-03-14
### Added
- **🔄 Model Failover Chain**: PersonalClaw now cascades through 5 models automatically on failure:
  `gemini-3.1-pro-preview` → `gemini-3-flash-preview` → `gemini-2.5-pro` → `gemini-2.5-flash` → `gemini-3.1-flash-lite-preview`
  - Handles: 404 (model not found), 503 (unavailable), rate limits (429), permission errors, and internal errors.
  - Tracks failover history and displays it in `/status`.
- **🤖 Model Registry**: Full model registry with metadata (tier, status, description, context window).
- **📋 15 Slash Commands**: Massively expanded local command system:
  - `/models` — View all models and the failover chain
  - `/model <id>` — Hot-swap the active model mid-session (no context loss)
  - `/memory` — View all stored long-term knowledge
  - `/forget <key>` — Remove a specific memory entry
  - `/skills` — List all loaded skills with descriptions
  - `/jobs` — Show all scheduled cron jobs
  - `/ping` — Quick health check
  - `/export` — Export full session history to JSON
  - `/screenshot` — Quick screen capture + analysis
  - `/sysinfo` — Quick system info snapshot via PowerShell
  - Unknown command handler with suggestions

---

## [1.15.0] - 2026-03-14
### Changed
- **🧠 Brain Overhaul**: Completely rebuilt the AI reasoning engine and system prompt from the ground up.
  - **Identity & Personality**: PersonalClaw now has a defined personality — direct, efficient, technically sharp with dry humor.
  - **Reasoning Framework**: Added structured 4-phase thinking model: Understand → Plan → Act → Verify.
  - **Tool Usage Guides**: Each skill now has in-prompt best practices, tips, and anti-patterns to prevent wasteful calls.
  - **Safety Guardrails**: Explicit rules preventing destructive commands without user confirmation, credential leaking, and rogue network requests.
  - **Communication Rules**: Defined formatting, conciseness, and markdown standards for response quality.
- **⚡ Context Window Management**: Added auto-compaction at 800k tokens — the brain now summarizes old history and rebuilds the session to avoid hitting the 1M limit.
- **🔄 Memory-Aware Boot**: The system prompt now dynamically loads `long_term_knowledge.json` at session start, making learned preferences immediately available.
- **🚀 Parallel Tool Execution**: Tool calls from the same turn are now executed concurrently via `Promise.all` instead of sequentially.
- **📡 Live Tool Streaming**: Tool progress (success/failure + execution time) is now streamed to the UI via `onUpdate` during execution.
- **🛠️ Configurable Model**: Model is now controlled via `GEMINI_MODEL` env var (defaults to `gemini-2.5-flash-preview-05-20`).
- **📊 Enhanced /status**: Now shows turn count, token usage with percentage, and active model name.
- **🗜️ /compact Command**: New slash command to manually trigger context compaction.
- **🛡️ Error Recovery**: Added context overflow detection with automatic compaction retry, and richer error context passed back to the model.

---

## [1.14.0] - 2026-03-14
### Changed
- **🚀 Browser Streamlining**: Consolidated 3 competing browser systems (Playwright MCP, Stagehand, Relay Extension) into a single unified `browser` skill.
- **🛠️ Unified Browser Architecture**: Implemented a singleton `BrowserManager` with `launchPersistentContext` for shared login storage across all AI sessions.
- **🧹 Cleanup**: Removed the relay extension WebSocket server (port 3001) and the MCP initialization cycle for a faster, lazier startup.
- **🧠 Prompt Optimization**: Rebuilt the system prompt to guide the AI toward the new unified browser workflow (Scrape -> Act -> Vision).

---

## [1.13.0] - 2026-03-13
### Added
- **🎭 Stagehand AI Browser**: Integrated `@browserbasehq/stagehand`, enabling high-level natural language browser automation ("act", "extract", "observe").

- **🔄 Session Consistency**: Implemented singleton pattern for Stagehand and added **Independent Browser** support (`npm run browser`) so the browser window stays open even if the terminal/dashboard is closed.


---

## [1.12.0] - 2026-03-13
### Added
- **🧠 Continuous Learning Engine**: Implemented `manage_long_term_memory` skill, allowing PersonalClaw to learn user preferences, shorthand, and custom MSP workflows across sessions.
- **🛠️ Tier 3 MSP Specialization**: Tailored the system prompt for high-level IT troubleshooting. Integrated awareness of `pts_tools.json` for rapid access to ITGlue, Nilear, ConnectWise, and more.
- **⚡ Performance Overhaul**: Fixed typing lag in the dashboard by refactoring `App.tsx` and isolating the chat input into a memoized component.
- **📋 Copy to Clipboard**: Added a one-click copy button to bot messages in the dashboard with visual "check-mark" feedback.
- **🛡️ Developer Stability**: Added `dev:persist` script and optimized watcher exclusions (`browser_data`, `memory`, etc.) to prevent Playwright browsers from closing during code edits.


---

### Added

- **🌐 Playwright MCP**: Replaced the legacy web skill with the full **Model Context Protocol (MCP)** server for Playwright, adding 22 granular browser automation tools.
- **🚀 Dashboard Navigation**: Fixed side tabs with animated transitions. Added new dedicated views for **System Telemetry**, **File Explorer**, and **Security/Audit Logs**.
- **📊 Context Radar**: Enhanced the `/status` command to show real-time **Token Usage** (against the 1M limit) and full session metrics.
- **Sanitized Schemas**: Implemented a JSON Schema sanitizer to bridge complex MCP tool definitions with Gemini's API requirements.

---

## [1.10.0] - 2026-03-12
### Added
- **⌨️ Slash Commands**: Added quick-access commands: `/cronjob`, `/browser`, `/status`, and `/help`.
- **📸 Screenshot Preview**: Rebuilt the dashboard capture flow to show a thumbnail preview, allowing users to add a text message before sending.
- **⚡ Typing Indicators**: Added visual feedback (animated dots) to the dashboard chat to improve user experience during AI thinking cycles.
- **🌐 Persistent Browser**: Rebuilt the web engine to use `launchPersistentContext` to save logins and session data.

---

## [1.9.0] - 2026-03-12
### Added
- **⏰ Automated Task Scheduling**: Implemented a new `manage_scheduler` skill using `node-cron`.
- **Persistent Jobs**: Scheduled tasks are saved to `memory/scheduled_jobs.json` and persist through server restarts.
- **Smart Execution**: The scheduler can trigger any natural language command (e.g., "Take a screenshot and analyze it every Monday").
- **Dashboard Feedback**: Active jobs broadcast their results to the dashboard so you can see them running in real-time.

---

## [1.8.0] - 2026-03-12
### Added
- **📸 Dashboard Vision**: Integrated a new "Camera" button in the web dashboard.
- **Native Selection**: Uses the browser's `DisplayMedia` API to allow users to capture specific windows or their entire screen "the usual way."
- **Auto-Analysis**: Screenshots are automatically saved to `/screenshots` and sent to the AI for immediate processing.

---

## [1.7.0] - 2026-03-12
### Added
- **Unified Startup**: Added `npm run all` command to launch both the Backend and Dashboard in a single terminal session using `concurrently`.
- **Developer Experience**: Simplified user documentation to focus on the single-command workflow.

---

## [1.6.0] - 2026-03-12
### Added
- **User Documentation**: Created a comprehensive `USER_GUIDE.md` for end-user onboarding, featuring icons, setup tips, and a breakdown of AI capabilities.
- **Brand Identity**: Generated a futuristic logo for PersonalClaw and integrated it into the documentation assets.

---

## [1.5.0] - 2026-03-12
### Added
- **Screenshot Archive**: Created a dedicated `screenshots/` folder.
- **Persistent Vision**: Updated the vision skill to save all captured screenshots locally for record-keeping instead of deleting them after analysis.

---

## [1.4.0] - 2026-03-12
### Added
- **Browser Relay Extension**: Built a custom Chrome extension to allow PersonalClaw to control the user's active browser tabs.
- **WebSocket Gateway**: Implemented a dedicated Relay Server on port 3001 for high-speed extension communication.
- **Relay Skill**: Added `relay_browser_command` to the AI brain, allowing it to scrape or interact with any open website.

---

## [1.3.0] - 2026-03-12
### Added
- **Persistent Memory**: Chat history is now saved locally to `memory/history.json`.
- **Session Refresh**: Added `/new` command to manually reset the conversation and refresh the LLM context.

---

## [1.2.0] - 2026-03-12
### Added
- **Telegram Interface**: Launched `@Personal_Clw_bot` for full remote Windows control via mobile.
- **Bot Security Lock**: Implemented `AUTHORIZED_CHAT_ID` whitelisting to prevent unauthorized access to the system.
- **Remote Tool Access**: Enabled all local skills (Shell, Vision, etc.) to be triggered via Telegram chat.

---

## [1.1.0] - 2026-03-12
### Added
- **Markdown Support**: Integrated `react-markdown` and `remark-gfm` for beautiful, indented message formatting in the dashboard.
- **Theme Engine**: Added a Light/Dark mode toggle with high-end "Glassmorphism" aesthetics for both themes.
- **Improved UI/UX**: Added sender icons (Bot/User) and enhanced message spacing/typography.
- **System Documentation**: Created a centralized `docs/` directory with technical specs and codebase snapshots.

### Changed
- **Model Upgrade**: Upgraded core reasoning and vision skills to **Gemini 3 Flash Preview** (March 2026 version).
- **Vision Reliability**: Fixed API identity issues (403/404) and added comprehensive logging to the vision skill.
- **Real-time Telemetry**: Finalized the connection between the dashboard UI and actual system metrics (CPU/RAM).

### Fixed
- **Env Loading**: Resolved a race condition where the Gemini API was initialized before environment variables were loaded.
- **Dashboard Metrics**: Replaced placeholder data with live Socket.io streams.

---

## [1.0.0] - 2026-03-11
### Added
- Initial release of PersonalClaw agent.
- Core Skills: Shell (PowerShell), File Management, Python Execution, Web Browsing, Vision (Screenshots), and Clipboard.
- Real-time Dashboard with Glassmorphic design.
- Integration with Google Gemini API for tool-calling.
