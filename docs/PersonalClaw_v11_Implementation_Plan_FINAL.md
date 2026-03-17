# PersonalClaw v11 — Final Implementation Plan
## Step 1: Remove Paperclip | Step 2: Multi-Chat & Multi-Agent | Step 3: Skill Lock System

> **FINAL** — All 8 pre-build issues resolved inline. Ready to hand off.

---

## DECISIONS REFERENCE

| Decision | Answer |
|---|---|
| Max panes | 3 |
| Max sub-agents per pane | 5 |
| Max total agents | 15 |
| Brain per pane | Fresh isolated instance |
| Sub-agent output to parent | Final result only |
| Sub-agent raw logs | Visible via superuser toggle (Ctrl+Shift+D) |
| Sub-agent skill access | All skills (full power) |
| Sub-agent slot overflow | Queue and wait |
| Nested spawning | Disabled — only primary brain can spawn |
| New message while workers running | Process in parallel, workers continue |
| Pane titles | Auto-numbered: Chat 1, Chat 2, Chat 3 |
| Default pane layout | 1 pane, + button splits up to 3 |
| On pane close | Auto-save to SessionManager |
| Conversation persistence | Persist to disk |
| Skill lock scope | Per tool call only — acquired at run() start, released in finally block |
| Lock overflow | Queue and wait |
| `/api/chat` REST endpoint | Keep — route to Chat 1 if exists, create if not |
| Telegram Brain | Dedicated isolated instance in `src/core/telegram-brain.ts` — outside ConversationManager |

---

## CURRENT SKILL INVENTORY (v10.4 baseline)

14 skills remain after paperclip removal, plus the new agent-spawn skill added in this plan.

| Skill File | Tool Name | Conflict Risk | Lock Strategy |
|---|---|---|---|
| `shell.ts` | `execute_powershell` | 🟢 None | None — meta param signature only |
| `files.ts` | `manage_files` | 🟡 Write conflicts per path | Write lock keyed per absolute file path |
| `python.ts` | `run_python_script` | 🟢 None | None — meta param signature only |
| `vision.ts` | `analyze_vision` | 🔴 Screen state conflict with browser | Exclusive — shares `browser_vision` lock key with browser |
| `clipboard.ts` | `manage_clipboard` | 🔴 Global Windows resource | Exclusive lock on `clipboard` key |
| `memory.ts` | `manage_long_term_memory` | 🟡 Concurrent writes corrupt JSON | Read-write lock on `memory` key |
| `scheduler.ts` | `manage_scheduler` | 🟡 Concurrent writes corrupt JSON | Read-write lock on `scheduler` key |
| `browser.ts` | `browser` | 🔴 Singleton — 3 modes all conflict | Exclusive — shares `browser_vision` lock key with vision |
| `http.ts` | `http_request` | 🟢 None | None — meta param signature only |
| `network.ts` | `network_diagnostics` | 🟢 None | None — meta param signature only |
| `process-manager.ts` | `manage_processes` | 🟢 None / guardrail for destructive | None — meta param + system prompt guardrail only |
| `system-info.ts` | `system_info` | 🟢 None | None — meta param signature only |
| `pdf.ts` | `manage_pdf` | 🟡 Same output file conflicts | Reuses `files` write lock keyed on output path |
| `imagegen.ts` | `generate_image` | 🟢 None | None — meta param signature only |
| `agent-spawn.ts` | `spawn_agent` | 🟢 None | None — managed by AgentRegistry |

### Key notes
- `browser.ts` contains Playwright, Chrome Native MCP (`chrome_*`), and Extension Relay (`relay_*`) in one file. All three share the `browser_vision` exclusive lock.
- The self-learning engine (v1.17) writes to `long_term_knowledge.json` asynchronously after every turn. With 3 brains running, up to 3 concurrent writes can occur. The `memory` write lock handles this automatically — no special changes needed.
- Skills marked "meta param signature only" need their `run(args, meta: SkillMeta)` signature updated but no logic changes.

---

## PRE-BUILD FIXES APPLIED IN THIS PLAN

Eight issues were identified and fixed inline before finalising. The implementing agent must understand all of them.

| # | Severity | Issue | Fix Location |
|---|---|---|---|
| FIX-1 | 🔴 | `skill-lock.ts` ↔ `agent-registry.ts` circular import | Section 3.1 — use Event Bus instead of direct import |
| FIX-2 | 🔴 | `agent-registry.ts` ↔ `brain.ts` circular import | Section 2.4 — lazy dynamic import inside `startWorker()` |
| FIX-3 | 🔴 | `telegram.ts` ↔ `index.ts` circular import | New file `src/core/telegram-brain.ts` — section 2.7 |
| FIX-4 | 🟡 | EventBus missing `off()` method | Section 2.4 — verify and patch `src/core/events.ts` |
| FIX-5 | 🟡 | Worker Brain missing `conversationLabel` | Section 2.4 + 2.5 — pass label through spawn chain |
| FIX-6 | 🟡 | Tool streaming `onUpdate` broken after Brain refactor | Section 2.7 — re-wire via Event Bus in `index.ts` |
| FIX-7 | 🟢 | `display:contents` wrapper breaks `react-resizable-panels` | Section 4.7 — use `React.Fragment` instead |
| FIX-8 | 🟢 | `legacy_default` Brain never scheduled for removal | Phase 7, step 33 — explicit removal after Telegram wired |

---

---

## STEP 1 — REMOVE PAPERCLIP

### Overview
Clean removal of all Paperclip AI references. No functional changes. Project must compile with zero errors before proceeding.

---

### 1.1 — Files to Delete

```bash
rm -rf PaperClip/
rm src/skills/paperclip.ts
rm docs/PAPERCLIP_SOP.md
rm docs/PAPERCLIP_SKILL.md
```

---

### 1.2 — Files to Modify

#### `src/skills/index.ts`
- Remove: `import { paperclipSkill } from './paperclip.js'`
- Remove: `paperclipSkill` from the skills array
- Nothing else changes

#### `src/core/brain.ts`
- Search all strings containing "paperclip" (case-insensitive)
- Remove system prompt lines referencing Paperclip
- Remove any special-cased logic for `paperclip_orchestration` tool calls
- Do not change the brain loop structure

#### `AGENTS.md`
- Replace header: "You are a Paperclip AI agent" → "You are a PersonalClaw agent"
- Remove `+-- paperclip.ts` line from project structure tree
- Remove `+-- PaperClip/` directory lines
- Remove `Create issues and track work via Paperclip tickets` from What You Can Do

#### `docs/codebase_documentation.md`
- Remove item 8: `Paperclip (paperclip_orchestration)` from Integrated Skills list
- Update skill count references

#### `V10_FEATURES.md`
- Remove paperclip from skills growth metrics table

---

### 1.3 — Verification

```bash
npx tsc --noEmit
grep -ri "paperclip" src/
grep -ri "paperclip" dashboard/
```

All three must return clean. Do not proceed until zero errors, zero grep results.

---

---

## STEP 2 — MULTI-CHAT & MULTI-AGENT

---

### 2.1 — Refactor `src/core/brain.ts` — Singleton to Class

#### Update `src/types/index.ts` first

```typescript
export interface SkillMeta {
  agentId: string;
  conversationId: string;
  conversationLabel: string;   // "Chat 1" — used in lock holder display
  isWorker: boolean;
}

export interface Skill {
  name: string;
  description: string;
  parameters: object;
  run: (args: any, meta: SkillMeta) => Promise<any>;
}
```

#### Add `BrainConfig` interface to `brain.ts`

```typescript
export interface BrainConfig {
  agentId: string;
  conversationId: string;
  conversationLabel?: string;
  systemPromptOverride?: string;
  skillSubset?: string[];
  isWorker?: boolean;
  parentAgentId?: string;
}
```

#### Convert Brain to class

```typescript
export class Brain {
  private agentId: string;
  private conversationId: string;
  private conversationLabel: string;
  private config: BrainConfig;
  private conversationHistory: Message[] = [];
  private isWorker: boolean;
  private aborted: boolean = false;

  constructor(config: BrainConfig) {
    this.agentId = config.agentId;
    this.conversationId = config.conversationId;
    this.conversationLabel = config.conversationLabel ?? config.conversationId;
    this.config = config;
    this.isWorker = config.isWorker ?? false;

    let skills = config.skillSubset
      ? allSkills.filter(s => config.skillSubset!.includes(s.name))
      : allSkills;

    // Workers NEVER get spawn_agent — enforced at model level, not just prompt
    if (this.isWorker) {
      skills = skills.filter(s => s.name !== 'spawn_agent');
    }

    // Initialize Gemini client with filtered skills
  }

  // Called by AgentRegistry.kill() before resolving the worker Promise.
  // Sets abort flag so the next skill invocation check throws immediately,
  // which propagates through the skill's finally block and releases any held lock.
  abort(): void {
    this.aborted = true;
  }

  async chat(userMessage: string): Promise<string> {
    // All existing brain loop logic moves here unchanged.
    // Replace all module-level history references with this.conversationHistory.
    // Replace all module-level agentId references with this.agentId.
    //
    // ABORT CHECK — add this at the very start of every skill invocation
    // inside the tool loop, before calling skill.run():
    //   if (this.aborted) throw new Error('Brain aborted');
    //
    // This is what allows kill() to cleanly release locks on in-flight skills.
  }

  private buildMeta(): SkillMeta {
    return {
      agentId: this.agentId,
      conversationId: this.conversationId,
      conversationLabel: this.conversationLabel,
      isWorker: this.isWorker
    };
  }

  getHistory(): Message[] { return this.conversationHistory; }
  getAgentId(): string { return this.agentId; }
  getConversationId(): string { return this.conversationId; }
  isWorkerAgent(): boolean { return this.isWorker; }
  clearHistory(): void { this.conversationHistory = []; }
}
```

#### Pass `buildMeta()` to every skill invocation

```typescript
// Every skill.run() call inside the tool loop becomes:
if (this.aborted) throw new Error('Brain aborted');
const result = await skill.run(args, this.buildMeta());
```

#### Update all event emissions

```typescript
eventBus.emit('brain:tool_called', {
  agentId: this.agentId,
  conversationId: this.conversationId,
  conversationLabel: this.conversationLabel,
  tool: toolName,
  isWorker: this.isWorker
})
```

#### Parallel tool execution — self-deadlock prevention (FIX-6 related)

v1.15 added `Promise.all` for concurrent tool execution. If a Brain calls the same exclusive-lock skill twice in one parallel batch it will deadlock on itself. Add deduplication:

```typescript
const exclusiveLockSkills = new Set(['browser', 'analyze_vision', 'manage_clipboard']);

// Split tool calls in the current batch
const parallelSafe = toolCalls.filter(t => !exclusiveLockSkills.has(t.name));
const mustSequence = toolCalls.filter(t => exclusiveLockSkills.has(t.name));

// Run safe calls in parallel, exclusive-lock calls sequentially
const results = [
  ...await Promise.all(parallelSafe.map(call => invokeTool(call))),
  ...await mustSequence.reduce(async (chain, call) => {
    const acc = await chain;
    return [...acc, await invokeTool(call)];
  }, Promise.resolve([] as any[]))
];
```

Add to system prompt: "Never call the same singleton-resource skill (browser, vision, clipboard) more than once in the same parallel tool batch."

#### Worker system prompt guardrail

When `isWorker === true`, append to the system prompt:

```
WORKER AGENT CONSTRAINTS:
You are a sub-agent worker. Complete your assigned task and return the result.

You must NOT:
- Kill or terminate any processes
- Stop, start, or restart any Windows services
- Delete, clear, or reset any memory or learned preferences
- Modify or delete any scheduled jobs
- Perform any irreversible system operations

If your task requires any of the above, return an explanation of what you would
need to do and ask the parent conversation to confirm before acting.
```

#### Temporary legacy export — scheduled for removal in Phase 7

```typescript
// TEMPORARY — remove at end of Phase 7 once all callers updated
export const brain = new Brain({
  agentId: 'legacy_default',
  conversationId: 'legacy_default'
});
```

**✅ Run `npx tsc --noEmit` after this step. 0 errors required.**

---

### 2.2 — New File: `src/core/telegram-brain.ts` (FIX-3)

Creating a neutral file breaks the circular import between `index.ts` and `telegram.ts`. Both import from this file — neither imports the other.

```typescript
import { Brain } from './brain.js';

// Telegram gets its own isolated Brain instance.
// It does not count toward the 3-pane limit.
// It is not listed in conversationManager.list().
// Its history is not saved on shutdown (Telegram users reconnect fresh).
export const telegramBrain = new Brain({
  agentId: 'telegram_primary',
  conversationId: 'telegram',
  conversationLabel: 'Telegram'
});
```

Update `src/interfaces/telegram.ts`:
- Remove: any import of the singleton `brain` or import from `../index.js`
- Add: `import { telegramBrain } from '../core/telegram-brain.js'`
- Replace: all `brain.chat(...)` calls with `telegramBrain.chat(...)`

---

### 2.3 — New File: `src/core/conversation-manager.ts`

```typescript
import { Brain } from './brain.js';
import { SessionManager } from './sessions.js';
import { agentRegistry } from './agent-registry.js';
import { eventBus } from './events.js';

export interface ConversationInfo {
  id: string;
  label: string;
  createdAt: Date;
  lastActivityAt: Date;
  messageCount: number;
}

interface Conversation {
  id: string;
  label: string;
  brain: Brain;
  createdAt: Date;
  lastActivityAt: Date;
}

class ConversationManager {
  private conversations: Map<string, Conversation> = new Map();
  private readonly MAX_CONVERSATIONS = 3;
  private readonly LABELS = ['Chat 1', 'Chat 2', 'Chat 3'];

  create(): ConversationInfo {
    if (this.conversations.size >= this.MAX_CONVERSATIONS) {
      throw new Error('Maximum of 3 conversations reached');
    }
    const label = this.nextAvailableLabel();
    const id = `conv_${Date.now()}`;
    const brain = new Brain({
      agentId: `primary_${id}`,
      conversationId: id,
      conversationLabel: label
    });
    const convo: Conversation = {
      id, label, brain,
      createdAt: new Date(),
      lastActivityAt: new Date()
    };
    this.conversations.set(id, convo);
    eventBus.emit('conversation:created', { id, label });
    return this.toInfo(convo);
  }

  get(conversationId: string): Conversation {
    const convo = this.conversations.get(conversationId);
    if (!convo) throw new Error(`Conversation ${conversationId} not found`);
    return convo;
  }

  list(): ConversationInfo[] {
    return Array.from(this.conversations.values()).map(c => this.toInfo(c));
  }

  async send(conversationId: string, message: string): Promise<string> {
    const convo = this.get(conversationId);
    convo.lastActivityAt = new Date();
    return convo.brain.chat(message);
  }

  async close(conversationId: string): Promise<void> {
    const convo = this.get(conversationId);
    const history = convo.brain.getHistory();
    await SessionManager.saveSession(convo.label, history);
    agentRegistry.killAll(conversationId);
    this.conversations.delete(conversationId);
    eventBus.emit('conversation:closed', { id: conversationId, label: convo.label });
  }

  async closeAll(): Promise<void> {
    for (const id of Array.from(this.conversations.keys())) {
      await this.close(id);
    }
  }

  // Used by POST /api/chat — routes to Chat 1 if it exists, creates it if not
  async getOrCreateDefault(): Promise<Conversation> {
    const chat1 = Array.from(this.conversations.values()).find(c => c.label === 'Chat 1');
    if (chat1) return chat1;
    const info = this.create();
    return this.get(info.id);
  }

  private nextAvailableLabel(): string {
    const used = new Set(Array.from(this.conversations.values()).map(c => c.label));
    const available = this.LABELS.find(l => !used.has(l));
    if (!available) throw new Error('No labels available');
    return available;
  }

  private toInfo(convo: Conversation): ConversationInfo {
    return {
      id: convo.id,
      label: convo.label,
      createdAt: convo.createdAt,
      lastActivityAt: convo.lastActivityAt,
      messageCount: convo.brain.getHistory().length
    };
  }
}

export const conversationManager = new ConversationManager();
```

---

### 2.4 — Modify `src/core/sessions.ts` — Add `saveSession`

Add one new static method. Do not change any existing methods.

```typescript
static saveSession(name: string, history: Message[]): string {
  const timestamp = Date.now();
  const safeName = name.toLowerCase().replace(/\s+/g, '-'); // "Chat 1" → "chat-1"
  const sessionId = `session_${timestamp}_${safeName}`;
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    id: sessionId, name, history,
    savedAt: new Date().toISOString()
  }, null, 2));
  return sessionId;
}
```

---

### 2.5 — Patch `src/core/events.ts` — Add `off()` Method (FIX-4)

Before creating `agent-registry.ts`, verify the EventBus has a working `off()` / `removeListener()` method. If it only has `on()` and `emit()`, add `off()` now.

```typescript
// Add to the EventBus class if not already present:
off(event: string, listener: (...args: any[]) => void): void {
  // Implementation depends on the existing EventBus internals.
  // If EventBus extends Node.js EventEmitter, this is already available.
  // If it's a custom Map-based implementation, add listener removal:
  const listeners = this.listeners.get(event);
  if (listeners) {
    this.listeners.set(event, listeners.filter(l => l !== listener));
  }
}
```

Also add the new event constants:

```typescript
'conversation:created'
'conversation:closed'
'agent:worker_queued'
'agent:worker_started'
'agent:worker_completed'
'agent:worker_failed'
'agent:worker_timed_out'
'skill:lock_acquired'
'skill:lock_released'
'skill:lock_queued'
'skill:lock_timeout'
'skill:lock_waiting'      // NEW — emitted by skill-lock, consumed by agent-registry
```

---

### 2.6 — New File: `src/core/agent-registry.ts` (with FIX-2 and FIX-4 and FIX-5)

**FIX-2:** Brain is imported lazily inside `startWorker()` to break the circular dependency chain: `brain.ts` → `agent-spawn.ts` → `agent-registry.ts` → `brain.ts`.

**FIX-4:** Uses `eventBus.off()` to clean up raw log listeners — requires the `off()` patch above.

**FIX-5:** `conversationLabel` passed through the spawn chain so the worker Brain and lock UI show "Chat 1" instead of the raw conversationId.

```typescript
import { eventBus } from './events.js';
// NOTE: Brain is NOT imported at the top level — see FIX-2.
// It is dynamically imported inside startWorker() to break the circular dependency.

export type WorkerStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_lock'
  | 'completed'
  | 'failed'
  | 'timed_out';

export interface WorkerAgentInfo {
  agentId: string;
  parentConversationId: string;
  conversationLabel: string;
  task: string;
  status: WorkerStatus;
  spawnedAt: string;
  completedAt?: string;
  result?: string;
  lockWaitInfo?: {
    lockKey: string;
    heldBy: string;
    heldByConversation: string;
  };
}

interface WorkerAgent extends WorkerAgentInfo {
  brain: any;              // typed as any here because of dynamic import — Brain at runtime
  rawLogs: string[];
  timeoutHandle?: NodeJS.Timeout;
  resolve: (result: string) => void;
}

interface QueuedTask {
  parentConversationId: string;
  conversationLabel: string;
  task: string;
  resolve: (result: string) => void;
}

class AgentRegistry {
  private workers: Map<string, WorkerAgent> = new Map();
  private queue: QueuedTask[] = [];
  private readonly MAX_WORKERS_PER_CONVERSATION = 5;
  private readonly WORKER_TIMEOUT_MS = 5 * 60 * 1000;

  constructor() {
    // FIX-1 + FIX-4: Subscribe to skill-lock events via Event Bus.
    // skill-lock.ts emits these instead of calling agentRegistry directly,
    // which breaks the circular dependency.
    eventBus.on('skill:lock_waiting', (data: {
      agentId: string; lockKey: string;
      heldBy: string; heldByConversation: string;
    }) => {
      this.setLockWaitInfo(data.agentId, {
        lockKey: data.lockKey,
        heldBy: data.heldBy,
        heldByConversation: data.heldByConversation
      });
    });

    eventBus.on('skill:lock_acquired', (data: { agentId: string }) => {
      this.setLockWaitInfo(data.agentId, undefined);
    });
  }

  // FIX-5: conversationLabel param added so worker Brain shows "Chat 1" in lock UI
  async spawn(
    parentConversationId: string,
    task: string,
    conversationLabel: string
  ): Promise<string> {
    return new Promise((resolve) => {
      if (this.runningCount(parentConversationId) < this.MAX_WORKERS_PER_CONVERSATION) {
        this.startWorker(parentConversationId, conversationLabel, task, resolve);
      } else {
        this.queue.push({ parentConversationId, conversationLabel, task, resolve });
        eventBus.emit('agent:worker_queued', { parentConversationId, task });
      }
    });
  }

  getWorkers(conversationId: string): WorkerAgentInfo[] {
    return Array.from(this.workers.values())
      .filter(w => w.parentConversationId === conversationId)
      .map(w => this.toInfo(w));
  }

  getRawLogs(agentId: string): string[] {
    return this.workers.get(agentId)?.rawLogs ?? [];
  }

  kill(agentId: string): void {
    const worker = this.workers.get(agentId);
    if (!worker) return;
    if (worker.timeoutHandle) clearTimeout(worker.timeoutHandle);
    // FIX: abort Brain first so any in-flight skill call throws from its abort check,
    // triggering the skill's finally block and releasing any held lock cleanly.
    worker.brain.abort();
    // 100ms delay gives the abort propagation time to complete before resolving.
    setTimeout(() => {
      worker.resolve(`Worker ${agentId} was killed`);
      this.workers.delete(agentId);
      this.processQueue();
    }, 100);
  }

  killAll(conversationId: string): void {
    for (const agentId of Array.from(this.workers.keys())) {
      if (this.workers.get(agentId)?.parentConversationId === conversationId) {
        this.kill(agentId);
      }
    }
    this.queue = this.queue.filter(q => q.parentConversationId !== conversationId);
  }

  private setLockWaitInfo(
    agentId: string,
    info: WorkerAgentInfo['lockWaitInfo'] | undefined
  ): void {
    const worker = this.workers.get(agentId);
    if (!worker) return;
    worker.lockWaitInfo = info;
    worker.status = info ? 'waiting_for_lock' : 'running';
    eventBus.emit('agent:worker_started', {
      agentId, parentConversationId: worker.parentConversationId
    });
  }

  private async startWorker(
    parentConversationId: string,
    conversationLabel: string,
    task: string,
    resolve: (r: string) => void
  ): Promise<void> {
    // FIX-2: Lazy dynamic import breaks circular dependency
    const { Brain } = await import('./brain.js');

    const agentId = `worker_${parentConversationId}_${Date.now()}`;
    const brain = new Brain({
      agentId,
      conversationId: parentConversationId,
      conversationLabel,                    // FIX-5: passes "Chat 1" not raw id
      isWorker: true,
      parentAgentId: `primary_${parentConversationId}`
    });

    const worker: WorkerAgent = {
      agentId, parentConversationId, conversationLabel,
      task, status: 'running',
      spawnedAt: new Date().toISOString(),
      brain, rawLogs: [], resolve
    };

    worker.timeoutHandle = setTimeout(() => {
      worker.status = 'timed_out';
      worker.completedAt = new Date().toISOString();
      worker.brain.abort();
      eventBus.emit('agent:worker_timed_out', { agentId, parentConversationId });
      resolve(`Worker timed out after 5 minutes. Task was: ${task}`);
      this.workers.delete(agentId);
      this.processQueue();
    }, this.WORKER_TIMEOUT_MS);

    this.workers.set(agentId, worker);
    eventBus.emit('agent:worker_started', { agentId, parentConversationId, task });

    this.runWorker(worker).catch(err => {
      worker.status = 'failed';
      worker.completedAt = new Date().toISOString();
      if (worker.timeoutHandle) clearTimeout(worker.timeoutHandle);
      eventBus.emit('agent:worker_failed', { agentId, parentConversationId, error: err.message });
      resolve(`Worker failed: ${err.message}`); // resolve not reject — parent sees error as result
      this.workers.delete(agentId);
      this.processQueue();
    });
  }

  private async runWorker(worker: WorkerAgent): Promise<void> {
    // FIX-4: eventBus.off() used here — requires off() patch in events.ts
    const logListener = (event: any) => {
      if (event.agentId === worker.agentId) {
        worker.rawLogs.push(JSON.stringify(event));
      }
    };
    eventBus.on('brain:tool_called', logListener);
    eventBus.on('brain:tool_completed', logListener);

    try {
      const result = await worker.brain.chat(worker.task);
      worker.status = 'completed';
      worker.result = result;
      worker.completedAt = new Date().toISOString();
      if (worker.timeoutHandle) clearTimeout(worker.timeoutHandle);
      eventBus.emit('agent:worker_completed', {
        agentId: worker.agentId,
        parentConversationId: worker.parentConversationId,
        result
      });
      worker.resolve(result);
    } finally {
      // FIX-4: clean up listeners — requires off() in events.ts
      eventBus.off('brain:tool_called', logListener);
      eventBus.off('brain:tool_completed', logListener);
      this.workers.delete(worker.agentId);
      this.processQueue();
    }
  }

  private processQueue(): void {
    const remaining: QueuedTask[] = [];
    for (const queued of this.queue) {
      if (this.runningCount(queued.parentConversationId) < this.MAX_WORKERS_PER_CONVERSATION) {
        this.startWorker(
          queued.parentConversationId,
          queued.conversationLabel,
          queued.task,
          queued.resolve
        );
      } else {
        remaining.push(queued);
      }
    }
    this.queue = remaining;
  }

  private runningCount(conversationId: string): number {
    return Array.from(this.workers.values()).filter(w =>
      w.parentConversationId === conversationId &&
      (w.status === 'running' || w.status === 'waiting_for_lock')
    ).length;
  }

  private toInfo(worker: WorkerAgent): WorkerAgentInfo {
    return {
      agentId: worker.agentId,
      parentConversationId: worker.parentConversationId,
      conversationLabel: worker.conversationLabel,
      task: worker.task,
      status: worker.status,
      spawnedAt: worker.spawnedAt,
      completedAt: worker.completedAt,
      result: worker.result,
      lockWaitInfo: worker.lockWaitInfo
    };
  }
}

export const agentRegistry = new AgentRegistry();
```

---

### 2.7 — New File: `src/skills/agent-spawn.ts` (with FIX-5)

**FIX-5:** `meta.conversationLabel` passed to `agentRegistry.spawn()` so worker Brain displays correctly in lock UI.

```typescript
import { agentRegistry } from '../core/agent-registry.js';
import type { Skill, SkillMeta } from '../types/index.js';

export const agentSpawnSkill: Skill = {
  name: 'spawn_agent',
  description: `Spawn a sub-agent worker to complete a specific task in parallel.
Use this when you have a clearly defined sub-task that can run independently.
Up to 5 workers can run simultaneously per conversation. If all slots are full, spawn queues automatically.
Workers have access to all skills. Workers CANNOT spawn further agents.
Each worker gets only its task string — it has no conversation history.
Be explicit and self-contained in the task description. Include all context the worker needs.
Do NOT call the same singleton-resource skill (browser, vision, clipboard) more than once
in the same parallel tool batch — this will cause a deadlock.
Returns the worker's final result string when complete.`,

  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Complete, self-contained task. Worker has no conversation history — include everything needed.'
      },
      context: {
        type: 'string',
        description: 'Optional background context to prepend to the task.'
      }
    },
    required: ['task']
  },

  run: async (args: { task: string; context?: string }, meta: SkillMeta) => {
    if (meta.isWorker) {
      return { success: false, error: 'Workers cannot spawn sub-agents' };
    }
    const fullTask = args.context
      ? `Context:\n${args.context}\n\nTask:\n${args.task}`
      : args.task;
    // FIX-5: pass conversationLabel so worker Brain shows "Chat 1" in lock UI
    const result = await agentRegistry.spawn(
      meta.conversationId,
      fullTask,
      meta.conversationLabel
    );
    return { success: true, result };
  }
};
```

Register in `src/skills/index.ts`:
- Add: `import { agentSpawnSkill } from './agent-spawn.js'`
- Add `agentSpawnSkill` to skills array

---

### 2.8 — Modify `src/index.ts` — Full Server Wiring (with FIX-3, FIX-6, FIX-8)

#### Imports to add at top of file

```typescript
import { conversationManager } from './core/conversation-manager.js';
import { agentRegistry } from './core/agent-registry.js';
import { skillLock } from './core/skill-lock.js';
// FIX-3: telegramBrain imported from neutral file, not declared here
import { telegramBrain } from './core/telegram-brain.js';
```

#### Update existing socket message handler

```typescript
// BEFORE
socket.on('message', async (text: string) => {
  const response = await brain.chat(text);
  socket.emit('response', response);
});

// AFTER
socket.on('message', async (payload: { text: string; conversationId: string }) => {
  const { text, conversationId } = payload;
  try {
    const response = await conversationManager.send(conversationId, text);
    socket.emit('response', { conversationId, text: response });
  } catch (err: any) {
    socket.emit('response', {
      conversationId, text: `Error: ${err.message}`, isError: true
    });
  }
});
```

#### New socket event handlers

```typescript
socket.on('conversation:create', async () => {
  try {
    socket.emit('conversation:created', conversationManager.create());
  } catch (err: any) {
    socket.emit('conversation:error', { message: err.message });
  }
});

socket.on('conversation:close', async ({ conversationId }: { conversationId: string }) => {
  await conversationManager.close(conversationId);
  socket.emit('conversation:closed', { conversationId });
});

socket.on('conversation:list', () => {
  socket.emit('conversation:list', conversationManager.list());
});

socket.on('agent:list', ({ conversationId }: { conversationId: string }) => {
  socket.emit('agent:list', {
    conversationId,
    workers: agentRegistry.getWorkers(conversationId)
  });
});

socket.on('agent:logs', ({ agentId }: { agentId: string }) => {
  socket.emit('agent:logs', {
    agentId,
    logs: agentRegistry.getRawLogs(agentId)
  });
});
```

#### FIX-6 — Re-wire tool streaming via Event Bus

v1.15 added live tool progress to the dashboard via an `onUpdate` callback on `brain.chat()`. After the Brain refactor, `chat()` no longer takes a callback — it emits via Event Bus instead. Replace the old callback wiring with Event Bus subscriptions in `index.ts`:

```typescript
// Remove: any existing onUpdate callback wiring from the old brain.chat() call
// Add: Event Bus subscriptions that forward tool events to the correct socket clients

eventBus.on('brain:tool_called', (data: {
  agentId: string; conversationId: string; tool: string; isWorker: boolean;
}) => {
  // Only forward primary brain tool events to the dashboard (not worker events)
  // Worker events go to agent:update, not tool_update
  if (!data.isWorker) {
    io.emit('tool_update', {
      conversationId: data.conversationId,
      type: 'started',
      tool: data.tool,
      timestamp: Date.now()
    });
  }
});

eventBus.on('brain:tool_completed', (data: {
  agentId: string; conversationId: string; tool: string;
  durationMs: number; success: boolean; isWorker: boolean;
}) => {
  if (!data.isWorker) {
    io.emit('tool_update', {
      conversationId: data.conversationId,
      type: 'completed',
      tool: data.tool,
      durationMs: data.durationMs,
      success: data.success,
      timestamp: Date.now()
    });
  }
});
```

Note: the existing dashboard `tool_update` handler should already render this correctly since the payload shape is compatible. If the dashboard currently filters tool_update by anything other than conversationId, review and update that filter.

#### Real-time agent status push

```typescript
const pushWorkerUpdate = (data: { agentId: string; parentConversationId: string }) => {
  io.emit('agent:update', {
    conversationId: data.parentConversationId,
    workers: agentRegistry.getWorkers(data.parentConversationId)
  });
};
eventBus.on('agent:worker_started', pushWorkerUpdate);
eventBus.on('agent:worker_completed', pushWorkerUpdate);
eventBus.on('agent:worker_failed', pushWorkerUpdate);
eventBus.on('agent:worker_timed_out', pushWorkerUpdate);
eventBus.on('agent:worker_queued', pushWorkerUpdate);
```

#### Update existing `POST /api/chat` (EC-1)

```typescript
// BEFORE (approximate)
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  const response = await brain.chat(message);
  res.json({ response });
});

// AFTER
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const convo = await conversationManager.getOrCreateDefault();
    const response = await convo.brain.chat(message);
    res.json({ response, conversationId: convo.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
```

#### New REST endpoints

```typescript
app.post('/api/conversations', (req, res) => {
  try { res.json(conversationManager.create()); }
  catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.get('/api/conversations', (req, res) => res.json(conversationManager.list()));

app.delete('/api/conversations/:id', async (req, res) => {
  await conversationManager.close(req.params.id);
  res.json({ success: true });
});

app.get('/api/conversations/:id/agents', (req, res) => {
  res.json(agentRegistry.getWorkers(req.params.id));
});

app.get('/api/agents/:agentId/logs', (req, res) => {
  res.json({ logs: agentRegistry.getRawLogs(req.params.agentId) });
});

app.get('/api/locks', (req, res) => {
  res.json(skillLock.getAllHeld());
});
```

#### Graceful shutdown update

```typescript
// Add BEFORE audit flush in existing SIGINT/SIGTERM handler:
await conversationManager.closeAll();
// telegramBrain history is not saved — Telegram users reconnect fresh (matches existing behaviour)
```

#### FIX-8 — Remove legacy_default Brain export

After all callers are updated (`telegram.ts` uses `telegramBrain`, `/api/chat` uses `getOrCreateDefault()`), remove the legacy export from `brain.ts`:

```typescript
// DELETE THIS LINE from brain.ts:
export const brain = new Brain({ agentId: 'legacy_default', conversationId: 'legacy_default' });
```

Then search for any remaining import of the singleton `brain` from `brain.ts` across the entire codebase and fix them:

```bash
grep -rn "import.*brain.*from.*brain" src/
```

Every remaining reference must be updated to use `conversationManager` or `telegramBrain` as appropriate. Zero references to the `brain` singleton should remain after this step.

---

---

## STEP 3 — SKILL LOCK SYSTEM

---

### 3.1 — New File: `src/core/skill-lock.ts` (with FIX-1)

**FIX-1:** `agentRegistry` is NOT imported here. Instead, `skill-lock.ts` emits Event Bus events (`skill:lock_waiting`, `skill:lock_acquired`) which `agent-registry.ts` subscribes to in its constructor. This breaks the circular dependency.

```typescript
import { eventBus } from './events.js';
// NO import of agentRegistry — FIX-1

export type ExclusiveLockKey = 'browser_vision' | 'clipboard';
export type ReadWriteLockKey = 'memory' | 'scheduler' | `files:${string}`;
export type AnyLockKey = ExclusiveLockKey | ReadWriteLockKey;

export interface LockHolder {
  agentId: string;
  conversationId: string;
  conversationLabel: string;
  operation: string;
  acquiredAt: Date;
}

export interface LockStatus {
  key: AnyLockKey;
  type: 'exclusive' | 'read' | 'write' | 'free';
  holders: LockHolder[];
  queueLength: number;
}

const LOCK_TIMEOUTS: Record<string, number> = {
  browser_vision: 60_000,
  clipboard: 5_000,
  memory: 5_000,
  scheduler: 5_000,
  files: 10_000
};

function getTimeout(key: string): number {
  return LOCK_TIMEOUTS[key.split(':')[0]] ?? 30_000;
}

class SkillLockManager {
  private exclusiveChain: Map<string, Promise<void>> = new Map();
  private exclusiveHolders: Map<string, LockHolder> = new Map();
  private exclusiveQueueLengths: Map<string, number> = new Map();

  private rwState: Map<string, {
    readers: LockHolder[];
    writer: LockHolder | null;
    readerQueue: number;
    writerQueue: number;
  }> = new Map();

  async acquireExclusive(key: ExclusiveLockKey, holder: LockHolder): Promise<() => void> {
    const timeout = getTimeout(key);
    this.exclusiveQueueLengths.set(key, (this.exclusiveQueueLengths.get(key) ?? 0) + 1);

    // FIX-1: emit event instead of calling agentRegistry directly
    eventBus.emit('skill:lock_waiting', {
      agentId: holder.agentId,
      lockKey: key,
      heldBy: this.exclusiveHolders.get(key)?.agentId ?? 'none',
      heldByConversation: this.exclusiveHolders.get(key)?.conversationLabel ?? 'none'
    });
    eventBus.emit('skill:lock_queued', { key, holder });

    const previous = this.exclusiveChain.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = previous.then(() => new Promise<void>(r => { release = r; }));
    this.exclusiveChain.set(key, current);

    await Promise.race([
      previous,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(
          `Lock timeout: '${key}' waited ${timeout}ms. Held by: ${this.exclusiveHolders.get(key)?.agentId ?? 'unknown'}`
        )), timeout)
      )
    ]);

    this.exclusiveHolders.set(key, holder);
    this.exclusiveQueueLengths.set(key,
      Math.max(0, (this.exclusiveQueueLengths.get(key) ?? 1) - 1)
    );

    // FIX-1: emit acquired event — agent-registry clears waiting_for_lock status
    eventBus.emit('skill:lock_acquired', { agentId: holder.agentId, key });

    return () => {
      this.exclusiveHolders.delete(key);
      eventBus.emit('skill:lock_released', { key, holder });
      release();
    };
  }

  async acquireRead(key: ReadWriteLockKey, holder: LockHolder): Promise<() => void> {
    const timeout = getTimeout(key);
    const state = this.getRWState(key);
    state.readerQueue++;

    eventBus.emit('skill:lock_waiting', {
      agentId: holder.agentId, lockKey: key,
      heldBy: state.writer?.agentId ?? 'none',
      heldByConversation: state.writer?.conversationLabel ?? 'none'
    });

    const deadline = Date.now() + timeout;
    while (state.writer !== null || state.writerQueue > 0) {
      if (Date.now() > deadline) {
        state.readerQueue--;
        throw new Error(`Read lock timeout on '${key}' after ${timeout}ms`);
      }
      await new Promise(r => setTimeout(r, 50));
    }

    state.readerQueue--;
    state.readers.push(holder);
    eventBus.emit('skill:lock_acquired', { agentId: holder.agentId, key });
    eventBus.emit('skill:lock_queued', { key, holder, mode: 'read' });

    return () => {
      state.readers = state.readers.filter(r => r.agentId !== holder.agentId);
      eventBus.emit('skill:lock_released', { key, holder, mode: 'read' });
    };
  }

  async acquireWrite(key: ReadWriteLockKey, holder: LockHolder): Promise<() => void> {
    const timeout = getTimeout(key);
    const state = this.getRWState(key);
    state.writerQueue++;

    eventBus.emit('skill:lock_waiting', {
      agentId: holder.agentId, lockKey: key,
      heldBy: (state.writer ?? state.readers[0])?.agentId ?? 'none',
      heldByConversation: (state.writer ?? state.readers[0])?.conversationLabel ?? 'none'
    });

    const deadline = Date.now() + timeout;
    while (state.writer !== null || state.readers.length > 0) {
      if (Date.now() > deadline) {
        state.writerQueue--;
        throw new Error(`Write lock timeout on '${key}' after ${timeout}ms`);
      }
      await new Promise(r => setTimeout(r, 50));
    }

    state.writerQueue--;
    state.writer = holder;
    eventBus.emit('skill:lock_acquired', { agentId: holder.agentId, key });

    return () => {
      state.writer = null;
      eventBus.emit('skill:lock_released', { key, holder, mode: 'write' });
    };
  }

  getStatus(key: AnyLockKey): LockStatus {
    if (key === 'browser_vision' || key === 'clipboard') {
      const holder = this.exclusiveHolders.get(key);
      return {
        key, type: holder ? 'exclusive' : 'free',
        holders: holder ? [holder] : [],
        queueLength: this.exclusiveQueueLengths.get(key) ?? 0
      };
    }
    const state = this.rwState.get(key);
    if (!state) return { key, type: 'free', holders: [], queueLength: 0 };
    return {
      key,
      type: state.writer ? 'write' : state.readers.length > 0 ? 'read' : 'free',
      holders: state.writer ? [state.writer] : [...state.readers],
      queueLength: state.readerQueue + state.writerQueue
    };
  }

  getAllHeld(): Record<string, LockStatus> {
    const result: Record<string, LockStatus> = {};
    for (const key of this.exclusiveHolders.keys()) {
      result[key] = this.getStatus(key as ExclusiveLockKey);
    }
    for (const key of this.rwState.keys()) {
      const status = this.getStatus(key as ReadWriteLockKey);
      if (status.type !== 'free') result[key] = status;
    }
    return result;
  }

  private getRWState(key: string) {
    if (!this.rwState.has(key)) {
      this.rwState.set(key, { readers: [], writer: null, readerQueue: 0, writerQueue: 0 });
    }
    return this.rwState.get(key)!;
  }
}

export const skillLock = new SkillLockManager();
```

---

### 3.2 — Modify `src/skills/browser.ts` — `browser_vision` Exclusive Lock

Wraps the entire `run()` function. Covers all three modes (Playwright, Chrome Native MCP, Extension Relay) and all actions.

```typescript
import { skillLock } from '../core/skill-lock.js';

run: async (args: any, meta: SkillMeta) => {
  let release: (() => void) | undefined;
  try {
    release = await skillLock.acquireExclusive('browser_vision', {
      agentId: meta.agentId, conversationId: meta.conversationId,
      conversationLabel: meta.conversationLabel,
      operation: `browser:${args.action}`, acquiredAt: new Date()
    });
    // ALL existing action handling logic unchanged
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    release?.();
  }
}
```

---

### 3.3 — Modify `src/skills/vision.ts` — `browser_vision` Exclusive Lock

Shares the same lock key as `browser.ts` — vision cannot run while browser is active and vice versa.

```typescript
run: async (args: any, meta: SkillMeta) => {
  let release: (() => void) | undefined;
  try {
    release = await skillLock.acquireExclusive('browser_vision', {
      agentId: meta.agentId, conversationId: meta.conversationId,
      conversationLabel: meta.conversationLabel,
      operation: 'vision:analyze', acquiredAt: new Date()
    });
    // existing vision logic unchanged
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    release?.();
  }
}
```

---

### 3.4 — Modify `src/skills/clipboard.ts` — `clipboard` Exclusive Lock

```typescript
run: async (args: any, meta: SkillMeta) => {
  let release: (() => void) | undefined;
  try {
    release = await skillLock.acquireExclusive('clipboard', {
      agentId: meta.agentId, conversationId: meta.conversationId,
      conversationLabel: meta.conversationLabel,
      operation: `clipboard:${args.action}`, acquiredAt: new Date()
    });
    // existing clipboard logic unchanged
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    release?.();
  }
}
```

---

### 3.5 — Modify `src/skills/memory.ts` — Read-Write Lock

```typescript
run: async (args: any, meta: SkillMeta) => {
  const writeActions = new Set(['set', 'update', 'delete', 'clear']);
  const holderBase = {
    agentId: meta.agentId, conversationId: meta.conversationId,
    conversationLabel: meta.conversationLabel,
    operation: `memory:${args.action}`, acquiredAt: new Date()
  };
  let release: (() => void) | undefined;
  try {
    release = writeActions.has(args.action)
      ? await skillLock.acquireWrite('memory', holderBase)
      : await skillLock.acquireRead('memory', holderBase);
    // existing memory logic unchanged
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    release?.();
  }
}
```

---

### 3.6 — Modify `src/skills/scheduler.ts` — Read-Write Lock

```typescript
run: async (args: any, meta: SkillMeta) => {
  const writeActions = new Set(['create', 'delete', 'update', 'pause', 'resume']);
  const holderBase = {
    agentId: meta.agentId, conversationId: meta.conversationId,
    conversationLabel: meta.conversationLabel,
    operation: `scheduler:${args.action}`, acquiredAt: new Date()
  };
  let release: (() => void) | undefined;
  try {
    release = writeActions.has(args.action)
      ? await skillLock.acquireWrite('scheduler', holderBase)
      : await skillLock.acquireRead('scheduler', holderBase);
    // existing scheduler logic unchanged
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    release?.();
  }
}
```

---

### 3.7 — Modify `src/skills/files.ts` — Per-Path Write Lock

```typescript
import path from 'path';

run: async (args: any, meta: SkillMeta) => {
  const writeActions = new Set(['write', 'append', 'delete']);
  if (writeActions.has(args.action) && args.path) {
    const absolutePath = path.resolve(args.path);
    const lockKey = `files:${absolutePath}` as const;
    let release: (() => void) | undefined;
    try {
      release = await skillLock.acquireWrite(lockKey, {
        agentId: meta.agentId, conversationId: meta.conversationId,
        conversationLabel: meta.conversationLabel,
        operation: `files:${args.action}:${absolutePath}`, acquiredAt: new Date()
      });
      // existing files logic unchanged
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      release?.();
    }
  } else {
    // read, list — no lock needed
    // existing files logic unchanged
  }
}
```

---

### 3.8 — Modify `src/skills/pdf.ts` — Per-Path Write Lock on Output Files

```typescript
import path from 'path';

run: async (args: any, meta: SkillMeta) => {
  const writeActions = new Set(['merge', 'split', 'rotate', 'watermark', 'create', 'extract_pages']);
  if (writeActions.has(args.action) && args.output_path) {
    const absolutePath = path.resolve(args.output_path);
    const lockKey = `files:${absolutePath}` as const;
    let release: (() => void) | undefined;
    try {
      release = await skillLock.acquireWrite(lockKey, {
        agentId: meta.agentId, conversationId: meta.conversationId,
        conversationLabel: meta.conversationLabel,
        operation: `pdf:${args.action}:${absolutePath}`, acquiredAt: new Date()
      });
      // existing pdf logic unchanged
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      release?.();
    }
  } else {
    // extract_text, metadata — read only, no lock
    // existing pdf logic unchanged
  }
}
```

---

### 3.9 — Skills Requiring Signature Update Only

These files need the `meta: SkillMeta` parameter added to their `run()` signature. No logic changes.

```typescript
// Add to run() signature in each of these files:
run: async (args: any, meta: SkillMeta) => {
  // existing logic entirely unchanged
}
```

Files: `shell.ts`, `python.ts`, `http.ts`, `network.ts`, `process-manager.ts`, `system-info.ts`, `imagegen.ts`

---

---

## FRONTEND CHANGES

---

### 4.1 — Install Dependencies

```bash
cd dashboard
npm install react-resizable-panels
```

---

### 4.2 — New File: `dashboard/src/types/conversation.ts`

```typescript
export interface ConversationInfo {
  id: string;
  label: string;
  createdAt: string;
  lastActivityAt: string;
  messageCount: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  conversationId: string;
}

export type WorkerStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_lock'
  | 'completed'
  | 'failed'
  | 'timed_out';

export interface WorkerAgentInfo {
  agentId: string;
  parentConversationId: string;
  conversationLabel: string;
  task: string;
  status: WorkerStatus;
  spawnedAt: string;
  completedAt?: string;
  lockWaitInfo?: {
    lockKey: string;
    heldBy: string;
    heldByConversation: string;
  };
}

export interface WorkerLog {
  agentId: string;
  logs: string[];
}
```

---

### 4.3 — New File: `dashboard/src/hooks/useConversations.ts`

```typescript
import { useState, useEffect, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { ConversationInfo, Message } from '../types/conversation';

export function useConversations(socket: Socket) {
  const [conversations, setConversations] = useState<ConversationInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [isWaiting, setIsWaiting] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    socket.emit('conversation:list');

    socket.on('conversation:list', (list: ConversationInfo[]) => {
      setConversations(list);
      if (list.length > 0 && !activeId) setActiveId(list[0].id);
    });

    socket.on('conversation:created', (info: ConversationInfo) => {
      setConversations(prev => [...prev, info]);
      setMessages(prev => ({ ...prev, [info.id]: [] }));
      setActiveId(info.id);
    });

    socket.on('conversation:closed', ({ conversationId }: { conversationId: string }) => {
      setConversations(prev => {
        const remaining = prev.filter(c => c.id !== conversationId);
        if (activeId === conversationId && remaining.length > 0) {
          setActiveId(remaining[0].id);
        }
        return remaining;
      });
      setMessages(prev => {
        const next = { ...prev };
        delete next[conversationId];
        return next;
      });
    });

    socket.on('response', ({ conversationId, text }: {
      conversationId: string; text: string;
    }) => {
      setIsWaiting(prev => ({ ...prev, [conversationId]: false }));
      setMessages(prev => ({
        ...prev,
        [conversationId]: [...(prev[conversationId] ?? []), {
          id: `msg_${Date.now()}`, role: 'assistant', text,
          timestamp: new Date().toISOString(), conversationId
        }]
      }));
    });

    socket.on('conversation:error', ({ message }: { message: string }) => {
      setError(message);
      setTimeout(() => setError(null), 4000);
    });

    return () => {
      socket.off('conversation:list');
      socket.off('conversation:created');
      socket.off('conversation:closed');
      socket.off('response');
      socket.off('conversation:error');
    };
  }, [socket]);

  const createConversation = useCallback(() =>
    socket.emit('conversation:create'), [socket]);

  const closeConversation = useCallback((id: string) =>
    socket.emit('conversation:close', { conversationId: id }), [socket]);

  const sendMessage = useCallback((conversationId: string, text: string) => {
    setMessages(prev => ({
      ...prev,
      [conversationId]: [...(prev[conversationId] ?? []), {
        id: `msg_${Date.now()}`, role: 'user', text,
        timestamp: new Date().toISOString(), conversationId
      }]
    }));
    setIsWaiting(prev => ({ ...prev, [conversationId]: true }));
    socket.emit('message', { text, conversationId });
  }, [socket]);

  return {
    conversations, activeId, messages, isWaiting, error,
    createConversation, closeConversation, sendMessage, setActiveId
  };
}
```

---

### 4.4 — New File: `dashboard/src/hooks/useAgents.ts`

```typescript
import { useState, useEffect, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { WorkerAgentInfo, WorkerLog } from '../types/conversation';

export function useAgents(socket: Socket, conversationId: string | null) {
  const [workers, setWorkers] = useState<WorkerAgentInfo[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [selectedAgentLogs, setSelectedAgentLogs] = useState<WorkerLog | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    socket.emit('agent:list', { conversationId });

    socket.on('agent:update', (data: {
      conversationId: string; workers: WorkerAgentInfo[];
    }) => {
      if (data.conversationId !== conversationId) return;
      setWorkers(data.workers);

      const hasActive = data.workers.some(w =>
        w.status === 'running' || w.status === 'queued' || w.status === 'waiting_for_lock'
      );
      if (hasActive) setIsPanelOpen(true);

      const allTerminal = data.workers.length > 0 && data.workers.every(w =>
        ['completed', 'failed', 'timed_out'].includes(w.status)
      );
      if (allTerminal) setTimeout(() => setIsPanelOpen(false), 3000);
    });

    socket.on('agent:logs', (log: WorkerLog) => setSelectedAgentLogs(log));

    return () => {
      socket.off('agent:update');
      socket.off('agent:logs');
    };
  }, [socket, conversationId]);

  const requestLogs = useCallback((agentId: string) =>
    socket.emit('agent:logs', { agentId }), [socket]);

  const togglePanel = useCallback(() => setIsPanelOpen(p => !p), []);

  const activeCount = workers.filter(w =>
    w.status === 'running' || w.status === 'queued' || w.status === 'waiting_for_lock'
  ).length;

  return { workers, isPanelOpen, selectedAgentLogs, requestLogs, togglePanel, activeCount };
}
```

---

### 4.5 — New File: `dashboard/src/components/WorkerCard.tsx`

```typescript
import type { WorkerAgentInfo } from '../types/conversation';

const STATUS_COLORS: Record<string, string> = {
  queued: '#6b7280', running: '#3b82f6',
  waiting_for_lock: '#f59e0b', completed: '#22c55e',
  failed: '#ef4444', timed_out: '#f97316'
};

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued', running: 'Running',
  waiting_for_lock: 'Waiting for resource', completed: 'Done',
  failed: 'Failed', timed_out: 'Timed out'
};

interface WorkerCardProps {
  worker: WorkerAgentInfo;
  isSuperUser: boolean;
  isLogsSelected: boolean;
  onRequestLogs: (agentId: string) => void;
}

export function WorkerCard({ worker, isSuperUser, isLogsSelected, onRequestLogs }: WorkerCardProps) {
  const elapsed = worker.completedAt
    ? Math.round((new Date(worker.completedAt).getTime() - new Date(worker.spawnedAt).getTime()) / 1000)
    : Math.round((Date.now() - new Date(worker.spawnedAt).getTime()) / 1000);

  return (
    <div className="worker-card">
      <div className="worker-card-header">
        <span className={`status-dot ${worker.status}`}
          style={{ background: STATUS_COLORS[worker.status] }} />
        <span className="worker-status-label">{STATUS_LABELS[worker.status]}</span>
        <span className="worker-elapsed">{elapsed}s</span>
      </div>
      <p className="worker-task">
        {worker.task.slice(0, 120)}{worker.task.length > 120 ? '…' : ''}
      </p>
      {worker.status === 'waiting_for_lock' && worker.lockWaitInfo && (
        <div className="lock-wait-info">
          ⏳ Waiting for <strong>{worker.lockWaitInfo.lockKey}</strong>
          <br />Held by <strong>{worker.lockWaitInfo.heldByConversation}</strong>
        </div>
      )}
      {isSuperUser && ['completed', 'failed'].includes(worker.status) && (
        <button className="view-logs-btn" onClick={() => onRequestLogs(worker.agentId)}>
          {isLogsSelected ? 'Hide Logs' : 'View Logs'}
        </button>
      )}
    </div>
  );
}
```

---

### 4.6 — New File: `dashboard/src/components/ConversationPane.tsx`

```typescript
import { useState, useRef, useEffect } from 'react';
import type { Message, WorkerAgentInfo, WorkerLog } from '../types/conversation';
import { WorkerCard } from './WorkerCard';

interface ConversationPaneProps {
  conversationId: string;
  label: string;
  messages: Message[];
  workers: WorkerAgentInfo[];
  isAgentPanelOpen: boolean;
  activeWorkerCount: number;
  selectedAgentLogs: WorkerLog | null;
  isWaiting: boolean;
  isSuperUser: boolean;
  showCloseButton: boolean;
  onSend: (text: string) => void;
  onClose: () => void;
  onToggleAgentPanel: () => void;
  onRequestLogs: (agentId: string) => void;
}

export function ConversationPane(props: ConversationPaneProps) {
  const [input, setInput] = useState('');
  const [selectedLogAgentId, setSelectedLogAgentId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [props.messages]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
      textareaRef.current.style.height =
        `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  };

  const handleSend = () => {
    if (!input.trim() || props.isWaiting) return;
    props.onSend(input.trim());
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = '44px';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleLogToggle = (agentId: string) => {
    const next = selectedLogAgentId === agentId ? null : agentId;
    setSelectedLogAgentId(next);
    if (next) props.onRequestLogs(agentId);
  };

  return (
    <div className="conversation-pane">
      <div className="pane-header">
        <span className="pane-label">{props.label}</span>
        <div className="pane-header-actions">
          {props.workers.length > 0 && (
            <button className="agent-badge" onClick={props.onToggleAgentPanel}>
              <span className={`status-dot ${props.activeWorkerCount > 0 ? 'running' : 'completed'}`} />
              {props.workers.length} agent{props.workers.length !== 1 ? 's' : ''}
            </button>
          )}
          {props.showCloseButton && (
            <button className="pane-close-btn" onClick={props.onClose}>×</button>
          )}
        </div>
      </div>

      <div className="pane-body">
        <div className="message-list">
          {props.messages.map(msg => (
            <div key={msg.id} className={`message-bubble ${msg.role}`}>
              <div className="message-avatar">
                {msg.role === 'assistant' ? '🤖' : '👤'}
              </div>
              <div className="message-text">{msg.text}</div>
            </div>
          ))}
          {props.isWaiting && (
            <div className="message-bubble assistant">
              <div className="message-avatar">🤖</div>
              <div className="typing-indicator"><span /><span /><span /></div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className={`agent-side-panel ${props.isAgentPanelOpen ? 'open' : ''}`}>
          <div className="agent-panel-header">
            <span>Sub-Agents</span>
            <button onClick={props.onToggleAgentPanel}>×</button>
          </div>
          <div className="agent-panel-body">
            {props.workers.length === 0 && (
              <p className="no-agents-msg">No sub-agents active</p>
            )}
            {props.workers.map(worker => (
              <div key={worker.agentId}>
                <WorkerCard
                  worker={worker}
                  isSuperUser={props.isSuperUser}
                  isLogsSelected={selectedLogAgentId === worker.agentId}
                  onRequestLogs={handleLogToggle}
                />
                {props.isSuperUser &&
                  selectedLogAgentId === worker.agentId &&
                  props.selectedAgentLogs?.agentId === worker.agentId && (
                  <div className="raw-logs-viewer">
                    <pre>{props.selectedAgentLogs.logs.join('\n')}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="pane-input-area">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${props.label}…`}
          disabled={props.isWaiting}
          rows={1}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || props.isWaiting}
          className="send-btn"
        >↑</button>
      </div>
    </div>
  );
}
```

---

### 4.7 — New File: `dashboard/src/components/ChatWorkspace.tsx` (with FIX-7)

**FIX-7:** Uses `React.Fragment` with `key` instead of `<div style={{ display: 'contents' }}>`. `react-resizable-panels` requires `Panel` and `PanelResizeHandle` to be direct children of `PanelGroup` — a wrapper div breaks this even with `display: contents`.

```typescript
import React from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import type { Socket } from 'socket.io-client';
import { useConversations } from '../hooks/useConversations';
import { useAgents } from '../hooks/useAgents';
import { ConversationPane } from './ConversationPane';

interface ChatWorkspaceProps {
  socket: Socket;
  isSuperUser: boolean;
}

function PaneWithAgents({ conversationId, label, messages, isWaiting,
  isSuperUser, showCloseButton, socket, onSend, onClose }: any) {
  const {
    workers, isPanelOpen, selectedAgentLogs,
    requestLogs, togglePanel, activeCount
  } = useAgents(socket, conversationId);

  return (
    <ConversationPane
      conversationId={conversationId} label={label}
      messages={messages} workers={workers}
      isAgentPanelOpen={isPanelOpen} activeWorkerCount={activeCount}
      selectedAgentLogs={selectedAgentLogs} isWaiting={isWaiting}
      isSuperUser={isSuperUser} showCloseButton={showCloseButton}
      onSend={onSend} onClose={onClose}
      onToggleAgentPanel={togglePanel} onRequestLogs={requestLogs}
    />
  );
}

export function ChatWorkspace({ socket, isSuperUser }: ChatWorkspaceProps) {
  const {
    conversations, messages, isWaiting, error,
    createConversation, closeConversation, sendMessage
  } = useConversations(socket);

  return (
    <div className="chat-workspace">
      {error && <div className="workspace-error-toast">{error}</div>}

      {conversations.length === 0 ? (
        <div className="workspace-empty">
          <p>No active chats</p>
          <button onClick={createConversation}>Start Chat</button>
        </div>
      ) : (
        <PanelGroup direction="horizontal" className="panel-group">
          {conversations.map((convo, index) => (
            // FIX-7: React.Fragment with key — Panel and PanelResizeHandle are
            // direct children of PanelGroup as required by react-resizable-panels
            <React.Fragment key={convo.id}>
              <Panel minSize={20}>
                <PaneWithAgents
                  conversationId={convo.id}
                  label={convo.label}
                  messages={messages[convo.id] ?? []}
                  isWaiting={isWaiting[convo.id] ?? false}
                  isSuperUser={isSuperUser}
                  showCloseButton={conversations.length > 1}
                  socket={socket}
                  onSend={(text: string) => sendMessage(convo.id, text)}
                  onClose={() => closeConversation(convo.id)}
                />
              </Panel>
              {index < conversations.length - 1 && (
                <PanelResizeHandle className="panel-resize-handle" />
              )}
            </React.Fragment>
          ))}
        </PanelGroup>
      )}

      {conversations.length < 3 && (
        <button
          className="add-pane-btn"
          onClick={createConversation}
          title="Open new chat"
        >+</button>
      )}
    </div>
  );
}
```

---

### 4.8 — Modify `dashboard/src/App.tsx`

```typescript
import { ChatWorkspace } from './components/ChatWorkspace';

// Add to component state:
const [isSuperUser, setIsSuperUser] = useState(false);

// Add keyboard shortcut in useEffect:
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      setIsSuperUser(prev => !prev);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);

// Replace existing single-chat render with:
<ChatWorkspace socket={socket} isSuperUser={isSuperUser} />

// All other sidebar sections (Metrics, Audit, Skills, Activity) — unchanged
```

---

### 4.9 — CSS Additions to `dashboard/src/index.css`

Append to end of file. Do not modify any existing styles.

```css
/* ===== MULTI-CHAT WORKSPACE ===== */
.chat-workspace {
  display: flex; height: 100%; width: 100%;
  position: relative; overflow: hidden;
}
.panel-group { width: 100%; height: 100%; }
.panel-resize-handle {
  width: 4px; background: rgba(255,255,255,0.04);
  cursor: col-resize; transition: background 0.2s; flex-shrink: 0;
}
.panel-resize-handle:hover,
.panel-resize-handle[data-resize-handle-active] { background: rgba(255,255,255,0.18); }

/* ===== CONVERSATION PANE ===== */
.conversation-pane {
  display: flex; flex-direction: column; height: 100%;
  border-right: 1px solid rgba(255,255,255,0.05); position: relative;
}
.pane-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px; border-bottom: 1px solid rgba(255,255,255,0.06);
  height: 44px; flex-shrink: 0; background: rgba(255,255,255,0.02);
}
.pane-label { font-size: 13px; font-weight: 600; opacity: 0.8; }
.pane-header-actions { display: flex; align-items: center; gap: 8px; }
.pane-close-btn {
  opacity: 0.4; font-size: 18px; line-height: 1; padding: 2px 6px;
  border-radius: 4px; cursor: pointer; background: none; border: none;
  color: inherit; transition: opacity 0.15s;
}
.pane-close-btn:hover { opacity: 0.9; background: rgba(255,255,255,0.08); }
.agent-badge {
  display: flex; align-items: center; gap: 6px; font-size: 11px;
  padding: 3px 8px; border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.04); cursor: pointer;
  color: inherit; transition: background 0.15s;
}
.agent-badge:hover { background: rgba(255,255,255,0.08); }
.pane-body { flex: 1; display: flex; overflow: hidden; position: relative; }

/* ===== MESSAGES ===== */
.message-list {
  flex: 1; overflow-y: auto; padding: 16px;
  display: flex; flex-direction: column; gap: 12px;
}
.message-bubble { display: flex; gap: 10px; max-width: 90%; }
.message-bubble.user { align-self: flex-end; flex-direction: row-reverse; }
.message-bubble.assistant { align-self: flex-start; }
.message-avatar {
  width: 28px; height: 28px; border-radius: 6px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; background: rgba(255,255,255,0.06);
}
.message-text {
  padding: 10px 14px; border-radius: 10px;
  font-size: 14px; line-height: 1.5; background: rgba(255,255,255,0.05);
}
.message-bubble.user .message-text {
  background: var(--accent-primary, #6366f1); color: white;
}

/* ===== INPUT AREA ===== */
.pane-input-area {
  display: flex; align-items: flex-end; gap: 8px;
  padding: 12px; border-top: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
}
.pane-input-area textarea {
  flex: 1; resize: none; border-radius: 10px; padding: 10px 14px;
  font-size: 14px; min-height: 44px; max-height: 160px;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
  color: inherit; font-family: inherit; transition: border-color 0.15s;
}
.pane-input-area textarea:focus { outline: none; border-color: rgba(255,255,255,0.2); }
.send-btn {
  width: 36px; height: 36px; border-radius: 8px; border: none;
  background: var(--accent-primary, #6366f1); color: white; font-size: 16px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0; transition: opacity 0.15s;
}
.send-btn:disabled { opacity: 0.3; cursor: not-allowed; }

/* ===== AGENT SIDE PANEL ===== */
.agent-side-panel {
  position: absolute; right: 0; top: 0; bottom: 0; width: 280px;
  background: rgba(15,15,20,0.92); backdrop-filter: blur(16px);
  border-left: 1px solid rgba(255,255,255,0.07);
  transform: translateX(100%);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 10; display: flex; flex-direction: column;
}
.agent-side-panel.open { transform: translateX(0); }
.agent-panel-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.06);
  font-size: 12px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.05em; opacity: 0.6;
}
.agent-panel-body {
  flex: 1; overflow-y: auto; padding: 10px;
  display: flex; flex-direction: column; gap: 8px;
}

/* ===== WORKER CARDS ===== */
.worker-card {
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
  border-radius: 8px; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 6px;
}
.worker-card-header { display: flex; align-items: center; gap: 8px; }
.worker-status-label { font-size: 11px; font-weight: 600; opacity: 0.7; flex: 1; }
.worker-elapsed { font-size: 11px; opacity: 0.4; font-variant-numeric: tabular-nums; }
.worker-task { font-size: 12px; opacity: 0.6; line-height: 1.4; margin: 0; }
.lock-wait-info {
  font-size: 11px; opacity: 0.7; line-height: 1.5;
  background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2);
  border-radius: 4px; padding: 4px 8px;
}
.view-logs-btn {
  font-size: 11px; padding: 3px 8px; border-radius: 4px; align-self: flex-start;
  border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04);
  color: inherit; cursor: pointer; transition: background 0.15s;
}
.view-logs-btn:hover { background: rgba(255,255,255,0.08); }
.raw-logs-viewer {
  background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 6px; padding: 8px; max-height: 200px; overflow-y: auto;
}
.raw-logs-viewer pre {
  font-size: 10px; font-family: 'JetBrains Mono', monospace; margin: 0;
  white-space: pre-wrap; word-break: break-all; opacity: 0.7;
}
.no-agents-msg { font-size: 12px; opacity: 0.3; text-align: center; padding: 20px; }

/* ===== STATUS DOTS ===== */
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.status-dot.queued           { background: #6b7280; }
.status-dot.running          { background: #3b82f6; animation: pulse-dot 1.5s infinite; }
.status-dot.waiting_for_lock { background: #f59e0b; animation: pulse-dot 1.5s infinite; }
.status-dot.completed        { background: #22c55e; }
.status-dot.failed           { background: #ef4444; }
.status-dot.timed_out        { background: #f97316; }
@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}

/* ===== ADD PANE BUTTON ===== */
.add-pane-btn {
  position: absolute; bottom: 72px; right: 16px;
  width: 40px; height: 40px; border-radius: 50%; border: none;
  background: var(--accent-primary, #6366f1); color: white; font-size: 22px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; z-index: 20; box-shadow: 0 4px 16px rgba(0,0,0,0.35);
  transition: transform 0.15s, box-shadow 0.15s;
}
.add-pane-btn:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,0,0,0.45); }

/* ===== WORKSPACE STATES ===== */
.workspace-empty {
  width: 100%; height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px; opacity: 0.5;
}
.workspace-error-toast {
  position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
  background: rgba(239,68,68,0.9); color: white; z-index: 50;
  padding: 8px 16px; border-radius: 8px; font-size: 13px;
}

/* ===== TYPING INDICATOR ===== */
.typing-indicator { display: flex; gap: 4px; align-items: center; padding: 10px 14px; }
.typing-indicator span {
  width: 6px; height: 6px; background: rgba(255,255,255,0.4);
  border-radius: 50%; animation: typing-bounce 1.2s infinite;
}
.typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
.typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
@keyframes typing-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
```

---

---

## EDGE CASES (CARRIED FORWARD — STILL APPLY)

### EC-3: Slash Commands Are Per-Instance
All 23 slash commands are handled inside `brain.ts`. After refactor, each Brain instance handles its own. `/status` in Chat 2 reports Chat 2's stats. Global commands like `/audit` and `/sessions` query global systems (AuditLogger, SessionManager) and still work correctly. Do not change this logic.

### EC-4: Self-Learning Engine
Writes to `long_term_knowledge.json` asynchronously via `manage_long_term_memory`. With 3 brains active, the `memory` write lock handles concurrent writes automatically. No changes needed to the learning engine.

### EC-5: Context Compaction Is Per-Brain
Auto-compaction at 800k tokens runs independently per Brain instance. `/compact` in Chat 2 compacts Chat 2's brain only. Do not change this logic.

### EC-7: Dashboard State After Server Restart
All Brain instances and ConversationManager state are in-memory. Server restart → empty dashboard → user clicks `+` to start fresh. Sessions saved to disk remain accessible via `/sessions`. Do not add auto-restore logic — this is intentional.

### EC-9: Version Log Entry

After all phases complete and all integration tests pass, add to top of `docs/version_log.md`:

```markdown
## [11.0.0] - 2026-03-XX

### Removed
- **Paperclip AI** — entire integration removed. `src/skills/paperclip.ts`,
  `PaperClip/` directory, `docs/PAPERCLIP_SOP.md`, `docs/PAPERCLIP_SKILL.md` deleted.
  All references removed from brain, skill registry, and documentation.

### Multi-Chat — 3 Independent Panes
- Dashboard splits into up to 3 resizable chat panes via `react-resizable-panels`
- Each pane has its own isolated `Brain` instance, conversation history, and input
- Panes auto-numbered Chat 1 / Chat 2 / Chat 3 — label reused when pane is closed
- `+` button opens new pane (hidden when 3 are open), `×` closes (hidden on last pane)
- On close, conversation history auto-saved to SessionManager (retrievable via `/sessions`)
- Dashboard reconnect syncs pane state; server restart starts fresh (sessions on disk)

### Multi-Agent — 5 Sub-Agent Workers Per Pane
- New `spawn_agent` skill — primary brains spawn up to 5 parallel workers per conversation
- Workers: task string only, no history, no ability to spawn further agents
- Worker overflow queues automatically, runs when a slot frees
- Worker hard timeout: 5 minutes — resolves with error string, never crashes
- Collapsible sub-agent side panel per pane — slides in from right on worker activity
- Worker statuses: queued / running / waiting_for_lock / completed / failed / timed_out
- Superuser raw log viewer: `Ctrl+Shift+D` toggles, View Logs on completed worker cards

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
```

---

---

## IMPLEMENTATION ORDER — COMPLETE SEQUENCE

Read all Edge Cases and PRE-BUILD FIXES before starting. Run TypeScript check after every phase.

### Phase 1 — Paperclip Removal
1. Delete `src/skills/paperclip.ts`
2. Delete `PaperClip/` directory
3. Delete `docs/PAPERCLIP_SOP.md` and `docs/PAPERCLIP_SKILL.md`
4. Remove paperclip import and registration from `src/skills/index.ts`
5. Remove all paperclip references from `src/core/brain.ts`
6. Update `AGENTS.md` — header, remove paperclip lines
7. Update `docs/codebase_documentation.md` — skill list
8. ✅ `npx tsc --noEmit` — 0 errors. `grep -ri "paperclip" src/` — 0 results.

### Phase 2 — Type Foundation
9. Update `src/types/index.ts` — add `Skill` (with meta param) and `SkillMeta` interfaces
10. Add `meta: SkillMeta` signature to all 7 safe skills: `shell.ts`, `python.ts`, `http.ts`, `network.ts`, `process-manager.ts`, `system-info.ts`, `imagegen.ts` — signature only, no logic changes
11. ✅ `npx tsc --noEmit` — 0 errors

### Phase 3 — EventBus Patch (FIX-4)
12. Open `src/core/events.ts`
13. Verify `off()` / `removeListener()` method exists — if not, add it (section 2.5)
14. Add all 12 new event constants including `skill:lock_waiting` (section 2.5)
15. ✅ `npx tsc --noEmit` — 0 errors

### Phase 4 — Brain Refactor
16. Refactor `src/core/brain.ts` — singleton to class, `BrainConfig`, `abort()` + `aborted` flag, abort check before every skill invocation, `buildMeta()`, update all event emissions, parallel tool dedup for exclusive-lock skills, worker system prompt guardrail, temporary legacy export (section 2.1)
17. ✅ `npx tsc --noEmit` — 0 errors

### Phase 5 — Skill Lock System
18. Create `src/core/skill-lock.ts` — no agentRegistry import, emits Event Bus events only (section 3.1 / FIX-1)
19. ✅ `npx tsc --noEmit` — 0 errors
20. Modify `src/skills/browser.ts` — `browser_vision` exclusive lock (section 3.2)
21. Modify `src/skills/vision.ts` — `browser_vision` exclusive lock (section 3.3)
22. Modify `src/skills/clipboard.ts` — `clipboard` exclusive lock (section 3.4)
23. Modify `src/skills/memory.ts` — read-write lock (section 3.5)
24. Modify `src/skills/scheduler.ts` — read-write lock (section 3.6)
25. Modify `src/skills/files.ts` — per-path write lock (section 3.7)
26. Modify `src/skills/pdf.ts` — per-path write lock on output files (section 3.8)
27. ✅ `npx tsc --noEmit` — 0 errors

### Phase 6 — Core Backend Systems
28. Modify `src/core/sessions.ts` — add `saveSession` static method (section 2.4)
29. Create `src/core/agent-registry.ts` — lazy Brain import, Event Bus lock subscriptions in constructor, `conversationLabel` in spawn chain (section 2.6 / FIX-2, FIX-4, FIX-5)
30. Create `src/core/telegram-brain.ts` — neutral file, no circular imports (section 2.2 / FIX-3)
31. Create `src/core/conversation-manager.ts` — including `getOrCreateDefault()` (section 2.3)
32. ✅ `npx tsc --noEmit` — 0 errors

### Phase 7 — Agent Spawn Skill
33. Create `src/skills/agent-spawn.ts` — passes `meta.conversationLabel` to spawn (section 2.7 / FIX-5)
34. Register `agentSpawnSkill` in `src/skills/index.ts`
35. ✅ `npx tsc --noEmit` — 0 errors

### Phase 8 — Server Wiring + Legacy Cleanup
36. Update `src/interfaces/telegram.ts` — import `telegramBrain` from `../core/telegram-brain.js`, replace all `brain.chat()` calls (section 2.2 / FIX-3)
37. Modify `src/index.ts`:
    - Import `conversationManager`, `agentRegistry`, `skillLock`, `telegramBrain`
    - Update `message` socket handler to use `conversationId` payload
    - Add new socket events: `conversation:create/close/list`, `agent:list`, `agent:logs`
    - Add Event Bus subscriptions for agent status push
    - Re-wire tool streaming via Event Bus — remove old `onUpdate` callback (FIX-6)
    - Update `POST /api/chat` to use `getOrCreateDefault()`
    - Add new REST endpoints: conversations, agents, locks
    - Update graceful shutdown to call `conversationManager.closeAll()`
38. **FIX-8 — Remove legacy_default Brain export from `brain.ts`**
39. Run `grep -rn "import.*brain.*from.*brain" src/` — fix any remaining singleton imports
40. ✅ `npx tsc --noEmit` — 0 errors
41. Start server. Verify:
    - `POST /api/conversations` → `{ id, label: "Chat 1", ... }`
    - `GET /api/conversations` → array with 1 item
    - `GET /api/locks` → `{}`
    - `POST /api/chat` with `{ message: "hello" }` → `{ response, conversationId }`
    - Socket `message` with `{ text, conversationId }` → `response` with `{ conversationId, text }`
    - Telegram still responds if configured

### Phase 9 — Frontend
42. `cd dashboard && npm install react-resizable-panels`
43. Create `dashboard/src/types/conversation.ts` (section 4.2)
44. Create `dashboard/src/hooks/useConversations.ts` (section 4.3)
45. Create `dashboard/src/hooks/useAgents.ts` (section 4.4)
46. Create `dashboard/src/components/WorkerCard.tsx` (section 4.5)
47. Create `dashboard/src/components/ConversationPane.tsx` (section 4.6)
48. Create `dashboard/src/components/ChatWorkspace.tsx` — using `React.Fragment` (section 4.7 / FIX-7)
49. Modify `dashboard/src/App.tsx` — render `ChatWorkspace`, add superuser toggle (section 4.8)
50. Append CSS to `dashboard/src/index.css` (section 4.9)
51. Start dashboard. Verify:
    - Single pane loads, chat works end to end
    - `+` opens Chat 2; both panes fully independent
    - Chat 3 opens, `+` disappears
    - `×` closes a pane, remaining fill space
    - `×` hidden when only 1 pane open
    - Tool progress updates still appear during AI thinking (FIX-6 verified)

### Phase 10 — Integration Testing
52. **Sub-agent flow** — trigger `spawn_agent`, verify AgentSidePanel opens, status updates real-time, result in parent chat, panel auto-closes 3s after completion
53. **Skill lock contention** — two panes trigger browser simultaneously → second shows `waiting_for_lock` amber status with correct "Held by: Chat X" → after first completes, second proceeds → `GET /api/locks` shows lock while held, empty after release
54. **Agent queue** — spawn 5 workers → 6th shows `queued` → completes worker → 6th moves to `running`
55. **Parallel independence** — messages to Chat 1 and Chat 2 simultaneously → responses arrive in correct panes only, never crossed
56. **Pane close + session save** — close Chat 1 → run `/sessions` in Chat 2 → `chat-1` session in list → `/restore <id>` → history restored
57. **Superuser toggle** — `Ctrl+Shift+D` → complete a worker → View Logs button appears → logs show raw JSON → `Ctrl+Shift+D` again → button disappears
58. **Worker kill + lock release** — start long browser worker → close pane mid-execution → `GET /api/locks` must be empty after close (confirms FIX abort chain worked)
59. **Telegram unchanged** — send Telegram message → receives response → `GET /api/conversations` does NOT include Telegram entry
60. **`/api/chat` REST** — `POST /api/chat` with no panes → creates Chat 1 → second call → reuses Chat 1 → response includes `conversationId`
61. **Parallel tool self-deadlock** — craft prompt that would cause two browser calls in one `Promise.all` batch → verify it does not deadlock (second call runs after first returns)
62. **Tool streaming** — verify tool progress updates still appear in dashboard during AI thinking in each pane independently (FIX-6)
63. **Graceful shutdown** — 3 panes with history → `Ctrl+C` → check `memory/sessions/` → 3 session files saved
64. **EventBus off() no leak** — after workers complete, verify event listener count does not grow unboundedly across multiple spawn/complete cycles (FIX-4)

---

## FILES CHANGED — COMPLETE LIST

### Deleted
```
src/skills/paperclip.ts
PaperClip/                              (entire directory)
docs/PAPERCLIP_SOP.md
docs/PAPERCLIP_SKILL.md
```

### Created
```
src/core/telegram-brain.ts             (FIX-3 — neutral file, no circular imports)
src/core/skill-lock.ts                 (FIX-1 — no agentRegistry import)
src/core/conversation-manager.ts
src/core/agent-registry.ts             (FIX-2 — lazy Brain import; FIX-4 — uses off(); FIX-5 — label)
src/skills/agent-spawn.ts              (FIX-5 — passes conversationLabel)
dashboard/src/types/conversation.ts
dashboard/src/hooks/useConversations.ts
dashboard/src/hooks/useAgents.ts
dashboard/src/components/WorkerCard.tsx
dashboard/src/components/ConversationPane.tsx
dashboard/src/components/ChatWorkspace.tsx  (FIX-7 — React.Fragment)
```

### Modified
```
src/types/index.ts                      (Skill + SkillMeta interfaces)
src/core/brain.ts                       (class, BrainConfig, abort, meta, events, dedup, guardrail)
src/core/events.ts                      (FIX-4 off() method; 12 new event constants)
src/core/sessions.ts                    (saveSession added)
src/skills/index.ts                     (register agent-spawn, remove paperclip)
src/skills/browser.ts                   (browser_vision exclusive lock)
src/skills/vision.ts                    (browser_vision exclusive lock)
src/skills/clipboard.ts                 (clipboard exclusive lock)
src/skills/memory.ts                    (read-write lock)
src/skills/scheduler.ts                 (read-write lock)
src/skills/files.ts                     (per-path write lock)
src/skills/pdf.ts                       (per-path write lock on output files)
src/skills/shell.ts                     (meta param signature only)
src/skills/python.ts                    (meta param signature only)
src/skills/http.ts                      (meta param signature only)
src/skills/network.ts                   (meta param signature only)
src/skills/process-manager.ts           (meta param signature only)
src/skills/system-info.ts              (meta param signature only)
src/skills/imagegen.ts                  (meta param signature only)
src/interfaces/telegram.ts             (FIX-3 — use telegramBrain from telegram-brain.ts)
src/index.ts                            (FIX-6 tool streaming; FIX-8 legacy removal; all wiring)
dashboard/src/App.tsx                   (ChatWorkspace, superuser toggle)
dashboard/src/index.css                 (new CSS appended)
AGENTS.md                               (header, paperclip removal)
docs/codebase_documentation.md         (skill list update)
docs/version_log.md                     (v11.0.0 entry at top)
```

---

## CONSTRAINTS & RULES FOR IMPLEMENTING AGENT

1. **Run `npx tsc --noEmit` after every phase.** Do not proceed on errors.
2. **Do not change ports** — backend 3000, dashboard 5173.
3. **`spawn_agent` must NEVER appear in a worker Brain's Gemini tool list.** Enforced in Brain constructor. Non-negotiable.
4. **Workers receive only their task string** — no conversation history.
5. **Superuser toggle (`Ctrl+Shift+D`) defaults OFF.** No visual indicator of toggle state.
6. **Skill locks are held per-execution only.** Acquired at `run()` entry, released in `finally`. Never held between calls.
7. **Lock timeouts return as result strings** — `{ success: false, error: err.message }`. Never let timeout errors throw uncaught to the user.
8. **`brain.abort()` must be called before `worker.resolve()` in `kill()`.** The 100ms delay is required. Do not remove it.
9. **`eventBus.off()` must be verified to exist before use** — add it to events.ts if missing (Phase 3).
10. **`skill-lock.ts` must NOT import `agentRegistry`** — use Event Bus events only (FIX-1).
11. **`agent-registry.ts` must use lazy dynamic import for Brain** — `await import('./brain.js')` inside `startWorker()` only (FIX-2).
12. **`telegram-brain.ts` is the only source of `telegramBrain`** — neither `index.ts` nor `telegram.ts` declares it (FIX-3).
13. **Tool streaming must be re-wired via Event Bus** — remove old `onUpdate` callback pattern (FIX-6).
14. **Remove `legacy_default` Brain export at end of Phase 8** — grep for remaining references and fix them all (FIX-8).
15. **Use `React.Fragment` not `div[display:contents]`** in `ChatWorkspace.tsx` (FIX-7).
16. **Do not change existing SessionManager public API** — only add `saveSession`.
17. **Do not rename existing socket event names** — only add new ones.
18. **Do not remove or rename `POST /api/chat`** — update it, keep it working.
19. **Telegram must keep working** — `telegramBrain` is outside `conversationManager.list()`.
20. **Follow ESM import conventions** — `.js` extensions on all local imports.
21. **Follow async/await patterns** — no raw Promise chains except `Promise.race` for lock timeouts.
22. **Update `docs/version_log.md`** with v11.0.0 entry after all 64 integration test steps pass.
