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
  recurring?: {
    frequency: 'daily' | 'weekly' | 'monthly';
    days?: number[];
    dayOfMonth?: number;
    lastFiredDate?: string;
  };
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
