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
