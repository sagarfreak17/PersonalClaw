# PersonalClaw Architecture & Internal Specs

This document provides a technical deep-dive into the PersonalClaw backend and frontend communication protocols.

---

## 🏗️ Core Architecture (v12.2)

PersonalClaw uses a multi-layered architecture. The **ConversationManager** manages human chat panes, while the **OrgManager** orchestrates autonomous AI companies. The **OrgHeartbeatEngine** drives agent execution via cron and events, and the **OrgAgentRunner** executes them as persona-injected Brain instances.

### Key Systems
| System | File | Purpose |
|---|---|---|
| Brain (class) | `src/core/brain.ts` | Gemini integration, persona injection, tool loop, meta passing |
| OrgManager | `src/core/org-manager.ts` | Org/Agent CRUD, persistence (`orgs/`), mission state |
| OrgHeartbeatEngine | `src/core/org-heartbeat.ts` | Cron + Event triggered agent execution |
| OrgTaskBoard | `src/core/org-task-board.ts` | Shared Kanban ticket system per org, write-lock protected |
| OrgAgentRunner | `src/core/org-agent-runner.ts` | Runs agents as Brains, manages persistent direct-chat sessions, injects human comments into prompts |
| OrgFileGuard | `src/core/org-file-guard.ts` | Per-org file protection (git/manual/both), proposal creation and approval |
| OrgNotificationStore | `src/core/org-notification-store.ts` | Persistent notification storage + Telegram forwarding with rate limits |
| ConversationManager | `src/core/conversation-manager.ts` | Human chat panes with isolated Brains |
| AgentRegistry | `src/core/agent-registry.ts` | Worker lifecycle (human workers + org sub-agents) |
| SkillLockManager | `src/core/skill-lock.ts` | Global concurrent resource protection (v12 extended) |
| EventBus | `src/core/events.ts` | 45+ typed events, decoupled communication |

---

## 📡 Messaging Protocols

### Socket.io Events (v11 + v12)

| Event | Direction | Purpose |
|---|---|---|
| `org:list` | Bidirectional | Sync all organisations and agents |
| `org:agent:trigger` | Client → Server | Manually trigger an agent run |
| `org:agent:message` | Client → Server | Send message to a dedicated agent Brain |
| `org:agent:response` | Server → Client | Response from a dedicated agent Brain |
| `org:agent:chat:close` | Client → Server | Close persistent chat Brain and free memory |
| `org:tickets:list` | Bidirectional | Sync ticket board for an org |
| `org:memory:read` | Client → Server | Get shared/agent memory (correlationId-based) |
| `org:memory:content` | Server → Client | Memory content response (matched by correlationId) |
| `org:proposals:list` | Bidirectional | Sync code proposals for an org |
| `org:proposal:approve` | Client → Server | Approve and apply code change |
| `org:proposal:reject` | Client → Server | Reject a proposal |
| `org:proposal:content` | Bidirectional | Get original/proposed file content |
| `org:blockers:list` | Bidirectional | Sync blockers for an org |
| `org:blocker:resolve` | Client → Server | Resolve a blocker with notes |
| `org:notification` | Server → Client | Real-time toast notification |
| `org:agent:run_update` | Server → Client | Agent run started/completed/failed |
| `org:agent:file_activity` | Server → Client | Files written during agent run |
| `org:protection:update` | Client → Server | Update file protection settings |
| `org:workspace:files:all` | Bidirectional | Get all workspace files recursively |
| `org:workspace:file:read` | Bidirectional | Read workspace file content |
| `org:workspace:file:write` | Client → Server | Write workspace file content |
| `org:workspace:file:comment` | Client → Server | Add comment to a workspace file |
| `org:workspace:file:comments:read` | Bidirectional | Read comments for a workspace file |
| `tool_update` | Server → Client | Real-time tool execution progress |
| `metrics` | Server → Client | System telemetry (CPU/RAM/Disk) |

---

## 🛡️ Security & Privacy

### Audit Trail
- Every action logged to `memory/audit.jsonl` (auto-rotating)
- Immutable JSONL format for historical compliance
- Searchable via Dashboard and `/audit` command

### File Protection
- Per-org configurable protection modes: `none`, `git`, `manual`, `both`
- Git protection runs `git ls-files` from the org's own `rootDir` (not process.cwd())
- Protected files viewable in Settings tab with full grouped file list
- Agents must submit proposals for protected files; proposals require human approval

### Local-First Data
- No external data sent except to Google Gemini API
- Local session storage (`memory/sessions/`)
- Persistent browser data isolated per org to `orgs/{orgId}/browser_data/`

---

## ⚙️ AI Logic (Brain Loop)

PersonalClaw runs a **multi-turn tool execution loop**:
1. Human or Heartbeat triggers an agent.
2. If Heartbeat: OrgAgentRunner creates a Brain with **Persona Injection** (Mission + Role).
3. Brain checks Task Board and Memory, then builds a Plan.
4. **Human comments** on workspace files are injected into the system prompt so agents can act on feedback.
5. Tools execute via `handleToolCall`, acquiring global/per-path locks.
6. Loop repeats until the agent has achieved its run goals or delegates.
7. Run summary is appended to `runs.jsonl` and session history is saved.
8. Non-code submissions (documents, plans, hiring) are auto-approved unless `requiresApproval: true`.

---

## 🗂️ Dashboard Tabs (per org)

| Tab | Purpose |
|---|---|
| **Agents** | Agent cards with status, chat, edit (including Reports To dropdown), run, pause, delete |
| **Tickets** | Kanban board — open, in progress, blocked, done |
| **Board** | Command center — summary bar, org chart, blockers, expandable agent health cards |
| **Workspace** | Files organised by agent role, inline editor, human comment system |
| **Proposals** | Code change proposals only (documents/plans/hiring auto-approved) |
| **Activity** | Real-time event log |
| **Memory** | Shared + per-agent memory viewer |
| **Settings** | File protection configuration with full protected file list |
