/**
 * PersonalClaw Agent Registry — Manages sub-agent workers for multi-agent execution.
 *
 * FIX-2: Brain is NOT imported at the top level. It is dynamically imported inside
 * startWorker() to break the circular dependency chain:
 * brain.ts → agent-spawn.ts → agent-registry.ts → brain.ts
 *
 * FIX-4: Uses eventBus.off() to clean up raw log listeners.
 * FIX-5: conversationLabel passed through spawn chain so worker Brain shows "Chat 1" in lock UI.
 */

import { eventBus } from './events.js';
// NOTE: Brain is NOT imported at the top level — see FIX-2.

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
  brain: any;             // typed as any because of dynamic import — Brain at runtime
  rawLogs: string[];
  timeoutHandle?: ReturnType<typeof setTimeout>;
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
    // skill-lock.ts emits these instead of calling agentRegistry directly.
    eventBus.on('skill:lock_waiting', (data: {
      agentId: string; lockKey: string;
      heldBy: string; heldByConversation: string;
    }) => {
      this.setLockWaitInfo(data.agentId, {
        lockKey: data.lockKey,
        heldBy: data.heldBy,
        heldByConversation: data.heldByConversation,
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
      agentId, parentConversationId: worker.parentConversationId,
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
    });

    const worker: WorkerAgent = {
      agentId, parentConversationId, conversationLabel,
      task, status: 'running',
      spawnedAt: new Date().toISOString(),
      brain, rawLogs: [], resolve,
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
      if (event.data?.agentId === worker.agentId || event.agentId === worker.agentId) {
        worker.rawLogs.push(JSON.stringify(event));
      }
    };
    eventBus.on('brain:tool_called', logListener);
    eventBus.on('brain:tool_completed', logListener);

    try {
      const result = await worker.brain.processMessage(worker.task);
      worker.status = 'completed';
      worker.result = result;
      worker.completedAt = new Date().toISOString();
      if (worker.timeoutHandle) clearTimeout(worker.timeoutHandle);
      eventBus.emit('agent:worker_completed', {
        agentId: worker.agentId,
        parentConversationId: worker.parentConversationId,
        result,
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
      lockWaitInfo: worker.lockWaitInfo,
    };
  }
}

export const agentRegistry = new AgentRegistry();
