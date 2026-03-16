import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Brain } from './core/brain.js';
import { TelegramInterface } from './interfaces/telegram.js';
import { eventBus, Events } from './core/events.js';
import { audit } from './core/audit.js';
import { SessionManager } from './core/sessions.js';
import si from 'systeminformation';
import { initScheduler, skills } from './skills/index.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 10e6, // 10MB for image uploads
});

app.use(express.json());

// ─── Core Initialization ────────────────────────────────────────────
console.log('[Server] Initializing PersonalClaw v10...');

console.log('[Server] Initializing Brain...');
const brain = new Brain();

console.log('[Server] Checking Telegram configuration...');
const telegram = new TelegramInterface(brain);

console.log('[Server] Initializing Scheduler...');
initScheduler(async (msg) => {
  try {
    eventBus.dispatch(Events.SCHEDULER_FIRED, { command: msg }, 'scheduler');
    const response = await brain.processMessage(msg);
    io.emit('response', { text: response });
    return response;
  } catch (error) {
    console.error('[Scheduler] Brain execution error:', error);
    return `Error: ${error}`;
  }
});

const PORT = process.env.PORT || 3000;

// ─── Activity Feed ──────────────────────────────────────────────────
// Broadcast events to all dashboards in real-time
const activityBuffer: any[] = [];
const MAX_ACTIVITY = 100;

eventBus.on('*', (event) => {
  // Skip noisy events
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
    default: return event.type;
  }
}

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
    version: '10.0.0',
    model: brain.currentModel,
    sessionId: brain.currentSessionId,
    skills: skills.map(s => ({ name: s.name, description: s.description.split('\n')[0] })),
    metrics: cachedMetrics,
    activity: activityBuffer.slice(-20),
    uptime: brain.uptime,
    turns: brain.turns,
    toolCalls: brain.toolCallCount,
  });

  socket.on('message', async (data: { text: string, image?: string }) => {
    console.log('[Server] Received message:', data.text?.substring(0, 100));

    try {
      let finalPrompt = data.text;

      if (data.image) {
        console.log('[Server] Message contains an image. Saving...');
        const base64Data = data.image.replace(/^data:image\/png;base64,/, "");
        const screenshotsDir = path.join(process.cwd(), 'screenshots');
        if (!fs.existsSync(screenshotsDir)) {
          fs.mkdirSync(screenshotsDir, { recursive: true });
        }
        const filename = `dashboard_${Date.now()}.png`;
        const filePath = path.join(screenshotsDir, filename);
        fs.writeFileSync(filePath, base64Data, 'base64');

        finalPrompt = `[DASHBOARD_IMAGE_UPLOAD] User attached a screenshot saved to "${filePath}".\n\nUser Message: ${data.text}`;
        console.log(`[Server] Screenshot saved to ${filePath}`);
      }

      // Send tool updates in real-time
      const response = await brain.processMessage(finalPrompt, (update) => {
        socket.emit('tool_update', { text: update, timestamp: Date.now() });
      });

      socket.emit('response', {
        text: response,
        metadata: {
          model: brain.currentModel,
          turns: brain.turns,
          toolCalls: brain.toolCallCount,
        },
      });
    } catch (error: any) {
      console.error('[Server] Brain error:', error);
      socket.emit('response', { text: `Error: ${error.message}` });
    }
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
    version: '10.0.0',
    system: 'PersonalClaw',
    model: brain.currentModel,
    session: brain.currentSessionId,
    uptime: brain.uptime,
    turns: brain.turns,
    toolCalls: brain.toolCallCount,
  });
});

// Chat endpoint (REST)
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const response = await brain.processMessage(message);
    res.json({
      response,
      metadata: {
        model: brain.currentModel,
        session: brain.currentSessionId,
        turns: brain.turns,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
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

// Performance stats
app.get('/api/perf', (req, res) => {
  res.json(brain.performanceStats);
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

// Activity feed
app.get('/api/activity', (req, res) => {
  const count = parseInt(req.query.count as string) || 20;
  res.json(activityBuffer.slice(-count));
});

// ─── Graceful Shutdown ──────────────────────────────────────────────
const shutdown = async (signal: string) => {
  console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);

  eventBus.dispatch(Events.SERVER_SHUTDOWN, { signal }, 'server');

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
    '  ║       PersonalClaw v10.0  — Online       ║',
    '  ╠══════════════════════════════════════════╣',
    `  ║  Backend:    http://localhost:${PORT}        ║`,
    '  ║  Dashboard:  http://localhost:5173       ║',
    `  ║  Model:      ${brain.currentModel.padEnd(27)}║`,
    `  ║  Skills:     ${String(skills.length).padEnd(27)}║`,
    '  ║  REST API:   /api/chat, /api/skills      ║',
    '  ╚══════════════════════════════════════════╝',
    '',
  ];
  console.log(startupInfo.join('\n'));

  eventBus.dispatch(Events.SERVER_STARTED, {
    port: PORT,
    model: brain.currentModel,
    skills: skills.length,
  }, 'server');
});
