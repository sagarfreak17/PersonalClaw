/**
 * PersonalClaw Skill Lock Manager — Concurrent resource protection for multi-agent execution.
 *
 * FIX-1: This module does NOT import agentRegistry to avoid circular dependency.
 * Instead, it emits Event Bus events that agent-registry.ts subscribes to.
 *
 * Two lock types:
 *   • Exclusive — only one holder at a time (browser_vision, clipboard)
 *   • Read-Write — multiple readers OR one writer (memory, scheduler, files:path)
 */

import { eventBus } from './events.js';

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
  files: 10_000,
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
      heldByConversation: this.exclusiveHolders.get(key)?.conversationLabel ?? 'none',
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
      ),
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
      heldByConversation: state.writer?.conversationLabel ?? 'none',
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
      heldByConversation: (state.writer ?? state.readers[0])?.conversationLabel ?? 'none',
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
        queueLength: this.exclusiveQueueLengths.get(key) ?? 0,
      };
    }
    const state = this.rwState.get(key);
    if (!state) return { key, type: 'free', holders: [], queueLength: 0 };
    return {
      key,
      type: state.writer ? 'write' : state.readers.length > 0 ? 'read' : 'free',
      holders: state.writer ? [state.writer] : [...state.readers],
      queueLength: state.readerQueue + state.writerQueue,
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
