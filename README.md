# PersonalClaw v11.0 🛸

**The next-generation Windows AI agent. Local. Private. Unstoppable.**

PersonalClaw is a sophisticated, locally-hosted AI agent that combines Google Gemini with full system access, autonomous task execution, and intelligent learning. It's your digital hands—capable of system administration, automation, analytics, and real-time decision-making.

![PersonalClaw v11](docs/assets/logo.png)

**Developed by Sagar Kalra**

---

## ✨ v11.0 — Multi-Agent Architecture

### 🧩 Multi-Chat Workspace (3 Panes)
- **Up to 3 independent chat panes** — each with its own isolated Brain instance
- **Resizable panels** — drag to resize, auto-numbered Chat 1 / Chat 2 / Chat 3
- **Auto-save on close** — conversation history persisted to SessionManager
- **`+` button** to open new panes, `x` to close (reuses labels)

### 🤖 Sub-Agent Workers (5 per Pane)
- **`spawn_agent` skill** — primary brains spawn parallel workers for independent tasks
- **Worker constraints** — no history, no further spawning, destructive-ops guardrail
- **Real-time status** — queued / running / waiting_for_lock / completed / failed / timed_out
- **Collapsible side panel** — auto-opens on worker activity, closes after completion
- **Superuser mode (Ctrl+Shift+D)** — raw log viewer on completed worker cards

### 🔒 Skill Lock System
- **Exclusive locks** — `browser` + `vision` share `browser_vision` lock; `clipboard` exclusive
- **Read-write locks** — `memory`, `scheduler` allow concurrent reads, exclusive writes
- **Per-path locks** — `files` and `pdf` lock by output file path
- **Lock UI** — `waiting_for_lock` status with amber indicator showing holder info
- **`GET /api/locks`** — inspect current lock state

### 🏗️ Infrastructure
- **Brain refactored** — singleton to instantiable class with `BrainConfig`
- **`SkillMeta`** passed to every skill (agentId, conversationId, conversationLabel, isWorker)
- **Telegram Brain** — isolated instance, outside conversation manager
- **15 skills** — 14 original + `spawn_agent`
- **6 new REST endpoints** + 5 new socket events + 12 Event Bus constants
- **Tool streaming** re-wired via Event Bus
- **Graceful shutdown** saves all open conversations

### 📊 Previous (v10) Features Still Included
- Event Bus, Audit Logger, Session Manager, REST API
- HTTP Requests, Network Diagnostics, Process Manager, Deep System Info
- Performance Tracking, 23 Slash Commands, Session Restore, Full-Text Search
- Command Palette (Ctrl+K), Activity Feed, Tool Progress, Sparkline Charts
- PDF Management, AI Image Generation, Browser Extension Relay, Native Chrome

---

## 🚀 Quick Start (3 minutes)

### Prerequisites
- **Node.js** 18+ ([download](https://nodejs.org/))
- **Git** ([download](https://git-scm.com/))
- **Python** 3.10+ ([download](https://www.python.org/))
- **Google Gemini API Key** (free at [AI Studio](https://aistudio.google.com/))

### Install
```bash
git clone <repo-url> && cd PersonalClaw
npm install && npx playwright install chromium
cd dashboard && npm install && cd ..
cp .env.example .env
# Add your GEMINI_API_KEY to .env
```

### Run
```bash
# Terminal 1
npm run dev

# Terminal 2
cd dashboard && npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## 💡 Capabilities

### System Control
- **PowerShell** — Full Windows command execution
- **File Management** — CRUD on any file/directory
- **Process Control** — List, kill, start, restart processes & services
- **Network Diagnostics** — Comprehensive network troubleshooting
- **System Intelligence** — Hardware, software, storage, drivers, security, events

### Web Automation
- **Unified Browser** — Persistent login context, scraping, clicking, typing
- **HTTP Requests** — REST API calls with full header/auth/body control
- **Vision** — Screenshot capture & Gemini Vision analysis

### Automation & Scheduling
- **Cron Jobs** — Schedule recurring tasks with natural language
- **Python Execution** — Run Python scripts directly
- **Clipboard** — Read/write system clipboard

### Intelligence
- **Model Failover** — Auto-cascades through 5 Gemini models
- **Self-Learning** — Learns user preferences, communication style, patterns
- **Long-Term Memory** — Manual knowledge store
- **Context Compaction** — Auto-summarizes at 800k tokens (1M limit)

---

## 📋 Slash Commands (23 total)

**Session**: `/new` `/status` `/sessions` `/restore <id>` `/search <query>` `/compact` `/export`

**System**: `/sysinfo` `/ip` `/procs` `/perf` `/audit` `/jobs` `/screenshot`

**Knowledge**: `/models` `/model <id>` `/memory` `/forget <key>` `/skills` `/learned`

**Meta**: `/ping` `/help`

---

## 🏗️ Architecture

- **Backend** — Express + Socket.io + Gemini API with failover chain
- **Frontend** — React 19 + Vite + Framer Motion
- **Event Bus** — Publish/subscribe for all subsystems
- **Skills** — 14 pluggable tool modules
- **Memory** — Session history, long-term knowledge, audit logs, learning data

---

## 📚 Documentation

- **[USER_GUIDE.md](docs/USER_GUIDE.md)** — End-user walkthrough and tips
- **[SETUP_GUIDE.md](docs/SETUP_GUIDE.md)** — Installation & configuration
- **[VERSION_LOG.md](docs/version_log.md)** — Complete version history (v1 → v10)
- **[AGENTS.md](AGENTS.md)** — Agent operating instructions and guidelines

---

## 🛡️ Security

- **Private & Local** — No external data except to Gemini API
- **Telegram Locked** — Bot restricted to authorized chat ID
- **Audit Trail** — Every action logged
- **No Credential Exposure** — System prompt prevents .env leaks

---

## 📊 Stats

| Metric | Value |
|--------|-------|
| **Skills** | 14 |
| **Commands** | 23 |
| **Models** | 5 (with failover) |
| **Max Tokens** | 1M |
| **Auto-Compact** | 800k |
| **Build Status** | ✅ Clean |

---

*”Your machine, your command, anywhere.”* 🚀
