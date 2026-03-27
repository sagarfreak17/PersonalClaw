/**
 * PersonalClaw Event Bus — Central nervous system for decoupled communication.
 *
 * All subsystems emit and listen to events through this bus.
 * Enables plugins, audit logging, and real-time dashboard updates without tight coupling.
 */

import { EventEmitter } from 'events';

export interface ClawEvent {
  type: string;
  timestamp: number;
  data: any;
  source: string;
}

class EventBus extends EventEmitter {
  private eventLog: ClawEvent[] = [];
  private maxLogSize = 500;

  constructor() {
    super();
    // FIX-P: bumped from 50 to 100 — v12 adds org heartbeat, per-agent, and
    // per-org task board subscriptions that exceed 50 under load with multiple orgs.
    this.setMaxListeners(100);
  }

  /**
   * Emit a typed event with metadata.
   */
  dispatch(type: string, data: any, source: string = 'system') {
    const event: ClawEvent = {
      type,
      timestamp: Date.now(),
      data,
      source,
    };

    this.eventLog.push(event);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }

    this.emit(type, event);
    this.emit('*', event); // Wildcard listener for audit/logging
  }

  /**
   * Remove a listener for a specific event type. (FIX-4)
   * Required for agent-registry cleanup to prevent listener leaks.
   */
  off(event: string, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }

  /**
   * Get recent events, optionally filtered by type.
   */
  getRecentEvents(count: number = 50, type?: string): ClawEvent[] {
    const filtered = type ? this.eventLog.filter(e => e.type === type) : this.eventLog;
    return filtered.slice(-count);
  }

  /**
   * Get event stats.
   */
  getStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const event of this.eventLog) {
      stats[event.type] = (stats[event.type] || 0) + 1;
    }
    return stats;
  }
}

// Singleton
export const eventBus = new EventBus();

// ─── Event Type Constants ───────────────────────────────────────────
export const Events = {
  // Brain events
  MESSAGE_RECEIVED: 'brain:message_received',
  MESSAGE_PROCESSED: 'brain:message_processed',
  TOOL_CALLED: 'brain:tool_called',
  TOOL_COMPLETED: 'brain:tool_completed',
  TOOL_FAILED: 'brain:tool_failed',
  MODEL_FAILOVER: 'brain:model_failover',
  SESSION_STARTED: 'brain:session_started',
  SESSION_RESET: 'brain:session_reset',
  CONTEXT_COMPACTED: 'brain:context_compacted',
  STREAMING_CHUNK: 'brain:streaming_chunk',

  // Skill events
  SKILL_LOADED: 'skill:loaded',
  SKILL_ERROR: 'skill:error',

  // System events
  SERVER_STARTED: 'system:server_started',
  SERVER_SHUTDOWN: 'system:server_shutdown',
  DASHBOARD_CONNECTED: 'system:dashboard_connected',
  DASHBOARD_DISCONNECTED: 'system:dashboard_disconnected',
  TELEGRAM_MESSAGE: 'system:telegram_message',
  SCHEDULER_FIRED: 'system:scheduler_fired',
  LOG_EMITTED: 'system:log_emitted',

  // Learning events
  LEARNING_STARTED: 'learning:started',
  LEARNING_COMPLETED: 'learning:completed',
  LEARNING_FAILED: 'learning:failed',

  // Extension relay events
  RELAY_CONNECTED: 'relay:extension_connected',
  RELAY_DISCONNECTED: 'relay:extension_disconnected',
  RELAY_TABS_UPDATE: 'relay:tabs_update',

  // ─── v11 Multi-Agent & Skill Lock Events ───────────────────────────
  // Conversation lifecycle
  CONVERSATION_CREATED: 'conversation:created',
  CONVERSATION_CLOSED: 'conversation:closed',
  CONVERSATION_ABORTED: 'conversation:aborted',

  // Agent worker lifecycle
  AGENT_WORKER_STARTED: 'agent:worker_started',
  AGENT_WORKER_COMPLETED: 'agent:worker_completed',
  AGENT_WORKER_FAILED: 'agent:worker_failed',
  AGENT_WORKER_TIMED_OUT: 'agent:worker_timed_out',
  AGENT_WORKER_QUEUED: 'agent:worker_queued',

  // Skill lock events (FIX-1: emitted by skill-lock.ts, consumed by agent-registry.ts)
  SKILL_LOCK_WAITING: 'skill:lock_waiting',
  SKILL_LOCK_ACQUIRED: 'skill:lock_acquired',
  SKILL_LOCK_RELEASED: 'skill:lock_released',
  SKILL_LOCK_QUEUED: 'skill:lock_queued',

  // ─── v12 Org Events ────────────────────────────────────────────────

  // Org lifecycle
  ORG_CREATED: 'org:created',
  ORG_UPDATED: 'org:updated',
  ORG_DELETED: 'org:deleted',
  ORG_PAUSED: 'org:paused',
  ORG_RESUMED: 'org:resumed',

  // Agent lifecycle
  ORG_AGENT_CREATED: 'org:agent:created',
  ORG_AGENT_UPDATED: 'org:agent:updated',
  ORG_AGENT_DELETED: 'org:agent:deleted',
  ORG_AGENT_PAUSED: 'org:agent:paused',
  ORG_AGENT_RESUMED: 'org:agent:resumed',

  // Agent runs
  ORG_AGENT_HEARTBEAT_FIRED: 'org:agent:heartbeat_fired',
  ORG_AGENT_HEARTBEAT_SKIPPED: 'org:agent:heartbeat_skipped',
  ORG_AGENT_RUN_STARTED: 'org:agent:run_started',
  ORG_AGENT_RUN_COMPLETED: 'org:agent:run_completed',
  ORG_AGENT_RUN_FAILED: 'org:agent:run_failed',

  // Tickets
  ORG_TICKET_CREATED: 'org:ticket:created',
  ORG_TICKET_UPDATED: 'org:ticket:updated',
  ORG_TICKET_ASSIGNED: 'org:ticket:assigned',
  ORG_TICKET_COMPLETED: 'org:ticket:completed',

  // Delegation trigger (FIX-D: emitted by org-skills, consumed by org-heartbeat)
  ORG_AGENT_DELEGATED: 'org:agent:delegated',

  // Direct agent chat (FIX-I: chat session lifecycle)
  ORG_AGENT_CHAT_CLOSED: 'org:agent:chat_closed',

  // ─── v13 Todo Events ──────────────────────────────────────────────
  TODOS_UPDATED: 'todos:updated',                   // Any mutation — dashboard re-fetches
  TODOS_RECURRING_FIRED: 'todos:recurring_fired',   // A recurring template spawned a new instance
} as const;

