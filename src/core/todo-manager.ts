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
    // Stats count only top-level todos (not subtasks) to match dashboard display
    const topLevel = this.getVisible().filter(t => !t.parentId);

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

    for (const t of topLevel) {
      if (t.status === 'done' && t.completedAt) {
        const completedDate = new Date(t.completedAt);
        if (completedDate >= monday) {
          completedThisWeek++;
          completedByDay[dayNames[completedDate.getDay()]]++;
        }
      }
    }

    return {
      totalOpen: topLevel.filter(t => t.status === 'open').length,
      totalDone: topLevel.filter(t => t.status === 'done').length,
      dueToday: topLevel.filter(t =>
        t.status === 'open' && t.dueDate && t.dueDate === today
      ).length,
      overdue: topLevel.filter(t =>
        t.status === 'open' && t.dueDate && t.dueDate < today
      ).length,
      highPriority: topLevel.filter(t =>
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
