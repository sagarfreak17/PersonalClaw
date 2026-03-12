import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Brain } from './core/brain.js';
import { TelegramInterface } from './interfaces/telegram.js';
import si from 'systeminformation';
import { WebSocketServer } from 'ws';
import { setExtensionSocket, handleExtensionResponse } from './skills/relay.js';
import { initScheduler } from './skills/index.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

// Relay Server for Browser Extension
const relayWs = new WebSocketServer({ port: 3001 });
relayWs.on('connection', (ws) => {
  console.log('[Relay] Browser Extension Connected');
  setExtensionSocket(ws);
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      handleExtensionResponse(data);
    } catch (e) {
      console.error('[Relay] Error handling message:', e);
    }
  });

  ws.on('close', () => {
    console.log('[Relay] Browser Extension Disconnected');
    setExtensionSocket(null);
  });
});

console.log('[Server] Initializing Brain...');
const brain = new Brain();

console.log('[Server] Initializing Telegram...');
const telegram = new TelegramInterface(brain);

console.log('[Server] Initializing Scheduler...');
initScheduler(async (msg) => {
  try {
    const response = await brain.processMessage(msg);
    io.emit('response', { text: response });
    return response;
  } catch (error) {
    console.error('[Scheduler] Brain execution error:', error);
    return `Error: ${error}`;
  }
});

const PORT = process.env.PORT || 3000;

// Broadcaster for system metrics
setInterval(async () => {
  try {
    const cpu = await si.currentLoad();
    const mem = await si.mem();
    io.emit('metrics', {
      cpu: Math.round(cpu.currentLoad),
      ram: (mem.active / (1024 * 1024 * 1024)).toFixed(1),
      totalRam: (mem.total / (1024 * 1024 * 1024)).toFixed(1),
    });
  } catch (error) {
    console.error('[Metrics] Error:', error);
  }
}, 2000);

// Socket.io for real-time dashboard updates
io.on('connection', (socket) => {
  console.log('[Server] Dashboard connected');

  socket.on('message', async (data: { text: string, image?: string }) => {
    console.log('[Server] Received message from dashboard:', data.text);
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

      const response = await brain.processMessage(finalPrompt);
      socket.emit('response', { text: response });
    } catch (error: any) {
      console.error('[Server] Brain error:', error);
      socket.emit('response', { text: `Error: ${error.message}` });
    }
  });

  socket.on('disconnect', () => {
    console.log('[Server] Dashboard disconnected');
  });
});

// Basic Express API
app.get('/status', (req, res) => {
  res.json({ status: 'Online', system: 'PersonalClaw' });
});

server.listen(PORT, () => {
  console.log(`[Server] PersonalClaw running on http://localhost:${PORT}`);
});

// To be added: Telegram interface
