# PersonalClaw — Complete System Reference

> **One-stop document for understanding, extending, and building on PersonalClaw.**
> Share this with any AI (Claude, GPT, Gemini) or human developer to give them full context.

---

## What Is PersonalClaw?

PersonalClaw is a **local-first AI automation platform** for Windows. It connects Google Gemini models to your desktop, browser, file system, and network through 20 skills (tools). It runs as a Node.js backend (port 3000) with a React dashboard (port 5173).

**Five modes of operation:**

1. **Human Chat** — Up to 3 independent chat panes, each with its own AI brain. You talk, the AI acts using tools.
2. **Autonomous AI Organizations** — Create teams of AI agents (CEO, CTO, Developer, etc.) that run on cron schedules, manage tickets, delegate work, and submit code proposals for human review.
3. **Scheduled Automation** — Cron jobs that trigger the AI to perform recurring tasks (post to Twitter, take screenshots, run reports).
4. **Telegram** — Isolated Brain instance for remote control via the Telegram bot (no org access, separate history).
5. **Android Mobile App** — React Native app (PersonalClawApp) connecting via Socket.io over Cloudflare Tunnel. Full chat, org management, push notifications, and voice input from anywhere.

**Key facts:**
- Platform: Windows 11 (PowerShell commands throughout)
- AI Backend: Google Gemini (5-model failover chain)
- Frontend: React 19 + Socket.io (real-time)
- Mobile: React Native / Expo SDK 55 (Android)
- Browser Control: Playwright + Chrome Extension Relay + Native Chrome CDP
- Remote Access: Cloudflare Tunnel (`https://api.utilization-tracker.online`)
- Version: 12.10.1
- Author: Scout Kalra

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        DASHBOARD (React)                        │
│  localhost:5173  •  Socket.io client  •  6 tabs  •  Real-time   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Socket.io + REST
┌──────────────────────────▼──────────────────────────────────────┐
│                     EXPRESS SERVER (:3000)                       │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Conversation │  │  Org Manager  │  │  Extension Relay       │ │
│  │   Manager    │  │  + Heartbeat  │  │  (WebSocket /relay)    │ │
│  │  (3 chats)   │  │  + TaskBoard  │  │                        │ │
│  └──────┬───────┘  └──────┬───────┘  └────────────────────────┘ │
│         │                 │                                     │
│  ┌──────▼─────────────────▼───────────────────────────────────┐ │
│  │                    BRAIN (Gemini)                           │ │
│  │  System Prompt + Tool Loop + Failover + Context Compaction │ │
│  └──────────────────────┬─────────────────────────────────────┘ │
│                         │                                       │
│  ┌──────────────────────▼─────────────────────────────────────┐ │
│  │                  20 SKILLS (Tools)                          │ │
│  │  shell • python • files • vision • clipboard • memory      │ │
│  │  browser • http • network • processes • sysinfo • pdf      │ │
│  │  imagegen • agent-spawn • org-management • scheduler       │ │
│  │  linkedin • twitter • todos • desktop  + 13 org-specific   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ ┌───────────┐          │
│  │ EventBus │ │  Audit   │ │ Learner │ │ Sessions  │          │
│  │ (45+ ev) │ │ (JSONL)  │ │ (async) │ │ (on-disk) │          │
│  └──────────┘ └──────────┘ └─────────┘ └───────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
PersonalClaw/
├── src/
│   ├── index.ts                    # Express server, Socket.io, REST API, startup
│   ├── types/
│   │   └── skill.ts                # Skill + SkillMeta interfaces
│   ├── core/
│   │   ├── brain.ts                # Gemini AI engine (class, multi-instance)
│   │   ├── conversation-manager.ts # Human chat pane management (max 3)
│   │   ├── agent-registry.ts       # Sub-agent worker lifecycle (max 5/chat)
│   │   ├── org-manager.ts          # Org/Agent CRUD + persistence
│   │   ├── org-heartbeat.ts        # Cron scheduling for org agents
│   │   ├── org-agent-runner.ts     # Executes org agents as persona-injected Brains
│   │   ├── org-task-board.ts       # Kanban ticket system per org
│   │   ├── org-file-guard.ts       # File protection + code proposals
│   │   ├── org-notification-store.ts # Notification persistence + Telegram
│   │   ├── todo-manager.ts         # Todo CRUD, recurring engine, stats, filtered queries
│   │   ├── browser.ts              # BrowserManager (Playwright + native Chrome)
│   │   ├── chrome-mcp.ts           # Chrome 146+ native MCP / CDP adapter
│   │   ├── relay.ts                # Chrome Extension WebSocket relay
│   │   ├── mcp.ts                  # Playwright MCP server adapter
│   │   ├── skill-lock.ts           # Concurrent resource protection
│   │   ├── events.ts               # EventBus (45+ typed events)
│   │   ├── audit.ts                # JSONL audit logging with rotation
│   │   ├── sessions.ts             # Session save/restore/search
│   │   ├── learner.ts              # Self-learning engine (async analysis)
│   │   ├── terminal-logger.ts      # Console tee to daily rolling file
│   │   └── telegram-brain.ts       # Telegram bot interface (isolated Brain)
│   └── skills/
│       ├── index.ts                # Skill registry + handleToolCall dispatcher
│       ├── shell.ts                # execute_powershell
│       ├── python.ts               # run_python_script
│       ├── files.ts                # manage_files
│       ├── vision.ts               # analyze_vision
│       ├── clipboard.ts            # manage_clipboard
│       ├── memory.ts               # manage_long_term_memory
│       ├── browser.ts              # browser (3 modes, 26 actions)
│       ├── http.ts                 # http_request
│       ├── network.ts              # network_diagnostics
│       ├── process-manager.ts      # manage_processes
│       ├── system-info.ts          # system_info
│       ├── pdf.ts                  # manage_pdf
│       ├── imagegen.ts             # generate_image
│       ├── agent-spawn.ts          # spawn_agent
│       ├── org-management-skill.ts # manage_org
│       ├── org-skills.ts           # 13 org-agent-only skills
│       ├── linkedin.ts             # linkedin_post
│       ├── twitter.ts              # twitter_post
│       ├── scheduler.ts            # manage_scheduler
│       ├── todos.ts                # manage_todos (12 actions, read-write lock)
│       └── desktop-automation.ts   # desktop_automation (8 actions, pywinauto)
├── dashboard/
│   ├── vite.config.ts              # Vite config — proxies /api → http://localhost:3000
│   └── src/
│       ├── App.tsx                 # Main app — sidebar, 6 tabs, metrics, socket
│       ├── index.css               # Full design system (light theme, indigo accent)
│       ├── components/
│       │   ├── ChatWorkspace.tsx    # Multi-pane resizable chat layout
│       │   ├── ConversationPane.tsx # Single chat with markdown, workers, screenshots, and inline thinking console
│       │   ├── LogConsole.tsx       # Collapsible terminal UI for thinking logs
│       │   ├── MessageCopyButton.tsx # Copy-to-clipboard button for AI messages
│       │   ├── AgentCard.tsx        # Org agent card + EditAgentModal
│       │   ├── AgentChatPane.tsx    # Direct agent messaging (minimize/close)
│       │   ├── OrgWorkspace.tsx     # 8-tab org management container
│       │   ├── WorkspaceTab.tsx     # IDE-style file explorer + editor + comments
│       │   ├── OrgProtectionSettings.tsx # File protection config
│       │   ├── TodosTab.tsx         # Todos UI — stats bar, filters, add form, inline edit, focus mode, recurring create form
│       │   └── ...                 # CreateOrgModal, CreateAgentModal, etc.
│       ├── hooks/
│       │   ├── useConversations.ts  # Chat state + socket handlers
│       │   ├── useOrgs.ts          # Org/agent/ticket/proposal state
│       │   ├── useOrgChat.ts       # Agent direct messaging
│       │   ├── useAgents.ts        # Sub-agent worker tracking
│       │   ├── useScreenshot.ts    # Screen capture via DisplayMedia
│       │   └── useTodos.ts         # Todos state, socket sync, filter logic
│       └── types/
│           ├── org.ts              # Org, OrgAgent, Ticket, Proposal, Blocker
│           ├── conversation.ts     # Message, WorkerAgentInfo
│           └── todos.ts            # Todo, TodoStats, TodoFilter interfaces
├── extension/                      # Chrome MV3 relay extension
│   ├── manifest.json
│   ├── background.js               # WebSocket to ws://127.0.0.1:3000/relay
│   ├── content.js                  # DOM interaction (click, type, scrape, etc.)
│   └── popup.html / popup.js       # Connection status UI
├── scripts/
│   ├── xpost.py                    # Twitter posting via pyautogui replay
│   ├── xteacher.py                 # Record mouse clicks for automation
│   ├── twitter_steps.json          # Recorded click coordinates
│   ├── Post_content.txt            # Tweet content buffer
│   └── launch_persistent_browser.ps1
├── memory/                         # Persistent storage
│   ├── long_term_knowledge.json    # Learned user preferences
│   ├── self_learned.json           # Auto-learned patterns
│   ├── learning_log.json           # Learning event history
│   ├── scheduled_jobs.json         # Active cron jobs
│   ├── todos.json                  # All todos + recurring templates (atomic write)
│   ├── session_*.json              # Saved conversation sessions
│   └── audit/audit_YYYY-MM-DD.jsonl
├── orgs/                           # Per-org isolated directories
│   └── {orgName}-{shortId}/
│       ├── org.json                # Org config + agents array
│       ├── workspace/              # Shared project files
│       │   ├── {role-slug}/        # Per-agent folder (ceo/, cto/, etc.)
│       │   └── proposals/          # Code change proposals
│       ├── agents/{agentId}/
│       │   ├── memory.json         # Agent private memory
│       │   └── runs.jsonl          # Run history (one JSON per line)
│       ├── shared_memory.json      # Org-wide shared state
│       ├── tickets.json            # Task board
│       ├── proposals.json          # Proposal metadata
│       ├── blockers.json           # Blocker records
│       └── notifications.jsonl     # Notification history
├── PersonalClawApp/                # React Native / Expo SDK 55 Android app
│   ├── app/
│   │   ├── _layout.tsx             # Root layout — socket init, push notification handler, auth guard
│   │   ├── auth.tsx                # Auth screen
│   │   ├── (tabs)/
│   │   │   ├── index.tsx           # Chat screen — voice input, TTS, image picker
│   │   │   ├── activity.tsx        # Live activity feed
│   │   │   ├── metrics.tsx         # Real-time metrics
│   │   │   ├── orgs.tsx            # Org list
│   │   │   └── settings.tsx        # Server URL config
│   │   └── org/
│   │       └── [orgId].tsx         # Org detail — 5-tab view (Agents/Tickets/Proposals/Blockers/Memory)
│   ├── components/
│   │   └── orgs/
│   │       ├── AgentsView.tsx      # Agent list + status
│   │       ├── TicketsView.tsx     # Kanban tickets
│   │       ├── ProposalsView.tsx   # Pending/resolved proposals with Approve/Reject
│   │       ├── BlockersView.tsx    # Open/resolved blockers with Mark Resolved
│   │       └── MemoryView.tsx      # Memory browser — agent tabs, search, expandable
│   ├── services/
│   │   ├── socket.ts               # Socket.io client (polling+WS), event subscriptions
│   │   ├── push-notifications.ts   # FCM token registration, notification categories
│   │   └── voice.ts                # expo-audio recording + FormData upload to /api/voice/transcribe
│   ├── store/                      # Zustand v5 stores
│   │   └── index.ts                # Auth, Connection, Chat, Orgs, Activity, Metrics stores
│   ├── constants/
│   │   └── index.ts                # DEFAULT_SERVER_URL = https://api.utilization-tracker.online
│   ├── android/
│   │   ├── build.gradle            # Google Services classpath
│   │   └── app/
│   │       ├── build.gradle        # Google Services plugin + google-services.json
│   │       └── google-services.json # Firebase FCM config (not committed)
│   ├── app.json                    # Expo config (versionCode, bundleIdentifier)
│   └── eas.json                    # EAS Build profiles (dev/preview/prod), autoIncrement, submit config
├── screenshots/                    # Vision + relay screenshots
├── outputs/                        # Generated PDFs + images
├── logs/
│   ├── twitter_post.log            # Twitter skill log
│   ├── activity.jsonl              # Activity feed (max 1000)
│   └── personalclaw-*.log          # Daily server logs
├── .env                            # Environment config (see below)
├── package.json                    # Backend deps + scripts
├── tsconfig.json                   # TypeScript config (ESNext, strict)
└── docs/
    ├── ARCHITECTURE.md             # This document
    └── version_log.md              # Changelog
```

---

## Android Mobile App

**Directory:** `PersonalClawApp/`

React Native / Expo SDK 55 bare workflow app for Android. Connects to the backend over Cloudflare Tunnel so it works anywhere, not just on local WiFi.

### Key Libraries
| Library | Purpose |
|---------|---------|
| `expo-router` v4 | File-based navigation (tabs + stack) |
| `expo-notifications` | Push notifications (FCM) |
| `expo-audio` | Voice recording (hold-to-talk) |
| `expo-speech` | TTS for AI responses |
| `expo-image-picker` | Attach images to chat |
| `expo-local-authentication` | Biometric auth |
| `expo-secure-store` | Encrypted credential storage |
| `socket.io-client` | Real-time backend connection |
| `zustand` v5 | Global state management |
| `react-native-safe-area-context` | Safe area handling |

### Push Notification Flow
```
Backend sends push → Firebase FCM → Android device
  → expo-notifications shows banner
  → User taps inline button (Approve/Reject/Resolve) → socketService.send() acts silently
  → User taps notification body → deep-link to relevant screen
```

**Notification categories:**
- `proposal` — Approve + Reject inline actions → `org:proposal:action` socket event
- `blocker` — Resolve inline action → `org:blocker:resolve` socket event
- `chat_response`, `task_complete`, `worker_failed` — tap opens Chat tab

### New REST Endpoints (added for mobile)
| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/voice/transcribe` | Multer audio upload → Gemini STT → transcript |
| `POST` | `/api/push/register` | Register Expo push token for FCM delivery |

### New Socket Events (added for mobile)
| Event | Direction | Purpose |
|-------|-----------|---------|
| `org:proposal:action` | Client→Server | Unified approve/reject handler |
| `org:memory:list` | Client→Server | Scope-based agent memory list |
| `org:tickets:list` | Client→Server | List tickets for an org |
| `org:proposals:list` | Client→Server | List proposals for an org |
| `org:blockers:list` | Client→Server | List blockers for an org |

### Cloudflare Tunnel
- Domain: `https://api.utilization-tracker.online`
- Routes to: `localhost:3000`
- Purpose: Remote access from mobile without VPN or port forwarding

---

## Environment Variables (.env)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `GEMINI_API_KEY` | Yes | — | Google Gemini API key (aistudio.google.com) |
| `GEMINI_MODEL` | No | `gemini-3-flash-preview` | Primary model (failover chain starts here) |
| `GEMINI_LEARNER_MODEL` | No | `gemini-2.5-flash` | Cheap model for self-learning analysis |
| `PORT` | No | `3000` | Backend server port |
| `TELEGRAM_BOT_TOKEN` | No | — | Telegram bot token (optional, enables remote control) |
| `AUTHORIZED_CHAT_ID` | No | — | Locks Telegram bot to one user (required for security) |
| `LINKEDIN_SCRIPT_DIR` | No | `C:\LinkedInBot` | LinkedIn automation scripts directory |

---

## The Brain — AI Engine

**File:** `src/core/brain.ts`

The Brain is a **class** (not singleton). Each chat pane, each org agent chat, and each sub-agent worker gets its own Brain instance.

### Model Failover Chain

```
gemini-3-flash-preview → gemini-3.1-pro-preview → gemini-2.5-pro → gemini-2.5-flash → gemini-3.1-flash-lite-preview
```

If the primary model returns 404, 503, 429, or auth error, the Brain automatically tries the next model. The chain is logged and visible via `/status`.

### System Prompt

The system prompt is dynamically assembled from:
1. **Core identity** — personality, reasoning framework (Understand → Plan → Act → Verify)
2. **Self-learned knowledge** — user profile, communication style, intent patterns, domain terms (from `learner.ts`)
3. **Tool usage guides** — best practices and anti-patterns per skill
4. **Safety guardrails** — no destructive commands without confirmation, no credential leaking

For org agents, the system prompt is replaced with a **persona injection** containing: org mission, agent role/personality/responsibilities, colleague list, task queue, memory, shared memory, human comments on files.

### Tool Loop

1. User/scheduler/heartbeat sends message
2. Brain sends message + tool definitions to Gemini
3. Gemini responds with text and/or tool_use calls
4. Brain executes each tool via `handleToolCall()` (with SkillMeta context)
5. Results injected back into conversation as function role
6. Loop repeats until Gemini returns text-only response
7. Final text returned to caller

### Context Compaction

When conversation history exceeds ~50 messages or ~200KB, the Brain summarizes older messages into a single system message, preserving the most recent 5 interactions. This prevents hitting the 1M token limit.

### Brain Constructor

```typescript
new Brain({
  agentId: string,
  conversationId: string,
  conversationLabel: string,        // "Chat 1", "Agent: CEO", etc.
  isWorker: boolean,                // true for sub-agents
  systemPromptOverride?: string,    // for org agents
  historyDir?: string,              // where to save session
  orgId?: string,
  orgAgentId?: string,
  toolCallInterceptor?: (name, args) => { allow, reason? }
})
```

### Key Brain Methods

| Method | Purpose |
|--------|---------|
| `processMessage(text)` | Main chat loop — returns AI response string |
| `abort()` / `resetAbort()` | Stop in-flight tool loop |
| `filterTools(predicate)` | Hide specific tools from this Brain |
| `injectExtraTools(skills)` | Add org-specific skills |
| `getHistory()` | Raw conversation history |
| `updateSystemPromptOverride(prompt)` | Dynamic prompt update |

---

## Skills (Tools) — Complete Reference

All skills implement this interface:

```typescript
interface Skill {
  name: string;
  description: string;
  parameters: any;              // JSON Schema
  run: (args: any, meta: SkillMeta) => Promise<any>;
}

interface SkillMeta {
  agentId: string;
  conversationId: string;
  conversationLabel: string;
  isWorker: boolean;
  orgId?: string;               // Set for org agents only
  orgAgentId?: string;          // Set for org agents only
}
```

### Skill Registry

**File:** `src/skills/index.ts`

- `getToolDefinitions()` — converts skills to Gemini function declarations
- `handleToolCall(name, args, meta)` — dispatches to the right skill's `run()`
- Skills loaded at startup, count shown in server banner

### 1. Shell — `execute_powershell`

Executes PowerShell commands on Windows. Returns `{success, stdout, stderr}`. No locking.

### 2. Python — `run_python_script`

Writes code to `temp_script.py`, runs `python`, returns output, cleans up temp file.

### 3. Files — `manage_files`

| Action | Lock | Behavior |
|--------|------|----------|
| `read` | None | Read file content |
| `write` | Write (`files:{path}`) | Create/overwrite file (auto-creates dirs) |
| `append` | Write | Append to file |
| `delete` | Write | Delete file |
| `list` | None | List directory contents |

### 4. Vision — `analyze_vision`

Takes a screenshot (or reads an image file), sends to `gemini-3-flash-preview` with a prompt. Returns analysis text. **Exclusive lock** on `browser_vision`.

### 5. Clipboard — `manage_clipboard`

Read/write system clipboard via `clipboardy`. **Exclusive lock** on `clipboard`.

### 6. Memory — `manage_long_term_memory`

| Action | Lock | Behavior |
|--------|------|----------|
| `learn` | Write (`memory`) | Store key-value in `long_term_knowledge.json` |
| `recall` | Read | Retrieve by key or get all |
| `forget` | Write | Delete key |

### 7. Browser — `browser`

**Three modes, 26 actions:**

| Mode | How to Activate | Use When |
|------|----------------|----------|
| **Playwright** (default) | Automatic | Need clean isolated browser |
| **Native Chrome** | `action: "connect_native"` | Need user's real logins/cookies |
| **Extension Relay** | Auto-detected when extension connected | Need real DOM access on user's tabs |

**Relay actions** (most commonly used for automation):

| Action | Params | Returns |
|--------|--------|---------|
| `relay_tabs` | — | Array of `{id, url, title, active, windowId, protected}` |
| `relay_navigate` | `url`, `tab_id?` | `{title, url}` |
| `relay_click` | `target` (text/selector), `tab_id?` | `{clicked, tag, text}` |
| `relay_type` | `target`, `text`, `tab_id?` | `{typed, field, length}` |
| `relay_scrape` | `tab_id?` | `{title, url, text, links[], forms[], meta}` |
| `relay_screenshot` | `tab_id?` | Saves PNG to `screenshots/`, returns path |
| `relay_switch_tab` | `tab_id` | `{title, url}` |
| `relay_open_tab` | `url?` | `{tabId, url}` |
| `relay_close_tab` | `tab_id` | `{closed}` |
| `relay_evaluate` | `code`, `tab_id?` | `{result}` |
| `relay_scroll` | `target` (direction), `tab_id?` | `{scrolled, position}` |
| `relay_elements` | `target?` (selector), `tab_id?` | `{elements[]}` |

**Standard Playwright actions:** `navigate`, `click`, `type`, `scrape`, `screenshot`, `evaluate`, `back`, `wait`, `page_info`, `close`

**Native Chrome actions:** `connect_native`, `disconnect_native`, `status`, `chrome_call`

**Lock:** Exclusive on `browser_vision` (shared with vision skill).

**Tab Protection:** The relay auto-skips protected tabs (`chrome://`, `chrome-extension://`, `devtools://`, `edge://`, `about:`, `brave://`). When no `tab_id` is given, `resolveTabId()` picks the best non-protected tab (prefers active, then first safe). If no safe tab exists, returns an error suggesting `relay_open_tab`. Tab listings include a `protected` boolean flag. Helper functions `isProtectedTab()` and `getBestDefaultTabId()` are exported from `relay.ts`.

### 8. HTTP — `http_request`

Make HTTP requests. Params: `method`, `url`, `headers` (JSON string), `body`, `timeout`. Uses `axios`. Truncates responses > 10KB. Returns `{status, headers, body, elapsed_ms}`.

### 9. Network — `network_diagnostics`

9 actions: `ping`, `traceroute`, `dns`, `port_check`, `connections`, `interfaces`, `arp`, `route`, `whois`. All via PowerShell. 30-second timeout.

### 10. Process Manager — `manage_processes`

10 actions: `list`, `search`, `kill`, `details`, `services`, `start_service`, `stop_service`, `restart_service`, `startup`, `resource_hogs`. All via PowerShell.

### 11. System Info — `system_info`

12 actions: `overview`, `hardware`, `storage`, `software`, `updates`, `drivers`, `events`, `security`, `battery`, `environment`, `uptime`, `users`. All via PowerShell.

### 12. Thinking Console (Super User Only)

Exposes real-time internal AI reasoning and tool execution logs directly in the dashboard chat.

- **Implementation**: `TerminalLogger` intercepts all console outputs and dispatches them via `EventBus.LOG_EMITTED`.
- **UI Integration**: `LogConsole` component provides a collapsible, dark-themed terminal view.
- **Routing**: Logs are automatically associated with specific message threads via timestamp-based filtering in `ConversationPane`.
- **Toggle**: Activated by the Super User shortcut `Alt + Shift + S`.

### 13. PDF — `manage_pdf`

8 actions: `extract_text`, `metadata`, `merge`, `split`, `rotate`, `watermark`, `create`, `extract_pages`. Uses `pdf-lib` + `pdfjs-dist`. Output to `outputs/`. Write lock per output path.

### 13. Image Generation — `generate_image`

| Model | ID | Use |
|-------|----|-----|
| Pro | `gemini-3-pro-image-preview` | Highest quality, photorealistic |
| Flash | `gemini-3.1-flash-image-preview` | Fast, creative |
| Auto | Tries Pro → falls back to Flash | Default |

Params: `prompt`, `model`, `output_name`, `aspect_ratio`. Saves to `outputs/`.

### 14. Agent Spawn — `spawn_agent`

Spawns sub-agent worker with a task string. Max 5 per conversation, 5-minute timeout. Workers have all skills but **cannot spawn further agents**. Returns worker's result string.

### 15. Org Management — `manage_org`

11 actions for org/agent CRUD: `create_org`, `list_orgs`, `delete_org`, `add_agent`, `list_agents`, `remove_agent`, `trigger_agent`, `pause_org`, `resume_org`, `pause_agent`, `resume_agent`.

### 16. Org-Only Skills (13 skills)

These are injected into org agent Brains only (not available in human chat):

| Skill | Purpose |
|-------|---------|
| `org_read_agent_memory` | Load own persistent memory |
| `org_write_agent_memory` | Save memory (notes, priorities, pending actions) |
| `org_read_shared_memory` | Load org-wide shared state |
| `org_write_shared_memory` | Update shared announcements/decisions |
| `org_list_tickets` | Get tickets (filter by assignee, status) |
| `org_create_ticket` | Create new ticket |
| `org_update_ticket` | Update status/priority/comments |
| `org_delegate` | Assign work to colleague (triggers their heartbeat) |
| `org_write_report` | Save report to `workspace/{role-slug}/` |
| `org_notify` | Send notification to dashboard (rate-limited: 5/run) |
| `org_propose_code_change` | Submit code change for human review |
| `org_raise_blocker` | Raise blocker needing human intervention |
| `org_submit_for_review` | Submit plans/docs (auto-approved unless flagged) |

### 17. LinkedIn — `linkedin_post`

Posts to LinkedIn via pyautogui click replay. Requires `LINKEDIN_SCRIPT_DIR` env, `linkedin_steps.json` (from Teacher.py), and content (max 3000 chars). Supports `dry_run`.

### 18. Twitter — `twitter_post`

Fully automated X/Twitter posting via the extension relay:
1. Checks relay connected
2. Lists tabs → finds/opens `x.com/compose/post`
3. Takes relay screenshot → Gemini Vision pre-flight (login, popups, loading)
4. Aborts if not logged in or page not ready
5. Writes content to `scripts/Post_content.txt`
6. Runs `scripts/xpost.py` (pyautogui replay) — **single attempt, no retry**
7. All events logged to `logs/twitter_post.log`

Params: `content` (max 280 chars), `dry_run`. Requires extension relay + `twitter_steps.json`.

### 19. Desktop Automation — `desktop_automation`

**Windows native app automation** via pywinauto (UIA backend). Requires `pip install pywinauto` and `pip install Pillow` (for window screenshots). Each action builds a Python script, executes it with a 30-second subprocess timeout, and parses JSON output. **Exclusive lock** on `desktop`.

| Action | Params | Behavior |
|--------|--------|----------|
| `list_windows` | — | List all visible top-level windows (title, handle, rect, process_id) |
| `focus_window` | `title` | Bring a window to foreground by partial title match |
| `inspect_controls` | `title`, `depth?` (default 3) | List all UI controls in a window (name, type, auto_id, rect, enabled) |
| `click_control` | `title`, `control`, `click_type?` | Click a control by name/auto_id. Supports left/right/double |
| `type_text` | `title`, `control`, `text`, `clear_first?` | Type text into an input control |
| `get_text` | `title`, `control` | Read text content from a control |
| `send_keys` | `title`, `keys` | Send keyboard shortcuts (pywinauto syntax, e.g. `{VK_CONTROL down}s{VK_CONTROL up}`) |
| `wait_for_window` | `title`, `timeout?` (default 10s) | Wait for a window to appear |
| `launch_app` | `app_path`, `app_args?`, `title?`, `timeout?` | Launch an application, wait for its window, return handle + rect + PID. If `title` is omitted, derives match from the app filename |
| `screenshot_window` | `title`, `prompt?` | Capture a screenshot of just a specific window (using PIL ImageGrab on the window rect). If `prompt` is given, sends the screenshot to Gemini Vision for analysis and returns the AI response alongside the image path. Gives visual "eyes" on any native app |

**Use when:** You need to interact with native Windows apps (Notepad, Excel, VS Code, File Explorer, Settings, etc.) — anything that browser tools can't reach. Use `screenshot_window` with a prompt for apps with poor UI Automation trees (Java Swing, Delphi, custom GDI) where `inspect_controls` returns unhelpful results.

**Not available to org agents** (filtered alongside `execute_powershell` and `run_python_script`).

### 20. Scheduler — `manage_scheduler`

| Action | Lock | Behavior |
|--------|------|----------|
| `add` | Write (`scheduler`) | Add cron job with expression + command |
| `list` | Read | List all active jobs |
| `remove` | Write | Stop and delete job |

Jobs persisted to `memory/scheduled_jobs.json`. When cron fires, sends `[INTERNAL_SCHEDULER] Periodic Task Execution: {command}` to the Brain.

### 21. Todos — `manage_todos`

| Action | Lock | Behavior |
|--------|------|----------|
| `create` | Write (`todos`) | Create a new todo with optional priority/dueDate/tags/subtask |
| `list` | Read | Get todos with filters (status, priority, tag); top-level only |
| `due_today` | Read | Get all open todos due today + overdue count |
| `complete` | Write | Mark todo done by ID |
| `reopen` | Write | Uncheck a completed todo |
| `update` | Write | Edit any field (title, notes, priority, dueDate, tags, estimatedMinutes) |
| `delete` | Write | Remove todo + all its subtasks permanently |
| `add_subtask` | Write | Add a child todo under a parent (max 1 level deep) |
| `create_recurring` | Write | Create recurring template (spawns copies on schedule) |
| `list_recurring` | Read | List all recurring templates |
| `delete_recurring` | Write | Remove template; preserves past instances |
| `stats` | Read | Get completion stats for the week |

Data persisted atomically to `memory/todos.json` (write-to-tmp then rename). Recurring templates are processed at midnight via `node-cron` and on server startup.

**Stats:** All counts in `getStats()` (Open, Done, Due Today, Overdue, High Priority, Completed This Week) apply to **top-level todos only** (`!parentId`), matching exactly what the dashboard list displays. Subtasks are excluded from stats.

**Org agent restrictions:** Agents cannot `complete`, `delete`, or `delete_recurring` user-created todos (runtime guard checks `createdBy`). Agents should always set `createdBy: 'agent'`, `sourceLabel`, and `sourceType` when creating todos.

---

## Skill Locking System

**File:** `src/core/skill-lock.ts`

Prevents concurrent access to shared resources in multi-agent execution.

### Lock Types and Keys

| Key | Type | Timeout | Used By |
|-----|------|---------|---------|
| `browser_vision` | Exclusive | 60s | browser, vision |
| `clipboard` | Exclusive | 5s | clipboard |
| `desktop` | Exclusive | 30s | desktop_automation |
| `memory` | Read-Write | 5s | memory, org_read/write_memory |
| `scheduler` | Read-Write | 5s | scheduler |
| `todos` | Read-Write | 5s | todos |
| `files:{path}` | Read-Write | 10s | files, pdf, task board |

**Usage pattern:**
```typescript
const release = await skillLock.acquireExclusive('browser_vision', holder);
try { /* critical section */ } finally { release(); }
```

Lock waits emit events so the dashboard can show "waiting for lock" status on sub-agents.

---

## Conversation Management

**File:** `src/core/conversation-manager.ts`

- Max 3 simultaneous chats (labeled "Chat 1", "Chat 2", "Chat 3")
- Each chat gets its own Brain instance
- `send(conversationId, message)` → delegates to `brain.processMessage()`
- `abort(conversationId)` → stops Brain tool loop + kills all sub-agents
- `close(conversationId)` → saves session to disk, destroys Brain
- On page refresh, frontend re-requests history via `conversation:history` socket event

---

## Organization System (Autonomous AI Teams)

### Org Data Model

```typescript
interface Org {
  id: string;                     // org_${timestamp}
  name: string;
  mission: string;
  rootDir: string;                // Git root for protection snapshot
  orgDir: string;                 // orgs/{name}-{shortId}/
  workspaceDir: string;           // orgDir/workspace/
  paused: boolean;
  agents: OrgAgent[];
  protection: {
    mode: 'none' | 'git' | 'manual' | 'both';
    gitFiles: string[];           // From git ls-files
    manualPaths: string[];
  };
}

interface OrgAgent {
  id: string;                     // agent_${timestamp}_${random}
  name: string;
  role: string;                   // CEO, CTO, Developer, etc.
  personality: string;
  responsibilities: string;
  goals: string[];
  autonomyLevel: 'full' | 'approval_required';
  heartbeat: { cron: string; enabled: boolean; };
  paused: boolean;
  reportingTo: string | null;     // Another agent's ID
  lastRunAt: string | null;
  lastRunStatus: 'completed' | 'failed' | 'skipped' | null;
}
```

### Heartbeat Engine

**File:** `src/core/org-heartbeat.ts`

- Each agent has a cron expression (e.g., `"0 9 * * *"` = daily 9am)
- Uses `node-cron` library
- Stagger: if multiple agents share same cron, offset by 2-minute increments
- Event-triggered: `org_delegate` wakes target agent immediately
- Skip-if-running: concurrent heartbeat skipped, not stacked
- Max 5 agents running concurrently per org

### Agent Execution

**File:** `src/core/org-agent-runner.ts`

When an agent runs (cron/manual/event/chat):

1. Check not already running, not paused
2. Create Brain with **persona system prompt**:
   - Org mission + agent identity + colleague list
   - Task queue + memory + shared memory
   - Human comments on workspace files
   - 11-step workflow: read memory → check tickets → create ticket → execute → report
3. **Filter tools**: remove `execute_powershell`, `run_python_script`, `manage_scheduler`, `desktop_automation` (safety)
4. **Inject org skills**: 13 org-specific tools
5. **Tool interception**: write operations checked against protection list
6. Process message → log run to `runs.jsonl`

### Ticket System

**File:** `src/core/org-task-board.ts`

```typescript
interface Ticket {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'blocked' | 'done';
  assigneeId: string | null;
  comments: TicketComment[];
  history: TicketHistoryEntry[];
}
```

- Write-lock protected per org (`files:tickets:{orgId}`)
- In-progress tickets bound to assignee (others can't claim)
- Stale in-progress tickets auto-reset on server restart

### File Protection + Code Proposals

**File:** `src/core/org-file-guard.ts`

- Git protection: snapshots `git ls-files` from org's rootDir
- Manual protection: user-specified paths
- Protected files cannot be directly written by agents
- Agents must use `org_propose_code_change` → creates proposal for human review
- Proposals stored with original + proposed content in `workspace/proposals/{id}/`
- Max 3 pending proposals per agent
- Proposals go stale after 7 days

---

## Telegram Interface

**File:** `src/interfaces/telegram.ts` + `src/core/telegram-brain.ts`

### Architecture

The Telegram bot is a **completely isolated** Brain instance — separate from the dashboard's 3-pane chat and from org agents.

```
Telegram App → Telegraf (long polling) → telegramBrain.processMessage()
                                              │
                                        Isolated Brain
                                        (agentId: telegram_primary)
                                              │
                                        19 standard skills
                                        (NO org skills)
```

**Key isolation properties:**
- Not listed in `conversationManager.list()` — doesn't count toward the 3-pane limit
- No `orgId`/`orgAgentId` — all org skills return "Not running in org context"
- History not saved on shutdown — Telegram users reconnect fresh
- One-way org connection: org agents can push notifications TO Telegram, but Telegram can't talk to org agents

### Inbound (User → Bot)

1. Telegraf polls Telegram API for updates (long polling, not webhooks)
2. `bot.on('text')` handler fires, checks `AUTHORIZED_CHAT_ID`
3. Typing indicator starts (repeats every 4s via `setInterval`)
4. `telegramBrain.processMessage(message)` processes through Gemini + tool loop
5. Response converted from GitHub-flavored markdown → Telegram MarkdownV2 (with plaintext fallback)
6. Long responses split into 4096-char chunks

### Outbound (System → User)

Org notifications (`storeNotification()`) and daily digests flow through `sendMessage()`:
1. `flushTelegramQueue()` picks up pending notifications (rate-limited: 5 per agent run)
2. Message formatted with emoji prefix by notification level
3. Converted to MarkdownV2 with plaintext fallback
4. Sent via `bot.telegram.sendMessage(AUTHORIZED_CHAT_ID, ...)`

### Reliability

- **Retry with backoff**: `launchWithRetry()` handles 409 conflicts (stale polling from previous instance) with up to 5 retries and exponential backoff
- **Graceful shutdown**: `telegram.stop()` called on SIGINT/SIGTERM to cleanly release the polling connection
- **`dropPendingUpdates: true`**: Discards stale messages queued while bot was offline
- **`bot.catch()` handler**: Logs runtime polling errors instead of silently swallowing them

---

## Chrome Extension Relay

**Directory:** `extension/`

Chrome MV3 extension that bridges PersonalClaw to the user's real browser tabs.

### Message Protocol

**Connection:** Extension connects to `ws://127.0.0.1:3000/relay`

**Extension → Backend:**
- `tabs_update` — full tab list on any tab change
- `heartbeat` — every 20 seconds
- `command_result` — response to a command (`{id, success, data}`)

**Backend → Extension:**
```json
{
  "id": "cmd_1_1711000000000",
  "command": "navigate|click|type|scrape|screenshot|scroll|evaluate|get_elements|list_tabs|switch_tab|open_tab|close_tab",
  "params": { }
}
```

**Content script capabilities:**
- Element finding: CSS selector → text matching → placeholder/name/aria-label
- Visual feedback: 3px outline flash (1.5s) on click/type
- Character-by-character typing with realistic delays (20-50ms)
- Rich scraping: text, links, forms, metadata
- JavaScript evaluation in page context

---

## Event Bus

**File:** `src/core/events.ts`

All subsystems communicate via typed events. The dashboard subscribes to the event stream for real-time updates.

### Event Categories

**Brain:** `brain:message_received`, `brain:message_processed`, `brain:tool_called`, `brain:tool_completed`, `brain:tool_failed`, `brain:model_failover`, `brain:context_compacted`

**Skills:** `skill:lock_waiting`, `skill:lock_acquired`, `skill:lock_released`, `skill:lock_queued`

**Conversations:** `conversation:created`, `conversation:closed`, `conversation:aborted`

**Workers:** `agent:worker_started`, `agent:worker_completed`, `agent:worker_failed`, `agent:worker_timed_out`, `agent:worker_queued`

**Org:** `org:created`, `org:updated`, `org:deleted`, `org:agent:created`, `org:agent:updated`, `org:agent:heartbeat_fired`, `org:agent:run_started`, `org:agent:run_completed`, `org:agent:run_failed`, `org:agent:delegated`, `org:agent:file_activity`, `org:ticket:created`, `org:ticket:updated`

**Relay:** `relay:extension_connected`, `relay:extension_disconnected`, `relay:tabs_update`

**Todos:** `todos:updated`, `todos:recurring_fired`

**System:** `system:server_started`, `system:server_shutdown`, `system:scheduler_fired`

**Learning:** `learning:started`, `learning:completed`, `learning:failed`

---

## Self-Learning Engine

**File:** `src/core/learner.ts`

After conversations end, the Learner asynchronously analyzes the history using `gemini-2.5-flash` (cheap model) and extracts:

- **User profile** — name, role, company, expertise level
- **Communication style** — tone, verbosity, emoji usage, shorthand dictionary
- **Intent patterns** — "when user says X, they mean Y" (with confidence scores)
- **Workflow patterns** — recurring multi-step processes
- **Tool preferences** — which tools user prefers/avoids
- **Corrections** — mistakes and lessons learned
- **Domain knowledge** — specialized terminology

All learned data persisted to `memory/self_learned.json` and injected into every Brain's system prompt.

---

## REST API Endpoints

**Server:** `src/index.ts` (Express on port 3000)

### Chat
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/chat` | Send message (routes to Chat 1) |
| GET | `/api/conversations` | List all conversations |
| POST | `/api/conversations` | Create new conversation |
| POST | `/api/conversations/:id/message` | Send message to specific chat |
| POST | `/api/conversations/:id/abort` | Stop processing |
| DELETE | `/api/conversations/:id` | Close conversation |

### Orgs
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/orgs` | List organizations |
| POST | `/api/orgs` | Create organization |
| GET | `/api/orgs/:id` | Get org details |
| PUT | `/api/orgs/:id` | Update org |
| DELETE | `/api/orgs/:id` | Delete org (soft) |
| POST | `/api/orgs/:id/agents` | Add agent |
| PUT | `/api/orgs/:id/agents/:agentId` | Update agent |
| DELETE | `/api/orgs/:id/agents/:agentId` | Delete agent |
| POST | `/api/orgs/:id/agents/:agentId/trigger` | Manual trigger |

### Tickets & Proposals
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/orgs/:id/tickets` | List tickets |
| POST | `/api/orgs/:id/tickets` | Create ticket |
| PUT | `/api/orgs/:id/tickets/:ticketId` | Update ticket |
| GET | `/api/orgs/:id/proposals` | List proposals |
| POST | `/api/orgs/:id/proposals/:id/approve` | Approve code change |
| POST | `/api/orgs/:id/proposals/:id/reject` | Reject code change |

### Todos
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/todos` | List all open todos (top-level + subtasks) |
| GET | `/api/todos/today` | Get todos due today + overdue count |
| POST | `/api/todos` | Create a new todo |
| PUT | `/api/todos/:id` | Update todo fields (inline edit) |
| POST | `/api/todos/complete` | Mark todo done `{id}` |
| POST | `/api/todos/reopen` | Uncheck completed todo `{id}` |
| POST | `/api/todos/subtask` | Add subtask `{parentId, title, ...}` |
| DELETE | `/api/todos/:id` | Delete todo and its subtasks |

### System
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/skills` | List all skills |
| GET | `/api/locks` | Current lock status |
| GET | `/api/relay` | Extension relay status |
| GET | `/api/sessions` | Saved sessions |
| GET | `/api/sessions/search?q=` | Search sessions |
| GET | `/api/audit` | Audit log entries |
| GET | `/api/activity` | Activity feed |
| GET | `/api/metrics` | System metrics |

---

## Socket.io Events

### Client → Server
| Event | Payload | Purpose |
|-------|---------|---------|
| `message` | `{text, conversationId, image?}` | Chat message |
| `conversation:create` | — | New chat pane |
| `conversation:close` | `{conversationId}` | Close pane |
| `conversation:abort` | `{conversationId}` | Stop processing |
| `conversation:history` | `{conversationId}` | Request chat history |
| `org:agent:trigger` | `{orgId, agentId}` | Manual agent run |
| `org:agent:message` | `{orgId, agentId, text, chatId, image?}` | Direct agent message |
| `org:agent:chat:close` | `{orgId, agentId, chatId}` | Close agent chat |
| `org:workspace:files:all` | `{orgId}` | List workspace files |
| `org:workspace:file:read` | `{orgId, path}` | Read file content |
| `org:workspace:file:write` | `{orgId, path, content}` | Write file |
| `org:workspace:file:comment` | `{orgId, path, comment}` | Add comment |
| `org:workspace:organize` | `{orgId}` | Organize files into agent folders |
| `todos:get` | — | Request open todos list |
| `todos:get_all` | — | Request all todos including recurring templates |

### Server → Client
| Event | Payload | Purpose |
|-------|---------|---------|
| `init` | `{skills, activity, model, conversations}` | Initial state on connect |
| `metrics` | `{cpu, ram, totalRam, disk, totalDisk}` | System telemetry (every 5s; disk refreshed every 30s) |
| `response` | `{text, conversationId, metadata}` | Chat response |
| `tool_update` | `{text, conversationId}` | Tool execution progress |
| `chat:tool_feed` | `{tool, args, result, duration}` | Raw tool feed (super-user) |
| `activity` | `{id, type, timestamp, source, summary}` | Activity feed item |
| `agent:update` | `{conversationId, workers[]}` | Sub-agent status |
| `org:list` | `orgs[]` | All organizations |
| `org:notification` | `{orgName, agentName, message, level}` | Toast notification |
| `org:agent:run_update` | `{orgId, agentId, running}` | Agent run state |
| `org:agent:response` | `{orgId, agentId, chatId, text}` | Agent chat response |
| `org:agent:file_activity` | `{orgId, agentId, activity[]}` | Files changed |
| `todos:list` | `todos[]` | Response to `todos:get` |
| `todos:list_all` | `todos[]` | Response to `todos:get_all` (includes templates) |
| `todos:refresh` | — | Emitted after any write operation — clients re-fetch |

---

## Dashboard

**Stack:** React 19, Socket.io Client, Framer Motion, React Resizable Panels, Lucide icons, react-markdown

### Vite Dev Proxy

`dashboard/vite.config.ts` proxies all `/api/*` requests to `http://localhost:3000` during development. This is required because the dashboard runs on port 5173 (Vite) while the REST API is on port 3000 (Express). Without it, all `fetch('/api/...')` calls would return Vite HTML instead of JSON, silently failing.

```js
server: { proxy: { '/api': 'http://localhost:3000' } }
```

Socket.io connects directly to `http://localhost:3000` (hardcoded in `App.tsx`) and is unaffected by this proxy.

### Main Tabs
| Tab | Purpose |
|-----|---------|
| **Command Center** | Multi-pane chat (up to 3), tool feed, sub-agent panels |
| **System Metrics** | CPU/RAM/disk sparklines, session info |
| **Activity Feed** | Real-time event stream with color-coded dots |
| **Todos** | Personal task manager — stats, filters, add form, inline edit, focus mode, recurring |
| **Skills & Config** | All 21 skills listed, quick command cards |
| **Orgs** | Organization management workspace |

### Org Workspace Sub-Tabs
| Sub-Tab | Purpose |
|---------|---------|
| **Agents** | Agent cards — status, chat, edit, run, pause |
| **Tickets** | Kanban board (open → in_progress → blocked → done) |
| **Board** | Agent health dashboard with expandable run history |
| **Workspace** | IDE-style file explorer + editor + human comments |
| **Proposals** | Code proposals with diff view + approve/reject |
| **Activity** | Org-specific event feed |
| **Memory** | Agent + shared memory viewer |
| **Settings** | File protection config |

### Design System (index.css)
- **Theme:** Light-only, clean professional
- **Primary color:** Deep indigo `#4338ca`
- **Background:** Soft blue-to-lavender gradient
- **Borders:** `#d1d5db`, radius `10px`
- **Typography:** Inter font, 800-weight headings
- **Agent colors:** 10-color palette (indigo, violet, cyan, emerald, amber, red, pink, blue, etc.)
- **Collapsible sidebars:** Azure Portal style (240px ↔ 60px icon rail)

---

## Startup & Shutdown

### Startup Sequence (`src/index.ts`)
1. Load `.env`
2. Create Express + HTTP server + Socket.io
3. Initialize Telegram (if token set)
4. Load skills (20 registered)
5. Initialize scheduler (load persisted cron jobs)
6. Load orgs from disk
7. Start org heartbeat engine (schedule all agent crons)
8. Reset stale in-progress tickets
9. Process recurring todos (spawn due instances for today)
10. Schedule midnight cron for recurring todo processing (`0 0 * * *`)
11. Declare `ACTIVITY_FILE` constant + initialize activity buffer
12. Load persisted activity feed from disk into memory (`loadActivityFromDisk`)
13. Initialize audit logger
14. Start HTTP server
15. Attach extension relay at `/relay`
16. Print startup banner

### Shutdown (SIGINT/SIGTERM)
1. Stop Telegram bot polling (prevents 409 conflicts on restart)
2. Stop all heartbeat crons
3. Close all conversation Brains
4. Flush audit buffer
5. Close Socket.io
6. Stop HTTP server

---

## npm Scripts

| Command | Purpose |
|---------|---------|
| `npm run all` | Start backend + dashboard concurrently |
| `npm run dev` | Backend in watch mode (tsx) |
| `npm run dashboard` | Frontend dev server (Vite) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Production (runs `dist/index.js`) |
| `npm run browser` | Launch persistent Chromium with debug port |

---

## Key Dependencies

### Backend
| Package | Version | Purpose |
|---------|---------|---------|
| `@google/generative-ai` | ^0.24.1 | Gemini API client |
| `express` | ^5.2.1 | HTTP server |
| `socket.io` | ^4.8.3 | Real-time communication |
| `playwright` | ^1.58.2 | Browser automation |
| `node-cron` | ^4.2.1 | Cron scheduling |
| `ws` | ^8.19.0 | WebSocket (extension relay) |
| `telegraf` | ^4.16.3 | Telegram bot |
| `axios` | ^1.13.6 | HTTP client |
| `pdf-lib` | ^1.17.1 | PDF manipulation |
| `pdfjs-dist` | ^5.5.207 | PDF text extraction |
| `screenshot-desktop` | ^1.15.3 | Desktop screenshots |
| `clipboardy` | ^5.3.1 | Clipboard access |
| `systeminformation` | ^5.31.4 | CPU/RAM/disk metrics |

### Dashboard
| Package | Version | Purpose |
|---------|---------|---------|
| `react` | ^19.2.0 | UI framework |
| `socket.io-client` | ^4.8.3 | Real-time client |
| `react-markdown` | ^10.1.0 | Markdown rendering |
| `react-resizable-panels` | ^4.7.3 | Split pane layout |
| `framer-motion` | ^12.35.2 | Animations |
| `lucide-react` | ^0.577.0 | Icons |

---

## Architectural Patterns

### 1. Multi-Instance Brain
Each chat pane, org agent, and sub-agent gets its own Brain. No shared state between Brains except through skills (files, memory, tickets).

### 2. Circular Dependency Breaking
- **Brain ↔ AgentRegistry:** Registry lazy-imports Brain inside `startWorker()`
- **OrgAgentRunner ↔ Brain:** Dynamic import in `createOrgAgentBrain()`
- **SkillLock ↔ AgentRegistry:** Event-bus communication only (no direct imports)

### 3. Tool Interception for Org Agents
Org agents pass a `toolCallInterceptor` to their Brain. Write operations are checked against the org's protection list. Protected files are blocked with a message suggesting `org_propose_code_change`.

### 4. Event-Driven Decoupling
All major systems emit events via EventBus. The dashboard subscribes to the event stream. Audit logging happens via event subscription, not direct coupling.

### 5. Concurrent Execution Control
- 3 simultaneous human chats (hard limit)
- 5 sub-agent workers per chat (queue beyond 5)
- 5 org agents per org running concurrently
- Skill locks prevent resource conflicts

### 6. Local-First, No External Data
No data sent except to Google Gemini API. All storage is local JSON/JSONL files. No database required.

---

## How to Add a New Skill

1. Create `src/skills/my-skill.ts`:
```typescript
import type { Skill, SkillMeta } from '../types/skill.js';

export const mySkill: Skill = {
  name: 'my_skill_name',
  description: 'What this skill does. Be detailed — the AI reads this.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['do_thing'], description: '...' },
      input: { type: 'string', description: '...' },
    },
    required: ['action'],
  },
  run: async (args: any, meta: SkillMeta) => {
    // Implementation here
    return { success: true, result: '...' };
  },
};
```

2. Register in `src/skills/index.ts`:
```typescript
import { mySkill } from './my-skill.js';
// Add to skills array:
export const skills: Skill[] = [ ..., mySkill ];
```

3. Rebuild and restart server.

**Tips:**
- Use `skillLock` if your skill accesses shared resources
- Return `{success: false, error: '...'}` on failure — the AI reads this
- The `description` field is critical — it's the AI's only guide for when/how to use the tool
- Use `meta.orgId` / `meta.orgAgentId` to detect org context
- For org-only skills, add them to `src/skills/org-skills.ts` and inject via `injectExtraTools()`

---

## Security Model

| Layer | Mechanism |
|-------|-----------|
| **File Protection** | Git-tracked or manually specified files require code proposal workflow |
| **Org Isolation** | Each org has separate workspace, memory, browser profile |
| **Tool Filtering** | Org agents cannot use `execute_powershell`, `run_python_script`, `manage_scheduler`, `desktop_automation` |
| **Skill Locks** | Prevent concurrent access to browser, clipboard, desktop, memory |
| **Ticket System** | In-progress tickets bound to assignee |
| **Proposal Limits** | Max 3 pending proposals per agent, stale after 7 days |
| **Delegation Depth** | Max 5 delegation hops (prevents infinite loops) |
| **Notification Rate** | Max 5 Telegram notifications per agent run |
| **Telegram Auth** | Optional `AUTHORIZED_CHAT_ID` locks bot to single user |
| **Audit Trail** | Every tool call, model interaction, org event logged to JSONL |
| **Local-Only** | No external data store — all JSON files on disk |

---

*Last updated: 2026-03-26 — PersonalClaw v12.9.3*
