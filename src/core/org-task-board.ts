import * as fs from 'fs';
import * as path from 'path';
import { orgManager } from './org-manager.js';
import { eventBus, Events } from './events.js';
// FIX-L: per-org write lock prevents ticket file corruption under concurrent agents
import { skillLock } from './skill-lock.js';

const ORGS_DIR = path.join(process.cwd(), 'orgs');

export type TicketStatus = 'open' | 'in_progress' | 'blocked' | 'done';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export interface TicketComment {
  id: string;
  authorId: string;
  authorLabel: string;
  text: string;
  createdAt: string;
}

export interface TicketHistoryEntry {
  action: string;
  by: string;
  at: string;
}

export interface Ticket {
  id: string;
  orgId: string;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  assigneeId: string | null;
  assigneeLabel: string | null;
  createdBy: string;
  createdByLabel: string;
  isHumanCreated: boolean;
  comments: TicketComment[];
  history: TicketHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

class OrgTaskBoard {
  private cache: Map<string, Ticket[]> = new Map();

  private ticketsFile(orgId: string): string {
    const org = orgManager.get(orgId);
    return path.join(org?.orgDir ?? path.join(ORGS_DIR, orgId), 'tickets.json');
  }

  private load(orgId: string): Ticket[] {
    // Always re-read from disk to get latest after any write
    const file = this.ticketsFile(orgId);
    if (!fs.existsSync(file)) return [];
    try {
      const tickets = JSON.parse(fs.readFileSync(file, 'utf-8'));
      this.cache.set(orgId, tickets);
      return tickets;
    } catch {
      return [];
    }
  }

  private save(orgId: string, tickets: Ticket[]): void {
    const file = this.ticketsFile(orgId);
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(tickets, null, 2));
    fs.renameSync(tmp, file);
    this.cache.set(orgId, tickets);
  }

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

  // FIX-L: create() acquires a per-org write lock before touching tickets.json
  async create(params: {
    orgId: string;
    title: string;
    description: string;
    priority: TicketPriority;
    assigneeId: string | null;
    assigneeLabel: string | null;
    createdBy: string;
    createdByLabel: string;
    isHumanCreated: boolean;
  }): Promise<Ticket> {
    const lockKey = `files:tickets:${params.orgId}` as const;
    let release: (() => void) | undefined;
    try {
      release = await skillLock.acquireWrite(lockKey, {
        agentId: params.createdBy,
        conversationId: `org_${params.orgId}`,
        conversationLabel: 'OrgTaskBoard',
        operation: 'ticket:create',
        acquiredAt: new Date(),
      });
      const tickets = this.load(params.orgId);
      const now = new Date().toISOString();
      const ticket: Ticket = {
        id: `ticket_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        orgId: params.orgId,
        title: params.title,
        description: params.description,
        priority: params.priority,
        status: 'open',
        assigneeId: params.assigneeId,
        assigneeLabel: params.assigneeLabel,
        createdBy: params.createdBy,
        createdByLabel: params.createdByLabel,
        isHumanCreated: params.isHumanCreated,
        comments: [],
        history: [{ action: 'created', by: params.createdByLabel, at: now }],
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
      tickets.push(ticket);
      this.save(params.orgId, tickets);
      eventBus.dispatch(Events.ORG_TICKET_CREATED, { ticket }, 'org-task-board');
      return ticket;
    } finally {
      release?.();
    }
  }

  // FIX-L: update() acquires a per-org write lock before touching tickets.json
  async update(orgId: string, ticketId: string, updates: {
    status?: TicketStatus;
    priority?: TicketPriority;
    assigneeId?: string | null;
    assigneeLabel?: string | null;
    title?: string;
    description?: string;
    comment?: { authorId: string; authorLabel: string; text: string };
    historyEntry?: string;
    byLabel?: string;
    callerAgentId?: string;
  }): Promise<Ticket | null> {
    const lockKey = `files:tickets:${orgId}` as const;
    let release: (() => void) | undefined;
    try {
      release = await skillLock.acquireWrite(lockKey, {
        agentId: updates.callerAgentId ?? 'system',
        conversationId: `org_${orgId}`,
        conversationLabel: 'OrgTaskBoard',
        operation: 'ticket:update',
        acquiredAt: new Date(),
      });
      const tickets = this.load(orgId);
      const idx = tickets.findIndex(t => t.id === ticketId);
      if (idx === -1) return null;
      const ticket = tickets[idx];
      const now = new Date().toISOString();

      if (updates.status) {
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
        ticket.status = updates.status;
        if (updates.status === 'done') ticket.completedAt = now;
      }
      if (updates.priority) ticket.priority = updates.priority;
      if (updates.assigneeId !== undefined) {
        ticket.assigneeId = updates.assigneeId;
        ticket.assigneeLabel = updates.assigneeLabel ?? null;
      }
      if (updates.title) ticket.title = updates.title;
      if (updates.description) ticket.description = updates.description;
      if (updates.comment) {
        ticket.comments.push({
          id: `comment_${Date.now()}`,
          ...updates.comment,
          createdAt: now,
        });
      }
      if (updates.historyEntry && updates.byLabel) {
        ticket.history.push({ action: updates.historyEntry, by: updates.byLabel, at: now });
      }
      ticket.updatedAt = now;
      tickets[idx] = ticket;
      this.save(orgId, tickets);
      eventBus.dispatch(Events.ORG_TICKET_UPDATED, { ticket }, 'org-task-board');
      return ticket;
    } finally {
      release?.();
    }
  }

  get(orgId: string, ticketId: string): Ticket | null {
    return this.load(orgId).find(t => t.id === ticketId) ?? null;
  }
}

export const orgTaskBoard = new OrgTaskBoard();
