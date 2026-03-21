# PersonalClaw — Todos Feature Implementation Plan
## v13.0.0 — Personal Task Management with AI Integration

> **FINAL** — All design decisions locked. Ready to hand off to implementing LLM.
> Read this entire document before writing a single line of code.

---

## PERSISTENCE GUARANTEE

**Todos survive everything: server reboot, Windows reboot, power cut.**

- Single source of truth: `memory/todos.json` — a plain JSON file on disk
- No in-memory-only state. Every write goes to disk immediately (synchronous write)
- On every server startup, the recurring engine runs to catch any missed schedules
- If `memory/todos.json` does not exist on startup, it is created as `[]` automatically
- The file is never deleted by the system under any circumstances

---

## DECISIONS REFERENCE

| Decision | Answer |
|---|---|
| Storage | `memory/todos.json` — flat file, synchronous write on every mutation |
| Subtask depth | One level only — subtasks are items inside a parent todo, not recursive |
| Recurring behaviour | Template spawns a fresh open copy on schedule. Template itself never completes. Completed instances are preserved in history with `instanceOf` reference |
| Missed recurring todos on reboot | Startup engine checks all recurring templates against last-fired date. If missed, spawns immediately |
| Tags | Free-form strings, lowercase, stored as array. No predefined list |
| Priority | `high`, `medium`, `low` — default is `medium` |
| Source tracking | Every todo records `createdBy` (user/ai/agent/recurring) and `sourceLabel` (agent name or "Chat 1") |
| Quick capture hotkey | DEFERRED — not in v13.0.0 scope. Can be added via global shortcut in a future version |
| Daily briefing | Existing scheduler skill calls `manage_todos` with `action: 'due_today'` — see Phase 9 integration |
| AI access | Full CRUD via `manage_todos` skill — all Brains and org agents have access |
| Org agent todos | Org agents CAN create todos and assign `priority: 'high'`. They CANNOT delete or complete user todos |
| Focus mode | Separate view in TodosTab — locked list of today's todos only, no editing UI |
| Completion stats | Weekly summary computed on-the-fly from completed todos in `todos.json` |
| Socket events | Real-time push to dashboard on every mutation so UI stays in sync across tabs |
| Lock | Read-write lock on `todos` key via existing `skill-lock.ts` — same pattern as memory/scheduler skills |

---

## DATA MODEL

### `memory/todos.json` — Full Schema

```typescript
// The file is an array of Todo objects
type TodosFile = Todo[];

interface Todo {
  // Identity
  id: string;                          // "todo_${Date.now()}_${random4}"
  parentId?: string;                   // Set on subtasks — points to parent todo id

  // Content
  title: string;                       // Required. Max 200 chars
  notes?: string;                      // Optional rich description. No limit
  tags: string[];                      // e.g. ["msp", "client", "review"]. Always lowercase

  // Priority + Status
  priority: 'high' | 'medium' | 'low';
  status: 'open' | 'done';

  // Timing
  dueDate?: string;                    // ISO date string "YYYY-MM-DD". No time component
  estimatedMinutes?: number;           // How long this will take. 15, 30, 60, 120, etc.
  createdAt: string;                   // ISO datetime
  completedAt?: string;                // ISO datetime — set when status → done
  updatedAt: string;                   // ISO datetime — updated on every mutation

  // Recurring (only set on template todos)
  recurring?: {
    frequency: 'daily' | 'weekly' | 'monthly';
    days?: number[];                   // For weekly: 0=Sun, 1=Mon, ..., 6=Sat
    dayOfMonth?: number;               // For monthly: 1–31
    lastFiredDate?: string;            // "YYYY-MM-DD" — last date a copy was spawned
  };

  // Source tracking
  createdBy: 'user' | 'ai' | 'agent' | 'recurring';
  sourceLabel?: string;                // "Chat 1", "CTO Agent", "Weekly Recurring", etc.
  sourceType?: 'chat' | 'org_proposal' | 'org_ticket' | 'org_blocker' | 'manual' | 'recurring';
  sourceId?: string;                   // ID of the proposal/ticket that triggered this

  // Instance tracking (for recurring-spawned copies)
  instanceOf?: string;                 // ID of the recurring template that spawned this
  isRecurringTemplate?: boolean;       // True on the template itself
}
```

### Key Invariants

1. A todo with `isRecurringTemplate: true` is NEVER shown in the main todo list — it is a config record only
2. A todo with `parentId` set is a subtask — it is rendered nested under its parent
3. A todo with `instanceOf` set was spawned by a recurring template — deleting it does not delete the template
4. `status: 'done'` todos are never deleted automatically — they build up as history for stats
5. `tags` are always stored lowercase. Input is lowercased before save

---

## RECURRING LOGIC — DETAILED

### How Templates Work

When a user creates a recurring todo (e.g. "Every Monday — Review ConnectWise tickets"), the system creates a `Todo` with:
- `isRecurringTemplate: true`
- `recurring.frequency: 'weekly'`
- `recurring.days: [1]` (Monday)
- `recurring.lastFiredDate: null` initially

The template is **never shown in the UI todo list**. It lives in `todos.json` as a config record.

### When a Copy is Spawned

On server startup AND once per day at midnight (via node-cron in `src/index.ts`):

```
For each todo where isRecurringTemplate === true:
  1. Compute whether today is a fire day (frequency + days/dayOfMonth)
  2. Check if lastFiredDate === today's date
  3. If fire day AND not yet fired today:
     a. Create a new todo copying title, notes, tags, priority, estimatedMinutes
     b. Set dueDate = today
     c. Set createdBy = 'recurring'
     d. Set instanceOf = template.id
     e. Set sourceLabel = 'Recurring Task'
     f. Set status = 'open'
     g. Update template.recurring.lastFiredDate = today
     h. Save todos.json
     i. Emit socket event so dashboard updates in real-time
```

### Missed Schedules on Reboot

If PersonalClaw was offline when a recurring todo should have fired (e.g. reboot at 9am, daily todo fires at midnight):

- On startup, the engine checks `lastFiredDate` against today's date
- If today is a fire day and `lastFiredDate !== today`, it fires immediately
- This means: you reboot at 9am on Monday, your Monday recurring todos appear within seconds of the server starting

**This is the persistence guarantee for recurring todos.**

### Real Examples

| Template | Frequency | Result |
|---|---|---|
| "Review ConnectWise tickets" | Weekly, Monday | New open todo every Monday morning |
| "Send client weekly summary" | Weekly, Friday | New open todo every Friday |
| "Monthly billing review" | Monthly, day 1 | New open todo on 1st of every month |
| "Check overnight agent activity" | Daily | New open todo every morning |
| "Quarterly IT Glue audit" | Monthly, day 1 (set 4x/year manually) | Created monthly, user skips non-quarter months |

---

## PHASE 1 — BACKEND: TodoManager Core

### 1.1 — Create `memory/todos.json`

Create empty file on first run. Never fail if missing.

```json
[]
```

### 1.2 — New File: `src/core/todo-manager.ts`

This is the single source of truth for all todo operations. The skill and the socket handlers both go through this. No direct file access anywhere else.

```typescript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { eventBus, Events } from './events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TODOS_FILE = path.resolve(__dirname, '../../memory/todos.json');

export interface Todo {
  id: string;
  parentId?: string;
  title: string;
  notes?: string;
  tags: string[];
  priority: 'high' | 'medium' | 'low';
  status: 'open' | 'done';
  dueDate?: string;
  estimatedMinutes?: number;
  createdAt: string;
  completedAt?: string;
  updatedAt: string;
  recurring?: {
    frequency: 'daily' | 'weekly' | 'monthly';
    days?: number[];
    dayOfMonth?: number;
    lastFiredDate?: string;
  };
  createdBy: 'user' | 'ai' | 'agent' | 'recurring';
  sourceLabel?: string;
  sourceType?: 'chat' | 'org_proposal' | 'org_ticket' | 'org_blocker' | 'manual' | 'recurring';
  sourceId?: string;
  instanceOf?: string;
  isRecurringTemplate?: boolean;
}

export interface CreateTodoInput {
  title: string;
  notes?: string;
  tags?: string[];
  priority?: 'high' | 'medium' | 'low';
  dueDate?: string;
  estimatedMinutes?: number;
  parentId?: string;
  recurring?: Todo['recurring'];
  createdBy?: Todo['createdBy'];
  sourceLabel?: string;
  sourceType?: Todo['sourceType'];
  sourceId?: string;
}

export interface TodoStats {
  totalOpen: number;
  totalDone: number;
  dueToday: number;
  overdue: number;
  highPriority: number;
  completedThisWeek: number;
  completedByDay: Record<string, number>; // "Mon": 3, "Tue": 5, etc.
}

class TodoManager {
  private todos: Todo[] = [];

  constructor() {
    this.load();
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  private load(): void {
    try {
      if (!fs.existsSync(TODOS_FILE)) {
        fs.mkdirSync(path.dirname(TODOS_FILE), { recursive: true });
        fs.writeFileSync(TODOS_FILE, '[]', 'utf-8');
      }
      const raw = fs.readFileSync(TODOS_FILE, 'utf-8');
      this.todos = JSON.parse(raw);
    } catch {
      // If file is corrupted, start fresh and log — never crash
      console.error('[TodoManager] Failed to load todos.json — starting with empty list');
      this.todos = [];
    }
  }

  private save(): void {
    // Synchronous write — every mutation persists immediately
    // Survive reboots: if Node crashes mid-write, the OS atomic rename pattern
    // is used via a temp file to avoid corruption
    const tempFile = TODOS_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(this.todos, null, 2), 'utf-8');
    fs.renameSync(tempFile, TODOS_FILE);
    eventBus.dispatch(Events.TODOS_UPDATED, { count: this.todos.filter(t => !t.isRecurringTemplate).length }, 'todos');
  }

  private generateId(): string {
    const random = Math.random().toString(36).slice(2, 6);
    return `todo_${Date.now()}_${random}`;
  }

  private today(): string {
    return new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  create(input: CreateTodoInput): Todo {
    const now = new Date().toISOString();
    const isTemplate = !!input.recurring;

    // Enforce single-level subtask depth
    if (input.parentId) {
      const parent = this.todos.find(t => t.id === input.parentId);
      if (!parent) throw new Error(`Parent todo ${input.parentId} not found`);
      if (parent.parentId) throw new Error('Subtasks cannot be nested more than one level deep');
    }

    // Validate dueDate format if provided
    if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
      throw new Error('dueDate must be in YYYY-MM-DD format');
    }

    const todo: Todo = {
      id: this.generateId(),
      title: input.title.slice(0, 200),
      notes: input.notes,
      tags: (input.tags ?? []).map(t => t.toLowerCase()),
      priority: input.priority ?? 'medium',
      status: 'open',
      dueDate: input.dueDate,
      estimatedMinutes: input.estimatedMinutes,
      parentId: input.parentId,
      createdBy: input.createdBy ?? 'user',
      sourceLabel: input.sourceLabel,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      createdAt: now,
      updatedAt: now,
      recurring: input.recurring
        ? { ...input.recurring, lastFiredDate: undefined }
        : undefined,
      isRecurringTemplate: isTemplate || undefined,
    };

    this.todos.push(todo);
    this.save();

    // If recurring, fire immediately for today if today is a match
    if (isTemplate) {
      this.processRecurringTemplate(todo);
    }

    return todo;
  }

  getAll(includeTemplates = false): Todo[] {
    if (includeTemplates) return [...this.todos];
    return this.todos.filter(t => !t.isRecurringTemplate);
  }

  getVisible(): Todo[] {
    // Visible = not a template. Subtasks included (rendered by parent)
    return this.todos.filter(t => !t.isRecurringTemplate);
  }

  getById(id: string): Todo | undefined {
    return this.todos.find(t => t.id === id);
  }

  getDueToday(): Todo[] {
    const today = this.today();
    return this.todos.filter(t =>
      !t.isRecurringTemplate &&
      t.status === 'open' &&
      t.dueDate &&
      t.dueDate <= today // includes overdue
    );
  }

  getOverdue(): Todo[] {
    const today = this.today();
    return this.todos.filter(t =>
      !t.isRecurringTemplate &&
      t.status === 'open' &&
      t.dueDate &&
      t.dueDate < today
    );
  }

  getSubtasks(parentId: string): Todo[] {
    return this.todos.filter(t => t.parentId === parentId);
  }

  complete(id: string): Todo {
    const todo = this.todos.find(t => t.id === id);
    if (!todo) throw new Error(`Todo ${id} not found`);
    if (todo.isRecurringTemplate) throw new Error('Cannot complete a recurring template');
    todo.status = 'done';
    todo.completedAt = new Date().toISOString();
    todo.updatedAt = new Date().toISOString();
    this.save();
    return todo;
  }

  reopen(id: string): Todo {
    const todo = this.todos.find(t => t.id === id);
    if (!todo) throw new Error(`Todo ${id} not found`);
    todo.status = 'open';
    todo.completedAt = undefined;
    todo.updatedAt = new Date().toISOString();
    this.save();
    return todo;
  }

  update(id: string, changes: Partial<Pick<Todo,
    'title' | 'notes' | 'tags' | 'priority' | 'dueDate' | 'estimatedMinutes'
  >>): Todo {
    const todo = this.todos.find(t => t.id === id);
    if (!todo) throw new Error(`Todo ${id} not found`);
    if (changes.title) todo.title = changes.title.slice(0, 200);
    if (changes.notes !== undefined) todo.notes = changes.notes;
    if (changes.tags) todo.tags = changes.tags.map(t => t.toLowerCase());
    if (changes.priority) todo.priority = changes.priority;
    if (changes.dueDate !== undefined) todo.dueDate = changes.dueDate;
    if (changes.estimatedMinutes !== undefined) todo.estimatedMinutes = changes.estimatedMinutes;
    todo.updatedAt = new Date().toISOString();
    this.save();
    return todo;
  }

  delete(id: string): void {
    const todo = this.todos.find(t => t.id === id);
    if (!todo) throw new Error(`Todo ${id} not found`);
    // Deleting a parent also deletes its subtasks
    this.todos = this.todos.filter(t => t.id !== id && t.parentId !== id);
    // Deleting a recurring template removes it but preserves spawned instances
    this.save();
  }

  // ─── Recurring Engine ──────────────────────────────────────────────────────

  // Called on server startup AND by midnight cron
  processAllRecurring(): number {
    let spawned = 0;
    const templates = this.todos.filter(t => t.isRecurringTemplate);
    for (const template of templates) {
      const fired = this.processRecurringTemplate(template);
      if (fired) spawned++;
    }
    return spawned;
  }

  private processRecurringTemplate(template: Todo): boolean {
    if (!template.recurring) return false;
    const today = this.today();
    if (template.recurring.lastFiredDate === today) return false; // already fired today
    if (!this.shouldFireToday(template.recurring)) return false;

    // Spawn a fresh instance
    const now = new Date().toISOString();
    const instance: Todo = {
      id: this.generateId(),
      title: template.title,
      notes: template.notes,
      tags: [...template.tags],
      priority: template.priority,
      status: 'open',
      dueDate: today,
      estimatedMinutes: template.estimatedMinutes,
      createdBy: 'recurring',
      sourceLabel: 'Recurring Task',
      sourceType: 'recurring',
      instanceOf: template.id,
      createdAt: now,
      updatedAt: now,
    };

    // Update lastFiredDate on template
    template.recurring.lastFiredDate = today;
    template.updatedAt = now;

    this.todos.push(instance);
    this.save();

    eventBus.dispatch(Events.TODOS_RECURRING_FIRED, {
      templateId: template.id,
      instanceId: instance.id,
      title: template.title,
    }, 'todos');

    return true;
  }

  private shouldFireToday(recurring: NonNullable<Todo['recurring']>): boolean {
    const now = new Date();
    const day = now.getDay();           // 0=Sun ... 6=Sat
    const date = now.getDate();         // 1–31

    if (recurring.frequency === 'daily') return true;

    if (recurring.frequency === 'weekly') {
      return (recurring.days ?? []).includes(day);
    }

    if (recurring.frequency === 'monthly') {
      return recurring.dayOfMonth === date;
    }

    return false;
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  getStats(): TodoStats {
    const today = this.today();
    const visible = this.getVisible();

    // Week boundaries (Mon–Sun)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const completedByDay: Record<string, number> = {
      Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0
    };

    let completedThisWeek = 0;

    for (const t of visible) {
      if (t.status === 'done' && t.completedAt) {
        const completedDate = new Date(t.completedAt);
        if (completedDate >= monday) {
          completedThisWeek++;
          completedByDay[dayNames[completedDate.getDay()]]++;
        }
      }
    }

    return {
      totalOpen: visible.filter(t => t.status === 'open' && !t.parentId).length,
      totalDone: visible.filter(t => t.status === 'done').length,
      dueToday: visible.filter(t =>
        t.status === 'open' && t.dueDate && t.dueDate === today
      ).length,
      overdue: visible.filter(t =>
        t.status === 'open' && t.dueDate && t.dueDate < today
      ).length,
      highPriority: visible.filter(t =>
        t.status === 'open' && t.priority === 'high'
      ).length,
      completedThisWeek,
      completedByDay,
    };
  }

  // ─── Filtered Queries (used by skill) ─────────────────────────────────────

  query(filters: {
    status?: 'open' | 'done' | 'all';
    priority?: 'high' | 'medium' | 'low';
    tag?: string;
    dueToday?: boolean;
    parentId?: string | null; // null = top-level only
  }): Todo[] {
    let results = this.getVisible();

    if (filters.status && filters.status !== 'all') {
      results = results.filter(t => t.status === filters.status);
    }
    if (filters.priority) {
      results = results.filter(t => t.priority === filters.priority);
    }
    if (filters.tag) {
      results = results.filter(t => t.tags.includes(filters.tag!.toLowerCase()));
    }
    if (filters.dueToday) {
      const today = this.today();
      results = results.filter(t => t.dueDate && t.dueDate <= today);
    }
    if (filters.parentId === null) {
      results = results.filter(t => !t.parentId);
    } else if (filters.parentId) {
      results = results.filter(t => t.parentId === filters.parentId);
    }

    // Sort: open before done, then high→medium→low, then by dueDate
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    results.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      if (a.priority !== b.priority) return priorityOrder[a.priority] - priorityOrder[b.priority];
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    });

    return results;
  }
}

export const todoManager = new TodoManager();
```

---

## PHASE 2 — SKILL: `src/skills/todos.ts`

This is what the AI uses. Every Brain, every org agent, every chat pane. Full CRUD + query.

```typescript
import { todoManager } from '../core/todo-manager.js';
import { skillLock } from '../core/skill-lock.js';
import type { Skill, SkillMeta } from '../types/skill.js';

export const todosSkill: Skill = {
  name: 'manage_todos',
  description: `Manage the user's personal todo list. Use this when the user asks to add, view, update, complete, or delete tasks or todos.

WHEN TO USE:
- User says "add to my todo", "remind me to", "put on my list", "I need to remember to"
- User asks "what's on my list", "what do I have today", "show my todos"
- User says "mark X as done", "I finished X", "check off X"
- An org agent wants to create a task for the human to review (set createdBy: 'agent', priority: 'high')

ACTIONS:
- create: Add a new todo. Use natural language parsing for due dates.
- list: Get todos with optional filters. Default shows all open top-level todos.
- due_today: Get all open todos due today + overdue. Best action for morning briefings.
- complete: Mark a todo done. Requires todo id.
- reopen: Uncheck a completed todo.
- update: Edit any field of a todo.
- delete: Remove a todo permanently (and its subtasks).
- add_subtask: Add a subtask under an existing parent todo.
- create_recurring: Create a recurring todo template (spawns copies on schedule).
- list_recurring: List all recurring templates.
- delete_recurring: Delete a recurring template (stops future spawns, keeps past instances).
- stats: Get completion stats for the week.

IMPORTANT FOR ORG AGENTS:
- Always set createdBy: 'agent' and sourceLabel: your agent name (e.g. "CTO Agent")
- Always set sourceType appropriately (org_proposal, org_ticket, org_blocker)
- Always set sourceId to the relevant proposal/ticket ID
- Set priority: 'high' when human review is genuinely urgent
- Do NOT delete or complete human todos — only create and update`,

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'create', 'list', 'due_today', 'complete', 'reopen',
          'update', 'delete', 'add_subtask', 'create_recurring',
          'list_recurring', 'delete_recurring', 'stats'
        ],
        description: 'Action to perform'
      },
      id: {
        type: 'string',
        description: 'Todo ID. Required for complete, reopen, update, delete, add_subtask'
      },
      title: {
        type: 'string',
        description: 'Todo title. Required for create, add_subtask, create_recurring'
      },
      notes: {
        type: 'string',
        description: 'Optional description or context for the todo'
      },
      priority: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Priority level. Default: medium'
      },
      dueDate: {
        type: 'string',
        description: 'Due date in YYYY-MM-DD format'
      },
      estimatedMinutes: {
        type: 'number',
        description: 'Estimated time to complete in minutes (15, 30, 60, 120, etc.)'
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for filtering. e.g. ["msp", "client", "review"]'
      },
      // Filter params for list action
      filterStatus: {
        type: 'string',
        enum: ['open', 'done', 'all'],
        description: 'Filter by status. Default: open'
      },
      filterTag: {
        type: 'string',
        description: 'Filter by tag'
      },
      filterPriority: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Filter by priority'
      },
      // Recurring params
      recurringFrequency: {
        type: 'string',
        enum: ['daily', 'weekly', 'monthly'],
        description: 'For create_recurring: how often to repeat'
      },
      recurringDays: {
        type: 'array',
        items: { type: 'number' },
        description: 'For weekly recurring: days of week (0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat)'
      },
      recurringDayOfMonth: {
        type: 'number',
        description: 'For monthly recurring: day of month (1–31)'
      },
      // Source tracking (for org agents)
      createdBy: {
        type: 'string',
        enum: ['user', 'ai', 'agent', 'recurring'],
        description: 'Who created this todo'
      },
      sourceLabel: {
        type: 'string',
        description: 'Human-readable source (e.g. "CTO Agent", "Chat 1")'
      },
      sourceType: {
        type: 'string',
        enum: ['chat', 'org_proposal', 'org_ticket', 'org_blocker', 'manual', 'recurring'],
        description: 'Type of source that created this todo'
      },
      sourceId: {
        type: 'string',
        description: 'ID of the source entity (proposal ID, ticket ID, etc.)'
      },
      // Update fields
      changes: {
        type: 'object',
        description: 'For update action: object with fields to change',
        properties: {
          title: { type: 'string' },
          notes: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          dueDate: { type: 'string' },
          estimatedMinutes: { type: 'number' },
          tags: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    required: ['action']
  },

  run: async (args: any, meta: SkillMeta) => {
    // Use read-write lock — same pattern as memory and scheduler skills
    const writeActions = new Set([
      'create', 'complete', 'reopen', 'update', 'delete',
      'add_subtask', 'create_recurring', 'delete_recurring'
    ]);
    const isWrite = writeActions.has(args.action);

    let release: (() => void) | undefined;
    try {
      release = isWrite
        ? await skillLock.acquireWrite('todos', {
            agentId: meta.agentId,
            conversationId: meta.conversationId,
            conversationLabel: meta.conversationLabel,
            operation: `todos:${args.action}`,
            acquiredAt: new Date()
          })
        : await skillLock.acquireRead('todos', {
            agentId: meta.agentId,
            conversationId: meta.conversationId,
            conversationLabel: meta.conversationLabel,
            operation: `todos:${args.action}`,
            acquiredAt: new Date()
          });

      switch (args.action) {

        case 'create': {
          if (!args.title) return { success: false, error: 'title is required' };
          const todo = todoManager.create({
            title: args.title,
            notes: args.notes,
            tags: args.tags,
            priority: args.priority,
            dueDate: args.dueDate,
            estimatedMinutes: args.estimatedMinutes,
            createdBy: args.createdBy ?? (meta.isWorker ? 'agent' : 'ai'),
            sourceLabel: args.sourceLabel ?? meta.conversationLabel,
            sourceType: args.sourceType ?? 'chat',
            sourceId: args.sourceId,
          });
          return { success: true, todo, message: `Created todo: "${todo.title}"` };
        }

        case 'create_recurring': {
          if (!args.title) return { success: false, error: 'title is required' };
          if (!args.recurringFrequency) return { success: false, error: 'recurringFrequency is required' };
          const template = todoManager.create({
            title: args.title,
            notes: args.notes,
            tags: args.tags,
            priority: args.priority,
            estimatedMinutes: args.estimatedMinutes,
            createdBy: 'user',
            sourceLabel: 'Recurring Setup',
            sourceType: 'manual',
            recurring: {
              frequency: args.recurringFrequency,
              days: args.recurringDays,
              dayOfMonth: args.recurringDayOfMonth,
            }
          });
          return {
            success: true,
            template,
            message: `Created recurring todo: "${template.title}" (${args.recurringFrequency})`
          };
        }

        case 'list': {
          const todos = todoManager.query({
            status: args.filterStatus ?? 'open',
            priority: args.filterPriority,
            tag: args.filterTag,
            parentId: null, // top-level only
          });
          // Attach subtasks to each parent
          const withSubtasks = todos.map(t => ({
            ...t,
            subtasks: todoManager.getSubtasks(t.id)
          }));
          return { success: true, todos: withSubtasks, count: todos.length };
        }

        case 'due_today': {
          const todos = todoManager.getDueToday();
          const stats = todoManager.getStats();
          return {
            success: true,
            todos,
            count: todos.length,
            overdue: stats.overdue,
            message: todos.length === 0
              ? 'No todos due today.'
              : `${todos.length} todo(s) due today (${stats.overdue} overdue).`
          };
        }

        case 'complete': {
          if (!args.id) return { success: false, error: 'id is required' };
          const todo = todoManager.complete(args.id);
          return { success: true, todo, message: `Completed: "${todo.title}"` };
        }

        case 'reopen': {
          if (!args.id) return { success: false, error: 'id is required' };
          const todo = todoManager.reopen(args.id);
          return { success: true, todo, message: `Reopened: "${todo.title}"` };
        }

        case 'update': {
          if (!args.id) return { success: false, error: 'id is required' };
          const todo = todoManager.update(args.id, args.changes ?? {});
          return { success: true, todo, message: `Updated: "${todo.title}"` };
        }

        case 'delete': {
          if (!args.id) return { success: false, error: 'id is required' };
          todoManager.delete(args.id);
          return { success: true, message: `Todo deleted` };
        }

        case 'add_subtask': {
          if (!args.id) return { success: false, error: 'parent id is required' };
          if (!args.title) return { success: false, error: 'title is required' };
          const parent = todoManager.getById(args.id);
          if (!parent) return { success: false, error: `Parent todo ${args.id} not found` };
          const subtask = todoManager.create({
            title: args.title,
            notes: args.notes,
            priority: args.priority ?? parent.priority,
            parentId: args.id,
            createdBy: meta.isWorker ? 'agent' : 'ai',
            sourceLabel: meta.conversationLabel,
          });
          return { success: true, subtask, message: `Subtask added to "${parent.title}"` };
        }

        case 'list_recurring': {
          const templates = todoManager.getAll(true).filter(t => t.isRecurringTemplate);
          return { success: true, templates, count: templates.length };
        }

        case 'delete_recurring': {
          if (!args.id) return { success: false, error: 'id is required' };
          todoManager.delete(args.id);
          return { success: true, message: `Recurring template deleted. Past instances preserved.` };
        }

        case 'stats': {
          const stats = todoManager.getStats();
          return { success: true, stats };
        }

        default:
          return { success: false, error: `Unknown action: ${args.action}` };
      }

    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      release?.();
    }
  }
};
```

---

## PHASE 3 — SKILL LOCK KEY

Add `'todos'` to the `ReadWriteLockKey` type in `src/core/skill-lock.ts`:

```typescript
// BEFORE:
export type ReadWriteLockKey = 'memory' | 'scheduler' | `files:${string}`;

// AFTER:
export type ReadWriteLockKey = 'memory' | 'scheduler' | 'todos' | `files:${string}`;
```

Also add lock timeout in `LOCK_TIMEOUTS`:

```typescript
const LOCK_TIMEOUTS: Record<string, number> = {
  browser_vision: 60_000,
  clipboard: 5_000,
  memory: 5_000,
  scheduler: 5_000,
  todos: 5_000,       // ADD THIS
  files: 10_000
};
```

---

## PHASE 4 — REGISTER SKILL + EVENTBUS CONSTANTS

### `src/skills/index.ts`

```typescript
import { todosSkill } from './todos.js';
// Add todosSkill to the skills array
```

### `src/core/events.ts` — Add new event constants to the `Events` object

```typescript
// ─── v13 Todo Events ──────────────────────────────────────────────
TODOS_UPDATED: 'todos:updated',                   // Any mutation — dashboard re-fetches
TODOS_RECURRING_FIRED: 'todos:recurring_fired',   // A recurring template spawned a new instance
```

Add these inside the `Events` object, before the closing `} as const;`.

---

## PHASE 5 — SERVER WIRING: `src/index.ts`

### 5.1 — Import todoManager

```typescript
import { todoManager } from './core/todo-manager.js';
```

### 5.2 — Run Recurring Engine on Startup

Add immediately after org heartbeat initialization (after orgs are loaded):

```typescript
// Run recurring todo engine on startup — catches any missed schedules from reboot
const recurringSpawned = todoManager.processAllRecurring();
if (recurringSpawned > 0) {
  console.log(`[Todos] Spawned ${recurringSpawned} recurring todo(s) on startup`);
}
```

### 5.3 — Midnight Cron for Recurring Engine

Add after the startup call:

```typescript
// Recurring todos — fire at midnight every day
cron.schedule('0 0 * * *', () => {
  const spawned = todoManager.processAllRecurring();
  if (spawned > 0) {
    console.log(`[Todos] Midnight: spawned ${spawned} recurring todo(s)`);
    io.emit('todos:refresh'); // push to dashboard
  }
});
```

### 5.4 — Socket Events

```typescript
// Client requests full todo list (on tab open / after mutation)
socket.on('todos:get', () => {
  socket.emit('todos:list', {
    todos: todoManager.query({ status: 'open', parentId: null }).map(t => ({
      ...t,
      subtasks: todoManager.getSubtasks(t.id)
    })),
    stats: todoManager.getStats()
  });
});

// Client requests all todos (includes recurring templates for the recurring section)
socket.on('todos:get_all', () => {
  socket.emit('todos:list_all', {
    todos: todoManager.getAll(true),  // true = include recurring templates
    stats: todoManager.getStats()
  });
});
```

### 5.5 — Broadcast on mutation

EventBus `todos:updated` → push to all clients:

```typescript
eventBus.on(Events.TODOS_UPDATED, () => {
  io.emit('todos:refresh'); // Dashboard re-fetches on receiving this
});

eventBus.on(Events.TODOS_RECURRING_FIRED, (event: any) => {
  const data = event.data ?? event; // ClawEvent wraps payload in .data
  io.emit('todos:refresh');
  io.emit('activity', {
    id: `act_${Date.now()}`,
    type: 'todos:recurring_fired',
    timestamp: new Date().toISOString(),
    source: 'todos',
    summary: `Recurring todo spawned: "${data.title}"`
  });
});
```

### 5.6 — REST Endpoints

All todo REST endpoints. The dashboard `TodosTab` calls these directly via `fetch()`.

```typescript
// GET /api/todos — list todos with optional status filter
app.get('/api/todos', (req, res) => {
  const status = (req.query.status as string) ?? 'open';
  const todos = todoManager.query({
    status: status as any,
    parentId: null
  }).map(t => ({ ...t, subtasks: todoManager.getSubtasks(t.id) }));
  res.json({ todos, stats: todoManager.getStats() });
});

// GET /api/todos/today — todos due today + overdue
app.get('/api/todos/today', (req, res) => {
  res.json({
    todos: todoManager.getDueToday(),
    stats: todoManager.getStats()
  });
});

// POST /api/todos — create a new todo
app.post('/api/todos', (req, res) => {
  try {
    const todo = todoManager.create(req.body);
    io.emit('todos:refresh');
    res.json({ success: true, todo });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/todos/complete — mark a todo done
app.post('/api/todos/complete', (req, res) => {
  try {
    const todo = todoManager.complete(req.body.id);
    io.emit('todos:refresh');
    res.json({ success: true, todo });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/todos/reopen — reopen a completed todo
app.post('/api/todos/reopen', (req, res) => {
  try {
    const todo = todoManager.reopen(req.body.id);
    io.emit('todos:refresh');
    res.json({ success: true, todo });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/todos/subtask — add a subtask under a parent
app.post('/api/todos/subtask', (req, res) => {
  try {
    const subtask = todoManager.create({
      title: req.body.title,
      parentId: req.body.parentId,
      createdBy: 'user',
      sourceType: 'manual',
    });
    io.emit('todos:refresh');
    res.json({ success: true, subtask });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/todos/:id — delete a todo (and its subtasks)
app.delete('/api/todos/:id', (req, res) => {
  try {
    todoManager.delete(req.params.id);
    io.emit('todos:refresh');
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
```

---

## PHASE 6 — FRONTEND

### 6.1 — New File: `dashboard/src/types/todos.ts`

```typescript
export interface Todo {
  id: string;
  parentId?: string;
  title: string;
  notes?: string;
  tags: string[];
  priority: 'high' | 'medium' | 'low';
  status: 'open' | 'done';
  dueDate?: string;
  estimatedMinutes?: number;
  createdAt: string;
  completedAt?: string;
  updatedAt: string;
  createdBy: 'user' | 'ai' | 'agent' | 'recurring';
  sourceLabel?: string;
  sourceType?: string;
  sourceId?: string;
  instanceOf?: string;
  isRecurringTemplate?: boolean;
  subtasks?: Todo[];            // Attached by server query
}

export interface TodoStats {
  totalOpen: number;
  totalDone: number;
  dueToday: number;
  overdue: number;
  highPriority: number;
  completedThisWeek: number;
  completedByDay: Record<string, number>;
}

export type TodoFilter = 'all' | 'today' | 'high' | 'done' | 'overdue';
```

### 6.2 — New File: `dashboard/src/hooks/useTodos.ts`

```typescript
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Socket } from 'socket.io-client';
import type { Todo, TodoStats, TodoFilter } from '../types/todos';

export function useTodos(socket: Socket) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [stats, setStats] = useState<TodoStats | null>(null);
  const [filter, setFilter] = useState<TodoFilter>('all');
  const [loading, setLoading] = useState(true);

  const fetchTodos = useCallback(() => {
    socket.emit('todos:get_all');
  }, [socket]);

  useEffect(() => {
    // Initial fetch
    fetchTodos();

    socket.on('todos:list_all', (data: { todos: Todo[]; stats: TodoStats }) => {
      setTodos(data.todos);
      setStats(data.stats);
      setLoading(false);
    });

    // Server pushes refresh on any mutation
    socket.on('todos:refresh', fetchTodos);

    return () => {
      socket.off('todos:list_all');
      socket.off('todos:refresh');
    };
  }, [socket, fetchTodos]);

  // Derived filtered list — useMemo since this is computed data, not a callback
  const filtered = useMemo((): Todo[] => {
    const today = new Date().toISOString().split('T')[0];
    const topLevel = todos.filter(t => !t.parentId && !t.isRecurringTemplate);

    switch (filter) {
      case 'today':
        return topLevel.filter(t =>
          t.status === 'open' && t.dueDate && t.dueDate <= today
        );
      case 'high':
        return topLevel.filter(t =>
          t.status === 'open' && t.priority === 'high'
        );
      case 'done':
        return topLevel.filter(t => t.status === 'done');
      case 'overdue':
        return topLevel.filter(t =>
          t.status === 'open' && t.dueDate && t.dueDate < today
        );
      default: // 'all'
        return topLevel.filter(t => t.status === 'open');
    }
  }, [todos, filter]);

  const getSubtasks = useCallback((parentId: string): Todo[] => {
    return todos.filter(t => t.parentId === parentId);
  }, [todos]);

  return {
    todos,
    filtered,
    stats,
    loading,
    filter,
    setFilter,
    getSubtasks,
    refresh: fetchTodos,
  };
}
```

### 6.3 — New File: `dashboard/src/components/TodosTab.tsx`

Full component with:
- Stats bar (open count, due today, overdue, completed this week)
- Filter bar (All / Today / High / Done / Overdue)
- Inline add form (title, priority, due date, tags)
- Todo list with checkboxes, priority dots, due date badges, source badges
- Inline subtask expansion
- Focus mode toggle
- Weekly completion bar chart (simple divs, no library)
- Recurring templates section (collapsible)

```typescript
import { useState, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { Todo, TodoFilter } from '../types/todos';
import { useTodos } from '../hooks/useTodos';

// Priority config
const PRIORITY = {
  high:   { color: '#ef4444', label: 'High',   dot: '🔴' },
  medium: { color: '#f59e0b', label: 'Medium', dot: '🟡' },
  low:    { color: '#22c55e', label: 'Low',    dot: '🟢' },
};

const DAYS_OF_WEEK = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

interface TodosTabProps {
  socket: Socket;
}

function TodoItem({
  todo,
  subtasks,
  onToggle,
  onDelete,
  onAddSubtask,
}: {
  todo: Todo;
  subtasks: Todo[];
  onToggle: (id: string, status: 'open' | 'done') => void;
  onDelete: (id: string) => void;
  onAddSubtask: (parentId: string, title: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [subTitle, setSubTitle] = useState('');
  const today = new Date().toISOString().split('T')[0];
  const isOverdue = todo.dueDate && todo.dueDate < today && todo.status === 'open';

  const handleSubtaskSubmit = () => {
    if (!subTitle.trim()) return;
    onAddSubtask(todo.id, subTitle.trim());
    setSubTitle('');
    setAddingSub(false);
  };

  return (
    <div className={`todo-item ${todo.status === 'done' ? 'done' : ''} priority-${todo.priority}`}>
      <div className="todo-item-main">
        {/* Checkbox */}
        <button
          className={`todo-checkbox ${todo.status === 'done' ? 'checked' : ''}`}
          onClick={() => onToggle(todo.id, todo.status)}
          aria-label={todo.status === 'done' ? 'Reopen' : 'Complete'}
        />

        {/* Priority dot */}
        <span className="todo-priority-dot" title={PRIORITY[todo.priority].label}>
          {PRIORITY[todo.priority].dot}
        </span>

        {/* Title */}
        <span className={`todo-title ${todo.status === 'done' ? 'strikethrough' : ''}`}>
          {todo.title}
        </span>

        {/* Badges */}
        <div className="todo-badges">
          {todo.dueDate && (
            <span className={`todo-due-badge ${isOverdue ? 'overdue' : ''}`}>
              {isOverdue ? '⚠ ' : ''}{todo.dueDate}
            </span>
          )}
          {todo.estimatedMinutes && (
            <span className="todo-time-badge">⏱ {todo.estimatedMinutes}m</span>
          )}
          {todo.tags.map(tag => (
            <span key={tag} className="todo-tag-badge">#{tag}</span>
          ))}
          {(todo.createdBy === 'agent' || todo.createdBy === 'ai') && (
            <span className="todo-source-badge" title={todo.sourceLabel}>
              🤖 {todo.sourceLabel}
            </span>
          )}
          {todo.instanceOf && (
            <span className="todo-recurring-badge" title="Spawned from recurring template">🔁</span>
          )}
        </div>

        {/* Actions */}
        <div className="todo-actions">
          {subtasks.length > 0 && (
            <button className="todo-expand-btn" onClick={() => setExpanded(e => !e)}>
              {expanded ? '▲' : '▼'} {subtasks.length}
            </button>
          )}
          <button className="todo-sub-btn" onClick={() => setAddingSub(a => !a)} title="Add subtask">+</button>
          <button className="todo-delete-btn" onClick={() => onDelete(todo.id)} title="Delete">×</button>
        </div>
      </div>

      {/* Notes */}
      {todo.notes && (
        <div className="todo-notes">{todo.notes}</div>
      )}

      {/* Subtasks */}
      {expanded && subtasks.length > 0 && (
        <div className="todo-subtasks">
          {subtasks.map(sub => (
            <div key={sub.id} className={`subtask-item ${sub.status === 'done' ? 'done' : ''}`}>
              <button
                className={`todo-checkbox small ${sub.status === 'done' ? 'checked' : ''}`}
                onClick={() => onToggle(sub.id, sub.status)}
              />
              <span className={`subtask-title ${sub.status === 'done' ? 'strikethrough' : ''}`}>
                {sub.title}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Add subtask input */}
      {addingSub && (
        <div className="add-subtask-row">
          <input
            autoFocus
            value={subTitle}
            onChange={e => setSubTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSubtaskSubmit();
              if (e.key === 'Escape') setAddingSub(false);
            }}
            placeholder="Subtask title..."
            className="subtask-input"
          />
          <button onClick={handleSubtaskSubmit} className="subtask-add-btn">Add</button>
        </div>
      )}
    </div>
  );
}

export function TodosTab({ socket }: TodosTabProps) {
  const { todos, filtered, stats, loading, filter, setFilter, getSubtasks, refresh } = useTodos(socket);
  const [focusMode, setFocusMode] = useState(false);
  const [addingTodo, setAddingTodo] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [newDue, setNewDue] = useState('');
  const [newTags, setNewTags] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newEstimate, setNewEstimate] = useState('');
  const [showRecurring, setShowRecurring] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);

  const recurringTemplates = todos.filter(t => t.isRecurringTemplate);

  const handleToggle = async (id: string, currentStatus: 'open' | 'done') => {
    const action = currentStatus === 'open' ? 'complete' : 'reopen';
    await fetch(`/api/todos/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    refresh();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/todos/${id}`, { method: 'DELETE' });
    refresh();
  };

  const handleAddSubtask = async (parentId: string, title: string) => {
    await fetch('/api/todos/subtask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, title })
    });
    refresh();
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newTitle.trim(),
        priority: newPriority,
        dueDate: newDue || undefined,
        tags: newTags ? newTags.split(',').map(t => t.trim()).filter(Boolean) : [],
        notes: newNotes || undefined,
        estimatedMinutes: newEstimate ? parseInt(newEstimate) : undefined,
        createdBy: 'user',
        sourceType: 'manual',
      })
    });
    setNewTitle(''); setNewPriority('medium'); setNewDue('');
    setNewTags(''); setNewNotes(''); setNewEstimate('');
    setAddingTodo(false);
    refresh();
  };

  const FILTERS: { key: TodoFilter; label: string }[] = [
    { key: 'all', label: 'All Open' },
    { key: 'today', label: `Today${stats?.dueToday ? ` (${stats.dueToday})` : ''}` },
    { key: 'overdue', label: `Overdue${stats?.overdue ? ` (${stats.overdue})` : ''}` },
    { key: 'high', label: 'High Priority' },
    { key: 'done', label: 'Done' },
  ];

  if (loading) return <div className="todos-loading">Loading todos...</div>;

  // ── Focus Mode ──────────────────────────────────────────────────────────────
  if (focusMode) {
    const today = new Date().toISOString().split('T')[0];
    const focusList = todos.filter(t =>
      !t.parentId && !t.isRecurringTemplate &&
      t.status === 'open' && t.dueDate && t.dueDate <= today
    );
    return (
      <div className="todos-focus-mode">
        <div className="focus-header">
          <h2>Today's Focus</h2>
          <button className="focus-exit-btn" onClick={() => setFocusMode(false)}>Exit Focus</button>
        </div>
        <div className="focus-date">{new Date().toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric'
        })}</div>
        {focusList.length === 0
          ? <div className="focus-empty">Nothing due today. You're clear. 🎉</div>
          : focusList.map(todo => (
            <div key={todo.id} className={`focus-item priority-${todo.priority}`}>
              <button
                className={`todo-checkbox ${todo.status === 'done' ? 'checked' : ''}`}
                onClick={() => handleToggle(todo.id, todo.status)}
              />
              <span className="focus-title">{todo.title}</span>
              <span className="focus-priority">{PRIORITY[todo.priority].dot}</span>
            </div>
          ))
        }
        <div className="focus-progress">
          {focusList.filter(t => t.status === 'done').length} / {focusList.length} done
        </div>
      </div>
    );
  }

  // ── Normal View ─────────────────────────────────────────────────────────────
  return (
    <div className="todos-tab">
      {/* Header */}
      <div className="todos-header">
        <h2 className="todos-title">My Todos</h2>
        <div className="todos-header-actions">
          <button className="focus-mode-btn" onClick={() => setFocusMode(true)}>🎯 Focus</button>
          <button className="add-todo-btn" onClick={() => {
            setAddingTodo(a => !a);
            setTimeout(() => titleRef.current?.focus(), 50);
          }}>+ Add</button>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="todos-stats-bar">
          <div className="stat-chip">
            <span className="stat-number">{stats.totalOpen}</span>
            <span className="stat-label">Open</span>
          </div>
          <div className={`stat-chip ${stats.dueToday > 0 ? 'accent' : ''}`}>
            <span className="stat-number">{stats.dueToday}</span>
            <span className="stat-label">Due Today</span>
          </div>
          <div className={`stat-chip ${stats.overdue > 0 ? 'danger' : ''}`}>
            <span className="stat-number">{stats.overdue}</span>
            <span className="stat-label">Overdue</span>
          </div>
          <div className={`stat-chip ${stats.highPriority > 0 ? 'warning' : ''}`}>
            <span className="stat-number">{stats.highPriority}</span>
            <span className="stat-label">High Priority</span>
          </div>
          <div className="stat-chip">
            <span className="stat-number">{stats.completedThisWeek}</span>
            <span className="stat-label">Done This Week</span>
          </div>
        </div>
      )}

      {/* Weekly Bar Chart */}
      {stats && stats.completedThisWeek > 0 && (
        <div className="todos-weekly-chart">
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => {
            const count = stats.completedByDay[day] ?? 0;
            const max = Math.max(...Object.values(stats.completedByDay), 1);
            return (
              <div key={day} className="chart-col">
                <div className="chart-bar-wrap">
                  <div
                    className="chart-bar"
                    style={{ height: `${(count / max) * 100}%` }}
                    title={`${count} completed`}
                  />
                </div>
                <div className="chart-label">{day}</div>
                {count > 0 && <div className="chart-count">{count}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Filter Bar */}
      <div className="todos-filter-bar">
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={`filter-btn ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >{f.label}</button>
        ))}
      </div>

      {/* Inline Add Form */}
      {addingTodo && (
        <div className="add-todo-form">
          <input
            ref={titleRef}
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setAddingTodo(false); }}
            placeholder="What needs to be done?"
            className="add-todo-title-input"
          />
          <div className="add-todo-fields">
            <select value={newPriority} onChange={e => setNewPriority(e.target.value as any)} className="add-todo-priority">
              <option value="high">🔴 High</option>
              <option value="medium">🟡 Medium</option>
              <option value="low">🟢 Low</option>
            </select>
            <input
              type="date"
              value={newDue}
              onChange={e => setNewDue(e.target.value)}
              className="add-todo-date"
            />
            <input
              value={newTags}
              onChange={e => setNewTags(e.target.value)}
              placeholder="Tags (comma separated)"
              className="add-todo-tags"
            />
            <select value={newEstimate} onChange={e => setNewEstimate(e.target.value)} className="add-todo-estimate">
              <option value="">Time estimate</option>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="60">1 hour</option>
              <option value="120">2 hours</option>
              <option value="240">Half day</option>
            </select>
          </div>
          <textarea
            value={newNotes}
            onChange={e => setNewNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="add-todo-notes"
            rows={2}
          />
          <div className="add-todo-actions">
            <button onClick={handleCreate} className="add-todo-submit-btn">Add Todo</button>
            <button onClick={() => setAddingTodo(false)} className="add-todo-cancel-btn">Cancel</button>
          </div>
        </div>
      )}

      {/* Todo List */}
      <div className="todos-list">
        {filtered.length === 0 ? (
          <div className="todos-empty">
            {filter === 'today' ? 'Nothing due today. 🎉' :
             filter === 'overdue' ? 'No overdue items. 🎉' :
             filter === 'done' ? 'No completed todos yet.' :
             'No todos. Add one above.'}
          </div>
        ) : (
          filtered.map(todo => (
            <TodoItem
              key={todo.id}
              todo={todo}
              subtasks={getSubtasks(todo.id)}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onAddSubtask={handleAddSubtask}
            />
          ))
        )}
      </div>

      {/* Recurring Templates Section */}
      <div className="recurring-section">
        <button
          className="recurring-toggle-btn"
          onClick={() => setShowRecurring(r => !r)}
        >
          🔁 Recurring Templates ({recurringTemplates.length}) {showRecurring ? '▲' : '▼'}
        </button>
        {showRecurring && (
          <div className="recurring-list">
            {recurringTemplates.length === 0 && (
              <div className="recurring-empty">No recurring todos. Ask the AI to create one.</div>
            )}
            {recurringTemplates.map(t => (
              <div key={t.id} className="recurring-item">
                <span className="recurring-title">{t.title}</span>
                <span className="recurring-freq">
                  {t.recurring?.frequency}
                  {t.recurring?.days?.length
                    ? ` (${t.recurring.days.map(d => DAYS_OF_WEEK[d]).join(', ')})`
                    : ''}
                  {t.recurring?.dayOfMonth ? ` (day ${t.recurring.dayOfMonth})` : ''}
                </span>
                <span className="recurring-last">
                  Last: {t.recurring?.lastFiredDate ?? 'never'}
                </span>
                <button className="recurring-delete-btn" onClick={() => handleDelete(t.id)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

### 6.4 — REST Endpoints

> **Note:** All REST endpoints are defined once in Phase 5.6. The dashboard `TodosTab` component calls those endpoints directly. No additional endpoints needed here — Phase 5.6 covers: `GET /api/todos`, `GET /api/todos/today`, `POST /api/todos`, `POST /api/todos/complete`, `POST /api/todos/reopen`, `POST /api/todos/subtask`, `DELETE /api/todos/:id`.

---

## PHASE 7 — WIRE INTO `dashboard/src/App.tsx`

### 7.1 — Add imports

```typescript
import { TodosTab } from './components/TodosTab';
// Add CheckSquare to the existing lucide-react import block:
import { /* ...existing imports... */ CheckSquare } from 'lucide-react';
```

### 7.2 — Update TabType union

```typescript
// BEFORE:
type TabType = 'command' | 'metrics' | 'activity' | 'skills' | 'orgs';

// AFTER:
type TabType = 'command' | 'metrics' | 'activity' | 'todos' | 'skills' | 'orgs';
```

### 7.3 — Add sidebar nav item (after Activity Feed, before Skills & Config)

```tsx
<li className={`nav-item ${activeTab === 'todos' ? 'active' : ''}`} onClick={() => setActiveTab('todos')} title="Todos">
  <CheckSquare size={18} />
  {!sidebarCollapsed && <span>Todos</span>}
</li>
```

### 7.4 — Add tab render (inside `<AnimatePresence>`, between activity and skills)

Must use `<motion.div>` wrapper for consistent tab transitions:

```tsx
{/* ── Todos ── */}
{activeTab === 'todos' && socket && (
  <motion.div
    key="todos"
    initial={{ opacity: 0, x: 20 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: -20 }}
    transition={{ duration: 0.2 }}
    style={{ height: '100%' }}
  >
    <TodosTab socket={socket} />
  </motion.div>
)}
```

---

## PHASE 8 — CSS: Append to `dashboard/src/index.css`

> **IMPORTANT:** Uses existing CSS variables (`var(--accent-primary)`, `var(--text-main)`, `var(--border)`, etc.) for theming consistency. Do NOT use hardcoded hex colors. Reference the `:root` block at the top of `index.css` for available variables.

```css
/* ===== TODOS TAB ===== */
.todos-tab {
  display: flex; flex-direction: column; height: 100%;
  overflow-y: auto; padding: 20px 24px; gap: 16px;
}
.todos-loading { padding: 40px; text-align: center; opacity: 0.5; }

/* Header */
.todos-header {
  display: flex; align-items: center; justify-content: space-between;
}
.todos-title { font-size: 20px; font-weight: 800; color: var(--text-main); margin: 0; }
.todos-header-actions { display: flex; gap: 8px; }
.add-todo-btn {
  padding: 7px 16px; border-radius: 8px; border: none;
  background: var(--accent-primary); color: white; font-weight: 600; font-size: 13px;
  cursor: pointer; transition: var(--transition);
}
.add-todo-btn:hover { opacity: 0.9; }
.focus-mode-btn {
  padding: 7px 14px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--panel-bg); font-size: 13px; font-weight: 600; cursor: pointer;
  color: var(--text-main); transition: var(--transition);
}
.focus-mode-btn:hover { background: var(--input-bg); }

/* Stats Bar */
.todos-stats-bar {
  display: flex; gap: 10px; flex-wrap: wrap;
}
.stat-chip {
  display: flex; flex-direction: column; align-items: center;
  padding: 10px 16px; border-radius: var(--radius); border: 1px solid var(--border-light);
  background: var(--panel-bg); min-width: 80px; box-shadow: var(--shadow-sm);
}
.stat-chip.accent { border-color: var(--accent-primary); background: color-mix(in srgb, var(--accent-primary) 8%, var(--panel-bg)); }
.stat-chip.danger { border-color: var(--accent-danger); background: color-mix(in srgb, var(--accent-danger) 8%, var(--panel-bg)); }
.stat-chip.warning { border-color: var(--accent-warning); background: color-mix(in srgb, var(--accent-warning) 8%, var(--panel-bg)); }
.stat-number { font-size: 22px; font-weight: 800; color: var(--text-main); line-height: 1; }
.stat-chip.danger .stat-number { color: var(--accent-danger); }
.stat-chip.warning .stat-number { color: var(--accent-warning); }
.stat-chip.accent .stat-number { color: var(--accent-primary); }
.stat-label { font-size: 11px; color: var(--text-dim); margin-top: 2px; font-weight: 500; }

/* Weekly Chart */
.todos-weekly-chart {
  display: flex; gap: 8px; align-items: flex-end;
  background: var(--panel-bg); border: 1px solid var(--border-light); border-radius: var(--radius);
  padding: 12px 16px; height: 80px;
}
.chart-col {
  display: flex; flex-direction: column; align-items: center;
  flex: 1; height: 100%; position: relative;
}
.chart-bar-wrap {
  flex: 1; width: 100%; display: flex; align-items: flex-end;
}
.chart-bar {
  width: 100%; background: var(--accent-primary); border-radius: 4px 4px 0 0;
  min-height: 4px; transition: height 0.3s;
}
.chart-label { font-size: 10px; color: var(--text-dim); margin-top: 2px; }
.chart-count { font-size: 10px; font-weight: 700; color: var(--accent-primary); }

/* Filter Bar */
.todos-filter-bar { display: flex; gap: 6px; flex-wrap: wrap; }
.filter-btn {
  padding: 5px 12px; border-radius: 20px; border: 1px solid var(--border);
  background: var(--panel-bg); font-size: 12px; font-weight: 500; cursor: pointer;
  color: var(--text-main); transition: var(--transition);
}
.filter-btn:hover { background: var(--input-bg); }
.filter-btn.active {
  background: var(--accent-primary); color: white; border-color: var(--accent-primary);
}

/* Add Form */
.add-todo-form {
  background: var(--panel-bg); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 14px; display: flex; flex-direction: column; gap: 10px;
  box-shadow: var(--shadow-md);
}
.add-todo-title-input {
  font-size: 15px; font-weight: 600; border: none; outline: none;
  color: var(--text-main); width: 100%; background: transparent;
}
.add-todo-fields { display: flex; gap: 8px; flex-wrap: wrap; }
.add-todo-fields select, .add-todo-fields input {
  padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border);
  font-size: 12px; color: var(--text-main); background: var(--input-bg);
}
.add-todo-notes {
  border: 1px solid var(--border); border-radius: 6px; padding: 8px;
  font-size: 13px; resize: none; color: var(--text-main); background: var(--input-bg);
  font-family: inherit; width: 100%; box-sizing: border-box;
}
.add-todo-actions { display: flex; gap: 8px; }
.add-todo-submit-btn {
  padding: 7px 16px; border-radius: 7px; border: none;
  background: var(--accent-primary); color: white; font-weight: 600; font-size: 13px; cursor: pointer;
}
.add-todo-cancel-btn {
  padding: 7px 14px; border-radius: 7px; border: 1px solid var(--border);
  background: var(--panel-bg); font-size: 13px; cursor: pointer; color: var(--text-main);
}

/* Todo List */
.todos-list { display: flex; flex-direction: column; gap: 6px; }
.todos-empty { padding: 40px; text-align: center; opacity: 0.4; font-size: 14px; }

/* Todo Item */
.todo-item {
  background: var(--panel-bg); border: 1px solid var(--border-light); border-radius: var(--radius);
  padding: 12px 14px; border-left: 4px solid var(--border-light);
  transition: var(--transition);
}
.todo-item:hover { box-shadow: var(--shadow-md); }
.todo-item.priority-high { border-left-color: var(--accent-danger); }
.todo-item.priority-medium { border-left-color: var(--accent-warning); }
.todo-item.priority-low { border-left-color: var(--accent-success); }
.todo-item.done { opacity: 0.55; }

.todo-item-main {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}

/* Checkbox */
.todo-checkbox {
  width: 18px; height: 18px; border-radius: 4px;
  border: 2px solid var(--border); background: var(--panel-bg); cursor: pointer;
  flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  transition: var(--transition);
}
.todo-checkbox.checked {
  background: var(--accent-primary); border-color: var(--accent-primary);
}
.todo-checkbox.checked::after {
  content: '✓'; color: white; font-size: 11px; font-weight: 700;
}
.todo-checkbox.small { width: 14px; height: 14px; }

.todo-priority-dot { font-size: 12px; flex-shrink: 0; }
.todo-title { font-size: 14px; font-weight: 600; color: var(--text-main); flex: 1; }
.todo-title.strikethrough { text-decoration: line-through; opacity: 0.5; }

/* Badges */
.todo-badges { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; }
.todo-due-badge {
  font-size: 11px; padding: 2px 7px; border-radius: 4px;
  background: var(--input-bg); color: var(--text-dim); font-weight: 500;
}
.todo-due-badge.overdue {
  background: color-mix(in srgb, var(--accent-danger) 10%, var(--panel-bg));
  color: var(--accent-danger); font-weight: 700;
}
.todo-time-badge {
  font-size: 11px; padding: 2px 7px; border-radius: 4px;
  background: color-mix(in srgb, var(--accent-primary) 8%, var(--panel-bg));
  color: var(--accent-primary); font-weight: 500;
}
.todo-tag-badge {
  font-size: 11px; padding: 2px 7px; border-radius: 4px;
  background: color-mix(in srgb, var(--accent-secondary) 8%, var(--panel-bg));
  color: var(--accent-secondary);
}
.todo-source-badge {
  font-size: 11px; padding: 2px 7px; border-radius: 4px;
  background: color-mix(in srgb, var(--accent-success) 10%, var(--panel-bg));
  color: var(--accent-success); font-weight: 500;
}
.todo-recurring-badge { font-size: 12px; opacity: 0.7; }

/* Todo Actions */
.todo-actions { display: flex; gap: 4px; margin-left: auto; }
.todo-expand-btn, .todo-sub-btn, .todo-delete-btn {
  padding: 2px 7px; border-radius: 4px; border: 1px solid var(--border-light);
  background: var(--panel-bg); font-size: 12px; cursor: pointer; color: var(--text-dim);
  transition: var(--transition);
}
.todo-expand-btn:hover, .todo-sub-btn:hover { background: var(--input-bg); color: var(--text-main); }
.todo-delete-btn:hover {
  background: color-mix(in srgb, var(--accent-danger) 10%, var(--panel-bg));
  color: var(--accent-danger); border-color: var(--accent-danger);
}

/* Notes */
.todo-notes {
  font-size: 12px; color: var(--text-dim); margin-top: 6px; padding-top: 6px;
  border-top: 1px solid var(--border-light); line-height: 1.5;
}

/* Subtasks */
.todo-subtasks { margin-top: 8px; padding-left: 26px; display: flex; flex-direction: column; gap: 4px; }
.subtask-item {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 0;
}
.subtask-item.done { opacity: 0.5; }
.subtask-title { font-size: 13px; color: var(--text-main); }
.subtask-title.strikethrough { text-decoration: line-through; }
.add-subtask-row {
  margin-top: 8px; padding-left: 26px; display: flex; gap: 6px;
}
.subtask-input {
  flex: 1; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border);
  font-size: 13px; color: var(--text-main); background: var(--input-bg);
}
.subtask-add-btn {
  padding: 4px 12px; border-radius: 6px; border: none;
  background: var(--accent-primary); color: white; font-size: 12px; font-weight: 600; cursor: pointer;
}

/* Focus Mode */
.todos-focus-mode {
  display: flex; flex-direction: column; padding: 40px; gap: 20px;
  max-width: 600px; margin: 0 auto;
}
.focus-header {
  display: flex; justify-content: space-between; align-items: center;
}
.focus-header h2 { font-size: 28px; font-weight: 800; color: var(--text-main); margin: 0; }
.focus-exit-btn {
  padding: 6px 14px; border-radius: 7px; border: 1px solid var(--border);
  background: var(--panel-bg); cursor: pointer; font-size: 13px; color: var(--text-main);
}
.focus-date { font-size: 14px; color: var(--text-dim); margin-top: -12px; }
.focus-item {
  display: flex; align-items: center; gap: 12px; padding: 16px 20px;
  background: var(--panel-bg); border-radius: var(--radius-lg); border: 1px solid var(--border-light);
  border-left: 5px solid var(--border-light);
}
.focus-item.priority-high { border-left-color: var(--accent-danger); }
.focus-item.priority-medium { border-left-color: var(--accent-warning); }
.focus-item.priority-low { border-left-color: var(--accent-success); }
.focus-title { font-size: 16px; font-weight: 600; color: var(--text-main); flex: 1; }
.focus-priority { font-size: 16px; }
.focus-empty { text-align: center; font-size: 18px; color: var(--text-dim); padding: 40px; }
.focus-progress {
  text-align: center; font-size: 13px; color: var(--text-dim);
  border-top: 1px solid var(--border-light); padding-top: 16px;
}

/* Recurring Section */
.recurring-section { margin-top: 8px; }
.recurring-toggle-btn {
  width: 100%; text-align: left; padding: 10px 14px; border-radius: 8px;
  border: 1px solid var(--border-light); background: var(--input-bg); font-size: 13px;
  font-weight: 600; color: var(--text-main); cursor: pointer; transition: var(--transition);
}
.recurring-toggle-btn:hover { background: var(--msg-bot-bg); }
.recurring-list {
  margin-top: 6px; display: flex; flex-direction: column; gap: 6px;
  padding: 10px; background: var(--input-bg); border-radius: 8px;
  border: 1px solid var(--border-light);
}
.recurring-empty { font-size: 12px; color: var(--text-dim); text-align: center; padding: 10px; }
.recurring-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  background: var(--panel-bg); border-radius: 6px; border: 1px solid var(--border-light);
}
.recurring-title { font-size: 13px; font-weight: 600; color: var(--text-main); flex: 1; }
.recurring-freq {
  font-size: 11px; color: var(--accent-secondary);
  background: color-mix(in srgb, var(--accent-secondary) 8%, var(--panel-bg));
  padding: 2px 7px; border-radius: 4px;
}
.recurring-last { font-size: 11px; color: var(--text-dim); }
.recurring-delete-btn {
  padding: 3px 9px; border-radius: 5px; border: 1px solid var(--accent-danger);
  background: color-mix(in srgb, var(--accent-danger) 8%, var(--panel-bg));
  color: var(--accent-danger); font-size: 11px; cursor: pointer;
}
```

---

## IMPLEMENTATION ORDER

Read all sections before starting. Run `npx tsc --noEmit` after each phase.

### Phase 1 — Data Layer
1. Create `memory/todos.json` as empty array `[]`
2. Create `src/core/todo-manager.ts` — full class as specified
3. Add `'todos'` to `ReadWriteLockKey` type in `src/core/skill-lock.ts`
4. Add `todos: 5_000` to `LOCK_TIMEOUTS` in `src/core/skill-lock.ts`
5. ✅ `npx tsc --noEmit` — 0 errors

### Phase 2 — Skill
6. Create `src/skills/todos.ts` — full skill as specified
7. Add `import { todosSkill } from './todos.js'` to `src/skills/index.ts`
8. Add `todosSkill` to skills array in `src/skills/index.ts`
9. ✅ `npx tsc --noEmit` — 0 errors

### Phase 3 — EventBus + Server
10. Add `'todos:updated'` and `'todos:recurring_fired'` to `src/core/events.ts`
11. Add `import { todoManager } from './core/todo-manager.js'` to `src/index.ts`
12. Add recurring engine startup call in `src/index.ts` (after org heartbeat init)
13. Add midnight cron for recurring in `src/index.ts`
14. Add socket event handlers (`todos:get`, `todos:get_all`) in `src/index.ts`
15. Add EventBus listeners for `todos:updated` and `todos:recurring_fired` in `src/index.ts`
16. Add all 6 REST endpoints in `src/index.ts`
17. ✅ `npx tsc --noEmit` — 0 errors
18. Start server. Verify:
    - `GET /api/todos` → `{ todos: [], stats: {...} }`
    - `POST /api/todos` with `{ title: "test", priority: "high", createdBy: "user", sourceType: "manual" }` → todo created
    - `GET /api/todos` → returns the created todo
    - `POST /api/todos/complete` with `{ id: "todo_..." }` → todo marked done
    - Server restart → todo still exists in `GET /api/todos`

### Phase 4 — Frontend
19. Create `dashboard/src/types/todos.ts`
20. Create `dashboard/src/hooks/useTodos.ts`
21. Create `dashboard/src/components/TodosTab.tsx`
22. Add `CheckSquare` import from `lucide-react` in `App.tsx`
23. Add `'todos'` to `TabType` union in `App.tsx`
24. Add Todos nav item to sidebar in `App.tsx` (between Activity and Skills)
25. Add `TodosTab` render in `App.tsx` tab switch (wrapped in `<motion.div>`)
26. Append CSS to `dashboard/src/index.css` — **use CSS variables only, no hardcoded hex colors**
27. Start dashboard. Verify:
    - Todos tab appears in sidebar
    - Stats bar shows correct counts
    - Add form creates a todo
    - Checkbox toggles complete/reopen
    - Delete works
    - Filter bar switches views
    - Due today filter shows correct todos
    - Overdue items show red date badge
    - AI-created todos show 🤖 badge
    - Focus mode opens and shows today's items only
    - Weekly chart renders when completed todos exist

### Phase 5 — Integration Testing
27. **From chat**: "Add a high priority todo to review the ConnectWise billing report by Friday" → verify it appears in dashboard immediately
28. **From chat**: "What's on my todo list for today?" → AI calls `due_today`, returns readable list
29. **From chat**: "Mark the ConnectWise billing todo as done" → AI finds it by title, completes it, dashboard updates in real-time
30. **Recurring test**: Ask AI to "Create a recurring todo every Monday to review open tickets" → template appears in recurring section → manually call `processAllRecurring()` on a Monday → instance appears in list
31. **Org agent test**: Trigger a CTO agent run → agent creates a todo with `createdBy: 'agent'`, `sourceLabel: 'CTO Agent'`, `priority: 'high'` → appears in dashboard with 🤖 badge
32. **Subtask test**: Add a todo from dashboard → expand → add 2 subtasks → check each subtask → verify parent stays open
33. **Persistence test**: Create 3 todos → kill the server (`Ctrl+C`) → restart server → `GET /api/todos` → all 3 still present
34. **Reboot simulation**: Create a daily recurring todo → set `lastFiredDate` to yesterday in `todos.json` directly → restart server → verify instance spawned immediately on startup
35. **Focus mode**: Set 3 todos with dueDate = today → open Focus Mode → verify only those 3 show → check one off → verify progress counter updates
36. **Stats test**: Complete 5 todos → check weekly chart → verify correct day bar increases → restart server → stats still correct (computed from file)
37. **Filter persistence**: Switch to High filter → the filter remembers while on the tab (React state — intentional, no persistence needed)

---

## FILES CHANGED — COMPLETE LIST

### Created
```
memory/todos.json                           — persistent storage (empty array)
src/core/todo-manager.ts                    — TodoManager class, all CRUD + recurring engine
src/skills/todos.ts                         — manage_todos skill (12 actions)
dashboard/src/types/todos.ts                — Todo, TodoStats, TodoFilter types
dashboard/src/hooks/useTodos.ts             — React hook for todo state + socket
dashboard/src/components/TodosTab.tsx       — Full todos UI component
```

### Modified
```
src/core/skill-lock.ts                      — Add 'todos' to ReadWriteLockKey + LOCK_TIMEOUTS
src/core/events.ts                          — Add todos:updated, todos:recurring_fired constants
src/skills/index.ts                         — Register todosSkill
src/index.ts                                — Import todoManager, startup cron, socket handlers, REST endpoints
dashboard/src/App.tsx                       — Add Todos tab to nav + render TodosTab
dashboard/src/index.css                     — Append todos CSS (do not modify existing styles)
docs/version_log.md                         — Add v13.0.0 entry after all tests pass
```

---

## CONSTRAINTS FOR IMPLEMENTING AGENT

1. **Run `npx tsc --noEmit` after every phase. Do not proceed on errors.**
2. **Never use in-memory state as the only store.** Every mutation writes to disk immediately via synchronous `writeFileSync` with temp file + rename pattern.
3. **`isRecurringTemplate: true` todos must never appear in `getVisible()`.** They are config records, not user-facing items.
4. **Recurring engine runs on startup AND at midnight.** Both are required. Missing the startup call breaks the reboot persistence guarantee.
5. **Do not auto-delete completed todos.** They are the source of truth for stats. Only the user can delete them explicitly.
6. **Org agents can create and update todos. They cannot delete or complete user todos.** The skill description makes this clear — the implementing agent must not add delete/complete paths for org agent callers.
7. **Subtasks are one level deep only.** `create()` with a `parentId` that itself has a `parentId` should be rejected with an error.
8. **Tags are always stored lowercase.** Input must be lowercased before save.
9. **The lock key is `'todos'` — read-write pattern, same as memory and scheduler skills.**
10. **Do not modify any existing CSS.** Only append to `index.css`.
11. **Socket event `todos:refresh` is the only push mechanism.** Dashboard re-fetches `todos:get_all` on receiving it. Keep it simple.
12. **The `manage_todos` skill must be available to ALL Brains** — human chat, org agents, sub-agent workers. Register it in the global skill array.
13. **Follow ESM import conventions** — `.js` extensions on all local imports.
14. **Update `docs/version_log.md`** with v13.0.0 entry only after all 37 integration test steps pass.
15. **Use `eventBus.dispatch()`, not `eventBus.emit()`** — the event bus wraps payloads in `ClawEvent { type, data, source }`. Listeners receive the full event object; access payload via `event.data`.
16. **Use CSS variables everywhere in the todos CSS** — `var(--accent-primary)`, `var(--text-main)`, `var(--border)`, etc. No hardcoded hex colors. This ensures theming works.
17. **Validate dueDate format** — reject anything that doesn't match `YYYY-MM-DD` to prevent garbage dates.
18. **Enforce subtask depth at runtime** — `create()` must check if the parent itself has a `parentId` and reject with an error if so.

---

## PHASE 9 — DAILY BRIEFING INTEGRATION

The existing scheduler system can schedule a daily briefing. To integrate todos into it, add the following to the Brain's system prompt (or the scheduler's briefing template):

```
When generating the daily morning briefing, always call manage_todos with action: 'due_today'
to include the user's todo list. Present:
- How many todos are due today and how many are overdue
- List each by priority (high first)
- Mention any recurring todos that fired overnight
```

This requires **no new code** — just update the briefing prompt template to instruct the AI to call `manage_todos`. The skill is already registered globally and available to all Brains.

---

## PHASE 10 — ENHANCEMENTS (implement after core is stable)

These are improvements that make the todo system more powerful. Implement only after Phases 1–8 pass all tests.

### 10.1 — Inline Edit from Dashboard

The current plan only supports creating todos from the dashboard. Users should be able to click a todo title to edit it inline.

**Add to `TodoItem` component:**
- Double-click title → inline `<input>` with current title
- Press Enter → `PUT /api/todos/:id` with `{ title }` → refresh
- Press Escape → cancel edit

**Add REST endpoint:**
```typescript
app.put('/api/todos/:id', (req, res) => {
  try {
    const todo = todoManager.update(req.params.id, req.body);
    io.emit('todos:refresh');
    res.json({ success: true, todo });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
```

### 10.2 — Snooze / Defer

Users often want to push a todo to "tomorrow" or "next Monday" without editing the date manually.

**Add `snooze` action to the skill:**
```typescript
case 'snooze': {
  if (!args.id) return { success: false, error: 'id is required' };
  const snoozeDate = args.dueDate; // AI parses "tomorrow" → "YYYY-MM-DD"
  const todo = todoManager.update(args.id, { dueDate: snoozeDate });
  return { success: true, todo, message: `Snoozed to ${snoozeDate}` };
}
```

**Dashboard:** Add a small clock icon button on each todo → dropdown with "Tomorrow", "Next Monday", "Next Week", "Pick date".

### 10.3 — Search / Text Filter

Add a search input above the todo list that filters by title text. Client-side only — no backend changes needed.

```tsx
const [searchQuery, setSearchQuery] = useState('');

// In the filtered list:
const searchFiltered = filtered.filter(t =>
  !searchQuery || t.title.toLowerCase().includes(searchQuery.toLowerCase())
);
```

### 10.4 — Bulk Complete

Add a "Complete All Visible" button when the filter is `today` or `overdue`. Calls `POST /api/todos/complete` for each visible todo in parallel.

### 10.5 — Drag-and-Drop Reorder

Add a `sortOrder: number` field to the `Todo` interface. Default to `Date.now()` on creation. When the user drags a todo to a new position, update `sortOrder` for affected items. Use a lightweight library like `@dnd-kit/core` (already React-compatible).

**Data model addition:**
```typescript
sortOrder?: number; // Manual ordering — lower numbers appear first
```

**Sorting update in `query()`:** Add `sortOrder` as the primary sort key before priority.

### 10.6 — Org Agent Permission Guard

The plan states org agents cannot delete/complete user todos, but the skill only enforces this via description text. Add an actual runtime guard:

```typescript
// In the skill's run() function, before complete/delete cases:
if (meta.isWorker && ['complete', 'delete'].includes(args.action)) {
  const target = todoManager.getById(args.id);
  if (target && target.createdBy !== 'agent') {
    return { success: false, error: 'Org agents cannot complete or delete user-created todos' };
  }
}
```

---

*PersonalClaw v13.0.0 — Todos Feature Implementation Plan*
*Built for: Sagar | Author: Scout Kalra*
