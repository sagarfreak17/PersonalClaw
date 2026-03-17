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
console.log('[Server] Initializing PersonalClaw v11...');

console.log('[Server] Checking Telegram configuration...');
const telegram = new TelegramInterface();

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

const PORT = process.env.PORT || 3000;

// ─── Activity Feed ──────────────────────────────────────────────────
const activityBuffer: any[] = [];
const MAX_ACTIVITY = 100;

eventBus.on('*', (event) => {
  if (event.type === Events.STREAMING_CHUNK) return;

  const activityItem = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    type: event.type,
    timestamp: event.timestamp,
    source: event.source,
    summary: formatActivitySummary(event),
  };

  activityBuffer.push(activityItem);
  if (activityBuffer.length > MAX_ACTIVITY) {
    activityBuffer.shift();
  }

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

  // Send initial state
  socket.emit('init', {
    version: '11.0.0',
    skills: skills.map(s => ({ name: s.name, description: s.description.split('\n')[0] })),
    metrics: cachedMetrics,
    activity: activityBuffer.slice(-20),
    conversations: conversationManager.list(),
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

  socket.on('disconnect', () => {
    console.log(`[Server] Dashboard disconnected: ${socket.id}`);
    eventBus.dispatch(Events.DASHBOARD_DISCONNECTED, { socketId: socket.id }, 'server');
  });
});

// ─── REST API ───────────────────────────────────────────────────────

// Health check
app.get('/status', (req, res) => {
  res.json({
    status: 'Online',
    version: '11.0.0',
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

// ─── Graceful Shutdown ──────────────────────────────────────────────
const shutdown = async (signal: string) => {
  console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);

  eventBus.dispatch(Events.SERVER_SHUTDOWN, { signal }, 'server');

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
    process.exit(0);
  });

  // Force exit after 5 seconds
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout.');
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
    '  ║       PersonalClaw v11.0  — Online       ║',
    '  ╠══════════════════════════════════════════╣',
    `  ║  Backend:    http://localhost:${PORT}        ║`,
    '  ║  Dashboard:  http://localhost:5173       ║',
    `  ║  Skills:     ${String(skills.length).padEnd(27)}║`,
    `  ║  Relay:      ws://localhost:${PORT}/relay   ║`,
    '  ║  REST API:   /api/chat, /api/skills      ║',
    '  ║  Multi-Chat: Up to 3 panes              ║',
    '  ║  Sub-Agents: Up to 5 per pane           ║',
    '  ╚══════════════════════════════════════════╝',
    '',
  ];
  console.log(startupInfo.join('\n'));

  eventBus.dispatch(Events.SERVER_STARTED, {
    port: PORT,
    skills: skills.length,
  }, 'server');
});
