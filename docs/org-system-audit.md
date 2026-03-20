# Organization System Audit — 2026-03-20

Comprehensive review of the virtual employees (org) system covering backend logic, frontend UX, ticket management, agent execution, and data integrity.

---

## CRITICAL ISSUES

### 1. Ticket Board is Barely Usable
- **No drag-and-drop** between columns — must open detail modal to change status. Very cumbersome.
- **No ticket search/filter** — must visually scan to find tickets.
- **No due dates or deadlines** — tickets have no SLA enforcement.
- **No priority editing** after creation — priority is set-and-forget.
- **No ticket dependencies** — can't say "ticket X blocks ticket Y".
- **Description is read-only** in detail view — can't edit after creation.
- **Done column grows forever** — no archive/hide for completed tickets.
- **No bulk operations** — can't multi-select to assign, close, or delete.
- **No "created by" indicator** — can't tell human-created vs agent-created tickets.
- **Whitespace-only comments accepted** — no input trimming.

### 2. Ticket Auto-Assignment Race Condition
- **Location:** `org-task-board.ts:172-184`
- Two agents can simultaneously check `assigneeId === null` (both true), both assign themselves. Write lock prevents file corruption but second agent doesn't know they failed — they think they own the ticket.

### 3. Chat Brain Concurrency Bug
- **Location:** `org-agent-runner.ts:462-470`
- Persistent chat Brain instances have no lock. Two simultaneous messages to same agent could both modify the brain concurrently, causing unpredictable behavior.

### 4. No Socket Authentication
- **Location:** `src/index.ts:463+`
- Any socket client can create/delete orgs, trigger agents, approve proposals. No JWT, session, or API key validation.

### 5. Chat History Lost on Refresh
- Messages only exist in React component state (`useOrgChat`). Page refresh = total history loss. Server-side Brain stores context but frontend can't recover it.

---

## HIGH PRIORITY ISSUES

### 6. Agent Card Missing Critical Info
- **Last run failure reason** not shown — if agent failed, no details visible without checking logs.
- **Goals not displayed** — must open edit modal to see them.
- **Responsibilities truncated** at 140 chars with no expand option.
- **No performance metrics** — no success rate, avg run time, or token trends.

### 7. Agent Form Validation Gaps
- **No cron syntax validation** in CreateAgentModal or EditAgentModal — invalid cron only caught by backend.
- **Circular reporting allowed** — Agent A → B → C → A creates loop, no cycle detection.
- **Duplicate agent names allowed** — confusing in logs and UI.
- **No input length limits** — personality/responsibilities can be 100KB with no warning.

### 8. Workspace File Editor Problems
- **No real-time updates** — if agent writes a file, UI doesn't update until manual refresh.
- **No conflict detection** — human and agent can edit same file simultaneously, last write wins.
- **Binary files not detected** — opens garbage in textarea.
- **No auto-save or unsaved changes warning** — close tab = lost work.
- **No line numbers** in editor.
- **Comment author hardcoded to "Human"** — no multi-user distinction.

### 9. Proposal Board Gaps
- **No side-by-side diff view** — shows original OR proposed, not both simultaneously.
- **No staging/preview** before approval — writes directly to disk.
- **No revert after approval** — if change breaks something, must manually fix.
- **Stale proposals (7+ days) not highlighted enough** — easy to approve outdated changes.
- **Code proposals and review submissions mixed** in same list — confusing.
- **No approval comments** — no audit trail of why reviewer approved.

### 10. Board of Directors Misleading Data
- **"Active agents" miscounted** — counts agents where `!paused && lastRunStatus === 'completed'`, which only counts agents that finished last run, not currently running ones.
- **Token estimate very rough** — `response.length / 4` doesn't account for tool calls or images.
- **No time context** for token usage — is this all-time? Today? This month?
- **File activity limited to last 5** — hides earlier operations without indication.
- **No agent sorting** — grid shows agents in array order with no sort options.
- **No real-time updates** — must manually refresh to see new data.

### 11. Memory System Fragility
- **No conflict resolution** for shared memory — two agents appending same item = duplicates.
- **Unbounded array growth** — shared memory decisions/announcements grow forever.
- **No field validation** — agents can write arbitrary JSON structure.
- **Summarization failure** corrupts memory (fails silently, leaves bloated file).

### 12. Notification System Double-Sends
- **Location:** `org-notification-store.ts:54-67`
- Blocker cascade detection sends BOTH cascade notification AND individual notifications to Telegram, doubling volume instead of suppressing duplicates.

---

## MEDIUM PRIORITY ISSUES

### 13. Org Management
- **Can't edit root directory** after creation — must delete and recreate org.
- **Active org not persisted** — switching tabs resets to first org on refresh.
- **Sidebar collapse state not persisted** — resets on refresh.
- **No unsaved changes warning** when switching orgs/subtabs.
- **Changing mission doesn't warn** that running agents use mission in system prompt.

### 14. Agent Execution Gaps
- **No validation that agent completed assigned work** — agent runs, claims success, nothing verifies.
- **System prompt can exceed context** for large orgs (10+ agents, 100+ tickets).
- **Delegation failures are silent** — delegator doesn't know delegation was skipped.
- **No global concurrent agent limit** — 10 orgs × 5 agents = 50 simultaneous agents possible.
- **Disabled tools not documented to agents** — they waste tokens trying to use them.

### 15. Protection System Gaps
- **No glob pattern support** for manual paths — must add each file individually.
- **Symlink bypass possible** — path validation doesn't check symlinks.
- **Mode change doesn't notify running agents** of new protection rules.
- **No dry-run** to preview which files would be affected by mode change.

### 16. File Comments Orphaned on Rename
- Comments stored in `{filename}.comments.json`. Moving/renaming a file orphans its comments with no cleanup.

### 17. Run Log Write Failures Silent
- **Location:** `org-agent-runner.ts:483-489`
- JSONL append has no error handling. If file deleted or permissions change, run is marked complete but not logged.

### 18. Soft-Deleted Orgs Accumulate
- `org-manager.ts:184-187` renames to `_deleted_*`. Over time, orgs/ directory fills with deleted entries.

---

## LOW PRIORITY / NICE-TO-HAVE

### 19. Missing Features
- No agent-to-agent direct messaging (only via tickets).
- No org export/import for backup.
- No keyboard shortcuts for power users.
- No cron expression builder (visual scheduler).
- No agent version control (can't rollback config changes).
- No "what-if" simulation mode for agents.
- No collapsible org chart subtrees for large hierarchies.
- No copy-to-clipboard on agent chat messages.
- No message search in agent chat.
- No dark mode (removed by design, but no theme persistence).

---

## DATA NOT BEING CAPTURED

| Missing Data | Impact |
|---|---|
| Effort estimates on tickets | Can't plan workload |
| Time spent per ticket | Can't measure productivity |
| Agent success rate over time | Can't evaluate agent performance |
| Token cost per tool call | Can't optimize expensive operations |
| Ticket dependency graph | Can't track blocking chains |
| Approval audit trail (who approved, why) | No accountability |
| Reassignment reasons | No context on handoffs |
| Due dates on tickets | No deadline enforcement |
| Agent config change history | Can't rollback bad changes |

---

## SUMMARY BY AREA

| Area | Critical | High | Medium | Low |
|---|---|---|---|---|
| Ticket System | 2 | 1 | 0 | 2 |
| Agent Execution | 1 | 2 | 3 | 3 |
| Chat System | 2 | 0 | 0 | 2 |
| Workspace/Files | 0 | 3 | 2 | 1 |
| Proposals | 0 | 3 | 0 | 1 |
| Memory | 0 | 2 | 1 | 0 |
| Notifications | 0 | 1 | 0 | 0 |
| Org Management | 0 | 1 | 3 | 2 |
| Board/Monitoring | 0 | 2 | 1 | 1 |
| Protection | 0 | 0 | 3 | 1 |
