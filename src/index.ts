// MUST be first — before any other imports so all console output is captured
import { terminalLogger } from './core/terminal-logger.js';
terminalLogger.start();

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { TelegramInterface } from './interfaces/telegram.js';
import { eventBus, Events } from './core/events.js';
import { audit } from './core/audit.js';
import { SessionManager } from './core/sessions.js';
import si from 'systeminformation';
import { initScheduler, skills } from './skills/index.js';
import { extensionRelay } from './core/relay.js';
import { conversationManager } from './core/conversation-manager.js';
import { agentRegistry } from './core/agent-registry.js';
import { skillLock } from './core/skill-lock.js';
// FIX-3: telegramBrain imported from neutral file, not declared here
import { telegramBrain } from './core/telegram-brain.js';
import { orgManager } from './core/org-manager.js';
import { orgHeartbeat } from './core/org-heartbeat.js';
import { orgTaskBoard } from './core/org-task-board.js';
import { runOrgAgent, isAgentRunning, closeChatSession, getAllOrgConversationIds, getRunningAgentsSet } from './core/org-agent-runner.js';
import { approveProposal, rejectProposal, loadProposals, resetStaleInProgressTickets, getProposalContent } from './core/org-file-guard.js';
import { storeNotification, getNotifications, setTelegramSender, sendDailyDigest } from './core/org-notification-store.js';
import cron from 'node-cron';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 10e6, // 10MB for image uploads
});

app.use(express.json());
app.use('/outputs', express.static(path.join(process.cwd(), 'outputs')));
app.use('/screenshots', express.static(path.join(process.cwd(), 'screenshots')));

// ─── Core Initialization ────────────────────────────────────────────
console.log('[Server] Initializing PersonalClaw v12...');

console.log('[Server] Checking Telegram configuration...');
const telegram = new TelegramInterface();
if (process.env.TELEGRAM_BOT_TOKEN) {
  setTelegramSender(async (msg) => telegram.sendMessage(msg));
}

// FIX-AF: Reset stale in_progress tickets on startup
setTimeout(() => resetStaleInProgressTickets(getRunningAgentsSet()), 2000);

console.log('[Server] Attaching Extension Relay...');
extensionRelay.attach(server);

console.log('[Server] Initializing Scheduler...');
initScheduler(async (msg) => {
  try {
    eventBus.dispatch(Events.SCHEDULER_FIRED, { command: msg }, 'scheduler');
    // Route scheduled tasks to Chat 1 (or create it)
    const convo = conversationManager.getOrCreateDefault();
    const response = await convo.brain.processMessage(msg);
    io.emit('response', { conversationId: convo.id, text: response });
    return response;
  } catch (error) {
    console.error('[Scheduler] Brain execution error:', error);
    return `Error: ${error}`;
  }
});

console.log('[Server] Starting Org Heartbeat Engine...');
orgHeartbeat.startAll();

// Load persisted activity feed into memory
loadActivityFromDisk();

cron.schedule('0 9 * * *', async () => {
  for (const org of orgManager.list()) {
    await sendDailyDigest(org.id).catch(e => console.error(`[Digest] ${org.id}:`, e));
  }
});

const PORT = process.env.PORT || 3000;

// ─── Activity Feed ──────────────────────────────────────────────────
const activityBuffer: any[] = [];
const MAX_ACTIVITY = 100;

// NEW — persistence
const ACTIVITY_FILE = path.join(process.cwd(), 'logs', 'activity.jsonl');
const MAX_ACTIVITY_FILE_ENTRIES = 1000;

let activityWriteCount = 0;

/**
 * Load the last 100 activity items from disk into the in-memory buffer.
 * Called once on startup so the Activity tab isn't blank after a restart.
 */
function loadActivityFromDisk(): void {
  try {
    if (!fs.existsSync(ACTIVITY_FILE)) return;
    const lines = fs.readFileSync(ACTIVITY_FILE, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .slice(-100); // only load last 100 into RAM
    for (const line of lines) {
      try { activityBuffer.push(JSON.parse(line)); } catch { /* skip corrupt lines */ }
    }
    console.log(`[Activity] Loaded ${activityBuffer.length} items from disk.`);
  } catch (e) {
    console.warn('[Activity] Failed to load from disk:', e);
  }
}

/**
 * Append one activity item to the in-memory buffer and persist to disk.
 * Trims the file every 100 writes to stay under MAX_ACTIVITY_FILE_ENTRIES.
 */
function persistActivity(item: any): void {
  // Existing in-memory logic
  activityBuffer.push(item);
  if (activityBuffer.length > MAX_ACTIVITY) activityBuffer.shift();

  // Persist to disk
  try {
    const dir = path.dirname(ACTIVITY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(ACTIVITY_FILE, JSON.stringify(item) + '\n');

    // Trim file periodically — every 100 writes
    if (++activityWriteCount % 100 === 0) {
      trimActivityFile();
    }
  } catch (e) {
    console.warn('[Activity] Failed to persist activity item:', e);
  }
}

function trimActivityFile(): void {
  try {
    if (!fs.existsSync(ACTIVITY_FILE)) return;
    const lines = fs.readFileSync(ACTIVITY_FILE, 'utf-8').split('\n').filter(Boolean);
    if (lines.length > MAX_ACTIVITY_FILE_ENTRIES) {
      const trimmed = lines.slice(-MAX_ACTIVITY_FILE_ENTRIES).join('\n') + '\n';
      const tmp = ACTIVITY_FILE + '.tmp';
      fs.writeFileSync(tmp, trimmed);
      fs.renameSync(tmp, ACTIVITY_FILE);
    }
  } catch (e) {
    console.warn('[Activity] Failed to trim activity file:', e);
  }
}

eventBus.on('*', (event) => {
  if (event.type === Events.STREAMING_CHUNK) return;

  const activityItem = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    type: event.type,
    timestamp: event.timestamp,
    source: event.source,
    summary: formatActivitySummary(event),
  };

  persistActivity(activityItem);

  io.emit('activity', activityItem);
});

function formatActivitySummary(event: any): string {
  switch (event.type) {
    case Events.TOOL_CALLED: return `Tool called: ${event.data.name}`;
    case Events.TOOL_COMPLETED: return `Tool completed: ${event.data.name} (${event.data.durationMs}ms)`;
    case Events.TOOL_FAILED: return `Tool failed: ${event.data.name}`;
    case Events.MESSAGE_RECEIVED: return `Message received`;
    case Events.MESSAGE_PROCESSED: return `Response generated (${event.data.durationMs}ms, ${event.data.toolCalls} tools)`;
    case Events.MODEL_FAILOVER: return `Model failover: ${event.data.from} → ${event.data.to}`;
    case Events.SESSION_STARTED: return `Session started`;
    case Events.SESSION_RESET: return `Session reset`;
    case Events.CONTEXT_COMPACTED: return `Context compacted`;
    case Events.DASHBOARD_CONNECTED: return `Dashboard connected`;
    case Events.DASHBOARD_DISCONNECTED: return `Dashboard disconnected`;
    case Events.SCHEDULER_FIRED: return `Scheduled task fired`;
    case Events.LEARNING_COMPLETED: return `Self-learning analysis completed`;
    case Events.RELAY_CONNECTED: return `Extension relay connected`;
    case Events.RELAY_DISCONNECTED: return `Extension relay disconnected`;
    case Events.RELAY_TABS_UPDATE: return `Extension tabs updated (${event.data?.count || 0} tabs)`;
    case Events.AGENT_WORKER_STARTED: return `Sub-agent started: ${event.data?.task?.substring(0, 60) || ''}`;
    case Events.AGENT_WORKER_COMPLETED: return `Sub-agent completed`;
    case Events.AGENT_WORKER_FAILED: return `Sub-agent failed: ${event.data?.error || ''}`;
    case Events.AGENT_WORKER_TIMED_OUT: return `Sub-agent timed out`;
    case Events.CONVERSATION_CREATED: return `Conversation created: ${event.data?.label || ''}`;
    case Events.CONVERSATION_CLOSED: return `Conversation closed: ${event.data?.label || ''}`;
    case Events.CONVERSATION_ABORTED: return `Conversation aborted: ${event.data?.label || ''}`;
    case Events.ORG_CREATED: return `Org created: ${event.data?.org?.name}`;
    case Events.ORG_DELETED: return `Org deleted: ${event.data?.name}`;
    case Events.ORG_PAUSED: return `Org paused: ${event.data?.org?.name}`;
    case Events.ORG_RESUMED: return `Org resumed: ${event.data?.org?.name}`;
    case Events.ORG_AGENT_CREATED: return `Agent created: ${event.data?.agent?.name} (${event.data?.agent?.role})`;
    case Events.ORG_AGENT_PAUSED: return `Agent paused: ${event.data?.agent?.name}`;
    case Events.ORG_AGENT_RESUMED: return `Agent resumed: ${event.data?.agent?.name}`;
    case Events.ORG_AGENT_HEARTBEAT_FIRED: return `Heartbeat: ${event.data?.agentName} woke up (${event.data?.trigger})`;
    case Events.ORG_AGENT_HEARTBEAT_SKIPPED: return `Heartbeat skipped: ${event.data?.agentId} still running`;
    case Events.ORG_AGENT_RUN_STARTED: return `Agent run started: ${event.data?.agentName} (${event.data?.role})`;
    case Events.ORG_AGENT_RUN_COMPLETED: return `Agent run completed: ${event.data?.agentName} in ${event.data?.durationMs}ms`;
    case Events.ORG_AGENT_RUN_FAILED: return `Agent run failed: ${event.data?.agentId} — ${event.data?.error}`;
    case Events.ORG_TICKET_CREATED: return `Ticket created: ${event.data?.ticket?.title}`;
    case Events.ORG_TICKET_UPDATED: return `Ticket updated: ${event.data?.ticket?.title}`;
    case 'org:notification': return `[${event.data?.orgName ?? 'Org'}] ${event.data?.agentName ?? 'Agent'}: ${event.data?.message ?? ''}`;
    default: return event.type;
  }
}

// ─── FIX-6: Tool streaming re-wired via Event Bus ───────────────────
// Forward primary brain tool events to dashboard (not worker events)
eventBus.on('brain:tool_called', (event: any) => {
  const data = event.data ?? event;
  if (!data.isWorker) {
    io.emit('tool_update', {
      conversationId: data.conversationId,
      type: 'started',
      tool: data.name,
      timestamp: Date.now(),
    });

    // 12.6 Live tool feed events
    io.emit('chat:tool_feed', { conversationId: data.conversationId, type: 'started', tool: data.name, args: data.args, timestamp: Date.now() });
  }
});

eventBus.on('brain:tool_completed', (event: any) => {
  const data = event.data ?? event;
  if (!data.isWorker) {
    io.emit('tool_update', {
      conversationId: data.conversationId,
      type: 'completed',
      tool: data.name,
      durationMs: data.durationMs,
      success: data.success,
      timestamp: Date.now(),
    });

    // 12.6 Live tool feed events
    io.emit('chat:tool_feed', { conversationId: data.conversationId, type: 'completed', tool: data.name, durationMs: data.durationMs, success: data.success, timestamp: Date.now() });
  }
});

// ─── Real-time agent status push ────────────────────────────────────
const pushWorkerUpdate = (event: any) => {
  const data = event.data ?? event;
  io.emit('agent:update', {
    conversationId: data.parentConversationId,
    workers: agentRegistry.getWorkers(data.parentConversationId),
  });
};
eventBus.on('agent:worker_started', pushWorkerUpdate);
eventBus.on('agent:worker_completed', pushWorkerUpdate);
eventBus.on('agent:worker_failed', pushWorkerUpdate);
eventBus.on('agent:worker_timed_out', pushWorkerUpdate);
eventBus.on('agent:worker_queued', pushWorkerUpdate);

// Push org notifications as toasts to dashboard
eventBus.on('org:notification', (event: any) => {
  io.emit('org:notification', event.data ?? event);
});

// Push org agent run status updates
eventBus.on(Events.ORG_AGENT_RUN_STARTED, (event: any) => {
  const data = event.data ?? event;
  io.emit('org:agent:run_update', { ...data, running: true });
});
eventBus.on(Events.ORG_AGENT_RUN_COMPLETED, (event: any) => {
  const data = event.data ?? event;
  io.emit('org:agent:run_update', { ...data, running: false });
  const org = orgManager.get(data.orgId);
  if (org) io.emit('org:updated', org);
});
eventBus.on(Events.ORG_AGENT_RUN_FAILED, (event: any) => {
  const data = event.data ?? event;
  io.emit('org:agent:run_update', { ...data, running: false, failed: true });
  const org = orgManager.get(data.orgId);
  if (org) io.emit('org:updated', org);
});

// Push ticket board updates
eventBus.on(Events.ORG_TICKET_CREATED, (event: any) => {
  io.emit('org:ticket:update', { orgId: (event.data ?? event).ticket.orgId });
});
eventBus.on(Events.ORG_TICKET_UPDATED, (event: any) => {
  io.emit('org:ticket:update', { orgId: (event.data ?? event).ticket.orgId });
});

// Proposals
eventBus.on('org:proposal:created', (event: any) => {
  const data = event.data ?? event;
  const proposal = data.proposal ?? {};
  io.emit('org:proposal:update', { orgId: proposal.orgId });
  const org = orgManager.get(proposal.orgId);
  const label = proposal.relativePath
    ? `Proposed change to \`${proposal.relativePath}\``
    : `Submitted for review: ${proposal.title ?? 'Untitled'}`;
  io.emit('org:notification', {
    orgId: proposal.orgId,
    orgName: org?.name ?? 'Unknown',
    agentName: proposal.agentLabel ?? 'Unknown',
    message: label,
    level: 'warning',
    type: 'proposal',
    timestamp: Date.now(),
  });
});
eventBus.on('org:proposal:approved', (event: any) => io.emit('org:proposal:update', { orgId: (event.data ?? event).proposal.orgId }));
eventBus.on('org:proposal:rejected', (event: any) => io.emit('org:proposal:update', { orgId: (event.data ?? event).proposal.orgId }));

// Blockers
eventBus.on('org:blocker:created', (event: any) => {
  const data = event.data ?? event;
  const blocker = data.blocker ?? {};
  const orgName = orgManager.get(blocker.orgId)?.name ?? 'Unknown';
  const agentName = blocker.agentLabel ?? 'Unknown';
  io.emit('org:blocker:update', { orgId: blocker.orgId });
  io.emit('org:notification', { orgId: blocker.orgId, orgName, agentName, message: `🚧 ${blocker.title ?? 'Blocker'}`, level: 'error', type: 'blocker', timestamp: Date.now() });
  storeNotification({ orgId: blocker.orgId, orgName, agentName, message: `🚧 ${blocker.title ?? 'Blocker'}: ${blocker.humanActionRequired ?? ''}`, level: 'error', type: 'blocker', timestamp: Date.now() });
});
eventBus.on('org:blocker:update', (event: any) => io.emit('org:blocker:update', { orgId: (event.data ?? event).orgId }));

// File activity (live)
eventBus.on('org:agent:file_activity', (event: any) => io.emit('org:agent:file_activity', event.data ?? event));

// ─── System Metrics Broadcaster ─────────────────────────────────────
let cachedMetrics = { cpu: 0, ram: '0', totalRam: '0', disk: '0', totalDisk: '0' };

setInterval(async () => {
  try {
    const [cpu, mem, disk] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
    ]);

    const mainDisk = disk.find(d => d.mount === 'C:') || disk[0];

    cachedMetrics = {
      cpu: Math.round(cpu.currentLoad),
      ram: (mem.active / (1024 * 1024 * 1024)).toFixed(1),
      totalRam: (mem.total / (1024 * 1024 * 1024)).toFixed(1),
      disk: mainDisk ? ((mainDisk.used) / (1024 * 1024 * 1024)).toFixed(0) : '0',
      totalDisk: mainDisk ? ((mainDisk.size) / (1024 * 1024 * 1024)).toFixed(0) : '0',
    };

    io.emit('metrics', cachedMetrics);
  } catch (error) {
    console.error('[Metrics] Error:', error);
  }
}, 2000);

// ─── Socket.io — Real-time Dashboard ────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Server] Dashboard connected: ${socket.id}`);
  eventBus.dispatch(Events.DASHBOARD_CONNECTED, { socketId: socket.id }, 'server');

  socket.emit('init', {
    version: '12.0.0',
    skills: skills.map(s => ({ name: s.name, description: s.description.split('\n')[0] })),
    metrics: cachedMetrics,
    activity: activityBuffer.slice(-20),
    conversations: conversationManager.list(),
    orgs: orgManager.list(), // v12 addition
  });

  // ── Multi-chat message handler ──
  socket.on('message', async (payload: { text: string; conversationId: string; image?: string }) => {
    const { text, conversationId, image } = payload;
    console.log(`[Server] Message for ${conversationId}:`, text?.substring(0, 100));

    try {
      let finalPrompt = text;

      if (image) {
        console.log('[Server] Message contains an image. Saving...');
        const base64Data = image.replace(/^data:image\/png;base64,/, "");
        const screenshotsDir = path.join(process.cwd(), 'screenshots');
        if (!fs.existsSync(screenshotsDir)) {
          fs.mkdirSync(screenshotsDir, { recursive: true });
        }
        const filename = `dashboard_${Date.now()}.png`;
        const filePath = path.join(screenshotsDir, filename);
        fs.writeFileSync(filePath, base64Data, 'base64');
        finalPrompt = `[DASHBOARD_IMAGE_UPLOAD] User attached a screenshot saved to "${filePath}".\n\nUser Message: ${text}`;
      }

      const response = await conversationManager.send(conversationId, finalPrompt);
      socket.emit('response', { conversationId, text: response });
    } catch (err: any) {
      socket.emit('response', {
        conversationId, text: `Error: ${err.message}`, isError: true,
      });
    }
  });

  // ── Conversation management ──
  socket.on('conversation:create', () => {
    try {
      socket.emit('conversation:created', conversationManager.create());
    } catch (err: any) {
      socket.emit('conversation:error', { message: err.message });
    }
  });

  socket.on('conversation:close', async ({ conversationId }: { conversationId: string }) => {
    await conversationManager.close(conversationId);
    socket.emit('conversation:closed', { conversationId });
  });

  socket.on('conversation:abort', ({ conversationId }: { conversationId: string }) => {
    try {
      conversationManager.abort(conversationId);
      eventBus.dispatch(Events.CONVERSATION_ABORTED, { conversationId }, 'server');
      // Send a synthetic "aborted" response so the frontend clears the waiting state
      socket.emit('response', {
        conversationId,
        text: '⬛ Stopped. What\'s next?',
        isAborted: true,
      });
    } catch (err: any) {
      socket.emit('conversation:error', { message: err.message });
    }
  });

  socket.on('conversation:list', () => {
    socket.emit('conversation:list', conversationManager.list());
  });

  // Send chat history for a conversation (used on reconnect / page refresh)
  socket.on('conversation:history', ({ conversationId }: { conversationId: string }) => {
    try {
      const messages = conversationManager.getMessages(conversationId);
      socket.emit('conversation:history', { conversationId, messages });
    } catch (err: any) {
      socket.emit('conversation:error', { message: err.message });
    }
  });

  // ── Agent management ──
  socket.on('agent:list', ({ conversationId }: { conversationId: string }) => {
    socket.emit('agent:list', {
      conversationId,
      workers: agentRegistry.getWorkers(conversationId),
    });
  });

  socket.on('agent:logs', ({ agentId }: { agentId: string }) => {
    socket.emit('agent:logs', {
      agentId,
      logs: agentRegistry.getRawLogs(agentId),
    });
  });

  // ── Org list & lifecycle ──
  socket.on('org:list', () => {
    socket.emit('org:list', orgManager.list());
  });

  socket.on('org:create', (params: { name: string; mission: string; rootDir: string }) => {
    try {
      const org = orgManager.create(params);
      io.emit('org:created', org);
    } catch (err: any) {
      socket.emit('org:error', { message: err.message });
    }
  });

  socket.on('org:update', (params: { orgId: string; updates: any }) => {
    try {
      const org = orgManager.update(params.orgId, params.updates);
      io.emit('org:updated', org);
    } catch (err: any) {
      socket.emit('org:error', { message: err.message });
    }
  });

  socket.on('org:delete', (params: { orgId: string }) => {
    try {
      orgManager.delete(params.orgId);
      io.emit('org:deleted', { orgId: params.orgId });
    } catch (err: any) {
      socket.emit('org:error', { message: err.message });
    }
  });

  // ── Agent management ──
  socket.on('org:agent:create', (params: { orgId: string; agent: any }) => {
    try {
      const agent = orgManager.addAgent(params.orgId, params.agent);
      orgHeartbeat.scheduleAgent(params.orgId, agent.id);
      io.emit('org:updated', orgManager.get(params.orgId));
    } catch (err: any) {
      socket.emit('org:error', { message: err.message });
    }
  });

  socket.on('org:agent:update', (params: { orgId: string; agentId: string; updates: any }) => {
    try {
      orgManager.updateAgent(params.orgId, params.agentId, params.updates);
      io.emit('org:updated', orgManager.get(params.orgId));
    } catch (err: any) {
      socket.emit('org:error', { message: err.message });
    }
  });

  socket.on('org:agent:delete', (params: { orgId: string; agentId: string }) => {
    try {
      orgManager.deleteAgent(params.orgId, params.agentId);
      io.emit('org:updated', orgManager.get(params.orgId));
    } catch (err: any) {
      socket.emit('org:error', { message: err.message });
    }
  });

  socket.on('org:agent:trigger', async (params: { orgId: string; agentId: string }) => {
    try {
      await orgHeartbeat.triggerAgent(params.orgId, params.agentId, 'manual');
    } catch (err: any) {
      socket.emit('org:error', { message: err.message });
    }
  });

  // ── Direct agent chat (FIX-I: persistent Brain per chatId) ──
  socket.on('org:agent:message', async (params: {
    orgId: string; agentId: string; chatId: string; text: string;
  }) => {
    const { orgId, agentId, chatId, text } = params;
    try {
      socket.emit('org:agent:thinking', { chatId, agentId });
      const result = await runOrgAgent(orgId, agentId, 'chat', text, chatId);
      socket.emit('org:agent:response', { chatId, agentId, text: result.response });
    } catch (err: any) {
      socket.emit('org:agent:response', {
        chatId, agentId, text: `Error: ${err.message}`, isError: true,
      });
    }
  });

  // FIX-I: Clean up persistent chat Brain when pane is closed
  socket.on('org:agent:chat:close', (params: { chatId: string }) => {
    closeChatSession(params.chatId);
  });

  // ── Ticket management ──
  socket.on('org:tickets:list', (params: { orgId: string; filter?: any }) => {
    const tickets = orgTaskBoard.list(params.orgId, params.filter);
    socket.emit('org:tickets:list', { orgId: params.orgId, tickets });
  });

  socket.on('org:ticket:create', async (params: { orgId: string; ticket: any }) => {
    try {
      const ticket = await orgTaskBoard.create({
        ...params.ticket,
        orgId: params.orgId,
        isHumanCreated: true,
        createdBy: 'human',
        createdByLabel: 'You',
      });
      io.emit('org:ticket:update', { orgId: params.orgId });
      socket.emit('org:ticket:created', ticket);
    } catch (err: any) {
      socket.emit('org:error', { message: err.message });
    }
  });

  socket.on('org:ticket:update', async (params: { orgId: string; ticketId: string; updates: any }) => {
    try {
      await orgTaskBoard.update(params.orgId, params.ticketId, {
        ...params.updates,
        byLabel: 'You',
        callerAgentId: 'human',
      });
      io.emit('org:ticket:update', { orgId: params.orgId });
    } catch (err: any) {
      socket.emit('org:error', { message: err.message });
    }
  });

  // ── Org activity log ──
  socket.on('org:activity', (params: { orgId: string; count?: number }) => {
    const org = orgManager.get(params.orgId);
    const filtered = activityBuffer
      .filter(a => a.type?.startsWith('org:') || a.summary?.includes(org?.name ?? '__never__'))
      .slice(-(params.count ?? 50));
    socket.emit('org:activity', { orgId: params.orgId, items: filtered });
  });

  // ── Org memory viewer (FIX-O: correlationId for response matching) ──
  socket.on('org:memory:read', (params: { orgId: string; agentId?: string; correlationId: string }) => {
    try {
      const { orgId, agentId, correlationId } = params;
      const file = agentId
        ? orgManager.getAgentMemoryFile(orgId, agentId)
        : orgManager.getSharedMemoryFile(orgId);
      const content = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : null;
      // FIX-O: include correlationId so frontend matches response to the correct request
      socket.emit('org:memory:content', { orgId, agentId, content, correlationId });
    } catch (err: any) {
      socket.emit('org:error', { message: err.message });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Server] Dashboard disconnected: ${socket.id}`);
    eventBus.dispatch(Events.DASHBOARD_DISCONNECTED, { socketId: socket.id }, 'server');
  });

  // Proposals
  socket.on('org:proposals:list', (params: { orgId: string }) => {
    socket.emit('org:proposals:list', { orgId: params.orgId, proposals: loadProposals(params.orgId) });
  });
  socket.on('org:proposal:content', (params: { orgId: string; proposalId: string }) => {
    const content = getProposalContent(params.orgId, params.proposalId);
    socket.emit('org:proposal:content', { proposalId: params.proposalId, ...content });
  });
  socket.on('org:proposal:approve', (params: { orgId: string; proposalId: string }) => {
    const result = approveProposal(params.orgId, params.proposalId);
    if (result.success) io.emit('org:proposal:update', { orgId: params.orgId });
    socket.emit('org:proposal:result', result);
  });
  socket.on('org:proposal:reject', (params: { orgId: string; proposalId: string }) => {
    const result = rejectProposal(params.orgId, params.proposalId);
    if (result.success) io.emit('org:proposal:update', { orgId: params.orgId });
    socket.emit('org:proposal:result', result);
  });

  // Protection management
  socket.on('org:protection:update', (params: {
    orgId: string;
    mode?: string;
    manualPaths?: string[];
    refreshGit?: boolean;
  }) => {
    try {
      const org = orgManager.updateProtection(params.orgId, {
        mode: params.mode as any,
        manualPaths: params.manualPaths,
        refreshGit: params.refreshGit,
      });
      io.emit('org:updated', org);
    } catch (err: any) {
      socket.emit('org:error', { message: err.message });
    }
  });

  // Blockers
  socket.on('org:blockers:list', (params: { orgId: string }) => {
    try {
      const org = orgManager.get(params.orgId);
      if (!org) return socket.emit('org:blockers:list', { orgId: params.orgId, blockers: [] });
      const file = path.join(org.orgDir, 'blockers.json');
      const blockers = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : [];
      socket.emit('org:blockers:list', { orgId: params.orgId, blockers });
    } catch { socket.emit('org:blockers:list', { orgId: params.orgId, blockers: [] }); }
  });
  socket.on('org:blocker:resolve', (params: { orgId: string; blockerId: string; resolution: string }) => {
    try {
      const org = orgManager.get(params.orgId);
      if (!org) return;
      const file = path.join(org.orgDir, 'blockers.json');
      const blockers = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : [];
      const idx = blockers.findIndex((b: any) => b.id === params.blockerId);
      if (idx > -1) {
        blockers[idx] = { ...blockers[idx], status: 'resolved', resolvedAt: new Date().toISOString(), resolution: params.resolution };
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(blockers, null, 2));
        fs.renameSync(tmp, file);
        io.emit('org:blocker:update', { orgId: params.orgId });
      }
    } catch (e: any) { socket.emit('org:error', { message: e.message }); }
  });
  
  // Stored notifications
  socket.on('org:notifications:list', (params: { orgId: string; count?: number }) => {
    socket.emit('org:notifications:list', { orgId: params.orgId, notifications: getNotifications(params.orgId, params.count ?? 100) });
  });
  
  // Agent run activity
  socket.on('org:agent:activity', (params: { orgId: string; agentId: string }) => {
    try {
      const logFile = orgManager.getRunLogFile(params.orgId, params.agentId);
      if (!fs.existsSync(logFile)) return socket.emit('org:agent:activity', { runs: [] });
      const runs = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean).slice(-20)
        .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      socket.emit('org:agent:activity', { orgId: params.orgId, agentId: params.agentId, runs });
    } catch { socket.emit('org:agent:activity', { runs: [] }); }
  });
  
  // Workspace file browser — all files recursively (for Workspace tab)
  socket.on('org:workspace:files:all', (params: { orgId: string }) => {
    try {
      const org = orgManager.get(params.orgId);
      if (!org) return socket.emit('org:workspace:files:all', { orgId: params.orgId, files: [] });
      const allFiles: any[] = [];
      const walk = (dir: string, rel: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          // Skip comments sidecar files and proposals directory
          if (entry.name.endsWith('.comments.json')) continue;
          if (entry.name === 'proposals' && rel === '') continue;
          const entryPath = (rel ? rel + '/' : '') + entry.name;
          if (entry.isDirectory()) {
            walk(path.join(dir, entry.name), entryPath);
          } else {
            try {
              const stat = fs.statSync(path.join(dir, entry.name));
              allFiles.push({
                name: entry.name,
                isDir: false,
                path: entryPath,
                size: stat.size,
                modified: stat.mtime.toISOString(),
              });
            } catch { /* skip unreadable files */ }
          }
        }
      };
      walk(org.workspaceDir, '');
      socket.emit('org:workspace:files:all', { orgId: params.orgId, files: allFiles });
    } catch (e: any) { socket.emit('org:error', { message: e.message }); }
  });

  // Workspace file read
  socket.on('org:workspace:file:read', (params: { orgId: string; path: string }) => {
    try {
      const org = orgManager.get(params.orgId);
      if (!org) return socket.emit('org:workspace:file:content', { orgId: params.orgId, path: params.path, error: 'Org not found' });
      const filePath = path.join(org.workspaceDir, params.path);
      // Security: ensure path is within workspace
      const resolved = path.resolve(filePath);
      const wsResolved = path.resolve(org.workspaceDir);
      if (!resolved.startsWith(wsResolved)) {
        return socket.emit('org:workspace:file:content', { orgId: params.orgId, path: params.path, error: 'Access denied: path outside workspace' });
      }
      if (!fs.existsSync(filePath)) {
        return socket.emit('org:workspace:file:content', { orgId: params.orgId, path: params.path, error: 'File not found' });
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      socket.emit('org:workspace:file:content', { orgId: params.orgId, path: params.path, content });
    } catch (e: any) {
      socket.emit('org:workspace:file:content', { orgId: params.orgId, path: params.path, error: e.message });
    }
  });

  // Workspace file write
  socket.on('org:workspace:file:write', (params: { orgId: string; path: string; content: string }) => {
    try {
      const org = orgManager.get(params.orgId);
      if (!org) return socket.emit('org:workspace:file:saved', { orgId: params.orgId, error: 'Org not found' });
      const filePath = path.join(org.workspaceDir, params.path);
      const resolved = path.resolve(filePath);
      const wsResolved = path.resolve(org.workspaceDir);
      if (!resolved.startsWith(wsResolved)) {
        return socket.emit('org:workspace:file:saved', { orgId: params.orgId, error: 'Access denied' });
      }
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, params.content, 'utf-8');
      socket.emit('org:workspace:file:saved', { orgId: params.orgId, path: params.path, success: true });
    } catch (e: any) {
      socket.emit('org:workspace:file:saved', { orgId: params.orgId, error: e.message });
    }
  });

  // Workspace file comments — read
  socket.on('org:workspace:file:comments:read', (params: { orgId: string; path: string }) => {
    try {
      const org = orgManager.get(params.orgId);
      if (!org) return socket.emit('org:workspace:file:comments', { orgId: params.orgId, path: params.path, comments: [] });
      const commentsFile = path.join(org.workspaceDir, params.path + '.comments.json');
      const comments = fs.existsSync(commentsFile) ? JSON.parse(fs.readFileSync(commentsFile, 'utf-8')) : [];
      socket.emit('org:workspace:file:comments', { orgId: params.orgId, path: params.path, comments });
    } catch {
      socket.emit('org:workspace:file:comments', { orgId: params.orgId, path: params.path, comments: [] });
    }
  });

  // Workspace file comments — add
  socket.on('org:workspace:file:comment', (params: { orgId: string; path: string; text: string; author: string }) => {
    try {
      const org = orgManager.get(params.orgId);
      if (!org) return;
      const commentsFile = path.join(org.workspaceDir, params.path + '.comments.json');
      const existing = fs.existsSync(commentsFile) ? JSON.parse(fs.readFileSync(commentsFile, 'utf-8')) : [];
      existing.push({
        author: params.author,
        text: params.text,
        timestamp: new Date().toISOString(),
        read: false,
      });
      fs.writeFileSync(commentsFile, JSON.stringify(existing, null, 2));
      socket.emit('org:workspace:file:comments', { orgId: params.orgId, path: params.path, comments: existing });
    } catch (e: any) {
      socket.emit('org:error', { message: e.message });
    }
  });

  // Original workspace directory browser
  socket.on('org:workspace:list', (params: { orgId: string; subdir?: string }) => {
    try {
      const org = orgManager.get(params.orgId);
      if (!org) return socket.emit('org:workspace:list', { files: [] });
      const dir = params.subdir ? path.join(org.workspaceDir, params.subdir) : org.workspaceDir;
      if (!fs.existsSync(dir)) return socket.emit('org:workspace:list', { files: [] });
      const entries = fs.readdirSync(dir, { withFileTypes: true }).map(e => ({
        name: e.name,
        isDir: e.isDirectory(),
        path: path.join(params.subdir ?? '', e.name).replace(/\\/g, '/'),
        size: e.isFile() ? fs.statSync(path.join(dir, e.name)).size : 0,
        modified: e.isFile() ? fs.statSync(path.join(dir, e.name)).mtime.toISOString() : null,
      }));
      socket.emit('org:workspace:list', { orgId: params.orgId, dir: params.subdir ?? '/', files: entries });
    } catch (e: any) { socket.emit('org:error', { message: e.message }); }
  });

});

// ─── REST API ───────────────────────────────────────────────────────

// Health check
app.get('/status', (req, res) => {
  res.json({
    status: 'Online',
    version: '12.0.0',
    system: 'PersonalClaw',
    skills: skills.length,
    conversations: conversationManager.list().length,
  });
});

// Chat endpoint (REST) — routes to Chat 1, creates if not exists
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required.' });
    }
    const convo = conversationManager.getOrCreateDefault();
    const response = await convo.brain.processMessage(message);
    res.json({ response, conversationId: convo.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Conversation management
app.post('/api/conversations', (req, res) => {
  try { res.json(conversationManager.create()); }
  catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.get('/api/conversations', (req, res) => res.json(conversationManager.list()));

app.delete('/api/conversations/:id', async (req, res) => {
  await conversationManager.close(req.params.id);
  res.json({ success: true });
});

// Agent management
app.get('/api/conversations/:id/agents', (req, res) => {
  res.json(agentRegistry.getWorkers(req.params.id));
});

app.get('/api/agents/:agentId/logs', (req, res) => {
  res.json({ logs: agentRegistry.getRawLogs(req.params.agentId) });
});

// Lock status
app.get('/api/locks', (req, res) => {
  res.json(skillLock.getAllHeld());
});

// Skills list
app.get('/api/skills', (req, res) => {
  res.json(skills.map(s => ({
    name: s.name,
    description: s.description,
    parameters: s.parameters,
  })));
});

// Session management
app.get('/api/sessions', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  res.json(SessionManager.listSessions(limit));
});

app.get('/api/sessions/search', (req, res) => {
  const query = req.query.q as string;
  if (!query) return res.status(400).json({ error: 'Query parameter "q" required.' });
  res.json(SessionManager.searchSessions(query));
});

app.get('/api/sessions/stats', (req, res) => {
  res.json(SessionManager.getStats());
});

// Metrics (instant)
app.get('/api/metrics', (req, res) => {
  res.json(cachedMetrics);
});

// Audit log
app.get('/api/audit', (req, res) => {
  const count = parseInt(req.query.count as string) || 50;
  const category = req.query.category as string;
  res.json(audit.getRecent(count, category));
});

// Extension relay status
app.get('/api/relay', (req, res) => {
  res.json(extensionRelay.getStatus());
});

// Activity feed
app.get('/api/activity', (req, res) => {
  const count = parseInt(req.query.count as string) || 20;
  res.json(activityBuffer.slice(-count));
});

// Org CRUD
app.get('/api/orgs', (_req, res) => res.json(orgManager.list()));
app.post('/api/orgs', (req, res) => {
  try { res.json(orgManager.create(req.body)); }
  catch (err: any) { res.status(400).json({ error: err.message }); }
});
app.put('/api/orgs/:id', (req, res) => {
  try { res.json(orgManager.update(req.params.id, req.body)); }
  catch (err: any) { res.status(400).json({ error: err.message }); }
});
app.delete('/api/orgs/:id', (req, res) => {
  try { orgManager.delete(req.params.id); res.json({ success: true }); }
  catch (err: any) { res.status(400).json({ error: err.message }); }
});

// Agent CRUD
app.post('/api/orgs/:id/agents', (req, res) => {
  try {
    const agent = orgManager.addAgent(req.params.id, req.body);
    orgHeartbeat.scheduleAgent(req.params.id, agent.id);
    res.json(agent);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});
app.put('/api/orgs/:orgId/agents/:agentId', (req, res) => {
  try { res.json(orgManager.updateAgent(req.params.orgId, req.params.agentId, req.body)); }
  catch (err: any) { res.status(400).json({ error: err.message }); }
});
app.delete('/api/orgs/:orgId/agents/:agentId', (req, res) => {
  try { orgManager.deleteAgent(req.params.orgId, req.params.agentId); res.json({ success: true }); }
  catch (err: any) { res.status(400).json({ error: err.message }); }
});
app.post('/api/orgs/:orgId/agents/:agentId/trigger', async (req, res) => {
  try {
    await orgHeartbeat.triggerAgent(req.params.orgId, req.params.agentId, 'manual');
    res.json({ success: true });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// Tickets
app.get('/api/orgs/:id/tickets', (req, res) => res.json(orgTaskBoard.list(req.params.id)));
app.post('/api/orgs/:id/tickets', async (req, res) => {
  try {
    const ticket = await orgTaskBoard.create({
      ...req.body, orgId: req.params.id, isHumanCreated: true,
      createdBy: 'human', createdByLabel: 'You',
    });
    res.json(ticket);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});
// Protection management
app.post('/api/check-git', (req, res) => {
  const { dir } = req.body;
  if (!dir) return res.status(400).json({ error: 'dir required' });
  const { hasGitRepo, snapshotGitFiles } = require('./core/org-file-guard.js');
  const available = hasGitRepo(dir);
  const count = available ? snapshotGitFiles(dir).length : 0;
  res.json({ available, fileCount: count });
});

app.put('/api/orgs/:id/protection', (req, res) => {
  try {
    const { mode, manualPaths, refreshGit } = req.body;
    const org = orgManager.updateProtection(req.params.id, { mode, manualPaths, refreshGit });
    io.emit('org:updated', org);
    res.json(org);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.post('/api/browse-folder', async (req, res) => {
  try {
    const { execSync } = await import('child_process');
    const result = execSync(
      `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select folder to protect'; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $f.SelectedPath } else { '' }"`,
      { encoding: 'utf-8', timeout: 30000 }
    ).trim();
    res.json({ path: result || null });
  } catch {
    res.json({ path: null });
  }
});

app.post('/api/browse-file', async (req, res) => {
  try {
    const { execSync } = await import('child_process');
    const result = execSync(
      `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Multiselect = $false; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $f.FileName } else { '' }"`,
      { encoding: 'utf-8', timeout: 30000 }
    ).trim();
    res.json({ path: result || null });
  } catch {
    res.json({ path: null });
  }
});

app.put('/api/orgs/:orgId/tickets/:ticketId', async (req, res) => {
  try {
    const ticket = await orgTaskBoard.update(req.params.orgId, req.params.ticketId, {
      ...req.body, byLabel: 'You', callerAgentId: 'human',
    });
    res.json(ticket);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// ─── Graceful Shutdown ──────────────────────────────────────────────
const shutdown = async (signal: string) => {
  console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);

  eventBus.dispatch(Events.SERVER_SHUTDOWN, { signal }, 'server');

  // FIX-G: Stop all org heartbeat cron tasks before anything else
  orgHeartbeat.stopAll();

  // FIX-M: Kill all workers spawned by org agents (their conversationIds are
  // not known to conversationManager, so we handle them explicitly here)
  for (const convId of getAllOrgConversationIds()) {
    agentRegistry.killAll(convId);
  }

  // Save all open conversations
  await conversationManager.closeAll();
  // telegramBrain history is not saved — Telegram users reconnect fresh

  // Stop extension relay
  extensionRelay.stop();

  // Flush audit log
  audit.shutdown();

  // Close socket connections
  io.close();

  // Close HTTP server
  server.close(() => {
    console.log('[Server] HTTP server closed.');
    terminalLogger.stop(); // flush and close log file
    process.exit(0);
  });

  // Force exit after 5 seconds
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout.');
    terminalLogger.stop();
    process.exit(1);
  }, 5000);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err);
  audit.log({
    level: 'critical',
    category: 'system',
    action: 'uncaught_exception',
    detail: err.message,
    metadata: { stack: err.stack },
  });
});
process.on('unhandledRejection', (reason: any) => {
  console.error('[Server] Unhandled rejection:', reason);
  audit.log({
    level: 'error',
    category: 'system',
    action: 'unhandled_rejection',
    detail: String(reason),
  });
});

// ─── Start Server ───────────────────────────────────────────────────
server.listen(PORT, () => {
  const startupInfo = [
    '',
    '  ╔══════════════════════════════════════════╗',
    '  ║       PersonalClaw v12.0  — Online       ║',
    '  ╠══════════════════════════════════════════╣',
    `  ║  Backend:    http://localhost:${PORT}        ║`,
    '  ║  Dashboard:  http://localhost:5173       ║',
    `  ║  Skills:     ${String(skills.length).padEnd(27)}║`,
    `  ║  Relay:      ws://localhost:${PORT}/relay   ║`,
    '  ║  REST API:   /api/chat, /api/skills      ║',
    '  ║  Multi-Chat: Up to 3 panes              ║',
    '  ║  Sub-Agents: Up to 5 per pane           ║',
    '  ╠══════════════════════════════════════════╣',
    `  ║  Orgs:       ${String(orgManager.list().length).padEnd(27)}║`,
    '  ║  Org API:    /api/orgs, /api/orgs/:id   ║',
    '  ╚══════════════════════════════════════════╝',
    '',
  ];
  console.log(startupInfo.join('\n'));

  eventBus.dispatch(Events.SERVER_STARTED, {
    port: PORT,
    skills: skills.length,
  }, 'server');
});
