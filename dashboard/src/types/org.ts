export type AutonomyLevel = 'full' | 'approval_required';
export type ProtectionMode = 'none' | 'git' | 'manual' | 'both';

export interface OrgProtection {
  mode: ProtectionMode;
  gitFiles: string[];
  manualPaths: string[];
  lastUpdated: string;
}

export type TicketStatus = 'open' | 'in_progress' | 'blocked' | 'done';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export interface AgentHeartbeat {
  cron: string;
  enabled: boolean;
}

export interface OrgAgent {
  id: string;
  orgId: string;
  name: string;
  role: string;
  personality: string;
  responsibilities: string;
  goals: string[];
  autonomyLevel: AutonomyLevel;
  heartbeat: AgentHeartbeat;
  paused: boolean;
  reportingTo: string | null;
  createdAt: string;
  lastRunAt: string | null;
  lastRunStatus: 'completed' | 'failed' | 'skipped' | null;
}

export interface Org {
  id: string;
  name: string;
  mission: string;
  rootDir: string;
  createdAt: string;
  paused: boolean;
  agents: OrgAgent[];
  protection: OrgProtection;
}

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

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export interface OrgNotification {
  orgId: string;
  orgName: string;
  agentName: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
  timestamp: number;
}

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
