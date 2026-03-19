import * as fs from 'fs';
import * as path from 'path';
import { orgTaskBoard, TicketPriority } from '../core/org-task-board.js';
import { orgManager } from '../core/org-manager.js';
import { eventBus, Events } from '../core/events.js';
import { skillLock } from '../core/skill-lock.js';
import type { Skill, SkillMeta } from '../types/skill.js';

// ─── org_read_agent_memory ────────────────────────────────────────
export const orgReadAgentMemorySkill: Skill = {
  name: 'org_read_agent_memory',
  description: 'Read your own persistent memory from previous sessions. Always do this at the start of your run to recall what you were working on.',
  parameters: { type: 'object', properties: {}, required: [] },
  run: async (_args: any, meta: SkillMeta) => {
    if (!meta.orgId || !meta.orgAgentId) return { error: 'Not running in org context' };
    const file = orgManager.getAgentMemoryFile(meta.orgId, meta.orgAgentId);
    if (!fs.existsSync(file)) return { memory: null, message: 'No memory yet — this is your first run.' };
    return { memory: JSON.parse(fs.readFileSync(file, 'utf-8')) };
  },
};

// ─── org_write_agent_memory ───────────────────────────────────────
export const orgWriteAgentMemorySkill: Skill = {
  name: 'org_write_agent_memory',
  description: 'Write to your own persistent memory. Call this at the end of EVERY run to record what you did, what is pending, and context for your next session. Never skip this.',
  parameters: {
    type: 'object',
    properties: {
      notes: { type: 'string', description: 'What you did this session and what is pending.' },
      currentPriorities: { type: 'array', items: { type: 'string' } },
      pendingActions: { type: 'array', items: { type: 'string' } },
    },
    required: ['notes'],
  },
  run: async (args: any, meta: SkillMeta) => {
    if (!meta.orgId || !meta.orgAgentId) return { error: 'Not running in org context' };
    const file = orgManager.getAgentMemoryFile(meta.orgId, meta.orgAgentId);
    const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
    fs.writeFileSync(file, JSON.stringify({
      ...existing,
      agentId: meta.orgAgentId,
      orgId: meta.orgId,
      lastUpdated: new Date().toISOString(),
      notes: args.notes,
      currentPriorities: args.currentPriorities ?? existing.currentPriorities ?? [],
      pendingActions: args.pendingActions ?? existing.pendingActions ?? [],
    }, null, 2));
    return { success: true };
  },
};

// ─── org_read_shared_memory ───────────────────────────────────────
export const orgReadSharedMemorySkill: Skill = {
  name: 'org_read_shared_memory',
  description: 'Read the shared org memory — company state, decisions, announcements visible to all agents.',
  parameters: { type: 'object', properties: {}, required: [] },
  run: async (_args: any, meta: SkillMeta) => {
    if (!meta.orgId) return { error: 'Not running in org context' };
    const file = orgManager.getSharedMemoryFile(meta.orgId);
    if (!fs.existsSync(file)) return { memory: null };
    return { memory: JSON.parse(fs.readFileSync(file, 'utf-8')) };
  },
};

// ─── org_write_shared_memory ──────────────────────────────────────
export const orgWriteSharedMemorySkill: Skill = {
  name: 'org_write_shared_memory',
  description: 'Write to the shared org memory. Use to post announcements, decisions, or company-wide context that other agents should know about.',
  parameters: {
    type: 'object',
    properties: {
      companyState: { type: 'string' },
      announcements: { type: 'array', items: { type: 'string' } },
      decisions: { type: 'array', items: { type: 'string' } },
    },
    required: [],
  },
  run: async (args: any, meta: SkillMeta) => {
    if (!meta.orgId) return { error: 'Not running in org context' };
    const file = orgManager.getSharedMemoryFile(meta.orgId);
    
    // FIX-AC: re-read inside write to merge arrays, not overwrite
    const lock = await skillLock.acquireWrite('memory', {
      agentId: meta.agentId ?? meta.orgAgentId ?? 'unknown',
      conversationId: meta.conversationId ?? '',
      conversationLabel: meta.conversationLabel ?? '',
      operation: 'shared_memory:write',
      acquiredAt: new Date(),
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
    } finally {
      lock();
    }
    return { success: true };
  },
};

// ─── org_list_tickets ─────────────────────────────────────────────
export const orgListTicketsSkill: Skill = {
  name: 'org_list_tickets',
  description: 'List tickets in this org. Filter by assignedToMe or by status.',
  parameters: {
    type: 'object',
    properties: {
      assignedToMe: { type: 'boolean' },
      status: { type: 'string', enum: ['open', 'in_progress', 'blocked', 'done'] },
    },
    required: [],
  },
  run: async (args: any, meta: SkillMeta) => {
    if (!meta.orgId) return { error: 'Not running in org context' };
    return { tickets: orgTaskBoard.list(meta.orgId, {
      assigneeId: args.assignedToMe ? meta.orgAgentId : undefined,
      status: args.status,
      callerAgentId: meta.orgAgentId,  // FIX-Z
    }) };
  },
};

// ─── org_create_ticket ────────────────────────────────────────────
export const orgCreateTicketSkill: Skill = {
  name: 'org_create_ticket',
  description: 'Create a new ticket in this org. Assign to yourself or another agent.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      assigneeId: { type: 'string' },
      assigneeLabel: { type: 'string' },
    },
    required: ['title', 'description', 'priority'],
  },
  run: async (args: any, meta: SkillMeta) => {
    if (!meta.orgId || !meta.orgAgentId) return { error: 'Not running in org context' };
    const org = orgManager.get(meta.orgId);
    const agent = org?.agents.find(a => a.id === meta.orgAgentId);
    const ticket = await orgTaskBoard.create({
      orgId: meta.orgId,
      title: args.title,
      description: args.description,
      priority: args.priority as TicketPriority,
      assigneeId: args.assigneeId ?? null,
      assigneeLabel: args.assigneeLabel ?? null,
      createdBy: meta.orgAgentId,
      createdByLabel: agent ? `${agent.role} (${agent.name})` : meta.orgAgentId,
      isHumanCreated: false,
    });
    return { success: true, ticket };
  },
};

// ─── org_update_ticket ────────────────────────────────────────────
export const orgUpdateTicketSkill: Skill = {
  name: 'org_update_ticket',
  description: 'Update a ticket status, add a comment, or reassign it.',
  parameters: {
    type: 'object',
    properties: {
      ticketId: { type: 'string' },
      status: { type: 'string', enum: ['open', 'in_progress', 'blocked', 'done'] },
      comment: { type: 'string' },
      assigneeId: { type: 'string' },
      assigneeLabel: { type: 'string' },
    },
    required: ['ticketId'],
  },
  run: async (args: any, meta: SkillMeta) => {
    if (!meta.orgId || !meta.orgAgentId) return { error: 'Not running in org context' };
    const org = orgManager.get(meta.orgId);
    const agent = org?.agents.find(a => a.id === meta.orgAgentId);
    const byLabel = agent ? `${agent.role} (${agent.name})` : meta.orgAgentId;
    const ticket = await orgTaskBoard.update(meta.orgId, args.ticketId, {
      status: args.status,
      assigneeId: args.assigneeId,
      assigneeLabel: args.assigneeLabel,
      comment: args.comment ? { authorId: meta.orgAgentId!, authorLabel: byLabel!, text: args.comment } : undefined,
      historyEntry: args.status ? `status changed to ${args.status}` : args.assigneeId ? 'reassigned' : 'comment added',
      byLabel: byLabel ?? 'unknown',
      callerAgentId: meta.orgAgentId,
    });
    if (!ticket) return { error: `Ticket ${args.ticketId} not found` };
    return { success: true, ticket };
  },
};

// ─── org_delegate ─────────────────────────────────────────────────
// FIX-D: emits ORG_AGENT_DELEGATED on EventBus — org-heartbeat.ts subscribes
// and triggers the target agent. No direct import of org-heartbeat.ts here.
export const orgDelegateSkill: Skill = {
  name: 'org_delegate',
  description: 'Delegate a task to another agent by creating a ticket assigned to them. This automatically triggers their heartbeat so they wake up and handle it promptly.',
  parameters: {
    type: 'object',
    properties: {
      toAgentId: { type: 'string' },
      toAgentLabel: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      delegationDepth: { type: 'number', description: 'Internal — delegation chain depth. Do not set manually.' },
    },
    required: ['toAgentId', 'toAgentLabel', 'title', 'description', 'priority'],
  },
  run: async (args: any, meta: SkillMeta) => {
    if (!meta.orgId || !meta.orgAgentId) return { error: 'Not running in org context' };
    
    // FIX-AB: delegation loop detection
    const delegationDepth = (args.delegationDepth ?? 0) + 1;
    if (delegationDepth > 5) {
      return {
        success: false,
        error: 'Delegation chain depth limit reached (5). This looks like a delegation loop. Resolve manually.',
      };
    }

    const org = orgManager.get(meta.orgId);
    const fromAgent = org?.agents.find(a => a.id === meta.orgAgentId);
    const fromLabel = fromAgent ? `${fromAgent.role} (${fromAgent.name})` : meta.orgAgentId;
    const ticket = await orgTaskBoard.create({
      orgId: meta.orgId,
      title: args.title,
      description: `${args.description}\n\n[delegation_depth:${delegationDepth}]`,
      priority: args.priority as TicketPriority,
      assigneeId: args.toAgentId,
      assigneeLabel: args.toAgentLabel,
      createdBy: meta.orgAgentId!,
      createdByLabel: fromLabel!,
      isHumanCreated: false,
    });
    // FIX-D: emit event — org-heartbeat.ts handles triggering the agent
    eventBus.dispatch(Events.ORG_AGENT_DELEGATED, {
      orgId: meta.orgId,
      targetAgentId: args.toAgentId,
      fromAgentLabel: fromLabel,
      ticketId: ticket.id,
    }, 'org-skills');
    return { success: true, ticket, message: `Delegated to ${args.toAgentLabel}. Their heartbeat will fire shortly.` };
  },
};

// ─── org_write_report ─────────────────────────────────────────────
export const orgWriteReportSkill: Skill = {
  name: 'org_write_report',
  description: 'Write a report or document to the org root directory. Use for status reports, analyses, or any output meant for the team or the human owner to read.',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Filename including extension, e.g. "weekly-status-2026-03-18.md"' },
      content: { type: 'string' },
      subdirectory: { type: 'string', description: 'Optional subdirectory within the org root dir.' },
    },
    required: ['filename', 'content'],
  },
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
};

// ─── org_notify ───────────────────────────────────────────────────
export const orgNotifySkill: Skill = {
  name: 'org_notify',
  description: 'Send a notification to the dashboard for the human owner to see. Use for important updates, completed milestones, or anything needing human attention.',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string' },
      level: { type: 'string', enum: ['info', 'success', 'warning', 'error'] },
    },
    required: ['message'],
  },
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
      orgId: meta.orgId,
      orgName: org?.name ?? '',
      agentName: agent ? `${agent.name} (${agent.role})` : 'Unknown',
      message: args.message,
      level: args.level ?? 'info',
      type: 'agent',
      timestamp: Date.now(),
    });
    
    if (!allowed) {
      return { success: true, message: 'Stored. Telegram suppressed — notification rate limit reached for this run (max 5).' };
    }
    
    eventBus.dispatch('org:notification', {
      orgId: meta.orgId,
      orgName: org?.name ?? 'Unknown',
      agentName: agent ? `${agent.name} (${agent.role})` : 'Unknown',
      message: args.message ?? '',
      level: args.level ?? 'info',
      timestamp: Date.now()
    }, 'org-skills');
    
    return { success: true };
  },
};

// ─── org_propose_code_change ──────────────────────────────────────
export const orgProposeCodeChangeSkill: Skill = {
  name: 'org_propose_code_change',
  description: 'Propose a change to a protected project file. The human owner will review and approve or reject. Use this when you need to modify source code files that are tracked by git.',
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Absolute path to the file you want to change.' },
      proposedContent: { type: 'string', description: 'The full proposed content of the file after your change.' },
      explanation: { type: 'string', description: 'Clear explanation of what you changed and why.' },
    },
    required: ['filePath', 'proposedContent', 'explanation'],
  },
  run: async (args: any, meta: SkillMeta) => {
    if (!meta.orgId || !meta.orgAgentId) return { error: 'Not running in org context' };
    const org = orgManager.get(meta.orgId);
    if (!org) return { error: 'Org not found' };
    const agent = org.agents.find(a => a.id === meta.orgAgentId);
    const { createProposal } = await import('../core/org-file-guard.js');
    const result = createProposal({
      orgId: meta.orgId,
      agentId: meta.orgAgentId,
      agentLabel: agent ? `${agent.name} (${agent.role})` : meta.orgAgentId,
      absolutePath: path.resolve(args.filePath),
      proposedContent: args.proposedContent,
      explanation: args.explanation,
    });
    return result;
  },
};

// ─── org_raise_blocker ────────────────────────────────────────────
export const orgRaiseBlockerSkill: Skill = {
  name: 'org_raise_blocker',
  description: 'Raise a blocker that requires human intervention. Use when you are stuck and cannot proceed without the human owner taking action (e.g., credentials needed, access required, ambiguous requirements).',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title for the blocker.' },
      description: { type: 'string', description: 'Detailed description of the problem.' },
      workaroundAttempted: { type: 'string', description: 'What you tried to work around it. Say "None" if nothing was attempted.' },
      humanActionRequired: { type: 'string', description: 'Specifically what the human needs to do to unblock you.' },
      ticketId: { type: 'string', description: 'Optional ticket ID this blocker is related to.' },
    },
    required: ['title', 'description', 'humanActionRequired'],
  },
  run: async (args: any, meta: SkillMeta) => {
    if (!meta.orgId || !meta.orgAgentId) return { error: 'Not running in org context' };
    const org = orgManager.get(meta.orgId);
    if (!org) return { error: 'Org not found' };
    const agent = org.agents.find(a => a.id === meta.orgAgentId);
    const agentLabel = agent ? `${agent.name} (${agent.role})` : meta.orgAgentId;

    const blocker = {
      id: `blocker_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      orgId: meta.orgId,
      agentId: meta.orgAgentId,
      agentLabel,
      title: args.title,
      description: args.description,
      workaroundAttempted: args.workaroundAttempted ?? 'None',
      humanActionRequired: args.humanActionRequired,
      ticketId: args.ticketId ?? null,
      status: 'open' as const,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };

    // Persist to blockers.json with atomic write
    const blockersFile = path.join(org.orgDir, 'blockers.json');
    const existing = fs.existsSync(blockersFile)
      ? JSON.parse(fs.readFileSync(blockersFile, 'utf-8'))
      : [];
    existing.push(blocker);
    const tmp = blockersFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(existing, null, 2));
    fs.renameSync(tmp, blockersFile);

    eventBus.dispatch('org:blocker:created', { blocker }, 'org-skills');
    return { success: true, blocker };
  },
};

// ─── org_submit_for_review ─────────────────────────────────────────
export const orgSubmitForReviewSkill: Skill = {
  name: 'org_submit_for_review',
  description: 'Submit significant work output for human review. Use for strategy documents, hiring decisions, pricing plans, or any major output the human owner should see in the Proposals tab.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title for this submission.' },
      content: { type: 'string', description: 'The full content of the submission — document text, decision rationale, plan details, etc.' },
      type: { type: 'string', enum: ['plan', 'decision', 'document', 'hiring'], description: 'Category of submission.' },
      requiresApproval: { type: 'boolean', description: 'True for major decisions that affect business direction. False for routine outputs.' },
    },
    required: ['title', 'content', 'type'],
  },
  run: async (args: any, meta: SkillMeta) => {
    if (!meta.orgId || !meta.orgAgentId) return { error: 'Not running in org context' };
    const org = orgManager.get(meta.orgId);
    if (!org) return { error: 'Org not found' };
    const agent = org.agents.find(a => a.id === meta.orgAgentId);
    const agentLabel = agent ? `${agent.name} (${agent.role})` : meta.orgAgentId;

    const submissionType = args.type as 'plan' | 'decision' | 'document' | 'hiring';
    // Auto-approve documents, plans, and hiring — they don't need human approval
    const autoApprove = ['document', 'plan', 'hiring'].includes(submissionType) && !(args.requiresApproval === true);
    const submission = {
      id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      orgId: meta.orgId,
      agentId: meta.orgAgentId,
      agentLabel,
      title: args.title,
      content: args.content,
      submissionType,
      requiresApproval: args.requiresApproval ?? false,
      status: (autoApprove ? 'approved' : 'pending') as 'pending' | 'approved',
      isStale: false,
      createdAt: new Date().toISOString(),
      resolvedAt: autoApprove ? new Date().toISOString() : null,
      resolvedBy: autoApprove ? 'auto' : null,
    };

    // Store alongside code proposals in proposals.json
    const proposalsFile = path.join(org.orgDir, 'proposals.json');
    const existing = fs.existsSync(proposalsFile)
      ? JSON.parse(fs.readFileSync(proposalsFile, 'utf-8'))
      : [];
    existing.push(submission);
    const tmp = proposalsFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(existing, null, 2));
    fs.renameSync(tmp, proposalsFile);

    // Also store content on disk like code proposals
    const submissionDir = path.join(org.workspaceDir, 'proposals', submission.id);
    fs.mkdirSync(submissionDir, { recursive: true });
    fs.writeFileSync(path.join(submissionDir, 'proposed.txt'), args.content);
    fs.writeFileSync(path.join(submissionDir, 'original.txt'), '(no original — new submission)');
    fs.writeFileSync(path.join(submissionDir, 'submission.json'), JSON.stringify(submission, null, 2));

    eventBus.dispatch('org:proposal:created', { proposal: submission }, 'org-skills');
    return { success: true, submission };
  },
};

export const orgSkills: Skill[] = [
  orgReadAgentMemorySkill,
  orgWriteAgentMemorySkill,
  orgReadSharedMemorySkill,
  orgWriteSharedMemorySkill,
  orgListTicketsSkill,
  orgCreateTicketSkill,
  orgUpdateTicketSkill,
  orgDelegateSkill,
  orgWriteReportSkill,
  orgNotifySkill,
  orgProposeCodeChangeSkill,
  orgRaiseBlockerSkill,
  orgSubmitForReviewSkill,
];
