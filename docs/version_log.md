# Version Log - PersonalClaw 📜

All notable changes to the PersonalClaw agent will be documented in this file.

## [12.9.3] - 2026-03-26

### Dashboard: Performance & Connection Stability

- **Fixed: Typing lag in chat window** — `systeminformation` calls (`si.currentLoad`, `si.mem`, `si.fsSize`) were running every 2 seconds, blocking the Node.js event loop long enough to cause Socket.IO ping timeouts. Increased metrics interval from 2s → 5s and split disk stats to run only every 30s (6th tick), cutting event loop blocking by ~60%.
- **Fixed: Frequent "disconnected/connected" toast flicker** — added explicit `pingInterval: 15000` and `pingTimeout: 10000` to the Socket.IO server config, giving more tolerance during brief event loop stalls from metrics collection.
- **Improved: Socket.IO client reconnection** — added `reconnectionDelay`, `reconnectionDelayMax`, `reconnectionAttempts: Infinity` to the dashboard Socket.IO client for more resilient connections. Removed explicit `transports: ['websocket', 'polling']` which was forcing websocket-first and causing silent connection failures.
- **Improved: Metrics rendering performance** — wrapped the 3 metrics `setState` calls (`setMetrics`, `setCpuHistory`, `setRamHistory`) in `queueMicrotask()` to batch them into a single React re-render, since Socket.IO callbacks run outside React's automatic batching scope.
- **Fixed: Chat input losing focus after send** — the textarea in `ConversationPane` was disabled via `isWaiting` while the bot responds, which ejects focus. Added `useEffect` to auto-refocus when `isWaiting` flips back to false. Also added `onMouseDown={preventDefault}` on send/screenshot buttons to prevent them from stealing focus on click.

#### Files Changed
- **Updated**: `src/index.ts` — Socket.IO server `pingInterval`/`pingTimeout`, metrics interval 2s → 5s, disk stats every 30s
- **Updated**: `dashboard/src/App.tsx` — Socket.IO client reconnection config (removed forced `transports`), `queueMicrotask` batched metrics updates
- **Updated**: `dashboard/src/components/ConversationPane.tsx` — auto-refocus textarea after bot response, `preventDefault` on button mouseDown
- **Updated**: `dashboard/src/components/ChatInput.tsx` — matching refocus and preventDefault fixes (legacy component)

---

## [12.9.2] - 2026-03-23

### CLI: Setup Script Fixes

- **Fixed: `setup.bat` syntax error** — resolved "require was unexpected at this time" error caused by unescaped parentheses in `if` blocks.
- **Improved Script Robustness** — escaped all nested parentheses in `echo` and `set /p` commands within conditional blocks to prevent premature script termination.
- **Enhanced Messaging** — standardized warning and error prefixes for tool detection (Python/Node).

## [12.9.1] - 2026-03-23

### Dashboard: Message Copy Button

- **New: `MessageCopyButton` component** — elegant "Copy" button for LLM and agent responses.
- **Auto-Copy functionality** — one-click copy to clipboard with visual "copied" feedback (Check icon).
- **Hover-to-reveal UX** — buttons stay hidden to keep the UI clean, appearing only when hovering over a message.
- **Smart Padding** — automated right-padding on assistant messages to ensure text never overlaps with the copy button.
- **Multi-Chat Support** — enabled in both the primary conversation workspace and the individual agent direct chat panes.

## [12.9.0] - 2026-03-23

### Relay Tab Protection + Desktop Automation Skill

#### New: `src/skills/desktop-automation.ts` — `desktop_automation` Skill
- **Windows native app automation** via pywinauto (UIA backend) — automate ANY desktop app, not just browsers
- 10 actions: `list_windows`, `focus_window`, `inspect_controls`, `click_control`, `type_text`, `get_text`, `send_keys`, `wait_for_window`, `launch_app`, `screenshot_window`
- **`launch_app`**: Launch any application by path/name, optionally pass args, wait for its window to appear, return handle + PID + rect. Title match auto-derived from app filename if not provided
- **`screenshot_window`**: Capture just a specific window's region via PIL ImageGrab + optional Gemini Vision analysis. Gives "eyes" on any native app — useful for legacy apps with poor UI Automation trees (Java Swing, Delphi, custom GDI)
- Each action generates a Python script, writes to a temp file, executes with 30-second subprocess timeout, parses JSON output, cleans up
- `escapePy()` helper safely injects string parameters into Python code
- **Exclusive `desktop` lock** (30s timeout) — registered in `skill-lock.ts`
- **Blocked for org agents** — filtered alongside `execute_powershell` and `run_python_script`
- `pywinauto 0.6.9` installed (`pip install pywinauto`), `Pillow 11.3.0` already available

#### Changed: `src/core/relay.ts` — Protected Tab Safety
- Added `PROTECTED_PREFIXES` constant: `chrome://`, `chrome-extension://`, `devtools://`, `edge://`, `about:`, `brave://`
- **`isProtectedTab(tab)`** — exported helper, returns true if tab URL matches any protected prefix or has no URL
- **`getBestDefaultTabId(tabs)`** — exported helper, picks best non-protected tab (prefers active, then first safe, then null)
- **`resolveTabId(tabId?)`** — private method used by all relay content methods; validates given tabId isn't protected, falls back to best default, throws descriptive error if no safe tab available
- `RelayTab` interface now includes `protected?: boolean`
- `currentTabs` getter and `listTabs()` now tag each tab with `protected: boolean`
- All relay content methods updated to use `resolveTabId`: `navigate`, `click`, `type`, `scrape`, `screenshot`, `evaluate`, `scroll`, `getElements`
- `switchTab`, `openTab`, `closeTab`, `highlight` unchanged (explicit required IDs or no tab content targeting)

#### Changed: `src/core/brain.ts`
- Added `desktop_automation` row to the Execution skills table in system prompt
- Added **Extension Relay Rules** block after `http_request` — documents protected tab auto-skip, "no safe tab" recovery flow (`relay_open_tab`), and the `protected` flag on tab listings

#### Changed: `src/core/skill-lock.ts`
- Added `'desktop'` to `ExclusiveLockKey` type union
- Added `desktop: 30_000` to `LOCK_TIMEOUTS`

#### Changed: `src/skills/index.ts`
- Registered `desktopAutomationSkill` (19 → 20 skills)

#### Changed: `src/core/org-agent-runner.ts`
- Added `desktop_automation` to `filterTools()` in `createOrgAgentBrain()`
- Updated disabled-tool text in both `buildOrgAgentSystemPrompt` and `buildOrgAgentChatPrompt`

#### Files Changed
- **New**: `src/skills/desktop-automation.ts` — full pywinauto skill
- **Updated**: `src/core/relay.ts` — protected tab helpers + resolveTabId
- **Updated**: `src/core/brain.ts` — desktop_automation in system prompt, relay rules
- **Updated**: `src/core/skill-lock.ts` — desktop exclusive lock
- **Updated**: `src/skills/index.ts` — skill registration
- **Updated**: `src/core/org-agent-runner.ts` — tool filter + system prompt text
- **Updated**: `docs/ARCHITECTURE.md` — skill count, relay tab protection docs, new skill section, lock table, org filtering, security model

---

## [12.8.0] - 2026-03-22

### Android Mobile App (PersonalClawApp)

Full React Native / Expo SDK 55 Android app built from scratch — enables controlling PersonalClaw from anywhere via mobile.

#### New: Android App (PersonalClawApp/)
- **Expo SDK 55** bare workflow, React Native 0.83.2, expo-router v4 file-based navigation
- **5-tab layout**: Chat, Activity, Metrics, Orgs, Settings
- **Chat screen** — full conversation UI with markdown rendering, worker indicators, hold-to-talk voice input (expo-audio + Gemini STT), TTS toggle (expo-speech), image picker (expo-image-picker)
- **Orgs screen** — lists all orgs with live status; taps through to Org Detail screen
- **Org Detail screen** — 5-tab view per org: Agents, Tickets, Proposals, Blockers, Memory
  - ProposalsView: pending/resolved proposals with inline Approve/Reject buttons
  - BlockersView: open/resolved blockers with Mark Resolved confirmation dialog
  - MemoryView: scoped memory browser with agent tabs, search, expandable entries
- **Activity screen** — live event feed from the backend
- **Metrics screen** — real-time system metrics (tokens, tool calls, uptime)
- **Settings screen** — server URL config, connection indicator

#### New: Real-time Connection (Socket.io)
- Socket.io client with polling+WebSocket transport for mobile reliability
- Zustand v5 global state: Auth, Connection, Chat, Orgs, Activity, Metrics stores
- Handles all core socket events: `init`, `response`, `chat:tool_feed`, `agent:update`, `metrics`, `activity`, `org:list`, `org:created/updated/deleted`, `conversation:list/created`

#### New: Push Notifications (Firebase FCM)
- Firebase Cloud Messaging (FCM) via `google-services.json` + Google Services Gradle plugin
- expo-notifications with Android notification channel
- **Inline action categories**: Proposal notifications have Approve/Reject buttons; Blocker notifications have Resolve button — acts without opening the app
- **Deep-link routing**: chat response push → Chat tab; blocker push → Org Blockers tab; proposal push → Org Proposals tab
- Cold-start handling via `getLastNotificationResponseAsync()`

#### New: Remote Access (Cloudflare Tunnel)
- Cloudflare Tunnel configured at `https://api.utilization-tracker.online` pointing to backend port 3000
- Default server URL updated — app connects from anywhere without being on local WiFi

#### New: EAS Build
- EAS Build configured with development/preview/production profiles
- `autoIncrement: true` for automatic versionCode bumping
- `eas submit` config with Google Play service account for Play Store upload

#### Backend Changes (src/index.ts)
- **New**: `POST /api/voice/transcribe` — multer audio upload + Gemini STT, returns transcript
- **New**: `org:proposal:action` socket handler — unified approve/reject handler (was separate)
- **New**: `org:memory:list` socket handler — scope-based agent memory retrieval
- **Enhanced**: Push notifications now include `categoryId` (proposal/blocker inline actions), `blockerId` in blocker payloads, `agentId` in worker payloads
- **New**: Push notification sent on chat response — strips markdown, sends preview to mobile

#### Brain Update (src/core/brain.ts)
- System prompt updated with `## Mobile App (Android)` section so Claw is aware of the app's capabilities, connection URL, and push notification behavior

#### Infrastructure
- `android/build.gradle` — added `classpath('com.google.gms:google-services:4.4.2')`
- `android/app/build.gradle` — added `apply plugin: "com.google.gms.google-services"`
- `android/local.properties` — created with correct Android SDK path
- `app.json` — added `versionCode: 1`

#### Files Changed
- **New**: `PersonalClawApp/` — entire React Native app directory
- **New**: `PersonalClawApp/services/push-notifications.ts` — FCM token registration, notification categories
- **New**: `PersonalClawApp/services/voice.ts` — expo-audio recording + Gemini STT upload
- **New**: `PersonalClawApp/services/socket.ts` — Socket.io client wrapper with Zustand integration
- **New**: `PersonalClawApp/components/orgs/ProposalsView.tsx` — proposals UI
- **New**: `PersonalClawApp/components/orgs/BlockersView.tsx` — blockers UI
- **New**: `PersonalClawApp/components/orgs/MemoryView.tsx` — memory browser UI
- **Updated**: `PersonalClawApp/app/_layout.tsx` — push notification init + deep-link handler
- **Updated**: `PersonalClawApp/app/org/[orgId].tsx` — 5-tab org detail screen
- **Updated**: `PersonalClawApp/constants/index.ts` — DEFAULT_SERVER_URL → Cloudflare URL
- **Updated**: `src/index.ts` — voice endpoint, new socket handlers, push enhancements
- **Updated**: `src/core/brain.ts` — mobile app awareness in system prompt
- **Updated**: `PersonalClawApp/eas.json` — production build + submit config

---

## [12.7.2] - 2026-03-21

### Todos — Critical Fixes & Recurring Template UI

#### Fixed: Add Todo / All REST Calls Silently Failing
- **Root cause**: No Vite proxy configured — all `fetch('/api/...')` calls from the dashboard (port 5173) went to Vite itself, not the backend (port 3000). Every REST call returned an HTML page, response was not `.ok`, and nothing happened with no visible error.
- **Fix**: Added Vite dev-server proxy in `dashboard/vite.config.ts`:
  ```js
  server: { proxy: { '/api': 'http://localhost:3000' } }
  ```
- **Also fixed**: `CreateOrgModal` fetch calls (`/api/check-git`, `/api/browse-folder`) had the same silent failure — now resolved by the same proxy.
- **Error visibility**: `handleCreate()` now catches network-level failures and shows `"Network error: ..."` inline. Server-level errors (400/500) also surface as `"Server error (400)"` text rather than silently doing nothing.

#### Fixed: Stats Bar Counts Not Matching Displayed List
- **Root cause**: `TodoManager.getStats()` counted all visible todos including subtasks, but the dashboard list only shows top-level todos. A parent with 3 high-priority subtasks showed "4 HIGH PRIORITY" but only 1 card was visible.
- **Fix**: `getStats()` now filters to `!t.parentId` (top-level only) before all calculations — Open, Done, Due Today, Overdue, High Priority, and Completed This Week counts all match exactly what the list shows.

#### Fixed: `loadActivityFromDisk` Temporal Dead Zone Error
- **Root cause**: `loadActivityFromDisk()` was called at line 94 in `src/index.ts` but `ACTIVITY_FILE` (a `const`) wasn't declared until line 109. JavaScript `const` is in the temporal dead zone before its declaration — accessing it throws `ReferenceError: Cannot access 'ACTIVITY_FILE' before initialization`.
- **Fix**: Moved `loadActivityFromDisk()` call to immediately after the `ACTIVITY_FILE` and `MAX_ACTIVITY_FILE_ENTRIES` declarations. Error no longer appears on startup.

#### New: Recurring Template Creation UI
- Added a full create form directly in the "Recurring Templates" section — no longer need to ask the AI to create recurring todos.
- Clicking `+ New Template` expands an inline form with:
  - Title input
  - Frequency selector: **Daily**, **Weekly**, **Monthly**
  - Priority selector
  - Day-of-week picker (clickable day buttons, multi-select) — shown for Weekly
  - Day-of-month number input — shown for Monthly
- Enter to create or click "Create Template" button. Escape or Cancel to dismiss.
- Templates appear in the list immediately after creation.

#### Files Changed
- **Updated**: `dashboard/vite.config.ts` — Vite `/api` proxy to `http://localhost:3000`
- **Updated**: `dashboard/src/components/TodosTab.tsx` — recurring create form, network/server error display, focus button tooltip
- **Updated**: `dashboard/src/index.css` — recurring form CSS (header, create form, day picker, submit/cancel buttons), `.add-todo-error` class
- **Updated**: `src/core/todo-manager.ts` — `getStats()` top-level-only counts
- **Updated**: `src/index.ts` — moved `loadActivityFromDisk()` after `ACTIVITY_FILE` declaration

---

## [12.7.1] - 2026-03-21

### Todos — Bug Fixes & Enhancements

#### Fixed: "Add Todo" Button Silent Failure
- **Root cause**: `handleCreate()` returned early on empty title with no user feedback — typing in the notes field instead of the title field produced zero visible response.
- **Fix**: Title input now triggers a red shake animation + "Title is required" inline error message on empty submit. Focus snaps back to title field automatically.
- **Placeholder updated**: `"What needs to be done?"` → `"Todo title (required) — e.g. Check TimeZest Appointments"` to make the field purpose unambiguous.

#### Fixed: `(Events as any)` Workaround Removed
- `todo-manager.ts` was using `(Events as any).TODOS_UPDATED` and `(Events as any).TODOS_RECURRING_FIRED` because the constants were added after the file was written. Now uses `Events.TODOS_UPDATED` and `Events.TODOS_RECURRING_FIRED` directly.

#### Fixed: Hardcoded Color in CSS
- `.stat-chip.warning` used `#f59e0b` instead of `var(--accent-warning)`. Fixed for theme consistency.

#### Fixed: 13 Missing CSS Classes
Added all classes that were referenced in `TodosTab.tsx` but absent from `index.css`:
- Priority left borders: `.todo-item.priority-high/medium/low`, `.focus-item.priority-high/medium/low`
- Empty states: `.todos-loading`, `.todos-empty`, `.focus-empty`, `.recurring-empty`
- Buttons: `.add-todo-cancel-btn`, `.recurring-delete-btn`, `.subtask-add-btn`
- Elements: `.todo-priority-dot`, `.subtask-title.strikethrough`, `.subtask-item.done`
- Badge colors: `.todo-source-badge` (success), `.todo-tag-badge` (secondary), `.todo-time-badge` (primary)

#### New: Inline Title Editing
- Double-click any open todo's title to edit it in place — no modal, no form.
- Enter to save, Escape to cancel, blur to save.
- New `PUT /api/todos/:id` REST endpoint added to `src/index.ts`.
- New `.todo-title-edit` CSS class for the inline input.

#### New: Org Agent Runtime Permission Guard
- Previously, org agents were instructed via description text not to complete or delete user todos. Now enforced at runtime in `src/skills/todos.ts`:
  - `complete` and `delete` actions called by `meta.isWorker === true` check if the target todo's `createdBy !== 'agent'` and return an error if so.
  - Prevents any org agent from completing or deleting human-created todos regardless of what the AI decides.

#### Files Changed
- **Updated**: `dashboard/src/components/TodosTab.tsx` — title validation, inline edit, `onUpdate` prop
- **Updated**: `dashboard/src/index.css` — 13 missing classes, title error + shake animation, inline edit input
- **Updated**: `src/core/todo-manager.ts` — removed `(Events as any)` casts
- **Updated**: `src/index.ts` — new `PUT /api/todos/:id` endpoint
- **Updated**: `src/skills/todos.ts` — org agent runtime permission guard

---

## [12.7.0] - 2026-03-21

### Task Management System (Todo Manager)

#### New: Todo Manager Core
- **`TodoManager` class** (`src/core/todo-manager.ts`) — robust task engine with support for:
  - CRUD operations (create, update, delete, complete, reopen)
  - Subtask hierarchy (infinitely nestable)
  - Priority levels (low, medium, high, critical)
  - Due dates and overdue tracking
  - Tags and categories
  - Detailed notes with markdown support
  - Automated ID generation and JSON persistence to `memory/todos.json`
- **Recurring Tasks Engine**: Supports daily, weekly (specific days), and monthly recurrence. Automatically spawns new todo instances from templates.
- **Midnight Cron Job**: A daily background task (`0 0 * * *`) that processes all recurring templates and fires missed ones.

#### New: Todos Dashboard Tab
- **Task Board UI** (`dashboard/src/components/TodosTab.tsx`) — premium, high-fidelity task management interface:
  - **Focus Mode**: Dedicated "Today" view with progress tracking.
  - **Stats Bar**: Real-time overview of open, today, overdue, and high-priority tasks.
  - **Weekly Completion Chart**: Visualized progress of completed tasks over the last 7 days.
  - **Filtering**: Quick filters for "Today", "Overdue", "High Priority", and "Done".
  - **Subtask Management**: Expandable subtasks with quick-add functionality.
  - **Template Management**: Dedicated section to view and manage recurring task templates.
- **`useTodos` Hook**: Custom React hook for real-time socket synchronization and task state management.
- **Frontend Types**: Robust `Todo`, `TodoStats`, and `TodoFilter` interfaces in `dashboard/src/types/todos.ts`.

#### System Integration
- **New `manage_todos` Skill**: Enables AI agents to create, query, and manage the user's task list via natural language.
- **Socket.io Integration**: Real-time updates via `todos:refresh` event. Dashboard auto-syncs across all open instances when any task changes.
- **REST API Overhaul**: 7 new endpoints added to `src/index.ts` for task management (`/api/todos`, `/api/todos/complete`, etc.).
- **Event Bus Integration**: `TODOS_UPDATED` and `TODOS_RECURRING_FIRED` events dispatched for audit logging and activity feed.

#### Files Changed
- **New**: `src/core/todo-manager.ts`, `src/skills/todos.ts`, `dashboard/src/components/TodosTab.tsx`, `dashboard/src/hooks/useTodos.ts`, `dashboard/src/types/todos.ts`, `memory/todos.json` (init)
- **Updated**: `src/index.ts` (API/Socket integration), `src/core/events.ts` (new constants), `src/skills/index.ts` (registry), `dashboard/src/App.tsx` (navigation), `dashboard/src/index.css` (styles)

---

## [12.6.2] - 2026-03-21

### Org Agent Workspace Sandbox & File Naming Overhaul

#### Fixed: Agents Writing Files Outside Workspace
- **Root cause**: `manage_files` skill accepted any path. When an org agent used a relative path like `ceo/report.md`, it resolved against `process.cwd()` (the project root) instead of the org's workspace directory — creating rogue folders in the project root.
- **Fix**: The `orgAwareHandleToolCall` interceptor in `org-agent-runner.ts` now sandboxes all `manage_files` write operations to the org's `workspaceDir`. Relative paths resolve against the workspace, and absolute paths outside the workspace are blocked with a clear error message.
- **System prompt updated**: Replaced the vague "Working in the Org Root Directory" section with explicit **File Operations** rules — agents are told writes are sandboxed, must use relative paths, and will be blocked if they attempt to write outside the workspace.

#### Changed: File Naming Convention
- **Before**: `ceo-2026-03-19T14-01-12-CEO-Progress-Report.md` (role first, verbose ISO timestamp with time)
- **After**: `marketing-plan-by-ceo-2026-03-19.md` (document name first, then `-by-{role}-{date}`)
- Filenames are now slugified and cleaned — no uppercase, no special characters, just clean kebab-case
- Date is `YYYY-MM-DD` only (no time component clutter)
- `org_write_report` skill description updated to guide agents toward descriptive document names

#### Fixed: File Attribution for `manage_files` Writes
- Backend workspace file scanner (`org:workspace:files:all`) now matches both relative and absolute paths from agent activity logs
- Files created via `manage_files` are now properly attributed to their agent instead of appearing as "Unassigned Files"

#### Files Changed
- **Updated**: `src/core/org-agent-runner.ts` — workspace sandbox interceptor, updated system prompt, fixed `FileActivityEntry` type to include `'move'` action
- **Updated**: `src/skills/org-skills.ts` — new naming convention in `org_write_report` (`{name}-by-{role}-{date}`)
- **Updated**: `src/index.ts` — file attribution lookup matches absolute paths from activity logs

---

## [12.6.1] - 2026-03-21

### Telegram Bot — Reliability, Formatting & UX Fixes

#### Fixed: Bot Polling 409 Conflicts
- **Root cause**: `bot.launch()` was fire-and-forget with no retry. When the server restarted, the old polling connection lingered (no graceful shutdown), causing Telegram's API to return `409: Conflict: terminated by other getUpdates request`. The new instance silently died — incoming messages never worked.
- **Fix**: Replaced one-shot `launch().catch()` with `launchWithRetry()` — retries up to 5 times with exponential backoff (5s → 10s → 15s → 30s) for 409 conflicts.
- **Graceful shutdown**: Added `telegram.stop()` to the server shutdown handler so polling is cleanly terminated on restart, preventing 409 conflicts entirely.
- **`dropPendingUpdates: true`**: Passed to `launch()` to discard stale queued messages from while the bot was offline.
- **Global error handler**: Added `bot.catch()` so runtime polling errors are logged instead of silently swallowed.

#### Fixed: Markdown Rendering — No More Raw `***` and `###`
- Gemini returns GitHub-flavored markdown which displayed as raw syntax in Telegram (headers, bold, bullets, code blocks all broken).
- **New `markdownToTelegram()` converter**: Transforms GFM → Telegram MarkdownV2 format:
  - `### Headers` → **bold text**
  - `**bold**` → Telegram bold
  - `~~strike~~` → Telegram strikethrough
  - `` `code` `` and code blocks preserved
  - `- bullets` → `• bullets`
  - Special characters escaped for MarkdownV2 compliance
- **Automatic fallback**: If MarkdownV2 parsing fails (Telegram is strict), retries as clean plaintext via `markdownToPlaintext()` which strips all markdown syntax.
- **Applies to both directions**: Incoming message replies AND outbound notifications (org alerts, daily digests) now render cleanly.

#### New: Continuous Typing Indicator
- Previously: single `sendChatAction('typing')` fired once, expired after 5 seconds — no visible feedback during long processing.
- Now: typing indicator fires immediately then repeats every 4 seconds via `setInterval`, keeping the "typing..." bubble visible the entire time the Brain processes. Cleared on response or error.

#### Improved: Message Splitting
- Telegram's 4096-character limit now handled properly — long responses split into sequential chunks with formatting preserved.

#### Files Changed
- **Updated**: `src/interfaces/telegram.ts` — retry logic, markdown converter, typing interval, formatted replies, error handler
- **Updated**: `src/index.ts` — `telegram.stop()` in shutdown handler

---

## [12.6.0] - 2026-03-21

### Twitter/X Auto-Post Skill — Relay-Based Automation

#### New: `src/skills/twitter.ts` — `twitter_post` Skill
- Fully automated X/Twitter posting via the Chrome extension relay and `pyautogui` script replay
- **Relay-first architecture** — uses `extensionRelay` directly (not desktop screenshots) to interact with the user's real logged-in Chrome session
- **Tab discovery**: Lists open tabs, finds existing x.com tabs, or opens a new one to `x.com/compose/post`
- **Tab priority logic**: compose/post tab → any x.com tab (navigates it) → new tab
- **Vision pre-flight**: Takes a relay screenshot of the actual browser tab, analyzes with Gemini 3 Flash to verify:
  - User is logged in (aborts immediately if not)
  - No popups or modals blocking the compose area
  - Page is not still loading
  - Compose text area is visible and ready
- **Content validation**: Enforces 280-character limit, rejects empty content
- **Script execution**: Writes content to `scripts/Post_content.txt`, runs `scripts/xpost.py` (pyautogui click replay)
- **Single attempt only**: If the script fails, logs the error and reports — never retries or fights the page
- **Dry run mode**: `dry_run: true` validates full setup + pre-flight without posting
- **Failure logging**: All events (INFO/WARN/ERROR) appended to `logs/twitter_post.log`

#### Supporting Scripts (pre-existing)
- `scripts/xpost.py` — Replays recorded mouse coordinates to paste content and click Post
- `scripts/xteacher.py` — Records click coordinates for the compose → post flow
- `scripts/twitter_steps.json` — Recorded step data (2+ clicks required)

#### Cron Scheduling
- Works with the existing `manage_scheduler` skill for automated posting
- Cron job command tells the LLM to generate content and call `twitter_post`

#### Files Changed
- **New**: `src/skills/twitter.ts` — full twitter_post skill with relay integration and vision pre-flight
- **Updated**: `src/skills/index.ts` — registered `twitterSkill` in skill array (18 → 19 skills)

---

## [12.5.0] - 2026-03-20

### Per-Agent Workspace Folders — Auto-Organized File System

#### Auto-Organize on Disk
- Agent files now route to per-agent subdirectories: `workspace/{roleSlug}/reports/`, `workspace/{roleSlug}/{subdirectory}/`
- CEO files go to `workspace/ceo/`, CMO to `workspace/cmo/`, CTO to `workspace/cto/`, etc.
- Proposals remain in the shared `workspace/proposals/` directory (internal review system)
- File Explorer is now clean and navigable without the dashboard

#### "Organize" Migration Button
- New green "Organize" button in workspace toolbar to sort existing loose files into agent folders
- Scans root-level files and `reports/` folder, matches to agents by role-slug prefix in filename
- Moves files and their `.comments.json` sidecars together
- Shows success banner with count of moved files, auto-refreshes file list

#### Folder-Based Attribution
- Backend file listing now uses folder-based attribution: files inside `workspace/ceo/` are automatically attributed to the CEO agent
- Attribution priority: 1) run log activity, 2) folder path match, 3) filename prefix match
- No more guessing — agent ownership is structural

#### Agent Awareness
- System prompt now tells each agent about their personal workspace folder path
- Comment scanning recognizes all files inside an agent's folder as belonging to that agent
- Entering `workspace/{roleSlug}/` directory marks all nested files as owned

#### Files Changed
- **Updated**: `src/skills/org-skills.ts` — `org_write_report` routes to `workspace/{roleSlug}/` subdirectory
- **Updated**: `src/core/org-agent-runner.ts` — system prompt includes agent folder path, comment walker uses folder-based ownership
- **Updated**: `src/index.ts` — folder-based attribution in file listing, new `org:workspace:organize` socket event for migration
- **Updated**: `dashboard/src/components/WorkspaceTab.tsx` — Organize button, result banner, socket handler
- **Updated**: `dashboard/src/index.css` — `.ws-organize-btn`, `.ws-organize-banner` styles

---

## [12.4.0] - 2026-03-20

### Workspace Tab Redesign — IDE-Style File Review System

#### P0: Fixed 25K Unassigned Files Bug
- Backend file walker (`src/index.ts`) now skips `.git`, `node_modules`, `dist`, `build`, `.next`, `__pycache__`, `.cache`, `.turbo`, `.parcel-cache`, `coverage`, `.nyc_output`, `.vscode`, `.idea` directories
- Skips all hidden directories (starting with `.`)
- Filters out binary file extensions (`.exe`, `.dll`, `.so`, `.dylib`, `.o`, `.obj`, `.bin`, `.pak`, `.map`)
- Drops file count from ~25,000 to actual workspace content only

#### P0: Agent Attribution from Run Logs
- Backend now reads each agent's `runs.jsonl` to build a file-to-agent attribution map
- Each file in the API response now includes `agentId`, `agentLabel`, and `createdAt`
- Files attributed to the agent that created them via activity logs, not just filename guessing

#### P1: IDE-Style Split Layout
- Replaced flat file list with a full IDE-style workspace: resizable left panel (240–500px) + flex editor right panel
- Toolbar with file count, unreviewed count, search bar, agent filter dropdown, and refresh button
- Two view modes togglable from toolbar: **Tree View** (files grouped by agent) and **Timeline View** (most recent first)

#### P1: Agent Color Badges
- Each agent gets a unique color from a 10-color palette
- Colored dots appear in the file tree, timeline, and editor header
- Agent name badge shown in editor header when viewing an attributed file

#### P1: Timeline View
- Toggle to see all files sorted by most recently modified
- Each item shows agent color dot, file name, agent name, folder path, relative timestamp, and size
- Great for answering "what just happened?" at a glance

#### P2: Review Status Indicators
- Three states per file: unreviewed (yellow dot), approved (green checkmark), commented (blue chat icon)
- "Approve" button in editor header marks file as reviewed
- Statuses persist to `localStorage` per org — survives page refresh

#### P2: Inline "Talk to Agent" Panel
- Bottom of editor shows feedback panel with comment history
- Shows "to **AgentName**" so you know who receives the feedback
- Type feedback and hit Enter — creates a comment addressed to the file's owning agent
- Commenting auto-sets file review status to "commented"

#### P2: Search & Filter
- Real-time file search across names and paths
- Agent filter dropdown to show only one agent's files or only unassigned files
- Filters apply to both tree and timeline views

#### Files Changed
- **Updated**: `src/index.ts` — directory/extension blacklists, agent attribution from `runs.jsonl`
- **Rewritten**: `dashboard/src/components/WorkspaceTab.tsx` — complete IDE-style redesign (~400 lines)
- **Updated**: `dashboard/src/index.css` — new `ws-*` class namespace for workspace styles

---

## [12.3.0] - 2026-03-20

### Complete Dashboard UI Overhaul

#### Light-Only Theme Redesign
- Removed dark theme entirely — no more theme toggle, no dual-theme CSS maintenance
- New clean color palette: deep indigo primary (`#4338ca`), bold accents for success/warning/danger
- Page background changed from flat gray to a soft blue-to-lavender gradient
- Bolder typography throughout — 800-weight headings, tighter letter spacing
- Stronger borders (`#d1d5db`) and more visible shadows for depth
- Status cards have colored top accent borders
- All glass morphism / backdrop-filter effects removed for a clean, modern look

#### Collapsible Sidebars (Azure Portal Style)
- **Main sidebar**: collapse button at bottom shrinks to 60px icon-only rail; nav items show icons only with tooltips; smooth 200ms transition
- **Org sidebar**: same pattern — collapses to avatar-only view; "+ New Org" becomes a "+" icon; toggle button at bottom

#### Org Section — Complete Refactor
- Org workspace wrapped in its own bordered container with shadow
- Org sidebar has distinct background, active org gets left accent border
- Header redesigned: 20px/800-weight title, proper action buttons with themed variants (warning, success, danger)
- **Subtabs** changed from background-fill to underline-style active indicator (border-bottom accent)
- **Notification dropdown** completely rebuilt with proper CSS classes (replaced broken inline styles using nonexistent CSS vars), z-index 200, color-coded items by level
- "+ New Org" pinned to bottom of org sidebar (no empty space gap)
- Paused org/agent opacity raised from 0.55 to 0.78 for better readability

#### Agent Cards — Color-Coded
- Each agent gets a unique color from a 10-color palette (indigo, violet, cyan, emerald, amber, red, pink, blue, etc.)
- Color shown as 4px left border stripe and matching avatar background
- Paused agents get neutral gray avatar instead of accent color
- Agent names use 800-weight, roles use 500-weight

#### Agent Chat Pane — Major Improvements
- Changed from `position: fixed` overlay to flex child within org-workspace — no more full-page takeover
- **Horizontally resizable** via drag handle (300px–700px range)
- **Minimize button** (Minus icon) hides chat but preserves all messages
- **Close button** (X) asks confirmation before destroying chat history
- **Minimized chat bar** at bottom of org-main shows all minimized chats with message counts
- Clicking a minimized tab restores the full chat with history intact
- Re-clicking "Chat" on same agent reopens existing chat instead of creating duplicate

#### Files Changed
- **Rewritten**: `dashboard/src/index.css` — complete light-only theme, ~1700 lines
- **Updated**: `dashboard/src/App.tsx` — removed theme toggle, added collapsible sidebar state, new icons
- **Updated**: `dashboard/src/components/OrgWorkspace.tsx` — collapsible org sidebar, notification dropdown rebuild, minimized chat bar, color-coded agent cards
- **Updated**: `dashboard/src/components/AgentCard.tsx` — per-agent color palette, index prop
- **Updated**: `dashboard/src/components/AgentChatPane.tsx` — minimize/close split, header buttons
- **Updated**: `dashboard/src/hooks/useOrgChat.ts` — `minimizeChat()` (hide without destroy), `openChat()` reuses existing chats

---

## [12.2.1] - 2026-03-20

### Screenshot-to-Chat Restored

#### Share Screenshot Button
- Restored the screenshot capture feature that was removed during the v11 multi-pane refactor
- Camera button now appears in both **ConversationPane** (main chat) and **AgentChatPane** (org agent direct chat)
- Uses browser `getDisplayMedia` API — pick any window or full screen
- Screenshot preview appears above the input area with a remove button before sending
- Images rendered inline in the message history for both user and assistant messages
- Server saves screenshots as PNGs to `screenshots/` directory and injects the file path into the prompt
- Org agent chat handler (`org:agent:message`) now supports image payloads, matching the existing main chat handler
- New reusable `useScreenshot` hook extracts capture logic from the old monolithic App.tsx
- Light theme styles included for all new screenshot UI elements

#### Files Changed
- **New**: `dashboard/src/hooks/useScreenshot.ts` — reusable screenshot capture hook
- **Updated**: `ConversationPane.tsx`, `AgentChatPane.tsx` — camera button, preview, inline image rendering
- **Updated**: `ChatWorkspace.tsx`, `OrgWorkspace.tsx` — pass image through send callbacks
- **Updated**: `useConversations.ts`, `useOrgChat.ts` — `sendMessage` accepts optional image
- **Updated**: `types/conversation.ts`, `types/org.ts` — `image?: string` on message types
- **Updated**: `src/index.ts` — org agent message handler saves images server-side
- **Updated**: `index.css` — screenshot preview, camera button, message image styles

---

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
- Complete CSS overhaul for the `WorkspaceTab` component: Styled the file explorer, inline text editor, and comments section to match the dashboard's premium dark glassmorphism aesthetic.

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
