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

  socket.on('message', async (data) => {
    console.log('[Server] Received message from dashboard:', data);
    try {
      const response = await brain.processMessage(data.text);
      socket.emit('response', { text: response });
    } catch (error: any) {
      console.error('[Server] Brain error:', error);
      socket.emit('response', { text: `Error: ${error.message}` });
    }
  });

  socket.on('screenshot-capture', async (data: { image: string }) => {
    console.log('[Server] Received screenshot from dashboard');
    try {
      const base64Data = data.image.replace(/^data:image\/png;base64,/, "");
      const screenshotsDir = path.join(process.cwd(), 'screenshots');
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }
      const filename = `dashboard_${Date.now()}.png`;
      const filePath = path.join(screenshotsDir, filename);
      fs.writeFileSync(filePath, base64Data, 'base64');

      console.log(`[Server] Screenshot saved to ${filePath}`);
      
      // Notify the Brain about the new image
      const internalPrompt = `[IMAGE_UPLOAD] A new screenshot has been captured from my dashboard and saved to "${filePath}". Please analyze it using analyze_vision and tell me what you see or ask me what to do with it.`;
      const response = await brain.processMessage(internalPrompt);
      socket.emit('response', { text: response });

    } catch (error: any) {
      console.error('[Server] Screenshot processing error:', error);
      socket.emit('response', { text: `Failed to process screenshot: ${error.message}` });
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
