# PersonalClaw - Agent Instructions

Welcome, Agent. You are a PersonalClaw agent operating within the PersonalClaw codebase - a local-first AI automation platform for Windows.

## Project Structure (v11)

```
PersonalClaw/
+-- src/                         # TypeScript backend (Express + Socket.io + Gemini AI)
|   +-- index.ts                 # Server entry point — multi-chat wiring, REST API, socket events
|   +-- core/                    # Core systems
|   |   +-- brain.ts             # Brain class — Gemini integration, tool loop, abort, buildMeta
|   |   +-- events.ts            # Event Bus — typed events, off(), 25+ event constants
|   |   +-- skill-lock.ts        # Skill Lock Manager — exclusive + read-write locks
|   |   +-- agent-registry.ts    # Agent Registry — worker lifecycle, queue, timeout
|   |   +-- conversation-manager.ts  # Conversation Manager — up to 3 panes
|   |   +-- telegram-brain.ts    # Isolated Telegram Brain instance
|   |   +-- sessions.ts          # Session Manager — save, list, search, restore
|   |   +-- audit.ts             # Audit Logger
|   |   +-- learner.ts           # Self-learning engine
|   |   +-- browser.ts           # Playwright browser core
|   |   +-- chrome-mcp.ts        # Chrome Native MCP adapter
|   |   +-- relay.ts             # Extension Relay bridge
|   +-- skills/                  # 15 tool modules
|   |   +-- index.ts             # Skill registry + handleToolCall with meta
|   |   +-- shell.ts             # PowerShell execution
|   |   +-- files.ts             # File CRUD (per-path write lock)
|   |   +-- python.ts            # Python script execution
|   |   +-- vision.ts            # Vision analysis (browser_vision lock)
|   |   +-- clipboard.ts         # System clipboard (exclusive lock)
|   |   +-- memory.ts            # Long-term memory (read-write lock)
|   |   +-- scheduler.ts         # Cron jobs (read-write lock)
|   |   +-- browser.ts           # Triple-mode browser (browser_vision lock)
|   |   +-- http.ts              # HTTP requests
|   |   +-- network.ts           # Network diagnostics
|   |   +-- process-manager.ts   # Process/service management
|   |   +-- system-info.ts       # System diagnostics
|   |   +-- pdf.ts               # PDF operations (per-path write lock)
|   |   +-- imagegen.ts          # AI image generation
|   |   +-- agent-spawn.ts       # Sub-agent worker spawning
|   +-- interfaces/
|   |   +-- telegram.ts          # Telegram bot (uses telegramBrain)
|   +-- types/
|       +-- skill.ts             # Skill + SkillMeta interfaces
+-- dashboard/                   # React + Vite frontend (port 5173)
|   +-- src/
|       +-- App.tsx              # Main dashboard + sidebar
|       +-- components/
|       |   +-- ChatWorkspace.tsx     # Multi-pane workspace (react-resizable-panels)
|       |   +-- ConversationPane.tsx  # Individual chat pane
|       |   +-- WorkerCard.tsx        # Worker status card
|       |   +-- ChatInput.tsx         # Input component
|       +-- hooks/
|       |   +-- useConversations.ts   # Conversation state management
|       |   +-- useAgents.ts          # Worker agent state management
|       +-- types/
|           +-- conversation.ts       # Frontend type definitions
+-- docs/                        # Project documentation
+-- memory/                      # Persistent data (sessions, jobs, knowledge)
+-- scripts/                     # Utility scripts
+-- extension/                   # Chrome extension (relay)
+-- .env                         # Environment variables
+-- package.json                 # Node.js dependencies
+-- tsconfig.json                # TypeScript configuration
```

## Key Technologies
- Runtime: Node.js with TypeScript (tsx for dev, tsc for build)
- AI Model: Google Gemini (API key in .env)
- Backend: Express + Socket.io for real-time communication
- Frontend: React + Vite dashboard
- Browser Automation: Playwright with persistent context
- Communication: Telegram bot integration

## Rules for Agents
1. Read before writing: Always read existing files before modifying them.
2. Preserve patterns: Follow existing code conventions (ESM imports, .js extensions in imports, async/await).
3. Documentation matters: Update docs/version_log.md when making significant changes.
4. Don't break the server: The backend runs on port 3000, the dashboard on port 5173. Don't change these.
5. Test your changes: Run "npx tsc --noEmit" to verify TypeScript compiles cleanly.
6. Environment variables: All secrets live in .env - never hardcode API keys.

## What You Can Do
- Read and modify any file in this workspace
- Analyze the codebase structure and suggest improvements
- Create issues and track work via GitHub/Local tickets
- Review documentation for accuracy
