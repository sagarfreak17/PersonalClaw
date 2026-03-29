# PersonalClaw — Agent Instructions

Welcome, Agent. You are operating within the PersonalClaw codebase — a local-first AI automation platform for Windows built on Google Gemini, Express, Socket.io, and React.

For the full technical deep-dive (every interface, every event, every endpoint), see `docs/ARCHITECTURE.md`. This file gives you what you need to work effectively.

---

## Project Structure (12.11.2)

```
PersonalClaw/
├── src/
│   ├── index.ts                    # Express server, Socket.io, REST API, startup sequence
│   ├── types/
│   │   └── skill.ts                # Skill + SkillMeta interfaces
│   ├── core/
│   │   ├── brain.ts                # Brain class — Gemini multi-model, tool loop, failover, compaction
│   │   ├── conversation-manager.ts # Human chat panes (max 3 concurrent)
│   │   ├── agent-registry.ts       # Sub-agent worker lifecycle (max 5 per chat)
│   │   ├── org-manager.ts          # Org/Agent CRUD + JSON persistence
│   │   ├── org-heartbeat.ts        # Cron scheduling + event-triggered agent runs
│   │   ├── org-agent-runner.ts     # Executes org agents as persona-injected Brains
│   │   ├── org-task-board.ts       # Kanban ticket system per org (write-lock protected)
│   │   ├── org-file-guard.ts       # File protection + code proposal workflow
│   │   ├── org-notification-store.ts # Persistent notifications + Telegram (rate-limited)
│   │   ├── todo-manager.ts         # Todo CRUD, recurring engine, stats, filtered queries
│   │   ├── skill-lock.ts           # Concurrent resource protection (exclusive + read-write locks)
│   │   ├── events.ts               # EventBus — 45+ typed events
│   │   ├── browser.ts              # BrowserManager — Playwright + native Chrome CDP
│   │   ├── chrome-mcp.ts           # Chrome 146+ native MCP / CDP adapter
│   │   ├── relay.ts                # Chrome Extension WebSocket relay (/relay path)
│   │   ├── mcp.ts                  # Playwright MCP server adapter
│   │   ├── audit.ts                # JSONL audit logging with rotation
│   │   ├── sessions.ts             # Session save/restore/search
│   │   ├── learner.ts              # Self-learning engine (async, uses gemini-2.5-flash)
│   │   ├── terminal-logger.ts      # Console tee to daily rolling file
│   │   └── telegram-brain.ts       # Isolated Telegram Brain instance
│   ├── interfaces/
│   │   └── telegram.ts             # Telegraf bot — polling, retry, markdown formatting, typing indicator
│   └── skills/                     # 21 registered skills
│       ├── index.ts                # Skill registry, getToolDefinitions(), handleToolCall()
│       ├── shell.ts                # execute_powershell — PowerShell commands
│       ├── python.ts               # run_python_script — dynamic Python execution
│       ├── files.ts                # manage_files — read/write/append/delete/list
│       ├── vision.ts               # analyze_vision — screenshot + Gemini Vision
│       ├── clipboard.ts            # manage_clipboard — read/write clipboard
│       ├── memory.ts               # manage_long_term_memory — learn/recall/forget
│       ├── browser.ts              # browser — 3 modes (Playwright/native Chrome/relay), 26 actions
│       ├── http.ts                 # http_request — REST API client (axios)
│       ├── network.ts              # network_diagnostics — ping/dns/traceroute/port check (9 actions)
│       ├── process-manager.ts      # manage_processes — process/service control (10 actions)
│       ├── system-info.ts          # system_info — deep system diagnostics (12 actions)
│       ├── pdf.ts                  # manage_pdf — extract/merge/split/watermark/create (8 actions)
│       ├── imagegen.ts             # generate_image — Gemini Pro/Flash image gen
│       ├── agent-spawn.ts          # spawn_agent — parallel sub-agent workers
│       ├── org-management-skill.ts # manage_org — org/agent CRUD from chat
│       ├── org-skills.ts           # 13 org-agent-only skills (tickets, memory, delegate, proposals)
│       ├── scheduler.ts            # manage_scheduler — cron job management
│       ├── linkedin.ts             # linkedin_post — pyautogui replay automation
│       ├── twitter.ts              # twitter_post — relay + vision pre-flight + pyautogui
│       ├── todos.ts                # manage_todos — personal todo list (12 actions, read-write lock)
│       ├── desktop-automation.ts   # desktop_automation — pywinauto Windows app automation (10 actions)
│       └── teamgps.ts              # teamgps_csat — MSP partner health & scorecard (8 actions)
├── dashboard/                      # React 19 + Vite frontend (port 5173)
│   ├── vite.config.ts              # Vite config — proxies /api → http://localhost:3000 (required for REST calls)
│   └── src/
│       ├── App.tsx                 # Main dashboard — sidebar, 6 tabs, metrics, socket
│       ├── index.css               # Design system — light theme, indigo accent (#4338ca)
│       ├── components/
│       │   ├── ChatWorkspace.tsx        # Multi-pane resizable chat (react-resizable-panels)
│       │   ├── ConversationPane.tsx     # Single chat — markdown, workers, screenshots
│       │   ├── OrgWorkspace.tsx         # 8-tab org management container
│       │   ├── AgentCard.tsx            # Agent card + EditAgentModal (heartbeat, reports-to)
│       │   ├── AgentChatPane.tsx        # Direct agent chat (minimize/close)
│       │   ├── BoardOfDirectors.tsx     # Agent health dashboard, expandable cards
│       │   ├── OrgChart.tsx             # Hierarchical org visualization
│       │   ├── TicketBoard.tsx          # Kanban — open/in_progress/blocked/done
│       │   ├── WorkspaceTab.tsx         # IDE-style file explorer + editor + comments
│       │   ├── ProposalBoard.tsx        # Code proposal diff view + approve/reject
│       │   ├── OrgProtectionSettings.tsx # Protection mode config + file list
│       │   ├── TodosTab.tsx             # Todos UI — stats bar, filters, add form, inline edit, focus mode, recurring create form
│       │   └── WorkerCard.tsx           # Sub-agent status card
│       ├── hooks/
│       │   ├── useConversations.ts      # Chat state + socket handlers
│       │   ├── useOrgs.ts              # Org/agent/ticket/proposal state
│       │   ├── useOrgChat.ts           # Agent direct messaging (minimize/close)
│       │   ├── useAgents.ts            # Sub-agent worker tracking
│       │   ├── useScreenshot.ts        # DisplayMedia screen capture
│       │   └── useTodos.ts             # Todos state, socket sync, filter logic (useMemo for derived data)
│       └── types/
│           ├── conversation.ts          # Message, WorkerAgentInfo
│           ├── org.ts                   # Org, OrgAgent, Ticket, Proposal, Blocker
│           └── todos.ts                 # Todo, TodoStats, TodoFilter interfaces
├── extension/                      # Chrome MV3 relay extension
│   ├── manifest.json               # Permissions: tabs, activeTab, scripting
│   ├── background.js               # WebSocket to ws://127.0.0.1:3000/relay
│   ├── content.js                  # DOM interaction (click, type, scrape, scroll, evaluate)
│   └── popup.html / popup.js       # Connection status + config
├── orgs/                           # Persistent org data (one dir per org)
│   └── {orgName}-{shortId}/
│       ├── org.json                # Org config + agents array
│       ├── workspace/              # Shared project files
│       │   ├── {role-slug}/        # Per-agent folder (ceo/, cto/, dev/, etc.)
│       │   └── proposals/{id}/     # Original + proposed file content
│       ├── agents/{agentId}/
│       │   ├── memory.json         # Agent private memory
│       │   └── runs.jsonl          # Run history (one JSON per line)
│       ├── shared_memory.json      # Org-wide shared state
│       ├── tickets.json            # Task board
│       ├── proposals.json          # Proposal metadata
│       ├── blockers.json           # Open blockers
│       └── notifications.jsonl     # Stored notifications
├── memory/                         # Persistent storage
│   ├── long_term_knowledge.json    # Learned user preferences
│   ├── self_learned.json           # Auto-learned patterns
│   ├── scheduled_jobs.json         # Active cron jobs
│   ├── todos.json                  # All todos + recurring templates (atomic write)
│   └── audit/                      # Daily JSONL audit logs
├── scripts/                        # Automation scripts
│   ├── xpost.py                    # Twitter posting (pyautogui replay)
│   ├── xteacher.py                 # Record mouse clicks for automation
│   ├── twitter_steps.json          # Recorded click coordinates
│   └── Post_content.txt            # Tweet content buffer
├── PersonalClawApp/                # React Native / Expo SDK 55 Android app
│   ├── app/
│   │   ├── _layout.tsx             # Root layout — socket init, push notification handler, auth guard
│   │   ├── (tabs)/
│   │   │   ├── index.tsx           # Chat screen — voice (hold-to-talk), TTS, image picker
│   │   │   ├── activity.tsx        # Live activity feed
│   │   │   ├── metrics.tsx         # Real-time metrics
│   │   │   ├── orgs.tsx            # Org list
│   │   │   └── settings.tsx        # Server URL + connection status
│   │   └── org/[orgId].tsx         # Org detail — 5 tabs: Agents/Tickets/Proposals/Blockers/Memory
│   ├── components/orgs/            # ProposalsView, BlockersView, MemoryView, AgentsView, TicketsView
│   ├── services/
│   │   ├── socket.ts               # Socket.io client (polling+WS transport)
│   │   ├── push-notifications.ts   # FCM token + notification categories (Approve/Reject/Resolve)
│   │   └── voice.ts                # expo-audio recording + Gemini STT upload
│   ├── store/index.ts              # Zustand v5: Auth, Connection, Chat, Orgs, Activity, Metrics
│   ├── constants/index.ts          # DEFAULT_SERVER_URL = https://api.utilization-tracker.online
│   └── eas.json                    # EAS Build profiles + autoIncrement + Google Play submit
├── screenshots/                    # Vision + relay screenshots
├── outputs/                        # Generated PDFs + images
├── logs/                           # twitter_post.log, activity.jsonl, daily server logs
├── docs/
│   ├── ARCHITECTURE.md             # FULL technical reference (share with any AI)
│   └── version_log.md              # Changelog (update when making changes)
└── .env                            # GEMINI_API_KEY, PORT, TELEGRAM_BOT_TOKEN, etc.
```

---

## Architecture at a Glance

```
Dashboard (:5173) ←──Socket.io──→ Express Server (:3000) ←──Socket.io──→ Android App
                                       │                                  (Cloudflare Tunnel)
                    ┌──────────────────┼──────────────────┐
                    │  21 SKILLS (Tools)                  │
                    │  shell • python • files • vision    │
                    │  clipboard • memory • browser       │
                    │  http • network • processes         │
                    │  sysinfo • pdf • imagegen           │
                    │  agent-spawn • org-management       │
                    │  scheduler • linkedin • twitter     │
                    │  todos • desktop • teamgps          │
                    │  + 13 org-specific skills           │
                    └─────────────────────────────────────┘
                           (Gemini)
                              │
                        21 Skills + 13 Org Skills

Telegram (Telegraf) ──polling──→ telegramBrain (isolated Brain)
                                  │
                             21 Skills (NO org skills)
                             Separate history, no persistence

Android App (PersonalClawApp) ──Socket.io over Cloudflare Tunnel──→ Express Server
  • Full chat with voice input (Gemini STT) + TTS
  • Org management: Tickets, Proposals (approve/reject), Blockers (resolve), Memory browser
  • Push notifications via Firebase FCM with inline action buttons
  • EAS Build → Google Play Store
```

**Five operation modes:**
1. **Human Chat** — Up to 3 chat panes, each with its own Brain instance
2. **Autonomous Orgs** — AI agent teams on cron schedules with tickets, delegation, proposals
3. **Scheduled Tasks** — Cron jobs that trigger the Brain to perform recurring work
4. **Telegram** — Isolated Brain for remote control via Telegram bot (no org access, no persistence)
5. **Android App** — React Native mobile app connecting via Cloudflare Tunnel; full chat + org management + push notifications + voice input

---

## Android App (PersonalClawApp)

- **Stack**: React Native 0.83.2, Expo SDK 55, expo-router v4, Zustand v5, Socket.io client
- **Remote access**: Cloudflare Tunnel at `https://api.utilization-tracker.online` → backend :3000
- **Push**: Firebase FCM via `google-services.json`; inline Approve/Reject/Resolve action buttons
- **Voice**: expo-audio hold-to-talk → `POST /api/voice/transcribe` → Gemini STT → auto-send
- **TTS**: expo-speech reads AI replies aloud (toggle per conversation)
- **New backend endpoints added for app**:
  - `POST /api/voice/transcribe` — multer audio upload → Gemini STT
  - `POST /api/push/register` — store Expo push token
- **New socket handlers added for app**:
  - `org:proposal:action` — unified approve/reject
  - `org:memory:list` — scope-based memory retrieval
  - `org:tickets:list`, `org:proposals:list`, `org:blockers:list`
- **Brain awareness**: system prompt includes `## Mobile App (Android)` section so Claw knows the app exists and can answer questions about it

---

## AI Engine (Brain)

- **Class**, not singleton — each chat/agent/worker gets its own instance
- **Model failover:** \`gemini-3.1-pro-preview → gemini-3-flash-preview → gemini-2.5-pro → gemini-2.5-flash → gemini-3.1-flash-lite-preview\`
- **Tool loop:** message → Gemini responds with tool calls → execute via `handleToolCall()` → inject results → loop until text-only response
- **Context compaction:** auto-summarizes at ~50 messages to stay within 1M token limit
- **Org agents:** Brain gets persona system prompt (mission, role, colleagues, tickets, memory, human comments)

---

## Skill Interface

Every skill follows this contract:

```typescript
interface Skill {
  name: string;                              // Tool name the AI calls
  description: string;                       // AI reads this to decide when/how to use it
  parameters: any;                           // JSON Schema for args
  run: (args: any, meta: SkillMeta) => Promise<any>;
}

interface SkillMeta {
  agentId: string;
  conversationId: string;
  conversationLabel: string;                 // "Chat 1", "Agent: CEO", etc.
  isWorker: boolean;
  orgId?: string;                            // Set for org agents only
  orgAgentId?: string;
}
```

### Skill Locking

| Lock Key | Type | Timeout | Used By |
|----------|------|---------|---------|
| `browser_vision` | Exclusive | 60s | browser, vision |
| `clipboard` | Exclusive | 5s | clipboard |
| `desktop` | Exclusive | 30s | desktop_automation |
| `memory` | Read-Write | 5s | memory, org memory skills |
| `scheduler` | Read-Write | 5s | scheduler |
| `todos` | Read-Write | 5s | todos |
| `files:{path}` | Read-Write | 10s | files, pdf, task board |

Pattern: `const release = await skillLock.acquireExclusive(key, holder); try { ... } finally { release(); }`

---

## How to Add a New Skill

1. Create `src/skills/my-skill.ts`:
```typescript
import type { Skill, SkillMeta } from '../types/skill.js';

export const mySkill: Skill = {
  name: 'my_skill_name',
  description: 'Detailed description — the AI reads this to decide when to call it.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['do_thing'], description: '...' },
      input: { type: 'string', description: '...' },
    },
    required: ['action'],
  },
  run: async (args: any, meta: SkillMeta) => {
    // Your logic here
    return { success: true, result: '...' };
  },
};
```

2. Register in `src/skills/index.ts`:
```typescript
import { mySkill } from './my-skill.js';
export const skills: Skill[] = [ ..., mySkill ];
```

3. Run `npx tsc --noEmit` to verify, restart server.

**Tips:**
- Use `skillLock` if your skill touches shared resources
- Return `{success: false, error: '...'}` on failure (the AI reads it)
- The `description` is critical — it's the AI's only guide for when/how to use the tool
- Check `meta.orgId` to detect org agent context
- For org-only skills, add to `org-skills.ts` and inject via `injectExtraTools()`
- Follow existing patterns (see `linkedin.ts` or `twitter.ts` for social media skills)

---

## How to Add a New Dashboard Component

1. Create component in `dashboard/src/components/MyComponent.tsx`
2. Add to the relevant tab in `App.tsx` or `OrgWorkspace.tsx`
3. Use Socket.io events for real-time data (see `useOrgs.ts` pattern)
4. Style using class names in `dashboard/src/index.css` (light theme, indigo accent `#4338ca`)

**State management:** Custom hooks (`useOrgs`, `useConversations`, etc.) — no Redux, no context providers.

**API calls from the dashboard:** Always use relative paths like `fetch('/api/todos')` — the Vite dev proxy (`vite.config.ts`) forwards them to `http://localhost:3000`. Socket.io connects directly to port 3000 and is unaffected.

---

## Org System Quick Reference

| Concept | File | Storage |
|---------|------|---------|
| Org config + agents | `org-manager.ts` | `orgs/{name}/org.json` |
| Agent execution | `org-agent-runner.ts` | `agents/{id}/runs.jsonl` |
| Cron scheduling | `org-heartbeat.ts` | Agent's `heartbeat.cron` field |
| Tickets | `org-task-board.ts` | `tickets.json` |
| Code proposals | `org-file-guard.ts` | `proposals.json` + `workspace/proposals/` |
| Agent memory | `org-skills.ts` | `agents/{id}/memory.json` |
| Shared memory | `org-skills.ts` | `shared_memory.json` |
| Notifications | `org-notification-store.ts` | `notifications.jsonl` |

**Org agent restrictions:** Cannot use `execute_powershell`, `run_python_script`, `manage_scheduler`, or `desktop_automation`. Protected file writes are intercepted and routed to proposal system.

---

## Key Technologies

| Tech | Version | Purpose |
|------|---------|---------|
| Node.js + TypeScript | ESNext, strict | Backend runtime |
| Express | ^5.2.1 | HTTP server |
| Socket.io | ^4.8.3 | Real-time communication |
| Google Gemini | `@google/generative-ai` ^0.24.1 | AI model (5-model failover) |
| React | ^19.2.0 | Dashboard UI |
| Vite | — | Frontend dev server + build |
| Playwright | ^1.58.2 | Browser automation |
| node-cron | ^4.2.1 | Cron scheduling |
| Telegraf | ^4.16.3 | Telegram bot |

---

## Rules for Agents

1. **Read before writing.** Always read existing files before modifying them.
2. **Preserve patterns.** Follow existing conventions:
   - ESM imports with `.js` extensions (TypeScript compiles to ESM)
   - `async/await` everywhere
   - Skills return `{success: boolean, ...}` objects
   - Error handling: return error objects, don't throw
3. **Update docs.** Update `docs/version_log.md` when making significant changes. Increment version.
4. **Don't break ports.** Backend: 3000, Dashboard: 5173. Don't change these.
5. **Type-check.** Run `npx tsc --noEmit` to verify TypeScript compiles cleanly.
6. **No hardcoded secrets.** All API keys live in `.env`.
7. **Respect locks.** If your code accesses shared resources (browser, clipboard, files, memory), use the skill lock system.
8. **Test relay skills.** If building anything that uses the extension relay, verify `extensionRelay.connected` first.
9. **Log failures.** For automation skills (social media, scheduled tasks), log to `logs/` directory.
10. **Single responsibility.** Each skill does one thing. Don't merge unrelated functionality.

---

## Quick Commands

```bash
npm run all          # Start backend + dashboard together
npm run dev          # Backend only (watch mode)
npm run dashboard    # Frontend only (Vite dev server)
npx tsc --noEmit     # Type-check without building
npm run build        # Compile to dist/
npm start            # Production mode (dist/index.js)
```

---

## Where to Find More

- **Full technical reference:** `docs/ARCHITECTURE.md` — every interface, event, endpoint, skill parameter
- **Changelog:** `docs/version_log.md` — what changed in each version
- **Environment config:** `.env` — API keys and settings
