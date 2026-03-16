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
    this.setMaxListeners(50);
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

  // Learning events
  LEARNING_STARTED: 'learning:started',
  LEARNING_COMPLETED: 'learning:completed',
  LEARNING_FAILED: 'learning:failed',

  // Extension relay events
  RELAY_CONNECTED: 'relay:extension_connected',
  RELAY_DISCONNECTED: 'relay:extension_disconnected',
  RELAY_TABS_UPDATE: 'relay:tabs_update',
} as const;
