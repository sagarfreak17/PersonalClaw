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

      // Org agent permission guard — agents cannot complete or delete user-created todos
      if (meta.isWorker && ['complete', 'delete', 'delete_recurring'].includes(args.action)) {
        const target = args.id ? todoManager.getById(args.id) : null;
        if (target && target.createdBy !== 'agent') {
          return { success: false, error: 'Org agents cannot complete or delete user-created todos' };
        }
      }

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
