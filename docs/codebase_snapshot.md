# PersonalClaw: Codebase Snapshot 📸

> **Note:** This snapshot was originally captured at v1.14.0 (March 14, 2026). The codebase has since been upgraded to **v11.0.0** (March 17, 2026) with multi-chat workspaces, multi-agent workers, and a skill lock system. For the current architecture, see `codebase_documentation.md` and `version_log.md`.

---

## 📂 File Structure
```text
PersonalClaw/
├── package.json
├── tsconfig.json
├── .env
├── docs/
│   ├── SETUP_GUIDE.md
│   ├── USER_GUIDE.md
│   ├── codebase_documentation.md
│   ├── codebase_snapshot.md
│   ├── implementation_plan.md
│   └── version_log.md
├── src/
│   ├── index.ts           (Main Server)
│   ├── core/
│   │   ├── brain.ts       (AI Logic)
│   │   └── browser.ts     (Unified Browser Core)
│   ├── skills/            (System Tools)
│   │   ├── index.ts
│   │   ├── browser.ts     (Unified Browser Skill)
│   │   ├── shell.ts
│   │   ├── python.ts
│   │   ├── files.ts
│   │   ├── vision.ts
│   │   └── clipboard.ts
│   ├── interfaces/
│   │   └── telegram.ts
│   └── types/
│       └── skill.ts
└── dashboard/             (UI Frontend)
    └── src/
        ├── App.tsx
        └── index.css
```

---

## 🚀 Backend Core

### `src/index.ts`
```typescript
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import * as dotenv from 'dotenv';
import { Brain } from './core/brain.js';
import si from 'systeminformation';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const brain = new Brain();
const PORT = process.env.PORT || 3000;

// System Metrics Broadcaster
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

io.on('connection', (socket) => {
  socket.on('message', async (data) => {
    try {
      const response = await brain.processMessage(data.text);
      socket.emit('response', { text: response });
    } catch (error: any) {
      socket.emit('response', { text: `Error: ${error.message}` });
    }
  });
});

server.listen(PORT, () => console.log(`[Server] Running on http://localhost:${PORT}`));
```

### `src/core/brain.ts`
```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
import { getToolDefinitions, handleToolCall } from '../skills/index.js';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({
  model: 'gemini-3-flash-preview',
  tools: getToolDefinitions() as any,
});

export class Brain {
  private chat: any;

  constructor() {
    this.chat = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: `You are PersonalClaw, a state-of-the-art AI agent for Windows automation.
Capabilities:
- shell: Direct PowerShell control.
- files: CRUD operations.
- web: Headless browser control.
- vision: Screen analysis using analyze_vision.
- python: Script execution.

Guidelines: Use vision proactively when user asks about the screen. Chain tools as needed.` }],
        },
        {
          role: 'model',
          parts: [{ text: 'Acknowledged. I am PersonalClaw. How can I control your system today?' }],
        },
      ],
    });
  }

  async processMessage(message: string) {
    let result = await this.chat.sendMessage(message);
    let response = result.response;

    while (response.candidates[0].content.parts.some((part: any) => part.functionCall)) {
      const toolCalls = response.candidates[0].content.parts.filter((part: any) => part.functionCall);
      const toolResults = [];

      for (const call of toolCalls) {
        const { name, args } = call.functionCall;
        const output = await handleToolCall(name, args);
        toolResults.push({ functionResponse: { name, response: output } });
      }

      result = await this.chat.sendMessage(toolResults);
      response = result.response;
    }

    return response.candidates[0].content.parts.filter((p: any) => p.text).map((p: any) => p.text).join('\n');
  }
}
```

---

## 🎨 Dashboard Frontend

### `dashboard/src/App.tsx` (Final v1.1.0)
```typescript
import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  Send, Bot, User, FileCode, Shield, LayoutDashboard, Activity, Sun, Moon 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([...]);
  const [isLightTheme, setIsLightTheme] = useState(false);
  // ... Logic for Socket.io, Metrics, and Markdown rendering ...
  return (
    <div className="dashboard-container">
      {/* Sidebar with Theme Toggle */}
      {/* Main Content with Real-time Metrics and Indented Markdown Messages */}
    </div>
  );
};
```

---

## 🚀 Version Log Summary
- **v1.14.0**: Streamlined Browser Architecture. Unified 3 systems into 1. Removed MCP/Stagehand/Relay overlap.
- **v1.13.0**: Added Stagehand AI Browser for natural language navigation.
- **v1.12.0**: Integrated Long-Term Memory and Tier 3 MSP specializations.
- **v1.10.0**: Added Slash Commands and Persistent Browser profiles.
- **v1.1.0**: Added Markdown support, Light/Dark mode, and Gemini 3 Preview integration.
- **v1.0.0**: Initial baseline.
