import cron from 'node-cron';
import { orgManager } from './org-manager.js';
import { runOrgAgent, isAgentRunning, getRunningCount } from './org-agent-runner.js';
import { eventBus, Events } from './events.js';

function staggerCron(expression: string, offsetMinutes: number): string {
  const parts = expression.split(' ');
  if (parts.length !== 5) return expression;
  const minutePart = parts[0];
  if (minutePart.includes('/') || minutePart.includes(',')) return expression; // FIX-U
  const minute = minutePart === '*' ? 0 : parseInt(minutePart, 10);
  if (isNaN(minute)) return expression;
  parts[0] = String((minute + offsetMinutes) % 60);
  return parts.join(' ');
}

class OrgHeartbeatEngine {
  private tasks: Map<string, cron.ScheduledTask> = new Map();

  constructor() {
    // FIX-D: Subscribe to delegation events to trigger the target agent heartbeat.
    // org-skills.ts emits this event — no direct import needed.
    eventBus.on(Events.ORG_AGENT_DELEGATED, async (event: any) => {
      const { orgId, targetAgentId } = event.data ?? event;
      await this.triggerAgent(orgId, targetAgentId, 'event');
    });

    // Subscribe to org/agent lifecycle events to keep cron schedules in sync
    eventBus.on(Events.ORG_AGENT_CREATED, (event: any) => {
      const { agent, orgId } = event.data ?? event;
      this.scheduleAgent(orgId, agent.id);
    });
    eventBus.on(Events.ORG_AGENT_UPDATED, (event: any) => {
      const { agent, orgId } = event.data ?? event;
      this.rescheduleAgent(orgId, agent.id);
    });
    eventBus.on(Events.ORG_AGENT_DELETED, (event: any) => {
      const { agentId, orgId } = event.data ?? event;
      this.unscheduleAgent(orgId, agentId);
    });
  }

  /** Boot: schedule cron for all existing agents across all orgs. */
  startAll(): void {
    const orgs = orgManager.list();
    let count = 0;
    const cronOffsets = new Map<string, number>();
    for (const org of orgs) {
      for (const agent of org.agents) {
        if (this.scheduleAgent(org.id, agent.id, cronOffsets)) count++;
      }
    }
    console.log(`[OrgHeartbeat] Scheduled ${count} agent heartbeats across ${orgs.length} organisations.`);
  }

  /** Graceful shutdown — stop all cron tasks (FIX-G). */
  stopAll(): void {
    for (const [key, task] of this.tasks.entries()) {
      task.stop();
    }
    this.tasks.clear();
    console.log('[OrgHeartbeat] All heartbeat schedules stopped.');
  }

  /** Manually trigger an agent run — called from dashboard or chat. */
  async triggerAgent(orgId: string, agentId: string, trigger: 'manual' | 'event'): Promise<void> {
    const org = orgManager.get(orgId);
    const agent = org?.agents.find(a => a.id === agentId);
    if (!agent || agent.paused || org?.paused) return;

    eventBus.dispatch(Events.ORG_AGENT_HEARTBEAT_FIRED, {
      orgId, agentId, trigger, agentName: agent.name,
    }, 'org-heartbeat');

    // Fire and forget — result broadcast via EventBus
    runOrgAgent(orgId, agentId, trigger).catch(err => {
      console.error(`[OrgHeartbeat] Agent ${agentId} run failed:`, err.message);
    });
  }

  // FIX-N: public so orgManagementSkill can call it directly without bracket notation
  public scheduleAgent(orgId: string, agentId: string, cronOffsets?: Map<string, number>): boolean {
    const org = orgManager.get(orgId);
    const agent = org?.agents.find(a => a.id === agentId);
    if (!agent || !agent.heartbeat.enabled || !agent.heartbeat.cron) return false;

    let cronExpr = agent.heartbeat.cron;
    if (cronOffsets) {
      const existing = cronOffsets.get(cronExpr) ?? 0;
      if (existing > 0) cronExpr = staggerCron(cronExpr, existing * 2);
      cronOffsets.set(agent.heartbeat.cron, existing + 1);
    }

    if (!cron.validate(cronExpr)) {
      console.warn(`[OrgHeartbeat] Invalid cron for agent ${agentId}: ${cronExpr}`);
      return false;
    }

    const key = `${orgId}:${agentId}`;
    this.tasks.get(key)?.stop();

    const task = cron.schedule(cronExpr, async () => {
      console.log(`[OrgHeartbeat] ⏰ Heartbeat: ${agent?.name} (${agent?.role}) in ${org?.name}`);
      // FIX-V: queue handled inside runOrgAgent — just fire and let it queue
      eventBus.dispatch(Events.ORG_AGENT_HEARTBEAT_FIRED, {
        orgId, agentId, trigger: 'cron', agentName: agent.name,
      }, 'org-heartbeat');
      runOrgAgent(orgId, agentId, 'cron').catch(err => {
        console.error(`[OrgHeartbeat] Run failed for ${agentId}:`, err.message);
      });
    });

    this.tasks.set(key, task);
    return true;
  }

  private rescheduleAgent(orgId: string, agentId: string): void {
    this.unscheduleAgent(orgId, agentId);
    this.scheduleAgent(orgId, agentId);
  }

  private unscheduleAgent(orgId: string, agentId: string): void {
    const key = `${orgId}:${agentId}`;
    this.tasks.get(key)?.stop();
    this.tasks.delete(key);
  }
}

export const orgHeartbeat = new OrgHeartbeatEngine();
