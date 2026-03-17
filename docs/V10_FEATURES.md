# PersonalClaw v10.0: Feature Guide (Legacy Reference) 🚀

> **Note:** This document covers v10.0 features. For v11.0 multi-chat, multi-agent, and skill lock features, see `version_log.md` and `USER_GUIDE.md`.

## Overview

v10.0 represents a fundamental leap forward—from a capable assistant to a production-grade autonomous agent. This document covers every system, skill, and feature introduced in v10.

---

## 🎯 Core Systems (NEW)

### 1. Event Bus System (`src/core/events.ts`)

**What it does:** Central nervous system for all subsystems. Enables decoupled, real-time communication.

**Features:**
- **Typed Events** — 15+ predefined event types (MESSAGE_RECEIVED, TOOL_CALLED, MODEL_FAILOVER, etc.)
- **Event Logging** — Recent 500 events kept in memory
- **Statistics** — `getStats()` returns event counts by type
- **Wildcard Listeners** — Subscribe to all events with `'*'` listener
- **Real-Time Broadcasting** — Socket.io integration broadcasts all events to dashboards

**Event Types:**
```
brain:message_received
brain:message_processed
brain:tool_called
brain:tool_completed
brain:tool_failed
brain:model_failover
brain:session_started
brain:session_reset
brain:context_compacted
brain:streaming_chunk
skill:loaded
skill:error
system:server_started
system:server_shutdown
system:dashboard_connected
system:dashboard_disconnected
system:telegram_message
system:scheduler_fired
learning:started
learning:completed
learning:failed
```

---

### 2. Audit Logger (`src/core/audit.ts`)

**What it does:** Comprehensive action logging for compliance and debugging.

**Features:**
- **JSONL Format** — Line-delimited JSON for easy parsing
- **Automatic Rotation** — Max 10 files, 1000 entries each, by date
- **Auto-Flush** — Flushes buffer every 5 seconds (immediately for errors)
- **Event Bus Integration** — Automatically subscribes and logs all system events
- **Rich Metadata** — Entry IDs, timestamps, levels (info/warn/error/critical), categories, durations

**Entry Schema:**
```json
{
  "id": "aud_1710507660123_abc1",
  "timestamp": "2026-03-15T15:47:40.123Z",
  "level": "info",
  "category": "tool",
  "action": "call",
  "detail": "Tool 'system_info' invoked",
  "durationMs": 245,
  "metadata": {...}
}
```

**Categories Logged:**
- `tool` — Tool calls, completions, failures
- `model` — Model failovers
- `message` — Message received/processed
- `session` — Session resets/starts
- `connection` — Dashboard connect/disconnect
- `system` — Errors, exceptions, shutdown

---

### 3. Session Manager (`src/core/sessions.ts`)

**What it does:** Browse, search, restore, and manage conversation history.

**Features:**
- **List Sessions** — Get recent sessions with metadata (turns, size, first/last messages)
- **Full-Text Search** — Find conversations by keyword with context snippets
- **Load Sessions** — Restore complete conversation history
- **Delete Sessions** — Remove specific sessions
- **Auto-Cleanup** — Keep only N most recent (default 50)
- **Statistics** — Total size, oldest/newest, average turns

**Public API:**
```typescript
SessionManager.listSessions(limit?: number): SessionInfo[]
SessionManager.searchSessions(query: string, limit?: number): SearchResult[]
SessionManager.loadSession(sessionId: string): any[] | null
SessionManager.deleteSession(sessionId: string): boolean
SessionManager.cleanup(keepCount?: number): number
SessionManager.getStats(): SessionStats
```

---

### 4. Chrome Native MCP Adapter (`src/core/chrome-mcp.ts`) — v10.2

**What it does:** Connects PersonalClaw to the user's already-running Chrome browser — real logins, real tabs, no re-authentication.

**Connection Modes (auto-selected, best wins):**

| Mode | Chrome Version | Transport | What You Get |
|------|---------------|-----------|-------------|
| `chrome-mcp` | 146+ | SSE via MCP SDK | Chrome's own DevTools MCP tools exposed directly to the brain |
| `cdp` | Any with remote debug | Playwright `connectOverCDP` | Full Playwright API on real Chrome |
| `disconnected` | — | — | Default Playwright-managed Chromium |

**Key Methods:**
```typescript
chromeNativeAdapter.connect(port?)        // Auto-selects best mode
chromeNativeAdapter.disconnect()          // Revert to Playwright
chromeNativeAdapter.getMode()             // 'chrome-mcp' | 'cdp' | 'disconnected'
chromeNativeAdapter.getActivePage()       // CDP: returns Playwright Page
chromeNativeAdapter.callMCPTool(name, args) // chrome-mcp: call Chrome's tools
ChromeNativeAdapter.probe(port?)          // Static: check if Chrome is available
```

**Brain Integration:**
- Chrome MCP tools dynamically registered with Gemini (prefixed `chrome_*`)
- Agentic loop routes `chrome_*` calls to Chrome's native MCP server
- `/chrome` slash command for quick connection
- System prompt guides the AI on when to use native Chrome vs Playwright

**Prerequisites:**
```
# Launch Chrome with remote debugging:
chrome.exe --remote-debugging-port=9222 --user-data-dir=%TEMP%\chrome-debug

# Or Chrome 146+: chrome://inspect/#remote-debugging → enable listening
```

**Use Cases:**
- Working with user's logged-in dashboards (email, CRM, ticketing systems)
- Automating tasks on sites where re-login is impractical (MFA, SSO)
- Interacting with the user's actual active tabs
- IT support: navigating to admin panels that require existing sessions

---

## 🚀 New Skills (4 additions)

### 1. HTTP Requests (`src/skills/http.ts`)

**Capability:** Make web requests to any API or service.

**Actions:** GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS

**Parameters:**
- `method` — HTTP verb (default: GET)
- `url` — Full URL
- `headers` — JSON string of headers (e.g., `{"Authorization": "Bearer token"}`)
- `body` — Request body (string or JSON)
- `timeout` — Timeout in ms (default: 15000)

**Response:**
```json
{
  "success": true,
  "status": 200,
  "statusText": "OK",
  "headers": { "content-type": "application/json" },
  "body": "...response body...",
  "elapsed_ms": 245
}
```

**Use Cases:**
- REST API testing
- Webhooks & integrations
- Data fetching
- Health checks
- External service calls

---

### 2. Network Diagnostics (`src/skills/network.ts`)

**Capability:** Comprehensive network troubleshooting.

**Actions:**
- `ping` — Test latency and packet loss
- `traceroute` — Trace route to host (hop-by-hop)
- `dns` — DNS lookup (A, AAAA, MX, NS records)
- `port_check` — Test if port is open on host
- `connections` — Show active TCP connections
- `interfaces` — List network interfaces and IP addresses
- `arp` — Show ARP table (local network devices)
- `route` — Show routing table
- `whois` — WHOIS lookup for domains

**Target Parameter:** Hostname, IP address, or domain

**Filter Parameter:** Optional (e.g., "ESTABLISHED" for connections)

**Use Cases:**
- Connectivity diagnostics
- Latency measurement
- Route analysis
- Service availability checking
- Network device discovery

---

### 3. Process Manager (`src/skills/process-manager.ts`)

**Capability:** Control running processes and Windows services.

**Actions:**
- `list` — Show running processes (sort: cpu, memory)
- `search` — Find processes by name
- `kill` — Terminate a process (by name or PID)
- `details` — Get detailed process information
- `services` — List Windows services (filter: running, stopped, name)
- `start_service` — Start a Windows service
- `stop_service` — Stop a Windows service
- `restart_service` — Restart a Windows service
- `startup` — List programs that run at startup
- `resource_hogs` — Top CPU and memory consumers

**Parameters:**
- `target` — Process name, PID, or service name
- `sort` — cpu or memory (for list)
- `filter` — running, stopped, or search term (for services)
- `count` — Number of results (default: 20)

**Use Cases:**
- Resource monitoring
- Troubleshooting runaway processes
- Service management
- Startup management
- Performance analysis

---

### 4. Deep System Info (`src/skills/system-info.ts`)

**Capability:** Comprehensive system intelligence across 12 actions.

**Actions:**
- `overview` — Full system summary (OS, CPU, RAM, disk, uptime, user)
- `hardware` — CPU, RAM, GPU, motherboard, BIOS details
- `storage` — Disk drives, partitions, space usage
- `software` — Installed programs list (optional name filter)
- `updates` — Recent Windows updates
- `drivers` — Device drivers (optional filter)
- `events` — Windows Event Log (optional log: System/Application/Security, level: Error/Warning)
- `security` — Firewall, antivirus, UAC, BitLocker status
- `battery` — Battery status (laptops only)
- `environment` — Environment variables (optional filter)
- `uptime` — System uptime and boot time
- `users` — User accounts and login sessions

**Parameters:**
- `action` — Which action to perform
- `filter` — Optional search/filter term
- `log` — Event log name (System, Application, Security)
- `level` — Event level (Error, Warning, Information)

**Use Cases:**
- System diagnostics
- Compliance checking
- Performance analysis
- Security audits
- Infrastructure assessment

---

## 🧠 Brain Enhancements

### Performance Tracking

**Metrics Tracked:**
- Response time (ms)
- Tool calls per request
- Active model
- Timestamp

**Statistics Available:**
- Total requests
- Average response time
- P50 (median) latency
- P95 (95th percentile) latency
- Average tools per request
- Total tool calls
- Model usage breakdown

**Access:** `/perf` command or `/api/perf` endpoint

---

### 8 New Slash Commands

1. **`/perf`** — Performance statistics (latency, throughput, model usage)
2. **`/audit`** — Recent audit log entries with filtering
3. **`/sessions`** — Browse saved conversations with preview
4. **`/restore <id>`** — Load a previous conversation
5. **`/search <query>`** — Find past conversations by keyword
6. **`/ip`** — Show network interfaces and IPs
7. **`/procs`** — Top resource-consuming processes
8. Plus: `/screenshot`, `/sysinfo` (both already existed)

**Total Commands:** 23 (15 in v1.17 + 8 new)

---

### Session Restore (`/restore`)

**Usage:** `/restore session_1710505200000`

**Behavior:**
1. Loads previous session's entire conversation history
2. Restores AI context from that moment
3. Preserves all long-term memory
4. Continues conversation from where you left off

**Benefits:**
- Never lose context
- Resume complex multi-step tasks
- Reference past conversations
- Maintain continuity across sessions

---

### Full-Text Search (`/search`)

**Usage:** `/search DNS issues`

**Returns:**
- Up to 10 matching sessions
- Each with relevant context snippets
- Session metadata (date, turns, size)
- Restore links

**Features:**
- Case-insensitive matching
- Context snippets around matches
- Multiple snippets per session
- Ranked by relevance

---

### Event Bus Integration

**Every Event Published:**
- Message received (text preview, source)
- Message processed (duration, tool count, model)
- Tool called (name, args)
- Tool completed (duration)
- Tool failed (error message)
- Model failover (from/to, reason)
- Session started/reset
- Context compacted
- Dashboard connected/disconnected
- Scheduler fired
- Learning completed

**Used By:**
- Audit logger (auto-subscribes)
- Activity feed (dashboard)
- Analytics
- Real-time monitoring

---

## 🌐 Server Enhancements

### REST API (9 Endpoints)

**Chat:**
- `POST /api/chat` — Send message, get response

**Skills:**
- `GET /api/skills` — List all loaded skills with descriptions

**Sessions:**
- `GET /api/sessions?limit=20` — List recent sessions
- `GET /api/sessions/search?q=dns` — Search sessions
- `GET /api/sessions/stats` — Overall session statistics

**Metrics:**
- `GET /api/perf` — Performance statistics
- `GET /api/metrics` — System metrics (CPU, RAM, disk)

**Audit:**
- `GET /api/audit?count=50&category=tool` — Audit log
- `GET /api/activity?count=20` — Activity feed

---

### Real-Time Metrics

**Broadcast Frequency:** Every 2 seconds

**Data:**
- CPU load (%)
- RAM active (GB)
- Total RAM (GB)
- Disk used (GB) — C: drive
- Disk total (GB) — C: drive

---

### Graceful Shutdown

**Signals Handled:**
- SIGINT (Ctrl+C)
- SIGTERM (service stop)

**Cleanup:**
1. Flushes audit log buffer
2. Closes Socket.io connections
3. Closes HTTP server
4. Exits cleanly (force exit after 5s)

**Exception Handling:**
- Uncaught exceptions logged to audit
- Unhandled rejections logged to audit
- No silent failures

---

## 🎨 Dashboard Overhaul

### Command Palette (Ctrl+K)

**17 Commands Searchable:**
- New Session (`/new`)
- System Status (`/status`)
- Performance Stats (`/perf`)
- Audit Log (`/audit`)
- Browse Sessions (`/sessions`)
- List Skills (`/skills`)
- List Models (`/models`)
- Memory (`/memory`)
- Screenshot (`/screenshot`)
- System Info (`/sysinfo`)
- Network Info (`/ip`)
- Top Processes (`/procs`)
- Scheduled Jobs (`/jobs`)
- Self-Learning (`/learned`)
- Compact Context (`/compact`)
- Export Session (`/export`)
- Help (`/help`)

**Features:**
- Keyboard-driven (Ctrl+K to open, Escape to close)
- Fuzzy search by label or command
- Arrow keys to navigate (in future)
- Enter to execute
- Auto-focus input

---

### Activity Feed Tab

**Real-Time Event Stream:**
- Type (tool_called, message_processed, etc.)
- Timestamp (HH:MM:SS format)
- Source (brain, scheduler, system)
- Summary (human-readable event description)
- Color-coded dots (green=success, red=error, blue=info)

**Latest 50 Events Displayed**

**Uses:** Monitor AI activity in real-time

---

### Tool Progress Updates

**While Bot is "Thinking":**
- Shows which tools are currently executing
- Execution time for each tool
- Success/failure status
- Listed in order

**Benefits:**
- Transparency into AI reasoning
- Identify slow tools
- Better user understanding

---

### Connection Status

**Indicator Shows:**
- Connected (WiFi icon, green dot, "Online")
- Disconnected (WiFi off icon, red dot, "Offline")
- Location: Sidebar, next to theme toggle

**Triggers:**
- Socket.io connect event → show "Online"
- Socket.io disconnect event → show "Offline"

---

### Toast Notifications

**Automatic Alerts:**
- Connection: "Connected to PersonalClaw" (success)
- Disconnection: "Disconnected from server" (error)
- Failures: Error messages

**Behavior:**
- Auto-dismiss after 4 seconds
- Stack vertically in bottom-right
- Non-blocking (overlay)

---

### Sparkline Charts

**Location:** System Metrics tab

**CPU Sparkline:**
- Last 30 data points
- Color: Accent primary
- Updates every 2 seconds

**RAM Sparkline:**
- Last 30 data points
- Color: Accent secondary
- Updates every 2 seconds

**Benefits:**
- Visual trend detection
- At-a-glance health check
- Compact representation

---

### Command History

**Navigation:**
- Arrow Up — Show previous message
- Arrow Down — Show next message
- Up/Down work only when textarea is empty

**State:**
- Stored in React component state
- Max 50 recent commands
- Cleared on page refresh

**Benefits:**
- Quickly repeat commands
- Iterate on complex queries
- Improved UX for power users

---

### Auto-Resizing Textarea

**Behavior:**
- Starts at 44px height
- Grows as you type
- Max height: 160px
- Smooth resize

**Implementation:**
- Hooks into onChange event
- Measures scrollHeight
- Updates height CSS

---

## 📊 Dashboard Features

### Improved Code Blocks
- Monospace font (JetBrains Mono)
- Dark background
- Border
- Horizontal scroll on overflow
- Language syntax support (via react-markdown)

### Table Rendering
- Borders on all cells
- Alternating row backgrounds
- Proper alignment
- Full width

### Message Avatars
- 28px rounded squares
- Centered icons
- Bot: lighter background
- User: gradient colors

### Responsive Design
- Desktop: Full sidebar (260px)
- Mobile (<900px): Collapsed sidebar (60px)
- Nav items hide text, show icons only
- Status grid: 2 columns on tablet, 4 on desktop

### Custom Scrollbars
- Width: 6px
- Thumb color: rgba(255,255,255,0.08)
- Hover: rgba(255,255,255,0.15)
- Rounded: 3px
- Applies globally to all scrollable areas

---

## 📈 Metrics & Impact

### Skills Growth
- v1.17: 9 skills
- v10.0: 14 skills (+55%)

### Commands Growth
- v1.17: 15 slash commands
- v10.0: 23 commands
- v10.2: 24 commands (`/chrome` added)

### New Systems
- Event Bus
- Audit Logger
- Session Manager
- Chrome Native MCP Adapter (v10.2)

### API Endpoints
- v1.17: 1 (GET /status)
- v10.0: 9 endpoints (+800%)

### Code Quality
- TypeScript: Strict mode enabled
- Build: 0 errors
- Compilation: Clean

---

## 🔐 Security & Privacy

### Audit Trail
- Every action logged
- Immutable JSONL format
- Auto-rotation prevents unbounded growth
- Searchable via `/audit` command

### Event Bus Visibility
- All events published
- No secrets leaked
- System prompt explicitly prevents credential exposure

### No External Data
- Only Gemini API calls sent externally
- All actions stay local
- Telegram optional and locked by chat ID

---

## 🎯 Use Cases Enhanced

### System Administration
- Process monitoring via `/procs`
- Service management via skill
- Audit trail for compliance
- Network diagnostics

### IT Automation
- Session persistence for complex workflows
- Event logging for troubleshooting
- Performance tracking
- Real-time status monitoring

### Scheduled Tasks
- Cron job management (existing)
- Event-based automation (new)
- Activity monitoring (new)

---

## 📚 Documentation Updates

- **README.md** — Updated with v10 features
- **USER_GUIDE.md** — v10 intro
- **SETUP_GUIDE.md** — v10 header
- **VERSION_LOG.md** — Comprehensive v10 entry
- **V10_FEATURES.md** — This document

---

## 🚀 Getting Started with v10

1. **Upgrade** — Pull latest code
2. **Install** — `npm install`
3. **Launch** — `npm run dev` (2 terminals)
4. **Explore** — Open dashboard, press Ctrl+K
5. **Learn** — Try `/perf`, `/audit`, `/sessions`, `/search`
6. **Master** — Use new skills for network & system diagnostics

---

**PersonalClaw v10.0: From assistant to autonomous agent.** 🛸
