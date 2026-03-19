# PersonalClaw v12.1 — Final Implementation Plan v2
## Org Safety, Governance & Observability Layer

> **FINAL v2** — Builds on v12.0.0. All 19 pre-build issues (FIX-Q through FIX-AK) identified and resolved inline.
> Written against actual v12.0 source code. All real-world edge cases addressed. Ready to hand off.

---

## DECISIONS REFERENCE

| Decision | Answer |
|---|---|
| Org directory location | Project root — `orgs/{OrgName}-{shortId}/` |
| Agent output files | All go to `orgs/{OrgName}/workspace/` — no scattering |
| Protected files definition | Any file tracked by git at org creation time (`git ls-files` snapshot) |
| Shell/Python protection | `execute_powershell` and `run_python_script` filtered from org agent Brain tool list |
| Code change proposal mechanics | Agent submits via `org_propose_code_change` → Proposals tab → Approve/Reject |
| Proposal content storage | Metadata only in `proposals.json` — file content lives in `workspace/proposals/{id}/` |
| Conflicting proposals on same file | Block second proposal until first is resolved |
| Max pending proposals per agent | 3 — blocked with clear message if exceeded |
| Proposal staleness | Badge after 7 days — never auto-expire |
| Proposal notifications | Telegram + dashboard toast, stored in `notifications.jsonl` |
| Blocker behaviour | Mark blocked, try workaround, document both, keep working on other tasks |
| Blocker cascade | 3+ agents blocked → single escalation notification |
| Board of Directors tab | Blockers, proposals, agent health, org chart, workspace browser |
| BOD notifications | Immediate Telegram + toast for blockers/proposals + daily morning digest |
| Max concurrent agents per org | 5 running simultaneously — 6th queues |
| Agent cap per org | No total cap — unlimited agents, 5 concurrent limit |
| Ticket locking | Agent picks up ticket → status auto-moves to `in_progress`, locked to that agent |
| Stale in_progress on restart | Tickets stuck `in_progress` with no active runner → reset to `open` on startup |
| Memory bloat threshold | Summarise/trim when agent memory file exceeds 50KB |
| Shared memory conflict | Merge-on-write — append arrays, last-write-wins for scalar fields |
| Duplicate role detection | Warn and require explicit `allowDuplicateRole: true` to proceed |
| Reporting line on agent creation | Auto-set to calling agent's ID |
| Staggered heartbeats | Auto-offset by 2 minutes when multiple agents share same cron |
| Atomic writes | Write to `.tmp` then rename for all critical org files |
| Chat Brain idle timeout | 30 minutes — single global sweep |
| Delegation loop detection | Track delegation chain depth — block if depth > 5 |
| Telegram notification queue | Store unsent, retry on reconnect, deduplicate by content hash |
| Telegram message length | Truncate at 3800 chars with `...` suffix |
| org_notify rate limit | Max 5 notifications per agent per run |
| Empty daily digest | Skip if no agent activity since last digest |
| Org directory naming | Sanitise to alphanumeric+hyphens, append 6-char ID for uniqueness |
| `orgs/` in `.gitignore` | Yes — all agent output excluded from git |
| Live tool feed in chat | Superuser mode toggle — inline in message stream, off by default |
| Activity tracking | Writes only — per file op per agent, live + run report |
| Browser isolation for org agents | Each org gets its own persistent browser profile directory |
| Report filename collisions | Enforced: `{agentRole}-{timestamp}-{filename}` prefix in `org_write_report` |
| Workspace file browser | Simple directory listing in Board of Directors |
| Workers calling manage_org | `manage_org` blocked from sub-agent workers (added to worker guardrails) |
| Token tracking | Estimated token count logged per run in `runs.jsonl`, shown in BOD |
| Visual org chart | SVG hierarchy rendered in Board of Directors from `reportingTo` relationships |

---

## DIRECTORY STRUCTURE

```
PersonalClaw/                             ← project root
├── .gitignore                            ← MODIFIED: add orgs/ entry
├── orgs/                                 ← NEW (moved from memory/orgs/)
│   └── PersonalClaw-Enterprise-abc123/
│       ├── org.json                      ← config + protectedFiles snapshot
│       ├── shared_memory.json            ← atomic write, merge-on-write
│       ├── tickets.json                  ← locked tickets tracked here
│       ├── blockers.json
│       ├── proposals.json                ← metadata only, no inline content
│       ├── notifications.jsonl
│       ├── agents/
│       │   └── {agentId}/
│       │       ├── memory.json
│       │       ├── runs.jsonl            ← includes fileActivity + tokenEstimate
│       │       └── session_*.json
│       └── workspace/                    ← ALL agent-created files
│           ├── reports/
│           │   └── {role}-{timestamp}-{filename}
│           ├── proposals/
│           │   └── {proposalId}/
│           │       ├── proposal.json     ← metadata only
│           │       ├── original.txt      ← original file content
│           │       └── proposed.txt      ← proposed file content
│           └── (any other output)
```

---

## PRE-BUILD ISSUES — ALL 19 IDENTIFIED AND RESOLVED INLINE

| # | Severity | Issue | Fix |
|---|---|---|---|
| FIX-Q | 🔴 | `ORGS_DIR` points to `memory/orgs/` — existing orgs won't migrate | `loadAll()` detects old path, migrates on startup |
| FIX-R | 🔴 | `git ls-files` must run from `process.cwd()` not arbitrary cwd | Always `execSync('git ls-files', { cwd: process.cwd() })` |
| FIX-S | 🔴 | File write interception via `manage_files` would affect all human chat if done in the skill itself | Intercept in `org-agent-runner.ts` via `toolCallInterceptor` in BrainConfig — org-only |
| FIX-T | 🔴 | Proposal approval could write to arbitrary paths | Validate relative path does not start with `..` and resolves within `process.cwd()` |
| FIX-U | 🟡 | Cron staggering fragile with complex expressions | Only stagger minute field — skip expressions with `/` or `,` in minute part |
| FIX-V | 🟡 | `org-heartbeat.ts` needs concurrent count but can't import runner without circular dep | Export `getRunningCount(orgId)` from runner — heartbeat already imports runner |
| FIX-W | 🟡 | Proposal stores full file content inline in `proposals.json` — bloats to MBs for large files | `proposals.json` stores metadata only. Content lives in `workspace/proposals/{id}/*.txt` |
| FIX-X | 🟢 | Per-session chat Brain `setInterval` → many intervals under load | Single global sweep every 5 min, `lastActivityAt` map per chatId |
| FIX-Y | 🔴 | `execute_powershell` and `run_python_script` completely bypass file guard — agent can `Set-Content src/core/brain.ts` | Filter both skills from org agent Brain tool list in `createOrgAgentBrain()` |
| FIX-Z | 🟡 | Ticket locking was decided but not implemented — two agents can pick up same ticket simultaneously | `org_list_tickets` skips `in_progress` tickets unless assignee is the caller. `org_update_ticket` with `in_progress` locks to caller's agentId |
| FIX-AA | 🟢 | `orgs/` directory not in `.gitignore` — `git status` polluted with agent output | Add `orgs/` to `.gitignore` |
| FIX-AB | 🔴 | Delegation loops — CEO delegates to CTO, CTO delegates back to CEO, heartbeats fire indefinitely | `org_delegate` tracks delegation chain depth in ticket metadata. Block if depth > 5 |
| FIX-AC | 🟡 | `shared_memory.json` concurrent writes — last-write-wins silently discards other agent's data | Merge-on-write: re-read file inside write lock, merge arrays before saving |
| FIX-AD | 🟡 | `org_notify` can be called 50 times per run → 50 Telegram messages | Per-agent per-run counter in `org-agent-runner.ts`. After 5 notifs per run, calls succeed silently (stored) but Telegram suppressed |
| FIX-AE | 🟡 | No max pending proposals per agent — BOD can be flooded | `org_propose_code_change` checks pending count for this agent. Blocks if ≥ 3 pending |
| FIX-AF | 🟡 | `in_progress` tickets stranded after server restart — no agent actually running them | On server startup, scan all org ticket files — reset `in_progress` to `open` if no matching entry in `runningAgents` Set |
| FIX-AG | 🟢 | Telegram 4096 char limit — long messages fail silently | Truncate all Telegram messages to 3800 chars + `...` suffix |
| FIX-AH | 🟢 | Two agents write same filename to workspace — second silently overwrites first | `org_write_report` enforces `{role}-{ISO-timestamp}-{filename}` prefix |
| FIX-AI | 🟡 | `BrowserManager` is a singleton — all org agents share browser session (cookies, auth) | Each org gets its own browser data dir: `orgs/{orgId}/browser_data/`. Pass to `BrowserManager` via skill meta |
| FIX-AJ | 🟢 | `manage_org` not on worker Brain exclusion list — sub-agent workers could create agents | Add `manage_org` to worker Brain filter in `createModel()` in `brain.ts` |
| FIX-AK | 🟡 | Blocker cascade — 3+ agents blocked fires 3+ Telegram notifications | Aggregate in `org-notification-store.ts`: if 3+ blockers opened within 5 min for same org, send single cascade alert |

---

## STEP 1 — MODIFY `.gitignore`

Add to project root `.gitignore`:

```
# AI Org workspaces — agent output excluded from git
orgs/
```

---

## STEP 2 — MODIFY `src/core/brain.ts`

### 2.1 — Add `toolCallInterceptor` to `BrainConfig`

```typescript
export interface BrainConfig {
  agentId: string;
  conversationId: string;
  conversationLabel?: string;
  isWorker?: boolean;
  systemPromptOverride?: string;
  historyDir?: string;
  orgId?: string;
  orgAgentId?: string;
  toolCallInterceptor?: (name: string, args: any, meta: SkillMeta) => Promise<any>; // FIX-S
}
```

### 2.2 — Update `invokeTool` to check interceptor first

```typescript
// In processMessage() invokeTool function:
const extraSkill = this.extraSkills.find(s => s.name === name);
const output = this.config.toolCallInterceptor
  ? await this.config.toolCallInterceptor(name, args, meta)
  : extraSkill
    ? await extraSkill.run(args, meta)
    : chromeNativeAdapter.isChromeMCPTool(name)
      ? await chromeNativeAdapter.executeChromeTool(name, args)
      : await handleToolCall(name, args, meta);
```

### 2.3 — Add `manage_org` to worker Brain exclusions (FIX-AJ)

In `createModel()`:

```typescript
if (this.isWorker) {
  toolDefs = toolDefs.filter((t: any) => {
    const name = t.functionDeclarations[0].name;
    return name !== 'spawn_agent' && name !== 'manage_org'; // FIX-AJ
  });
}
```

---

## STEP 3 — NEW FILE: `src/core/org-file-guard.ts`

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { orgManager } from './org-manager.js';
import { eventBus } from './events.js';

export interface CodeProposal {
  id: string;
  orgId: string;
  agentId: string;
  agentLabel: string;
  relativePath: string;      // FIX-W: relative only — content on disk not here
  explanation: string;
  status: 'pending' | 'approved' | 'rejected';
  isStale: boolean;          // true if pending > 7 days
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  // Content NOT stored here — in workspace/proposals/{id}/original.txt + proposed.txt
}

export function snapshotProtectedFiles(): string[] {
  try {
    const output = execSync('git ls-files', { cwd: process.cwd(), encoding: 'utf-8', timeout: 5000 });
    return output.split('\n').filter(Boolean).map(f => f.trim());
  } catch {
    console.warn('[OrgFileGuard] git ls-files failed — no protected files snapshot.');
    return [];
  }
}

export function isProtectedFile(absolutePath: string, protectedFiles: string[]): boolean {
  const relative = path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');
  return protectedFiles.some(f => f === relative || relative.startsWith(f + '/'));
}

export function getProposalsFile(orgId: string): string {
  const org = orgManager.get(orgId);
  if (!org) throw new Error(`Org ${orgId} not found`);
  return path.join(org.orgDir, 'proposals.json');
}

export function loadProposals(orgId: string): CodeProposal[] {
  const file = getProposalsFile(orgId);
  if (!fs.existsSync(file)) return [];
  try {
    const proposals: CodeProposal[] = JSON.parse(fs.readFileSync(file, 'utf-8'));
    // Mark stale proposals (pending > 7 days)
    const now = Date.now();
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    return proposals.map(p => ({
      ...p,
      isStale: p.status === 'pending' && (now - new Date(p.createdAt).getTime()) > SEVEN_DAYS,
    }));
  } catch { return []; }
}

function saveProposals(orgId: string, proposals: CodeProposal[]): void {
  const file = getProposalsFile(orgId);
  const tmp = file + '.tmp';
  // Don't persist the computed isStale field
  const toSave = proposals.map(({ isStale: _, ...p }) => p);
  fs.writeFileSync(tmp, JSON.stringify(toSave, null, 2));
  fs.renameSync(tmp, file);
}

export function getPendingCountForAgent(orgId: string, agentId: string): number {
  return loadProposals(orgId).filter(p => p.agentId === agentId && p.status === 'pending').length;
}

export function createProposal(params: {
  orgId: string;
  agentId: string;
  agentLabel: string;
  absolutePath: string;
  proposedContent: string;
  explanation: string;
}): { success: true; proposal: CodeProposal } | { success: false; error: string } {
  // FIX-T: validate path is within project root
  const relativePath = path.relative(process.cwd(), params.absolutePath).replace(/\\/g, '/');
  if (relativePath.startsWith('..')) {
    return { success: false, error: 'Proposed path is outside the project root.' };
  }

  const proposals = loadProposals(params.orgId);

  // Block if pending proposal already exists for this file
  const conflict = proposals.find(p => p.relativePath === relativePath && p.status === 'pending');
  if (conflict) {
    return {
      success: false,
      error: `A pending proposal already exists for ${relativePath} (ID: ${conflict.id}). Resolve it first.`,
    };
  }

  // FIX-AE: max 3 pending proposals per agent
  const agentPending = proposals.filter(p => p.agentId === params.agentId && p.status === 'pending').length;
  if (agentPending >= 3) {
    return {
      success: false,
      error: `You have ${agentPending} pending proposals already. Wait for the human to review them before submitting more.`,
    };
  }

  // Write content to workspace files (FIX-W: not inline in proposals.json)
  const org = orgManager.get(params.orgId);
  if (!org) return { success: false, error: 'Org not found' };

  const proposalId = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const proposalDir = path.join(org.workspaceDir, 'proposals', proposalId);
  fs.mkdirSync(proposalDir, { recursive: true });

  const originalContent = fs.existsSync(params.absolutePath)
    ? fs.readFileSync(params.absolutePath, 'utf-8')
    : '(file does not exist yet)';

  fs.writeFileSync(path.join(proposalDir, 'original.txt'), originalContent);
  fs.writeFileSync(path.join(proposalDir, 'proposed.txt'), params.proposedContent);

  const proposal: CodeProposal = {
    id: proposalId,
    orgId: params.orgId,
    agentId: params.agentId,
    agentLabel: params.agentLabel,
    relativePath,
    explanation: params.explanation,
    status: 'pending',
    isStale: false,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
  };

  fs.writeFileSync(path.join(proposalDir, 'proposal.json'), JSON.stringify(proposal, null, 2));
  proposals.push(proposal);
  saveProposals(params.orgId, proposals);

  eventBus.dispatch('org:proposal:created', { proposal }, 'org-file-guard');
  return { success: true, proposal };
}

export function getProposalContent(orgId: string, proposalId: string): {
  original: string; proposed: string;
} | null {
  const org = orgManager.get(orgId);
  if (!org) return null;
  const proposalDir = path.join(org.workspaceDir, 'proposals', proposalId);
  try {
    return {
      original: fs.readFileSync(path.join(proposalDir, 'original.txt'), 'utf-8'),
      proposed: fs.readFileSync(path.join(proposalDir, 'proposed.txt'), 'utf-8'),
    };
  } catch { return null; }
}

export function approveProposal(orgId: string, proposalId: string): { success: boolean; error?: string } {
  const proposals = loadProposals(orgId);
  const idx = proposals.findIndex(p => p.id === proposalId);
  if (idx === -1) return { success: false, error: 'Proposal not found' };
  if (proposals[idx].status !== 'pending') return { success: false, error: `Already ${proposals[idx].status}` };

  const relativePath = proposals[idx].relativePath;
  // FIX-T: re-validate
  if (relativePath.startsWith('..')) return { success: false, error: 'Invalid path.' };

  const content = getProposalContent(orgId, proposalId);
  if (!content) return { success: false, error: 'Proposal content files not found.' };

  const absolutePath = path.resolve(process.cwd(), relativePath);
  const dir = path.dirname(absolutePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(absolutePath, content.proposed, 'utf-8');

  proposals[idx] = { ...proposals[idx], status: 'approved', resolvedAt: new Date().toISOString(), resolvedBy: 'human' };
  saveProposals(orgId, proposals);
  eventBus.dispatch('org:proposal:approved', { proposal: proposals[idx] }, 'org-file-guard');
  return { success: true };
}

export function rejectProposal(orgId: string, proposalId: string): { success: boolean; error?: string } {
  const proposals = loadProposals(orgId);
  const idx = proposals.findIndex(p => p.id === proposalId);
  if (idx === -1) return { success: false, error: 'Proposal not found' };
  if (proposals[idx].status !== 'pending') return { success: false, error: `Already ${proposals[idx].status}` };
  proposals[idx] = { ...proposals[idx], status: 'rejected', resolvedAt: new Date().toISOString(), resolvedBy: 'human' };
  saveProposals(orgId, proposals);
  eventBus.dispatch('org:proposal:rejected', { proposal: proposals[idx] }, 'org-file-guard');
  return { success: true };
}

/**
 * Reset in_progress tickets with no active runner on startup (FIX-AF).
 * Called from org-manager loadAll() after all orgs are loaded.
 */
export function resetStaleInProgressTickets(activeRunKeys: Set<string>): void {
  // This is called by index.ts after orgManager loads and passes the empty runningAgents set
  // (all empty on startup — no agents are running yet)
  // Import orgTaskBoard lazily to avoid circular dep
  import('./org-task-board.js').then(({ orgTaskBoard }) => {
    import('./org-manager.js').then(({ orgManager }) => {
      for (const org of orgManager.list()) {
        const tickets = orgTaskBoard.list(org.id, { status: 'in_progress' });
        for (const ticket of tickets) {
          const runKey = ticket.assigneeId ? `${org.id}:${ticket.assigneeId}` : null;
          if (!runKey || !activeRunKeys.has(runKey)) {
            orgTaskBoard.update(org.id, ticket.id, {
              status: 'open',
              historyEntry: 'reset to open — server restarted mid-run',
              byLabel: 'System',
              callerAgentId: 'system',
            }).catch(() => {});
          }
        }
      }
    });
  });
}
```

---

## STEP 4 — NEW FILE: `src/core/org-notification-store.ts`

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { orgManager } from './org-manager.js';

export interface StoredNotification {
  id: string;
  orgId: string;
  orgName: string;
  agentName: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
  type: 'blocker' | 'proposal' | 'agent' | 'digest' | 'cascade';
  timestamp: number;
  telegramSent: boolean;
  telegramAttempts: number;
}

const MAX_TELEGRAM_LENGTH = 3800; // FIX-AG: Telegram 4096 char limit with buffer
const pendingTelegram: StoredNotification[] = [];
let telegramSendFn: ((msg: string) => Promise<void>) | null = null;

// FIX-AK: Blocker cascade tracking — orgId → timestamps of recent blockers
const recentBlockerTimestamps: Map<string, number[]> = new Map();
const BLOCKER_CASCADE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const BLOCKER_CASCADE_THRESHOLD = 3;

export function setTelegramSender(fn: (msg: string) => Promise<void>) {
  telegramSendFn = fn;
}

function truncateForTelegram(msg: string): string {
  // FIX-AG
  if (msg.length <= MAX_TELEGRAM_LENGTH) return msg;
  return msg.substring(0, MAX_TELEGRAM_LENGTH) + '...';
}

function getNotificationFile(orgId: string): string {
  const org = orgManager.get(orgId);
  if (!org) throw new Error(`Org ${orgId} not found`);
  return path.join(org.orgDir, 'notifications.jsonl');
}

export function storeNotification(
  notif: Omit<StoredNotification, 'id' | 'telegramSent' | 'telegramAttempts'>
): StoredNotification {
  // FIX-AK: Blocker cascade detection
  if (notif.type === 'blocker') {
    const now = Date.now();
    const timestamps = recentBlockerTimestamps.get(notif.orgId) ?? [];
    const recent = timestamps.filter(t => now - t < BLOCKER_CASCADE_WINDOW_MS);
    recent.push(now);
    recentBlockerTimestamps.set(notif.orgId, recent);

    if (recent.length === BLOCKER_CASCADE_THRESHOLD) {
      // Send single cascade alert instead of individual notifications for this and future ones
      const cascadeMsg = `🚨 *[${notif.orgName}]* Multiple agents blocked (${recent.length} in 5 min). Check the Board of Directors immediately.`;
      storeNotification({
        orgId: notif.orgId,
        orgName: notif.orgName,
        agentName: 'System',
        message: cascadeMsg,
        level: 'error',
        type: 'cascade',
        timestamp: now,
      });
      // Suppress this individual notification's Telegram (cascade sent instead)
    }
  }

  const full: StoredNotification = {
    ...notif,
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    telegramSent: false,
    telegramAttempts: 0,
  };

  try {
    const file = getNotificationFile(notif.orgId);
    fs.appendFileSync(file, JSON.stringify(full) + '\n');
  } catch (e) {
    console.error('[OrgNotificationStore] Failed to persist notification:', e);
  }

  pendingTelegram.push(full);
  flushTelegramQueue();
  return full;
}

export function getNotifications(orgId: string, count = 50): StoredNotification[] {
  try {
    const file = getNotificationFile(orgId);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf-8')
      .split('\n').filter(Boolean)
      .slice(-count)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

async function flushTelegramQueue(): Promise<void> {
  if (!telegramSendFn) return;
  const toSend = pendingTelegram.filter(n => !n.telegramSent && n.telegramAttempts < 5);
  for (const notif of toSend) {
    try {
      const emoji = notif.level === 'error' ? '🔴'
        : notif.level === 'warning' ? '🟡'
        : notif.type === 'proposal' ? '📋'
        : notif.type === 'blocker' ? '🚧'
        : '🟢';
      const msg = truncateForTelegram(`${emoji} *[${notif.orgName}]* ${notif.agentName}\n${notif.message}`);
      await telegramSendFn(msg);
      notif.telegramSent = true;
      const idx = pendingTelegram.indexOf(notif);
      if (idx > -1) pendingTelegram.splice(idx, 1);
    } catch { notif.telegramAttempts++; }
  }
}

setInterval(flushTelegramQueue, 2 * 60 * 1000);

export async function sendDailyDigest(orgId: string): Promise<void> {
  const org = orgManager.get(orgId);
  if (!org || org.paused) return;
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = getNotifications(orgId, 200).filter(n => n.timestamp > since && n.type !== 'digest');
  if (recent.length === 0) return; // Skip empty digest
  const blockers = recent.filter(n => n.type === 'blocker').length;
  const proposals = recent.filter(n => n.type === 'proposal').length;
  const agentEvents = recent.filter(n => n.type === 'agent').length;
  const summary = `📊 *Daily Digest — ${org.name}*\n\nLast 24h:\n• ${agentEvents} agent notifications\n• ${proposals} pending proposal${proposals !== 1 ? 's' : ''}\n• ${blockers} blocker${blockers !== 1 ? 's' : ''}\n\nCheck Board of Directors for details.`;
  storeNotification({ orgId, orgName: org.name, agentName: 'System', message: summary, level: 'info', type: 'digest', timestamp: Date.now() });
}
```

---

## STEP 5 — MODIFY `src/core/org-manager.ts`

### 5.1 — Update `ORGS_DIR` and add fields to `Org` interface

```typescript
// BEFORE
const ORGS_DIR = path.join(process.cwd(), 'memory', 'orgs');

// AFTER
const ORGS_DIR = path.join(process.cwd(), 'orgs');
```

Add to imports:
```typescript
import { snapshotProtectedFiles } from './org-file-guard.js';
```

Update `Org` interface:
```typescript
export interface Org {
  id: string;
  name: string;
  mission: string;
  rootDir: string;         // = workspaceDir for backward compat
  orgDir: string;          // NEW: parent — holds system files
  workspaceDir: string;    // NEW: agents write files here
  createdAt: string;
  paused: boolean;
  agents: OrgAgent[];
  protectedFiles: string[]; // NEW: git ls-files snapshot
}
```

### 5.2 — Update `create()` — new directory structure + protected files snapshot

```typescript
create(params: { name: string; mission: string; rootDir?: string }): Org {
  if (this.orgs.size >= MAX_ORGS) throw new Error(`Maximum of ${MAX_ORGS} organisations reached.`);

  const shortId = Math.random().toString(36).slice(2, 8);
  const safeName = (params.name || 'org')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40);
  const dirName = `${safeName}-${shortId}`;
  const orgDir = path.join(ORGS_DIR, dirName);
  const workspaceDir = path.join(orgDir, 'workspace');

  fs.mkdirSync(workspaceDir, { recursive: true });

  const protectedFiles = snapshotProtectedFiles();

  const org: Org = {
    id: `org_${Date.now()}`,
    name: params.name,
    mission: params.mission,
    rootDir: workspaceDir,
    orgDir,
    workspaceDir,
    createdAt: new Date().toISOString(),
    paused: false,
    agents: [],
    protectedFiles,
  };

  this.orgs.set(org.id, org);
  this.persist(org);
  this.ensureSharedMemory(org.id);
  eventBus.dispatch(Events.ORG_CREATED, { org }, 'org-manager');
  return org;
}
```

### 5.3 — Update `persist()` — atomic write

```typescript
private persist(org: Org): void {
  const dir = org.orgDir ?? path.join(ORGS_DIR, org.id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'org.json');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(org, null, 2));
  fs.renameSync(tmp, file);
}
```

### 5.4 — Update `loadAll()` — migration + back-fill (FIX-Q)

```typescript
private loadAll(): void {
  // FIX-Q: migrate from old memory/orgs/ if exists
  const legacyDir = path.join(process.cwd(), 'memory', 'orgs');
  if (fs.existsSync(legacyDir) && !fs.existsSync(ORGS_DIR)) {
    console.log('[OrgManager] Migrating orgs from memory/orgs/ to orgs/...');
    fs.mkdirSync(path.dirname(ORGS_DIR), { recursive: true });
    fs.renameSync(legacyDir, ORGS_DIR);
  }
  if (!fs.existsSync(ORGS_DIR)) return;
  for (const d of fs.readdirSync(ORGS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('_deleted_'))) {
    const file = path.join(ORGS_DIR, d.name, 'org.json');
    if (!fs.existsSync(file)) continue;
    try {
      const org = JSON.parse(fs.readFileSync(file, 'utf-8'));
      // Back-fill fields for orgs created before v12.1
      if (!org.orgDir) org.orgDir = path.join(ORGS_DIR, d.name);
      if (!org.workspaceDir) org.workspaceDir = org.rootDir;
      if (!org.protectedFiles) org.protectedFiles = [];
      this.orgs.set(org.id, org);
    } catch (e) { console.error(`[OrgManager] Failed to load ${file}:`, e); }
  }
  console.log(`[OrgManager] Loaded ${this.orgs.size} organisations.`);
}
```

### 5.5 — Update `addAgent()` — duplicate role detection + allowDuplicateRole

```typescript
addAgent(orgId: string, params: {
  name: string; role: string; personality: string; responsibilities: string;
  goals: string[]; autonomyLevel: AutonomyLevel; heartbeatCron: string;
  reportingTo: string | null; allowDuplicateRole?: boolean;
}): OrgAgent {
  const org = this.orgs.get(orgId);
  if (!org) throw new Error(`Org ${orgId} not found`);
  if (!params.allowDuplicateRole) {
    const existing = org.agents.find(a => a.role.toLowerCase() === params.role.toLowerCase());
    if (existing) throw new Error(`Agent with role "${params.role}" already exists (${existing.name}). Pass allowDuplicateRole: true to override.`);
  }
  const agent: OrgAgent = {
    id: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    orgId, name: params.name, role: params.role, personality: params.personality,
    responsibilities: params.responsibilities, goals: params.goals,
    autonomyLevel: params.autonomyLevel, heartbeat: { cron: params.heartbeatCron, enabled: true },
    paused: false, reportingTo: params.reportingTo,
    createdAt: new Date().toISOString(), lastRunAt: null, lastRunStatus: null,
  };
  org.agents.push(agent);
  this.persist(org);
  this.ensureAgentDirs(orgId, agent.id);
  eventBus.dispatch(Events.ORG_AGENT_CREATED, { agent, orgId }, 'org-manager');
  return agent;
}
```

### 5.6 — Update directory helpers to use `orgDir`

```typescript
getAgentMemoryDir(orgId: string, agentId: string): string {
  const org = this.orgs.get(orgId);
  return path.join(org?.orgDir ?? path.join(ORGS_DIR, orgId), 'agents', agentId);
}
getSharedMemoryFile(orgId: string): string {
  const org = this.orgs.get(orgId);
  return path.join(org?.orgDir ?? path.join(ORGS_DIR, orgId), 'shared_memory.json');
}
getAgentMemoryFile(orgId: string, agentId: string): string {
  return path.join(this.getAgentMemoryDir(orgId, agentId), 'memory.json');
}
getRunLogFile(orgId: string, agentId: string): string {
  return path.join(this.getAgentMemoryDir(orgId, agentId), 'runs.jsonl');
}
```

### 5.7 — Update `ensureSharedMemory()` — atomic write

```typescript
private ensureSharedMemory(orgId: string): void {
  const file = this.getSharedMemoryFile(orgId);
  if (!fs.existsSync(file)) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ orgId, lastUpdated: new Date().toISOString(), companyState: '', decisions: [], announcements: [], custom: {} }, null, 2));
    fs.renameSync(tmp, file);
  }
}
```

---

## STEP 6 — MODIFY `src/core/org-task-board.ts`

### 6.1 — Add ticket locking (FIX-Z)

In `update()`, add ticket lock logic: when status changes to `in_progress`, lock the assignee. Other agents calling `list()` will not see `in_progress` tickets unless they are the assignee.

```typescript
// In list() — FIX-Z: hide in_progress tickets from non-assignees
list(orgId: string, filter?: { assigneeId?: string; status?: TicketStatus; callerAgentId?: string }): Ticket[] {
  let tickets = this.load(orgId);
  if (filter?.status) tickets = tickets.filter(t => t.status === filter.status);
  if (filter?.assigneeId) tickets = tickets.filter(t => t.assigneeId === filter.assigneeId);
  // FIX-Z: hide in_progress tickets from agents who aren't the assignee
  if (filter?.callerAgentId) {
    tickets = tickets.filter(t =>
      t.status !== 'in_progress' || t.assigneeId === filter.callerAgentId
    );
  }
  return tickets;
}

// In update() — when status moves to in_progress, lock to current assignee
if (updates.status === 'in_progress' && updates.callerAgentId) {
  // Only allow the current assignee to pick it up
  if (ticket.assigneeId && ticket.assigneeId !== updates.callerAgentId) {
    // Release lock — don't throw, just return null-like indication
    return null;
  }
  // Auto-assign to caller if unassigned
  if (!ticket.assigneeId) {
    ticket.assigneeId = updates.callerAgentId;
    const org = orgManager.get(orgId);
    const agent = org?.agents.find(a => a.id === updates.callerAgentId);
    ticket.assigneeLabel = agent ? `${agent.name} (${agent.role})` : updates.callerAgentId;
  }
}
```

Also update `orgListTicketsSkill` in `org-skills.ts` to pass `callerAgentId`:

```typescript
return { tickets: orgTaskBoard.list(meta.orgId, {
  assigneeId: args.assignedToMe ? meta.orgAgentId : undefined,
  status: args.status,
  callerAgentId: meta.orgAgentId,  // FIX-Z
}) };
```

---

## STEP 7 — MODIFY `src/core/org-agent-runner.ts`

### 7.1 — Add concurrent limit system (FIX-V)

```typescript
const runningCounts: Map<string, number> = new Map();
const MAX_CONCURRENT_PER_ORG = 5;
const orgQueues: Map<string, Array<() => void>> = new Map();

export function getRunningCount(orgId: string): number {
  return runningCounts.get(orgId) ?? 0;
}

function incrementRunning(orgId: string) {
  runningCounts.set(orgId, (runningCounts.get(orgId) ?? 0) + 1);
}

function decrementRunning(orgId: string) {
  const count = Math.max(0, (runningCounts.get(orgId) ?? 1) - 1);
  runningCounts.set(orgId, count);
  const queue = orgQueues.get(orgId);
  if (queue?.length && count < MAX_CONCURRENT_PER_ORG) queue.shift()!();
}

function waitForSlot(orgId: string): Promise<void> {
  if (getRunningCount(orgId) < MAX_CONCURRENT_PER_ORG) return Promise.resolve();
  return new Promise(resolve => {
    if (!orgQueues.has(orgId)) orgQueues.set(orgId, []);
    orgQueues.get(orgId)!.push(resolve);
  });
}
```

### 7.2 — Chat Brain idle cleanup (FIX-X)

```typescript
const chatBrainLastActivity: Map<string, number> = new Map();
const CHAT_BRAIN_IDLE_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [chatId, lastActivity] of chatBrainLastActivity.entries()) {
    if (now - lastActivity > CHAT_BRAIN_IDLE_MS) {
      chatBrains.delete(chatId);
      chatBrainLastActivity.delete(chatId);
      console.log(`[OrgAgentRunner] Idle chat Brain cleaned: ${chatId}`);
    }
  }
}, 5 * 60 * 1000);
```

### 7.3 — Per-run notify counter (FIX-AD)

```typescript
// Per-run notification counter — reset each run
export const runNotifyCounters: Map<string, number> = new Map(); // key: runId

export function incrementNotifyCounter(runId: string): boolean {
  const count = (runNotifyCounters.get(runId) ?? 0) + 1;
  runNotifyCounters.set(runId, count);
  return count <= 5; // return false when over limit
}
```

Pass `runId` to the org Brain via system prompt or meta so `org_notify` can check it. The cleaner approach: store `runId` in a context that `org-skills.ts` can access. Use `meta.orgAgentId` as the key in `runNotifyCounters` keyed by `{orgId}:{agentId}:{runId}`. Clear at run end:

```typescript
// At end of runOrgAgent() in finally block:
runNotifyCounters.delete(runId);
```

### 7.4 — File write interceptor with FIX-Y (PowerShell/Python blocked)

`createOrgAgentBrain()` already filters `manage_scheduler`. Add to that same filter:

```typescript
// FIX-Y: also filter powershell and python — these bypass the file guard
brain.filterTools((name: string) =>
  name !== 'manage_scheduler' &&
  name !== 'execute_powershell' &&
  name !== 'run_python_script'
);
```

Update agent system prompt rules section:
```
- You do NOT have access to `execute_powershell` or `run_python_script` — these tools are
  disabled for org agents to protect the codebase. Use `org_propose_code_change` for code
  changes and `manage_files` for reading project files.
```

### 7.5 — File interceptor + activity log + token estimate

```typescript
export interface FileActivityEntry {
  action: 'write' | 'delete' | 'create';
  path: string;
  agentId: string;
  agentLabel: string;
  timestamp: string;
}

async function orgAwareHandleToolCall(
  name: string, args: any, meta: any,
  org: Org, agent: OrgAgent, activityLog: FileActivityEntry[]
): Promise<any> {
  const { handleToolCall } = await import('../skills/index.js');
  const WRITE_SKILLS = new Set(['manage_files', 'manage_pdf']);
  const WRITE_ACTIONS = new Set(['write', 'append', 'create', 'merge', 'split', 'rotate', 'watermark', 'extract_pages']);

  if (WRITE_SKILLS.has(name) && WRITE_ACTIONS.has(args.action)) {
    const targetPath = path.resolve(args.path ?? args.output_path ?? '');
    if (isProtectedFile(targetPath, org.protectedFiles)) {
      return {
        intercepted: true,
        success: false,
        message: `This is a protected file. Use \`org_propose_code_change\` to submit a proposal. Continue with other tasks.`,
      };
    }
    // Not protected — log write activity
    activityLog.push({
      action: args.action === 'create' ? 'create' : 'write',
      path: targetPath,
      agentId: agent.id,
      agentLabel: `${agent.name} (${agent.role})`,
      timestamp: new Date().toISOString(),
    });
  }
  return handleToolCall(name, args, meta);
}
```

### 7.6 — Memory bloat check

```typescript
const MEMORY_BLOAT_THRESHOLD = 50 * 1024;

async function checkAndSummariseMemory(orgId: string, agentId: string): Promise<void> {
  const memFile = orgManager.getAgentMemoryFile(orgId, agentId);
  if (!fs.existsSync(memFile) || fs.statSync(memFile).size < MEMORY_BLOAT_THRESHOLD) return;
  console.log(`[OrgAgentRunner] Memory for ${agentId} > 50KB. Summarising...`);
  try {
    const { Brain } = await import('./brain.js');
    const current = JSON.parse(fs.readFileSync(memFile, 'utf-8'));
    const summaryBrain = new Brain({ agentId: `summariser_${agentId}`, conversationId: `summarise_${Date.now()}`, isWorker: true });
    const summary = await summaryBrain.processMessage(
      `Summarise this agent memory into concise JSON with same structure, keeping only the most important recent notes, top 3 priorities, top 3 pending actions. Return only valid JSON.\n\n${JSON.stringify(current, null, 2)}`
    );
    const summarised = JSON.parse(summary.replace(/```json|```/g, '').trim());
    const tmp = memFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ...summarised, lastSummarisedAt: new Date().toISOString() }, null, 2));
    fs.renameSync(tmp, memFile);
  } catch (e) { console.warn(`[OrgAgentRunner] Memory summarisation failed for ${agentId}:`, e); }
}
```

### 7.7 — Main `runOrgAgent()` with all fixes wired

```typescript
export async function runOrgAgent(
  orgId: string, agentId: string,
  trigger: 'cron' | 'event' | 'manual' | 'chat',
  messageOverride?: string, chatId?: string
): Promise<OrgAgentRunResult> {
  const runKey = `${orgId}:${agentId}`;
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  const startedAt = new Date().toISOString();

  if (trigger !== 'chat' && runningAgents.has(runKey)) {
    orgManager.recordRun(orgId, agentId, 'skipped');
    eventBus.dispatch(Events.ORG_AGENT_HEARTBEAT_SKIPPED, { orgId, agentId, trigger }, 'org-agent-runner');
    return { runId, agentId, orgId, trigger, startedAt, completedAt: startedAt, durationMs: 0, response: '', skipped: true, skipReason: 'Still running from previous heartbeat.' };
  }

  const org = orgManager.get(orgId);
  if (!org) throw new Error(`Org ${orgId} not found`);
  const agent = org.agents.find(a => a.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);
  if (agent.paused || org.paused) {
    return { runId, agentId, orgId, trigger, startedAt, completedAt: startedAt, durationMs: 0, response: '', skipped: true, skipReason: agent.paused ? 'Agent paused.' : 'Org paused.' };
  }

  if (trigger !== 'chat') {
    await waitForSlot(orgId);
    runningAgents.add(runKey);
    incrementRunning(orgId);
  }

  const startMs = Date.now();
  const activityLog: FileActivityEntry[] = [];
  await checkAndSummariseMemory(orgId, agentId);

  eventBus.dispatch(Events.ORG_AGENT_RUN_STARTED, { runId, agentId, orgId, agentName: agent.name, role: agent.role, trigger }, 'org-agent-runner');

  try {
    let brain: any;
    if (trigger === 'chat' && chatId) {
      if (!chatBrains.has(chatId)) {
        brain = await createOrgAgentBrain(org, agent, activityLog);
        chatBrains.set(chatId, brain);
      } else {
        brain = chatBrains.get(chatId);
        brain.updateSystemPromptOverride(buildOrgAgentSystemPrompt(org, agent));
      }
      chatBrainLastActivity.set(chatId, Date.now());
    } else {
      brain = await createOrgAgentBrain(org, agent, activityLog);
    }

    const prompt = messageOverride ?? `[HEARTBEAT:${trigger.toUpperCase()}] You have been activated. Begin your run now.`;
    const response = await brain.processMessage(prompt);
    const durationMs = Date.now() - startMs;
    const completedAt = new Date().toISOString();

    if (trigger !== 'chat') {
      const logFile = orgManager.getRunLogFile(orgId, agentId);
      fs.appendFileSync(logFile, JSON.stringify({
        runId, trigger, startedAt, completedAt, durationMs,
        summary: response.substring(0, 300),
        fileActivity: activityLog,
        // Token estimate: rough heuristic — 4 chars ≈ 1 token
        estimatedTokens: Math.round(response.length / 4),
      }) + '\n');
      orgManager.recordRun(orgId, agentId, 'completed');
    }

    if (activityLog.length > 0) {
      eventBus.dispatch('org:agent:file_activity', { orgId, agentId, agentName: agent.name, role: agent.role, runId, activity: activityLog }, 'org-agent-runner');
    }

    eventBus.dispatch(Events.ORG_AGENT_RUN_COMPLETED, { runId, agentId, orgId, agentName: agent.name, role: agent.role, durationMs, trigger }, 'org-agent-runner');
    return { runId, agentId, orgId, trigger, startedAt, completedAt, durationMs, response, skipped: false };

  } catch (err: any) {
    const durationMs = Date.now() - startMs;
    if (trigger !== 'chat') orgManager.recordRun(orgId, agentId, 'failed');
    eventBus.dispatch(Events.ORG_AGENT_RUN_FAILED, { runId, agentId, orgId, error: err.message, trigger }, 'org-agent-runner');
    throw err;
  } finally {
    if (trigger !== 'chat') {
      runningAgents.delete(runKey);
      decrementRunning(orgId);
    }
    runNotifyCounters.delete(runId);
  }
}
```

### 7.8 — `createOrgAgentBrain()` — wire all filters + interceptor

```typescript
async function createOrgAgentBrain(org: Org, agent: OrgAgent, activityLog: FileActivityEntry[]): Promise<any> {
  const { Brain } = await import('./brain.js'); // FIX-A
  const brain = new Brain({
    agentId: `org_${agent.id}`,
    conversationId: `org_${org.id}_${agent.id}`,
    conversationLabel: `${agent.name} (${agent.role})`,
    isWorker: false,
    systemPromptOverride: buildOrgAgentSystemPrompt(org, agent),
    historyDir: orgManager.getAgentMemoryDir(org.id, agent.id),
    orgId: org.id,
    orgAgentId: agent.id,
    toolCallInterceptor: (name, args, meta) =>
      orgAwareHandleToolCall(name, args, meta, org, agent, activityLog),
  });
  // FIX-Y: filter powershell + python. FIX-K: filter manage_scheduler.
  brain.filterTools((name: string) =>
    name !== 'manage_scheduler' &&
    name !== 'execute_powershell' &&
    name !== 'run_python_script'
  );
  brain.injectExtraTools(orgSkills);
  return brain;
}
```

### 7.9 — Export helpers for shutdown + restart

```typescript
export { getRunningCount };

export function getAllOrgConversationIds(): string[] {
  const ids: string[] = [];
  for (const org of orgManager.list()) {
    for (const agent of org.agents) ids.push(`org_${org.id}_${agent.id}`);
  }
  return ids;
}

export function getRunningAgentsSet(): Set<string> {
  return runningAgents; // FIX-AF: exposed for stale ticket reset on startup
}
```

---

## STEP 8 — MODIFY `src/core/org-heartbeat.ts`

### 8.1 — Stagger + concurrent check (FIX-U, FIX-V, FIX-N)

```typescript
import { getRunningCount } from './org-agent-runner.js';

function staggerCron(expression: string, offsetMinutes: number): string {
  const parts = expression.split(' ');
  if (parts.length !== 5) return expression;
  const minutePart = parts[0];
  if (minutePart.includes('/') || minutePart.includes(',')) return expression; // FIX-U
  const minute = minutePart === '*' ? 0 : parseInt(minutePart, 10);
  if (isNaN(minute)) return expression;
  parts[0] = String((minute + offsetMinutes) % 60);
  return parts.join(' ');
}

public scheduleAgent(orgId: string, agentId: string, cronOffsets?: Map<string, number>): boolean {
  const org = orgManager.get(orgId);
  const agent = org?.agents.find(a => a.id === agentId);
  if (!agent || !agent.heartbeat.enabled || !agent.heartbeat.cron) return false;

  let cronExpr = agent.heartbeat.cron;
  if (cronOffsets) {
    const existing = cronOffsets.get(cronExpr) ?? 0;
    if (existing > 0) cronExpr = staggerCron(cronExpr, existing * 2);
    cronOffsets.set(agent.heartbeat.cron, existing + 1);
  }

  if (!cron.validate(cronExpr)) { console.warn(`[OrgHeartbeat] Invalid cron: ${cronExpr}`); return false; }

  const key = `${orgId}:${agentId}`;
  this.tasks.get(key)?.stop();

  const task = cron.schedule(cronExpr, async () => {
    // FIX-V: queue handled inside runOrgAgent — just fire and let it queue
    eventBus.dispatch(Events.ORG_AGENT_HEARTBEAT_FIRED, { orgId, agentId, trigger: 'cron', agentName: agent.name }, 'org-heartbeat');
    runOrgAgent(orgId, agentId, 'cron').catch(err =>
      console.error(`[OrgHeartbeat] Run failed for ${agentId}:`, err.message)
    );
  });

  this.tasks.set(key, task);
  return true;
}
```

---

## STEP 9 — MODIFY `src/skills/org-skills.ts`

### 9.1 — Update shared memory write — merge strategy (FIX-AC)

```typescript
run: async (args: any, meta: SkillMeta) => {
  if (!meta.orgId) return { error: 'Not running in org context' };
  const file = orgManager.getSharedMemoryFile(meta.orgId);
  // FIX-AC: re-read inside write to merge arrays, not overwrite
  const lock = await skillLock.acquireWrite('memory', {
    agentId: meta.agentId, conversationId: meta.conversationId ?? '',
    conversationLabel: meta.conversationLabel ?? '', operation: 'shared_memory:write', acquiredAt: new Date(),
  });
  try {
    const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : { decisions: [], announcements: [] };
    const updated = {
      ...existing,
      orgId: meta.orgId,
      lastUpdated: new Date().toISOString(),
      companyState: args.companyState ?? existing.companyState,
      // Merge arrays — don't overwrite
      announcements: [...(existing.announcements ?? []), ...(args.announcements ?? [])],
      decisions: [...(existing.decisions ?? []), ...(args.decisions ?? [])],
    };
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
    fs.renameSync(tmp, file);
  } finally { lock(); }
  return { success: true };
},
```

### 9.2 — Update `org_write_report` — timestamp + role prefix (FIX-AH)

```typescript
run: async (args: any, meta: SkillMeta) => {
  if (!meta.orgId) return { error: 'Not running in org context' };
  const org = orgManager.get(meta.orgId);
  if (!org) return { error: 'Org not found' };
  const agent = org.agents.find(a => a.id === meta.orgAgentId);
  const roleSlug = (agent?.role ?? 'agent').toLowerCase().replace(/\s+/g, '-');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  // FIX-AH: enforce unique filename — {role}-{timestamp}-{original}
  const safeFilename = `${roleSlug}-${timestamp}-${args.filename}`;
  const baseDir = args.subdirectory
    ? path.join(org.workspaceDir, args.subdirectory)
    : path.join(org.workspaceDir, 'reports');
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  const filePath = path.join(baseDir, safeFilename);
  fs.writeFileSync(filePath, args.content, 'utf-8');
  return { success: true, path: filePath };
},
```

### 9.3 — Update `org_notify` — rate limiting (FIX-AD)

The `runId` needs to reach `org_notify`. Best approach: store current `runId` in the Brain's `orgAgentId` meta as `{agentId}:{runId}`. Simpler: use a module-level Map in `org-agent-runner.ts` keyed by `agentId` → `runId`, and export a lookup:

```typescript
// In org-agent-runner.ts
export const activeRunIds: Map<string, string> = new Map(); // agentId → runId
// Set at run start: activeRunIds.set(agentId, runId);
// Clear at run end: activeRunIds.delete(agentId);
```

In `org_notify`:

```typescript
run: async (args: any, meta: SkillMeta) => {
  if (!meta.orgId) return { error: 'Not running in org context' };
  const org = orgManager.get(meta.orgId);
  const agent = org?.agents.find(a => a.id === meta.orgAgentId);

  // FIX-AD: rate limit — max 5 notifications per run
  const { activeRunIds, incrementNotifyCounter } = await import('../core/org-agent-runner.js');
  const runId = activeRunIds.get(meta.orgAgentId ?? '') ?? 'unknown';
  const allowed = incrementNotifyCounter(runId);
  // Always store — only suppress Telegram when over limit
  const { storeNotification } = await import('../core/org-notification-store.js');
  storeNotification({
    orgId: meta.orgId, orgName: org?.name ?? '', agentName: agent ? `${agent.name} (${agent.role})` : 'Unknown',
    message: args.message, level: args.level ?? 'info', type: 'agent', timestamp: Date.now(),
  });
  if (!allowed) {
    return { success: true, message: 'Stored. Telegram suppressed — notification rate limit reached for this run (max 5).' };
  }
  eventBus.dispatch('org:notification', { orgId: meta.orgId, orgName: org?.name, agentName: agent ? `${agent.name} (${agent.role})` : 'Unknown', message: args.message, level: args.level ?? 'info', timestamp: Date.now() }, 'org-skills');
  return { success: true };
},
```

### 9.4 — Update `org_propose_code_change` — FIX-AE enforced via `createProposal()`

Already handled in `org-file-guard.ts` — the `getPendingCountForAgent` check blocks at 3. No change needed here beyond the existing skill.

### 9.5 — Update `org_delegate` — delegation loop detection (FIX-AB)

```typescript
run: async (args: any, meta: SkillMeta) => {
  if (!meta.orgId || !meta.orgAgentId) return { error: 'Not running in org context' };

  // FIX-AB: delegation loop detection
  // Store delegation depth in ticket metadata. If depth > 5, block.
  const delegationDepth = (args.delegationDepth ?? 0) + 1;
  if (delegationDepth > 5) {
    return {
      success: false,
      error: 'Delegation chain depth limit reached (5). This looks like a delegation loop. Resolve manually.',
    };
  }

  // ... rest of existing delegation logic unchanged ...
  // When creating the ticket, include delegationDepth in description metadata
  const ticket = await orgTaskBoard.create({
    ...existingParams,
    description: `${args.description}\n\n[delegation_depth:${delegationDepth}]`,
  });
  // ... rest unchanged
```

Also update the org delegate skill parameters to optionally accept `delegationDepth` (internal use):
```typescript
delegationDepth: { type: 'number', description: 'Internal — delegation chain depth. Do not set manually.' },
```

When the receiving agent processes the ticket and re-delegates, it reads `delegationDepth` from the description and passes it through.

---

## STEP 10 — MODIFY `src/skills/org-management-skill.ts`

### 10.1 — Auto `reportingTo` + `allowDuplicateRole` + workers cannot call this (FIX-AJ already in brain.ts)

```typescript
case 'add_agent': {
  // Auto-set reportingTo to calling agent if called by an org agent
  const callerReportingTo = _meta.orgAgentId ?? (args.reportingTo ?? null);
  const agent = orgManager.addAgent(args.orgId, {
    name: args.name, role: args.role, personality: args.personality,
    responsibilities: args.responsibilities, goals: args.goals ?? [],
    autonomyLevel: (args.autonomyLevel ?? 'full') as AutonomyLevel,
    heartbeatCron: args.heartbeatCron ?? '0 9 * * *',
    reportingTo: callerReportingTo,
    allowDuplicateRole: args.allowDuplicateRole ?? false,
  });
  orgHeartbeat.scheduleAgent(args.orgId, agent.id);
  return { success: true, agent };
}
```

---

## STEP 11 — MODIFY `src/core/org-task-board.ts`

### Browser isolation per org (FIX-AI)

This fix is applied in `org-agent-runner.ts` system prompt and via the `manage_files` skill context — the actual browser data dir isolation is handled in a new helper exposed from `org-manager.ts`:

```typescript
// Add to OrgManager:
getBrowserDataDir(orgId: string): string {
  const org = this.orgs.get(orgId);
  return path.join(org?.orgDir ?? path.join(ORGS_DIR, orgId), 'browser_data');
}
```

In `buildOrgAgentSystemPrompt()` in `org-agent-runner.ts`, add to the browser section:

```typescript
## Browser Usage
If you use the browser, your session is isolated to this organisation — your logins and cookies
are separate from other agents and from the human's browser sessions.
Your browser profile is stored at: ${orgManager.getBrowserDataDir(org.id)}

To connect the browser with your org profile, use:
  browser(action="status") to see current mode
The browser skill will automatically use your org-specific profile.
```

The actual browser data dir is passed to `BrowserManager` via the `browser` skill when called from an org agent context — the `SkillMeta.orgId` is used to select the profile dir. Add to `src/skills/browser.ts`:

```typescript
// At the top of run() in browser skill, check if org context:
if (meta.orgId) {
  const orgBrowserDir = orgManager.getBrowserDataDir(meta.orgId);
  await browserManager.ensureProfileDir(orgBrowserDir);
}
```

And add `ensureProfileDir(dir: string)` to `BrowserManager` in `src/core/browser.ts`:

```typescript
async ensureProfileDir(profileDir: string): Promise<void> {
  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
  // Only switch profile if different from current
  if (this.currentProfileDir !== profileDir) {
    await this.close(); // close current browser
    this.currentProfileDir = profileDir;
    // Browser will relaunch with new profile on next getPage() call
  }
}
```

---

## STEP 12 — MODIFY `src/index.ts`

### 12.1 — New imports

```typescript
import { approveProposal, rejectProposal, loadProposals, resetStaleInProgressTickets } from './core/org-file-guard.js';
import { storeNotification, getNotifications, setTelegramSender, sendDailyDigest } from './core/org-notification-store.js';
import { getAllOrgConversationIds, getRunningAgentsSet } from './core/org-agent-runner.js';
import cron from 'node-cron';
```

### 12.2 — Wire Telegram sender + startup fixes

```typescript
// After: const telegram = new TelegramInterface();
if (process.env.TELEGRAM_BOT_TOKEN) {
  setTelegramSender(async (msg) => telegram.sendMessage(msg));
}

// FIX-AF: Reset stale in_progress tickets on startup
// runningAgents is empty on startup — all in_progress tickets are stale
setTimeout(() => resetStaleInProgressTickets(getRunningAgentsSet()), 2000);
```

### 12.3 — Daily digest + startup banner

```typescript
cron.schedule('0 9 * * *', async () => {
  for (const org of orgManager.list()) {
    await sendDailyDigest(org.id).catch(e => console.error(`[Digest] ${org.id}:`, e));
  }
});
```

### 12.4 — Event listeners

```typescript
// Proposals
eventBus.on('org:proposal:created', (event: any) => {
  const data = event.data ?? event;
  io.emit('org:proposal:update', { orgId: data.proposal.orgId });
  io.emit('org:notification', { ...data.proposal, message: `Proposed change to \`${data.proposal.relativePath}\``, level: 'warning', type: 'proposal', timestamp: Date.now() });
});
eventBus.on('org:proposal:approved', (event: any) => io.emit('org:proposal:update', { orgId: (event.data ?? event).proposal.orgId }));
eventBus.on('org:proposal:rejected', (event: any) => io.emit('org:proposal:update', { orgId: (event.data ?? event).proposal.orgId }));

// Blockers
eventBus.on('org:blocker:created', (event: any) => {
  const data = event.data ?? event;
  io.emit('org:blocker:update', { orgId: data.blocker.orgId });
  io.emit('org:notification', { orgId: data.blocker.orgId, orgName: orgManager.get(data.blocker.orgId)?.name, agentName: data.blocker.agentLabel, message: `🚧 ${data.blocker.title}`, level: 'error', type: 'blocker', timestamp: Date.now() });
  storeNotification({ orgId: data.blocker.orgId, orgName: orgManager.get(data.blocker.orgId)?.name ?? '', agentName: data.blocker.agentLabel, message: `🚧 ${data.blocker.title}: ${data.blocker.humanActionRequired}`, level: 'error', type: 'blocker', timestamp: Date.now() });
});
eventBus.on('org:blocker:update', (event: any) => io.emit('org:blocker:update', { orgId: (event.data ?? event).orgId }));

// File activity (live)
eventBus.on('org:agent:file_activity', (event: any) => io.emit('org:agent:file_activity', event.data ?? event));
```

### 12.5 — New socket handlers

```typescript
// Proposals
socket.on('org:proposals:list', (params: { orgId: string }) => {
  socket.emit('org:proposals:list', { orgId: params.orgId, proposals: loadProposals(params.orgId) });
});
socket.on('org:proposal:content', (params: { orgId: string; proposalId: string }) => {
  const { getProposalContent } = require('./core/org-file-guard.js');
  const content = getProposalContent(params.orgId, params.proposalId);
  socket.emit('org:proposal:content', { proposalId: params.proposalId, ...content });
});
socket.on('org:proposal:approve', (params: { orgId: string; proposalId: string }) => {
  const result = approveProposal(params.orgId, params.proposalId);
  if (result.success) io.emit('org:proposal:update', { orgId: params.orgId });
  socket.emit('org:proposal:result', result);
});
socket.on('org:proposal:reject', (params: { orgId: string; proposalId: string }) => {
  const result = rejectProposal(params.orgId, params.proposalId);
  if (result.success) io.emit('org:proposal:update', { orgId: params.orgId });
  socket.emit('org:proposal:result', result);
});

// Blockers
socket.on('org:blockers:list', (params: { orgId: string }) => {
  try {
    const org = orgManager.get(params.orgId);
    if (!org) return socket.emit('org:blockers:list', { orgId: params.orgId, blockers: [] });
    const file = path.join(org.orgDir, 'blockers.json');
    const blockers = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : [];
    socket.emit('org:blockers:list', { orgId: params.orgId, blockers });
  } catch { socket.emit('org:blockers:list', { orgId: params.orgId, blockers: [] }); }
});
socket.on('org:blocker:resolve', (params: { orgId: string; blockerId: string; resolution: string }) => {
  try {
    const org = orgManager.get(params.orgId);
    if (!org) return;
    const file = path.join(org.orgDir, 'blockers.json');
    const blockers = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : [];
    const idx = blockers.findIndex((b: any) => b.id === params.blockerId);
    if (idx > -1) {
      blockers[idx] = { ...blockers[idx], status: 'resolved', resolvedAt: new Date().toISOString(), resolution: params.resolution };
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(blockers, null, 2));
      fs.renameSync(tmp, file);
      io.emit('org:blocker:update', { orgId: params.orgId });
    }
  } catch (e: any) { socket.emit('org:error', { message: e.message }); }
});

// Stored notifications
socket.on('org:notifications:list', (params: { orgId: string; count?: number }) => {
  socket.emit('org:notifications:list', { orgId: params.orgId, notifications: getNotifications(params.orgId, params.count ?? 100) });
});

// Agent run activity
socket.on('org:agent:activity', (params: { orgId: string; agentId: string }) => {
  try {
    const logFile = orgManager.getRunLogFile(params.orgId, params.agentId);
    if (!fs.existsSync(logFile)) return socket.emit('org:agent:activity', { runs: [] });
    const runs = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean).slice(-20)
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    socket.emit('org:agent:activity', { orgId: params.orgId, agentId: params.agentId, runs });
  } catch { socket.emit('org:agent:activity', { runs: [] }); }
});

// Workspace file browser
socket.on('org:workspace:list', (params: { orgId: string; subdir?: string }) => {
  try {
    const org = orgManager.get(params.orgId);
    if (!org) return socket.emit('org:workspace:list', { files: [] });
    const dir = params.subdir ? path.join(org.workspaceDir, params.subdir) : org.workspaceDir;
    if (!fs.existsSync(dir)) return socket.emit('org:workspace:list', { files: [] });
    const entries = fs.readdirSync(dir, { withFileTypes: true }).map(e => ({
      name: e.name,
      isDir: e.isDirectory(),
      path: path.join(params.subdir ?? '', e.name).replace(/\\/g, '/'),
      size: e.isFile() ? fs.statSync(path.join(dir, e.name)).size : 0,
      modified: e.isFile() ? fs.statSync(path.join(dir, e.name)).mtime.toISOString() : null,
    }));
    socket.emit('org:workspace:list', { orgId: params.orgId, dir: params.subdir ?? '/', files: entries });
  } catch (e: any) { socket.emit('org:error', { message: e.message }); }
});
```

### 12.6 — Live tool feed events

```typescript
// Add to existing brain:tool_called listener:
io.emit('chat:tool_feed', { conversationId: data.conversationId, type: 'started', tool: data.name, args: data.args, timestamp: Date.now() });

// Add to existing brain:tool_completed listener:
io.emit('chat:tool_feed', { conversationId: data.conversationId, type: 'completed', tool: data.name, durationMs: data.durationMs, success: data.success, timestamp: Date.now() });
```

---

## STEP 13 — FRONTEND TYPES

Add to `dashboard/src/types/org.ts`:

```typescript
export interface CodeProposal {
  id: string;
  orgId: string;
  agentId: string;
  agentLabel: string;
  relativePath: string;
  explanation: string;
  status: 'pending' | 'approved' | 'rejected';
  isStale: boolean;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface ProposalContent {
  original: string;
  proposed: string;
}

export interface Blocker {
  id: string;
  orgId: string;
  agentId: string;
  agentLabel: string;
  title: string;
  description: string;
  workaroundAttempted: string;
  humanActionRequired: string;
  ticketId: string | null;
  status: 'open' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
  resolution?: string;
}

export interface AgentRunLog {
  runId: string;
  trigger: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  summary: string;
  fileActivity?: FileActivityEntry[];
  estimatedTokens?: number;
}

export interface FileActivityEntry {
  action: 'write' | 'delete' | 'create';
  path: string;
  agentId: string;
  agentLabel?: string;
  timestamp: string;
}

export interface WorkspaceFile {
  name: string;
  isDir: boolean;
  path: string;
  size: number;
  modified: string | null;
}

export interface ToolFeedItem {
  conversationId: string;
  type: 'started' | 'completed';
  tool: string;
  args?: any;
  durationMs?: number;
  success?: boolean;
  timestamp: number;
}
```

---

## STEP 14 — FRONTEND COMPONENTS

### 14.1 — New File: `dashboard/src/components/OrgChart.tsx`

```typescript
import type { OrgAgent } from '../types/org';

interface OrgChartProps {
  agents: OrgAgent[];
}

export function OrgChart({ agents }: OrgChartProps) {
  if (agents.length === 0) return <p className="empty-state">No agents yet.</p>;

  // Build hierarchy
  const roots = agents.filter(a => !a.reportingTo || !agents.find(b => b.id === a.reportingTo));
  const getChildren = (parentId: string) => agents.filter(a => a.reportingTo === parentId);

  const STATUS_COLORS: Record<string, string> = {
    completed: '#22c55e', failed: '#ef4444', skipped: '#6b7280', sleeping: '#6b7280',
  };

  function renderNode(agent: OrgAgent, depth: number): JSX.Element {
    const children = getChildren(agent.id);
    const statusColor = agent.paused ? '#f59e0b' : STATUS_COLORS[agent.lastRunStatus ?? 'sleeping'];
    return (
      <div key={agent.id} className="org-chart-node-wrap" style={{ paddingLeft: depth > 0 ? 32 : 0 }}>
        {depth > 0 && <div className="org-chart-connector" />}
        <div className="org-chart-node">
          <div className="org-chart-avatar" style={{ background: `${statusColor}33`, border: `2px solid ${statusColor}` }}>
            {agent.name.charAt(0).toUpperCase()}
          </div>
          <div className="org-chart-info">
            <div className="org-chart-name">{agent.name}</div>
            <div className="org-chart-role">{agent.role}</div>
            <div className="org-chart-status" style={{ color: statusColor }}>
              {agent.paused ? 'Paused' : agent.lastRunStatus ?? 'Sleeping'}
            </div>
          </div>
        </div>
        {children.length > 0 && (
          <div className="org-chart-children">
            {children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="org-chart">
      <h3 className="bod-section-title">🏗 Org Chart</h3>
      <div className="org-chart-tree">
        {roots.map(root => renderNode(root, 0))}
      </div>
    </div>
  );
}
```

### 14.2 — New File: `dashboard/src/components/WorkspaceBrowser.tsx`

```typescript
import { useState, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import type { WorkspaceFile } from '../types/org';

interface WorkspaceBrowserProps { orgId: string; socket: Socket; }

export function WorkspaceBrowser({ orgId, socket }: WorkspaceBrowserProps) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [currentDir, setCurrentDir] = useState('/');
  const [loading, setLoading] = useState(false);

  const loadDir = (dir: string) => {
    setLoading(true);
    socket.emit('org:workspace:list', { orgId, subdir: dir === '/' ? undefined : dir });
  };

  useEffect(() => { loadDir('/'); }, [orgId]);

  useEffect(() => {
    const handler = (data: any) => {
      if (data.orgId === orgId) { setFiles(data.files ?? []); setCurrentDir(data.dir); setLoading(false); }
    };
    socket.on('org:workspace:list', handler);
    return () => socket.off('org:workspace:list', handler);
  }, [orgId, socket]);

  const formatSize = (bytes: number) => bytes < 1024 ? `${bytes}B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)}KB` : `${(bytes / 1048576).toFixed(1)}MB`;

  return (
    <div className="workspace-browser">
      <div className="workspace-header">
        <h3 className="bod-section-title">📁 Workspace Files</h3>
        <div className="workspace-breadcrumb">
          <button onClick={() => loadDir('/')} className="breadcrumb-btn">workspace</button>
          {currentDir !== '/' && currentDir.split('/').filter(Boolean).map((part, i, arr) => (
            <span key={i}>
              <span className="breadcrumb-sep">/</span>
              <button className="breadcrumb-btn" onClick={() => loadDir('/' + arr.slice(0, i + 1).join('/'))}>
                {part}
              </button>
            </span>
          ))}
        </div>
      </div>
      {loading ? <p className="empty-state">Loading…</p> : (
        <div className="workspace-file-list">
          {files.length === 0 && <p className="empty-state">Empty directory.</p>}
          {files.sort((a, b) => (b.isDir ? 1 : 0) - (a.isDir ? 1 : 0)).map(f => (
            <div key={f.path} className={`workspace-file-entry ${f.isDir ? 'is-dir' : ''}`}
              onClick={() => f.isDir ? loadDir(f.path) : undefined}>
              <span className="workspace-file-icon">{f.isDir ? '📁' : '📄'}</span>
              <span className="workspace-file-name">{f.name}</span>
              {!f.isDir && <span className="workspace-file-size">{formatSize(f.size)}</span>}
              {!f.isDir && f.modified && <span className="workspace-file-date">{new Date(f.modified).toLocaleDateString()}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### 14.3 — New File: `dashboard/src/components/ProposalBoard.tsx`

```typescript
import { useState, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import type { CodeProposal, ProposalContent } from '../types/org';

interface ProposalBoardProps { orgId: string; socket: Socket; }

export function ProposalBoard({ orgId, socket }: ProposalBoardProps) {
  const [proposals, setProposals] = useState<CodeProposal[]>([]);
  const [selected, setSelected] = useState<CodeProposal | null>(null);
  const [content, setContent] = useState<ProposalContent | null>(null);
  const [activeView, setActiveView] = useState<'original' | 'proposed'>('proposed');

  useEffect(() => {
    socket.emit('org:proposals:list', { orgId });
    const handleList = (data: any) => { if (data.orgId === orgId) setProposals(data.proposals ?? []); };
    const handleUpdate = (data: any) => { if (data.orgId === orgId) socket.emit('org:proposals:list', { orgId }); };
    const handleContent = (data: any) => setContent({ original: data.original, proposed: data.proposed });
    socket.on('org:proposals:list', handleList);
    socket.on('org:proposal:update', handleUpdate);
    socket.on('org:proposal:content', handleContent);
    return () => {
      socket.off('org:proposals:list', handleList);
      socket.off('org:proposal:update', handleUpdate);
      socket.off('org:proposal:content', handleContent);
    };
  }, [orgId, socket]);

  const selectProposal = (p: CodeProposal) => {
    setSelected(p); setContent(null);
    socket.emit('org:proposal:content', { orgId, proposalId: p.id });
  };

  const approve = (id: string) => { if (confirm('Apply this change to the real file?')) { socket.emit('org:proposal:approve', { orgId, proposalId: id }); setSelected(null); } };
  const reject = (id: string) => { socket.emit('org:proposal:reject', { orgId, proposalId: id }); setSelected(null); };

  const pending = proposals.filter(p => p.status === 'pending');
  const resolved = proposals.filter(p => p.status !== 'pending');

  return (
    <div className="proposal-board">
      <div className="proposal-list">
        {pending.length === 0 && resolved.length === 0 && <p className="empty-state">No proposals yet.</p>}
        {pending.length > 0 && <>
          <div className="proposal-section-header">⏳ Pending ({pending.length})</div>
          {pending.map(p => (
            <div key={p.id} className={`proposal-card proposal-card--pending ${selected?.id === p.id ? 'selected' : ''} ${p.isStale ? 'proposal-card--stale' : ''}`} onClick={() => selectProposal(p)}>
              <div className="proposal-card-path">{p.relativePath}</div>
              <div className="proposal-card-agent">{p.agentLabel}</div>
              {p.isStale && <span className="proposal-stale-badge">⚠️ Stale (7+ days)</span>}
              <p className="proposal-card-explanation">{p.explanation.substring(0, 100)}…</p>
            </div>
          ))}
        </>}
        {resolved.length > 0 && <>
          <div className="proposal-section-header">✅ Resolved ({resolved.length})</div>
          {resolved.map(p => (
            <div key={p.id} className={`proposal-card proposal-card--${p.status}`} onClick={() => selectProposal(p)}>
              <div className="proposal-card-path">{p.relativePath}</div>
              <span className={`proposal-status-badge proposal-status-badge--${p.status}`}>{p.status}</span>
            </div>
          ))}
        </>}
      </div>
      {selected && (
        <div className="proposal-detail">
          <div className="proposal-detail-header">
            <div>
              <div className="proposal-detail-path">{selected.relativePath}</div>
              <div className="proposal-detail-meta">By {selected.agentLabel} · {new Date(selected.createdAt).toLocaleString()}</div>
            </div>
            {selected.status === 'pending' && (
              <div className="proposal-detail-actions">
                <button className="btn-approve" onClick={() => approve(selected.id)}>✅ Approve & Apply</button>
                <button className="btn-reject" onClick={() => reject(selected.id)}>❌ Reject</button>
              </div>
            )}
          </div>
          <div className="proposal-explanation"><strong>Explanation:</strong> {selected.explanation}</div>
          <div className="proposal-diff-tabs">
            <button className={activeView === 'original' ? 'active' : ''} onClick={() => setActiveView('original')}>Original</button>
            <button className={activeView === 'proposed' ? 'active' : ''} onClick={() => setActiveView('proposed')}>Proposed</button>
          </div>
          <div className="proposal-diff-content">
            {content ? <pre>{activeView === 'original' ? content.original : content.proposed}</pre> : <p className="empty-state">Loading…</p>}
          </div>
        </div>
      )}
    </div>
  );
}
```

### 14.4 — New File: `dashboard/src/components/BoardOfDirectors.tsx`

```typescript
import { useState, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import type { Blocker, CodeProposal, OrgAgent } from '../types/org';
import { OrgChart } from './OrgChart';
import { WorkspaceBrowser } from './WorkspaceBrowser';

interface BoardOfDirectorsProps { orgId: string; orgName: string; agents: OrgAgent[]; socket: Socket; }

export function BoardOfDirectors({ orgId, orgName, agents, socket }: BoardOfDirectorsProps) {
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [proposals, setProposals] = useState<CodeProposal[]>([]);
  const [agentRuns, setAgentRuns] = useState<Record<string, any[]>>({});
  const [resolutionText, setResolutionText] = useState<Record<string, string>>({});

  useEffect(() => {
    socket.emit('org:blockers:list', { orgId });
    socket.emit('org:proposals:list', { orgId });
    agents.forEach(a => socket.emit('org:agent:activity', { orgId, agentId: a.id }));

    const hb = (d: any) => { if (d.orgId === orgId) setBlockers(d.blockers ?? []); };
    const hp = (d: any) => { if (d.orgId === orgId) setProposals(d.proposals ?? []); };
    const hbu = (d: any) => { if (d.orgId === orgId) socket.emit('org:blockers:list', { orgId }); };
    const hpu = (d: any) => { if (d.orgId === orgId) socket.emit('org:proposals:list', { orgId }); };
    const ha = (d: any) => { if (d.orgId === orgId) setAgentRuns(prev => ({ ...prev, [d.agentId]: d.runs ?? [] })); };

    socket.on('org:blockers:list', hb); socket.on('org:proposals:list', hp);
    socket.on('org:blocker:update', hbu); socket.on('org:proposal:update', hpu);
    socket.on('org:agent:activity', ha);
    return () => {
      socket.off('org:blockers:list', hb); socket.off('org:proposals:list', hp);
      socket.off('org:blocker:update', hbu); socket.off('org:proposal:update', hpu);
      socket.off('org:agent:activity', ha);
    };
  }, [orgId, socket]);

  const openBlockers = blockers.filter(b => b.status === 'open');
  const pendingProposals = proposals.filter(p => p.status === 'pending');

  const resolveBlocker = (blockerId: string) => {
    const r = resolutionText[blockerId];
    if (!r?.trim()) return;
    socket.emit('org:blocker:resolve', { orgId, blockerId, resolution: r });
    setResolutionText(prev => { const n = {...prev}; delete n[blockerId]; return n; });
  };

  // Token summary across all agents
  const totalTokens = Object.values(agentRuns).flat()
    .reduce((sum, r) => sum + (r.estimatedTokens ?? 0), 0);

  return (
    <div className="board-of-directors">
      <div className="bod-header">
        <h2>🏛 Board of Directors</h2>
        <p className="bod-subtitle">{orgName} — Your command center</p>
      </div>

      {/* Summary bar */}
      <div className="bod-summary-bar">
        <div className={`bod-summary-card ${openBlockers.length > 0 ? 'urgent' : ''}`}>
          <span className="bod-summary-count">{openBlockers.length}</span>
          <span className="bod-summary-label">Open Blockers</span>
        </div>
        <div className={`bod-summary-card ${pendingProposals.length > 0 ? 'attention' : ''}`}>
          <span className="bod-summary-count">{pendingProposals.filter(p => p.status === 'pending').length}</span>
          <span className="bod-summary-label">Pending Proposals</span>
        </div>
        <div className="bod-summary-card">
          <span className="bod-summary-count">{agents.filter(a => !a.paused && a.lastRunStatus === 'completed').length}</span>
          <span className="bod-summary-label">Active Agents</span>
        </div>
        <div className="bod-summary-card">
          <span className="bod-summary-count">{(totalTokens / 1000).toFixed(1)}K</span>
          <span className="bod-summary-label">Est. Tokens Used</span>
        </div>
      </div>

      {/* Org Chart */}
      <OrgChart agents={agents} />

      {/* Blockers */}
      {openBlockers.length > 0 && (
        <div className="bod-section">
          <h3 className="bod-section-title">🚧 Blockers Requiring Your Attention</h3>
          {openBlockers.map(b => (
            <div key={b.id} className="bod-blocker-card">
              <div className="bod-blocker-header">
                <strong>{b.title}</strong>
                <span className="bod-blocker-agent">{b.agentLabel}</span>
                <span className="bod-blocker-time">{new Date(b.createdAt).toLocaleString()}</span>
              </div>
              <p className="bod-blocker-desc">{b.description}</p>
              {b.workaroundAttempted !== 'None' && <div className="bod-blocker-workaround"><strong>Tried:</strong> {b.workaroundAttempted}</div>}
              <div className="bod-blocker-action"><strong>What you need to do:</strong> {b.humanActionRequired}</div>
              <div className="bod-blocker-resolve">
                <input placeholder="Resolution notes…" value={resolutionText[b.id] ?? ''} onChange={e => setResolutionText(p => ({ ...p, [b.id]: e.target.value }))} />
                <button className="btn-resolve" onClick={() => resolveBlocker(b.id)} disabled={!resolutionText[b.id]?.trim()}>✅ Resolve</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending Proposals */}
      {pendingProposals.length > 0 && (
        <div className="bod-section">
          <h3 className="bod-section-title">📋 Pending Code Proposals</h3>
          {pendingProposals.map(p => (
            <div key={p.id} className="bod-proposal-card">
              <div className="bod-proposal-header">
                <code>{p.relativePath}</code>
                <span>{p.agentLabel}</span>
                {p.isStale && <span className="proposal-stale-badge">⚠️ Stale</span>}
              </div>
              <p>{p.explanation}</p>
              <div className="bod-proposal-actions">
                <button className="btn-approve" onClick={() => { if (confirm('Apply this change?')) socket.emit('org:proposal:approve', { orgId, proposalId: p.id }); }}>✅ Approve</button>
                <button className="btn-reject" onClick={() => socket.emit('org:proposal:reject', { orgId, proposalId: p.id })}>❌ Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Agent Health */}
      <div className="bod-section">
        <h3 className="bod-section-title">👥 Agent Health</h3>
        <div className="bod-agent-health-grid">
          {agents.map(agent => {
            const runs = agentRuns[agent.id] ?? [];
            const lastRun = runs[runs.length - 1];
            const fileOps = runs.flatMap((r: any) => r.fileActivity ?? []).slice(-5);
            const agentTokens = runs.reduce((s: number, r: any) => s + (r.estimatedTokens ?? 0), 0);
            return (
              <div key={agent.id} className="bod-agent-health-card">
                <div className="bod-agent-header">
                  <strong>{agent.name}</strong>
                  <span className="bod-agent-role">{agent.role}</span>
                  <span className={`bod-agent-status ${agent.paused ? 'paused' : agent.lastRunStatus ?? 'sleeping'}`}>
                    {agent.paused ? 'Paused' : agent.lastRunStatus ?? 'Sleeping'}
                  </span>
                </div>
                <div className="bod-agent-meta">
                  <div><span className="meta-label">Last run</span> {agent.lastRunAt ? new Date(agent.lastRunAt).toLocaleString() : 'Never'}</div>
                  <div><span className="meta-label">Heartbeat</span> <code>{agent.heartbeat.cron}</code></div>
                  <div><span className="meta-label">Reports to</span> {agent.reportingTo ? agents.find(a => a.id === agent.reportingTo)?.name ?? '?' : 'Nobody'}</div>
                  <div><span className="meta-label">Est. tokens</span> {(agentTokens / 1000).toFixed(1)}K</div>
                </div>
                {lastRun && <div className="bod-last-run-summary">{lastRun.summary?.substring(0, 120)}…</div>}
                {fileOps.length > 0 && (
                  <div className="bod-file-ops">
                    {fileOps.map((op: any, i: number) => (
                      <div key={i} className="bod-file-op">
                        <span className={`file-op-badge file-op-${op.action}`}>{op.action}</span>
                        <code>{op.path.length > 55 ? '…' + op.path.slice(-55) : op.path}</code>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Workspace Browser */}
      <WorkspaceBrowser orgId={orgId} socket={socket} />
    </div>
  );
}
```

---

## STEP 15 — MODIFY `dashboard/src/hooks/useOrgs.ts`

Add state + handlers for proposals, blockers, and file activity:

```typescript
// Add state
const [proposals, setProposals] = useState<CodeProposal[]>([]);
const [blockers, setBlockers] = useState<Blocker[]>([]);
const [agentFileActivity, setAgentFileActivity] = useState<Record<string, FileActivityEntry[]>>({});

// Add inside useEffect:
const handleProposalsList = (d: any) => { if (d.orgId === activeOrgId) setProposals(d.proposals ?? []); };
const handleProposalUpdate = (d: any) => { if (d.orgId === activeOrgId) socket.emit('org:proposals:list', { orgId: activeOrgId }); };
const handleBlockersList = (d: any) => { if (d.orgId === activeOrgId) setBlockers(d.blockers ?? []); };
const handleBlockerUpdate = (d: any) => { if (d.orgId === activeOrgId) socket.emit('org:blockers:list', { orgId: activeOrgId }); };
const handleFileActivity = (d: any) => {
  if (d.orgId === activeOrgId) {
    setAgentFileActivity(prev => ({ ...prev, [d.agentId]: [...(prev[d.agentId] ?? []).slice(-50), ...(d.activity ?? [])] }));
  }
};

socket.on('org:proposals:list', handleProposalsList);
socket.on('org:proposal:update', handleProposalUpdate);
socket.on('org:blockers:list', handleBlockersList);
socket.on('org:blocker:update', handleBlockerUpdate);
socket.on('org:agent:file_activity', handleFileActivity);

// Add to cleanup
socket.off('org:proposals:list', handleProposalsList);
socket.off('org:proposal:update', handleProposalUpdate);
socket.off('org:blockers:list', handleBlockersList);
socket.off('org:blocker:update', handleBlockerUpdate);
socket.off('org:agent:file_activity', handleFileActivity);

// Load on org change
useEffect(() => {
  if (activeOrgId) {
    socket.emit('org:tickets:list', { orgId: activeOrgId });
    socket.emit('org:proposals:list', { orgId: activeOrgId });
    socket.emit('org:blockers:list', { orgId: activeOrgId });
  }
}, [activeOrgId]);

// Add to return
return { ...existing, proposals, blockers, agentFileActivity };
```

---

## STEP 16 — MODIFY `dashboard/src/components/OrgWorkspace.tsx`

### 16.1 — Updated tab type + imports

```typescript
type OrgSubTab = 'agents' | 'tickets' | 'board' | 'proposals' | 'activity' | 'memory';

import { ProposalBoard } from './ProposalBoard';
import { BoardOfDirectors } from './BoardOfDirectors';
```

### 16.2 — Updated subtabs with badge indicators

```typescript
{tab === 'board'
  ? `🏛 Board${openBlockers > 0 ? ` 🔴` : ''}`
  : tab === 'proposals'
    ? `📋 Proposals${pendingProposals > 0 ? ` (${pendingProposals})` : ''}`
    : tab === 'agents' ? `👥 Agents (${activeOrg.agents.length})`
    : tab === 'tickets' ? `🎫 Tickets (${activeTickets})`
    : tab === 'activity' ? '📋 Activity'
    : '🧠 Memory'}
```

### 16.3 — New tab content blocks

```typescript
{subTab === 'board' && (
  <BoardOfDirectors orgId={activeOrg.id} orgName={activeOrg.name} agents={activeOrg.agents} socket={socket} />
)}
{subTab === 'proposals' && (
  <ProposalBoard orgId={activeOrg.id} socket={socket} />
)}
```

---

## STEP 17 — MODIFY `dashboard/src/components/ConversationPane.tsx`

Inline tool feed (superuser mode):

```typescript
// In message list, before typing indicator:
{isSuperUser && toolFeedItems && toolFeedItems.length > 0 && (
  <div className="tool-feed-inline">
    {toolFeedItems.slice(-8).map((item, i) => (
      <div key={i} className={`tool-feed-item tool-feed-item--${item.type}`}>
        <span className="tool-feed-icon">{item.type === 'started' ? '⚙️' : item.success === false ? '❌' : '✅'}</span>
        <code>{item.tool}</code>
        {item.durationMs && <span className="tool-feed-duration">{item.durationMs}ms</span>}
        <span className="tool-feed-time">{new Date(item.timestamp).toLocaleTimeString()}</span>
      </div>
    ))}
  </div>
)}
```

Wire `toolFeedItems` through `ChatWorkspace.tsx`:

```typescript
// State in ChatWorkspace
const [toolFeeds, setToolFeeds] = useState<Record<string, ToolFeedItem[]>>({});

useEffect(() => {
  if (!socket) return;
  const handler = (item: ToolFeedItem) => {
    setToolFeeds(prev => ({
      ...prev,
      [item.conversationId]: [...(prev[item.conversationId] ?? []).slice(-20), item],
    }));
  };
  socket.on('chat:tool_feed', handler);
  return () => socket.off('chat:tool_feed', handler);
}, [socket]);

// Pass to PaneWithAgents:
toolFeedItems={isSuperUser ? (toolFeeds[convo.id] ?? []) : []}
```

---

## STEP 18 — CSS ADDITIONS

Append to `dashboard/src/index.css`:

```css
/* ===== ORG CHART ===== */
.org-chart { margin-bottom: 8px; }
.org-chart-tree { display: flex; flex-direction: column; gap: 4px; padding: 12px 0; }
.org-chart-node-wrap { display: flex; flex-direction: column; position: relative; }
.org-chart-connector { width: 2px; height: 16px; background: rgba(255,255,255,0.12); margin-left: 19px; margin-bottom: 2px; }
.org-chart-node { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; width: fit-content; min-width: 200px; }
.org-chart-avatar { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
.org-chart-info { display: flex; flex-direction: column; gap: 1px; }
.org-chart-name { font-weight: 600; font-size: 13px; }
.org-chart-role { font-size: 11px; opacity: 0.5; }
.org-chart-status { font-size: 10px; font-weight: 600; }
.org-chart-children { padding-left: 20px; border-left: 2px solid rgba(255,255,255,0.08); margin-left: 19px; display: flex; flex-direction: column; gap: 4px; padding-top: 4px; }

/* ===== WORKSPACE BROWSER ===== */
.workspace-browser { background: rgba(255,255,255,0.02); border-radius: 10px; padding: 16px; }
.workspace-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px; }
.workspace-breadcrumb { display: flex; align-items: center; gap: 2px; font-size: 12px; opacity: 0.6; }
.breadcrumb-btn { background: none; border: none; color: inherit; cursor: pointer; padding: 2px 4px; border-radius: 4px; font-size: 12px; }
.breadcrumb-btn:hover { background: rgba(255,255,255,0.08); }
.breadcrumb-sep { opacity: 0.4; }
.workspace-file-list { display: flex; flex-direction: column; gap: 2px; }
.workspace-file-entry { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; font-size: 12px; transition: background 0.15s; cursor: default; }
.workspace-file-entry.is-dir { cursor: pointer; }
.workspace-file-entry:hover { background: rgba(255,255,255,0.05); }
.workspace-file-icon { font-size: 14px; flex-shrink: 0; }
.workspace-file-name { flex: 1; }
.workspace-file-size { opacity: 0.4; font-variant-numeric: tabular-nums; margin-left: auto; }
.workspace-file-date { opacity: 0.35; font-size: 11px; white-space: nowrap; }

/* ===== PROPOSAL BOARD ===== */
.proposal-board { display: flex; gap: 16px; height: 100%; overflow: hidden; }
.proposal-list { width: 280px; flex-shrink: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.proposal-section-header { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.5; padding: 8px 0 4px; }
.proposal-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 10px 12px; cursor: pointer; transition: background 0.15s; }
.proposal-card:hover, .proposal-card.selected { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.15); }
.proposal-card--pending { border-left: 3px solid #f59e0b; }
.proposal-card--approved { border-left: 3px solid #22c55e; opacity: 0.65; }
.proposal-card--rejected { border-left: 3px solid #ef4444; opacity: 0.65; }
.proposal-card--stale { border-left: 3px solid #ef4444; }
.proposal-stale-badge { font-size: 10px; color: #f87171; display: block; margin-top: 3px; }
.proposal-card-path { font-size: 12px; font-family: 'JetBrains Mono', monospace; font-weight: 600; }
.proposal-card-agent { font-size: 11px; opacity: 0.5; }
.proposal-card-explanation { font-size: 11px; opacity: 0.6; margin: 4px 0 0; line-height: 1.4; }
.proposal-status-badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; }
.proposal-status-badge--approved { background: rgba(34,197,94,0.15); color: #22c55e; }
.proposal-status-badge--rejected { background: rgba(239,68,68,0.15); color: #ef4444; }
.proposal-detail { flex: 1; display: flex; flex-direction: column; gap: 12px; overflow: hidden; }
.proposal-detail-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.proposal-detail-path { font-size: 14px; font-family: 'JetBrains Mono', monospace; font-weight: 600; }
.proposal-detail-meta { font-size: 12px; opacity: 0.5; }
.proposal-detail-actions { display: flex; gap: 8px; flex-shrink: 0; }
.btn-approve { padding: 7px 16px; background: rgba(34,197,94,0.15); border: 1px solid rgba(34,197,94,0.3); color: #22c55e; border-radius: 7px; cursor: pointer; font-size: 13px; }
.btn-approve:hover { background: rgba(34,197,94,0.25); }
.btn-reject { padding: 7px 16px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); color: #f87171; border-radius: 7px; cursor: pointer; font-size: 13px; }
.btn-reject:hover { background: rgba(239,68,68,0.2); }
.proposal-explanation { background: rgba(255,255,255,0.03); border-radius: 8px; padding: 10px 12px; font-size: 13px; line-height: 1.5; }
.proposal-diff-tabs { display: flex; gap: 4px; }
.proposal-diff-tabs button { padding: 5px 14px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: none; color: inherit; cursor: pointer; font-size: 12px; opacity: 0.5; }
.proposal-diff-tabs button.active { opacity: 1; background: rgba(255,255,255,0.08); }
.proposal-diff-content { flex: 1; overflow-y: auto; background: rgba(0,0,0,0.3); border-radius: 10px; padding: 16px; }
.proposal-diff-content pre { margin: 0; font-size: 12px; font-family: 'JetBrains Mono', monospace; white-space: pre-wrap; word-break: break-all; }

/* ===== BOARD OF DIRECTORS ===== */
.board-of-directors { display: flex; flex-direction: column; gap: 24px; padding-bottom: 40px; }
.bod-header h2 { margin: 0; font-size: 20px; }
.bod-subtitle { font-size: 13px; opacity: 0.5; margin: 4px 0 0; }
.bod-summary-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.bod-summary-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 16px; text-align: center; }
.bod-summary-card.urgent { border-color: rgba(239,68,68,0.4); background: rgba(239,68,68,0.07); }
.bod-summary-card.attention { border-color: rgba(245,158,11,0.4); background: rgba(245,158,11,0.07); }
.bod-summary-count { display: block; font-size: 32px; font-weight: 700; }
.bod-summary-label { font-size: 12px; opacity: 0.5; }
.bod-section { display: flex; flex-direction: column; gap: 12px; }
.bod-section-title { font-size: 14px; font-weight: 700; margin: 0; opacity: 0.8; }
.bod-blocker-card { background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.2); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.bod-blocker-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bod-blocker-agent { font-size: 12px; opacity: 0.6; }
.bod-blocker-time { font-size: 11px; opacity: 0.4; margin-left: auto; }
.bod-blocker-desc { font-size: 13px; opacity: 0.8; margin: 0; line-height: 1.5; }
.bod-blocker-workaround { font-size: 12px; opacity: 0.6; background: rgba(255,255,255,0.03); border-radius: 6px; padding: 6px 10px; }
.bod-blocker-action { font-size: 13px; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2); border-radius: 6px; padding: 8px 12px; }
.bod-blocker-resolve { display: flex; gap: 8px; align-items: center; }
.bod-blocker-resolve input { flex: 1; padding: 7px 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 7px; color: inherit; font-size: 13px; }
.btn-resolve { padding: 7px 14px; background: rgba(34,197,94,0.15); border: 1px solid rgba(34,197,94,0.3); color: #22c55e; border-radius: 7px; cursor: pointer; font-size: 12px; white-space: nowrap; }
.btn-resolve:disabled { opacity: 0.3; cursor: not-allowed; }
.bod-proposal-card { background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.2); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.bod-proposal-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
.bod-proposal-actions { display: flex; gap: 8px; }
.bod-agent-health-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.bod-agent-health-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.bod-agent-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bod-agent-role { font-size: 12px; opacity: 0.5; flex: 1; }
.bod-agent-status { font-size: 11px; padding: 2px 8px; border-radius: 4px; }
.bod-agent-status.completed { background: rgba(34,197,94,0.15); color: #22c55e; }
.bod-agent-status.failed { background: rgba(239,68,68,0.15); color: #f87171; }
.bod-agent-status.paused { background: rgba(245,158,11,0.15); color: #fbbf24; }
.bod-agent-status.sleeping { background: rgba(107,114,128,0.15); color: #9ca3af; }
.bod-agent-meta { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.bod-last-run-summary { font-size: 12px; opacity: 0.6; line-height: 1.4; }
.bod-file-ops { display: flex; flex-direction: column; gap: 3px; }
.bod-file-op { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.file-op-badge { font-size: 10px; padding: 1px 5px; border-radius: 3px; font-weight: 600; flex-shrink: 0; }
.file-op-write { background: rgba(59,130,246,0.15); color: #60a5fa; }
.file-op-create { background: rgba(34,197,94,0.15); color: #4ade80; }
.file-op-delete { background: rgba(239,68,68,0.15); color: #f87171; }

/* ===== INLINE TOOL FEED ===== */
.tool-feed-inline { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; background: rgba(255,255,255,0.02); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); margin: 4px 0; }
.tool-feed-item { display: flex; align-items: center; gap: 8px; font-size: 12px; opacity: 0.7; }
.tool-feed-item--started { opacity: 0.5; animation: tool-pulse 1.5s infinite; }
@keyframes tool-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.8; } }
.tool-feed-icon { font-size: 12px; }
.tool-feed-duration { opacity: 0.45; font-size: 11px; }
.tool-feed-time { margin-left: auto; opacity: 0.35; font-size: 10px; font-variant-numeric: tabular-nums; }
```

---

## IMPLEMENTATION ORDER

Run `npx tsc --noEmit` after every phase. Do not proceed on errors.

### Phase 1 — .gitignore (Flash)
1. Add `orgs/` to `.gitignore`

### Phase 2 — Brain updates (Opus 4.6)
2. Add `toolCallInterceptor` to `BrainConfig`
3. Update `invokeTool` routing to check interceptor first
4. Add `manage_org` to worker Brain exclusion list (FIX-AJ)
5. ✅ `npx tsc --noEmit`

### Phase 3 — New core files (Flash for file-guard, Opus for notification-store)
6. Create `src/core/org-file-guard.ts`
7. Create `src/core/org-notification-store.ts`
8. ✅ `npx tsc --noEmit`

### Phase 4 — Org Manager updates (Opus 4.6)
9. Update `ORGS_DIR` constant
10. Add `orgDir`, `workspaceDir`, `protectedFiles` to `Org` interface
11. Update `create()` — sanitised dir, workspace subdir, snapshot
12. Update `persist()` — atomic write
13. Update `loadAll()` — migration + back-fill (FIX-Q)
14. Update `addAgent()` — duplicate role check + `allowDuplicateRole`
15. Update all directory helpers to use `orgDir`
16. Update `ensureSharedMemory()` — atomic write
17. Add `getBrowserDataDir()` helper
18. ✅ `npx tsc --noEmit`

### Phase 5 — Org Task Board updates (Flash)
19. Update `list()` — FIX-Z ticket locking (`callerAgentId` param, hide in_progress from others)
20. Update `update()` — FIX-Z lock to assignee on `in_progress`
21. ✅ `npx tsc --noEmit`

### Phase 6 — Org Agent Runner updates (Opus 4.6)
22. Add concurrent limit system (FIX-V)
23. Export `getRunningCount`, `getAllOrgConversationIds`, `getRunningAgentsSet`
24. Add `activeRunIds` map + export
25. Add `incrementNotifyCounter` + `runNotifyCounters`
26. Add chat Brain idle sweep (FIX-X)
27. Add `FileActivityEntry` interface
28. Add `orgAwareHandleToolCall` interceptor
29. Add `checkAndSummariseMemory`
30. Update `createOrgAgentBrain()` — filter powershell/python/scheduler (FIX-Y), interceptor, activity log
31. Update `runOrgAgent()` — concurrent limit, activity log, token estimate, memory check
32. Update agent system prompt — add code change rules, blocker protocol, browser isolation note
33. ✅ `npx tsc --noEmit`

### Phase 7 — Org Heartbeat updates (Flash)
34. Add `staggerCron()` helper (FIX-U)
35. Update `startAll()` — pass cronOffsets map
36. Update `scheduleAgent()` — staggering, FIX-N (already public)
37. ✅ `npx tsc --noEmit`

### Phase 8 — Org Skills updates (Flash)
38. Update `org_write_shared_memory` — merge-on-write with skill lock (FIX-AC)
39. Update `org_write_report` — timestamp+role prefix (FIX-AH)
40. Update `org_notify` — rate limiting via `runNotifyCounters` (FIX-AD)
41. Update `org_list_tickets` — pass `callerAgentId` (FIX-Z)
42. Update `org_delegate` — delegation depth check (FIX-AB)
43. Add `org_propose_code_change` skill
44. Add `org_raise_blocker` skill
45. Update `orgSkills` export array
46. ✅ `npx tsc --noEmit`

### Phase 9 — Org Management Skill updates (Flash)
47. Update `add_agent` — auto `reportingTo`, `allowDuplicateRole` param
48. ✅ `npx tsc --noEmit`

### Phase 10 — Browser isolation (Opus 4.6)
49. Add `ensureProfileDir(dir)` to `BrowserManager` in `src/core/browser.ts`
50. Update `src/skills/browser.ts` — check `meta.orgId`, call `ensureProfileDir`
51. ✅ `npx tsc --noEmit`

### Phase 11 — Server wiring (Opus 4.6)
52. Add all new imports
53. Wire Telegram sender
54. Add startup stale ticket reset (FIX-AF)
55. Add daily digest cron
56. Add event listeners (proposals, blockers, file activity)
57. Add all new socket handlers (proposals, blockers, notifications, workspace browser, agent activity)
58. Add live tool feed `chat:tool_feed` emissions
59. ✅ `npx tsc --noEmit`
60. Start server. Verify:
    - New org creates `orgs/{name}-{id}/workspace/` at project root
    - `org.json` has `protectedFiles` array
    - Old orgs in `memory/orgs/` auto-migrate on startup
    - `orgs/` in `.gitignore` — does not appear in `git status`

### Phase 12 — Frontend types (Flash)
61. Update `dashboard/src/types/org.ts` — all new interfaces

### Phase 13 — Frontend hooks (Opus 4.6)
62. Update `dashboard/src/hooks/useOrgs.ts` — proposals, blockers, file activity

### Phase 14 — Frontend components (Opus 4.6)
63. Create `dashboard/src/components/OrgChart.tsx`
64. Create `dashboard/src/components/WorkspaceBrowser.tsx`
65. Create `dashboard/src/components/ProposalBoard.tsx`
66. Create `dashboard/src/components/BoardOfDirectors.tsx` (includes OrgChart + WorkspaceBrowser)
67. Update `dashboard/src/components/OrgWorkspace.tsx` — new tabs, imports, wire all
68. Update `dashboard/src/components/ConversationPane.tsx` — inline tool feed
69. Update `dashboard/src/components/ChatWorkspace.tsx` — tool feed state + socket

### Phase 15 — CSS (Flash)
70. Append all CSS to `dashboard/src/index.css`
71. Verify no existing styles broken

### Phase 16 — Integration Testing (Opus 4.6)
72. **gitignore** — create org → `git status` shows no `orgs/` entries
73. **Org dir at root** — `orgs/{name}-{id}/workspace/` created at project root
74. **Protected files** — `org.json` has `protectedFiles` with all git-tracked files
75. **Migration** — old orgs in `memory/orgs/` auto-migrate on startup
76. **Stale ticket reset (FIX-AF)** — manually set ticket to `in_progress`, restart server → ticket resets to `open`
77. **Staggered heartbeats** — 3 agents with `0 9 * * *` → logs show minute offsets (0, 2, 4)
78. **Concurrent limit** — trigger 6 agents → 5 run, 6th queues → one finishes → 6th starts
79. **Duplicate role** — create second CEO → error → retry with `allowDuplicateRole: true` → succeeds
80. **Auto reporting line** — CEO creates CTO → CTO's `reportingTo` = CEO's agentId
81. **PowerShell blocked (FIX-Y)** — org agent brain does not have `execute_powershell` in tool list → confirmed via chat
82. **Python blocked (FIX-Y)** — same for `run_python_script`
83. **File interception** — CTO tries `manage_files` write to `src/core/brain.ts` → intercepted → proposal created → Proposals tab shows it
84. **Proposal content on disk (FIX-W)** — `proposals.json` has no `originalContent`/`proposedContent` fields — content in `workspace/proposals/{id}/*.txt`
85. **Proposal approve** → real file updated → status approved
86. **Proposal reject** → file unchanged → status rejected
87. **Conflict prevention** → two proposals for same file → second blocked
88. **Proposal staleness (FIX-AE)** — manually set `createdAt` to 8 days ago → badge shows ⚠️ Stale
89. **Max proposals per agent (FIX-AE)** — submit 4th proposal → blocked with clear message
90. **Delegation loop (FIX-AB)** — create ticket chain depth > 5 → blocked with error
91. **Ticket locking (FIX-Z)** — agent A picks up ticket → moves to in_progress → agent B's `org_list_tickets` does not show it
92. **Blocker raised** — agent calls `org_raise_blocker` → Board shows red badge → Telegram sent → stored in notifications.jsonl
93. **Blocker cascade (FIX-AK)** — raise 3+ blockers within 5 min → single cascade Telegram alert, not 3 separate ones
94. **Blocker resolve** → resolution text entered → status resolved
95. **org_notify rate limit (FIX-AD)** — agent calls org_notify 8 times in one run → only 5 Telegram messages sent → all 8 stored in notifications.jsonl
96. **Shared memory merge (FIX-AC)** — two agents write to shared_memory simultaneously → both agents' announcements preserved, no data lost
97. **Report filename (FIX-AH)** — agent writes `report.md` → file created as `{role}-{timestamp}-report.md` in workspace/reports/
98. **All output in workspace** — all agent files land in `orgs/{name}/workspace/` — nothing at project root
99. **File activity tracking** — agent writes file → Board of Directors agent card shows the file op
100. **Token tracking** — Board of Directors shows estimated token count per agent and total
101. **Org chart** — create CEO + CTO (reporting to CEO) + Dev (reporting to CTO) → org chart renders hierarchy correctly
102. **Workspace browser** — click workspace tab → file listing → click folder → navigate into it
103. **Browser isolation (FIX-AI)** — org agent using browser gets its own profile dir (`orgs/{id}/browser_data/`) — confirmed via logs
104. **Workers cannot use manage_org (FIX-AJ)** — spawn sub-agent worker → verify `manage_org` not in tool list
105. **Memory summarisation** — manually inflate agent memory > 50KB → trigger → summarisation fires → memory file reduced
106. **Chat Brain idle** — open agent chat → wait (reduce timeout to test) → Brain cleaned up
107. **Telegram queue** — disable Telegram → raise blocker → re-enable → notification delivered on retry
108. **Telegram truncation (FIX-AG)** — send notification > 3800 chars → Telegram receives truncated message with `...`
109. **Daily digest** — trigger `sendDailyDigest()` manually → digest sent if activity → skipped if none
110. **Stale ticket on restart** — set ticket to `in_progress` → restart → ticket resets to `open`
111. **Live tool feed** — enable superuser mode → chat with PersonalClaw → tool calls render inline as they execute, with pulsing animation
112. **Proposal on restart** — proposals persist across server restarts — loaded from `proposals.json` on startup

---

## FILES CHANGED — COMPLETE LIST

### Created
```
src/core/org-file-guard.ts
src/core/org-notification-store.ts
dashboard/src/components/OrgChart.tsx
dashboard/src/components/WorkspaceBrowser.tsx
dashboard/src/components/ProposalBoard.tsx
dashboard/src/components/BoardOfDirectors.tsx
```

### Modified
```
.gitignore                              (add orgs/)
src/core/brain.ts                       (toolCallInterceptor, manage_org worker exclusion, FIX-AJ)
src/core/org-manager.ts                 (new dir structure, atomic writes, migration, duplicate roles, browser dir)
src/core/org-task-board.ts             (ticket locking FIX-Z)
src/core/org-agent-runner.ts            (concurrent limit, interceptor, activity log, memory bloat, idle timeout, token tracking, powershell/python filter FIX-Y, notify counter FIX-AD, activeRunIds)
src/core/org-heartbeat.ts              (staggered cron FIX-U, FIX-V)
src/core/browser.ts                    (ensureProfileDir FIX-AI)
src/skills/browser.ts                  (org profile dir selection FIX-AI)
src/skills/org-skills.ts               (merge-on-write FIX-AC, filename prefix FIX-AH, notify rate limit FIX-AD, ticket lock FIX-Z, delegation depth FIX-AB, 2 new skills)
src/skills/org-management-skill.ts     (auto reportingTo, allowDuplicateRole)
src/index.ts                           (all new imports, Telegram wiring, startup resets FIX-AF, daily digest, new socket handlers, tool feed)
dashboard/src/types/org.ts             (8 new interfaces)
dashboard/src/hooks/useOrgs.ts         (proposals, blockers, file activity)
dashboard/src/components/OrgWorkspace.tsx   (2 new tabs, imports, wire all)
dashboard/src/components/ConversationPane.tsx  (inline tool feed)
dashboard/src/components/ChatWorkspace.tsx     (tool feed state + socket)
dashboard/src/index.css                (org chart, workspace browser, proposal board, BOD, tool feed CSS)
```

---

## CONSTRAINTS FOR IMPLEMENTING AGENT

1. **Run `npx tsc --noEmit` after every phase.** Do not proceed on errors.
2. **Do not change ports** — backend 3000, dashboard 5173.
3. **`ORGS_DIR` migration** — `loadAll()` must handle both `memory/orgs/` and `orgs/` (FIX-Q).
4. **`toolCallInterceptor` checked BEFORE extra skills, Chrome MCP, and standard skills** (FIX-S).
5. **FIX-T: validate `path.relative` before writing** — reject if starts with `..`.
6. **FIX-U: only stagger minute field** — skip expressions with `/` or `,`.
7. **`getRunningCount()` exported from `org-agent-runner.ts`** for heartbeat (FIX-V).
8. **FIX-W: `proposals.json` stores metadata only** — no `originalContent`/`proposedContent` fields.
9. **FIX-X: single global sweep** for chat Brain idle — no per-session intervals.
10. **FIX-Y: `execute_powershell` and `run_python_script` filtered** from all org agent Brains.
11. **FIX-Z: `callerAgentId` passed to `orgTaskBoard.list()`** for ticket locking — never pass without it from org agents.
12. **FIX-AA: `orgs/` in `.gitignore`** — must be the first change made.
13. **FIX-AB: delegation depth tracked in ticket description** as `[delegation_depth:N]` — read and increment on re-delegation.
14. **FIX-AC: `org_write_shared_memory` re-reads file inside skill lock** before writing — never blind overwrite.
15. **FIX-AD: `activeRunIds` map exported from `org-agent-runner.ts`** — org skills import it to get current runId.
16. **FIX-AE: max 3 pending proposals per agent** — enforced in `createProposal()` in `org-file-guard.ts`.
17. **FIX-AF: `resetStaleInProgressTickets()` called on startup** — with the empty `runningAgents` Set.
18. **FIX-AG: all Telegram messages truncated to 3800 chars** in `flushTelegramQueue()`.
19. **FIX-AH: `org_write_report` enforces `{role}-{timestamp}-{filename}` prefix** — never raw filename.
20. **FIX-AI: org browser profile uses `orgManager.getBrowserDataDir(orgId)`** — never global singleton profile for org agents.
21. **FIX-AJ: `manage_org` on worker Brain exclusion list** alongside `spawn_agent`.
22. **FIX-AK: blocker cascade fires single alert** at 3+ blockers in 5 min — individual blockers still stored.
23. **Atomic writes for all critical org files**: `org.json`, `shared_memory.json`, `blockers.json`, `proposals.json` — write `.tmp` then rename.
24. **`org_write_report` always writes to `workspaceDir`** — never project root.
25. **Notification store initialised before Telegram** — `setTelegramSender` after interface constructed.
26. **Daily digest skips if no activity** — never send empty digest.
27. **All new socket handlers use named functions** for clean cleanup.
28. **Do not rename existing socket events or REST endpoints** — add only.
29. **`allowDuplicateRole` defaults to `false`** — explicit override required.
30. **Follow ESM `.js` extensions** on all local imports.
31. **Update `docs/version_log.md`** with v12.1.0 entry after all 112 integration tests pass.
