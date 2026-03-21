# PersonalClaw: Project Directory Structure

This document provides a comprehensive overview of the PersonalClaw codebase structure, optimized for both human developers and AI models.

## Project Overview
PersonalClaw is a local-first AI automation platform for Windows, integrating Gemini AI with local tools (skills), a React dashboard, and various communication interfaces.

## Major Directory Descriptions

- `/src`: Backend implementation in TypeScript (Node.js/Express).
- `/src/core`: Fundamental systems like the Brain, Event Bus, Session Management, Agent Registry, **Todo Manager**, and the **v12.6 Org Orchestration** core (`org-manager.ts`, `org-heartbeat.ts`, `org-task-board.ts`, `org-agent-runner.ts`).
- `/src/skills`: Individual tool modules (e.g., shell, files, browser, vision, **org-skills**, **org-management**) that the AI can execute.
- `/dashboard`: Frontend React + Vite application for interacting with the AI, including the **v12.6 Org Workspace**.
- `/docs`: Project documentation, including standard user/setup guides, the `ARCHITECTURE.md` spec, and historical/roadmap data in `docs/Updates/`.
- `/extension`: Chrome extension for relaying data to the backend.
- `/scripts`: Utility scripts for automation and setup.
- `/orgs`: Persistent org data directories (one per organisation — `org.json`, `workspace/`, `agents/`, `proposals.json`, `tickets.json`, `blockers.json`, etc.).
- `/memory`: (Hidden/Local) Persistent data including sessions and knowledge.

---

## Directory Tree

```
PersonalClaw/
├── browser_data
├── dashboard
│   ├── public
│   │   └── vite.svg
│   ├── src
│   │   ├── assets
│   │   │   └── react.svg
│   │   ├── components
│   │   │   ├── AgentCard.tsx              # Agent status card + EditAgentModal (with Reports To dropdown)
│   │   │   ├── AgentChatPane.tsx          # Direct agent chat interface
│   │   │   ├── BoardOfDirectors.tsx       # Org command center — summary, org chart, blockers, expandable agent health
│   │   │   ├── ChatInput.tsx
│   │   │   ├── ChatWorkspace.tsx
│   │   │   ├── ConversationPane.tsx
│   │   │   ├── CreateAgentModal.tsx
│   │   │   ├── CreateOrgModal.tsx
│   │   │   ├── EditOrgModal.tsx
│   │   │   ├── OrgChart.tsx               # Hierarchical org agent visualisation
│   │   │   ├── OrgProtectionSettings.tsx  # File protection config with protected file list viewer
│   │   │   ├── OrgWorkspace.tsx           # Main org workspace with 8 tabs
│   │   │   ├── ProposalBoard.tsx          # Code change proposals only (non-code auto-approved)
│   │   │   ├── TicketBoard.tsx
│   │   │   ├── TodosTab.tsx               # Task Management — focus mode, stats, charts
│   │   │   ├── WorkerCard.tsx
│   │   │   ├── WorkspaceBrowser.tsx       # Directory tree file browser
│   │   │   └── WorkspaceTab.tsx           # Workspace tab — files by agent role, inline editor, comments
│   │   ├── hooks
│   │   │   ├── useAgents.ts
│   │   │   ├── useConversations.ts
│   │   │   ├── useOrgChat.ts
│   │   │   ├── useOrgs.ts
│   │   │   ├── useScreenshot.ts           # Reusable screen capture hook (getDisplayMedia)
│   │   │   └── useTodos.ts                # Real-time task state and socket sync
│   │   ├── types
│   │   │   ├── conversation.ts
│   │   │   ├── org.ts
│   │   │   └── todos.ts                   # Todo and TodoStats interfaces
│   │   ├── App.css
│   │   ├── App.tsx
│   │   ├── index.css
│   │   └── main.tsx
│   ├── .gitignore
│   ├── eslint.config.js
│   ├── index.html
│   ├── package-lock.json
│   ├── package.json
│   ├── README.md
│   ├── tsconfig.app.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.ts
├── dist
├── docs
│   ├── assets
│   │   └── logo.png
│   ├── Updates
│   │   ├── PersonalClaw_v11_Implementation_Plan_FINAL.md
│   │   ├── PersonalClaw_v12_Implementation_Plan_FINAL_v2.md
│   │   ├── V10_FEATURES.md
│   │   ├── PersonalClaw_v12.1_Implementation_Plan_FINAL_v2.md
│   │   ├── PersonalClaw_v12.1_Protection_Patch.md
│   │   ├── PersonalClaw_Logging_Patch.md
│   │   └── PersonalClaw_LinkedIn_Local_Plan.md
│   ├── ARCHITECTURE.md
│   ├── DIR_STRUCTURE.md
│   ├── SETUP_GUIDE.md
│   ├── USER_GUIDE.md
│   └── version_log.md
├── exports
├── extension
│   ├── background.js
│   ├── content.js
│   ├── manifest.json
│   ├── popup.html
│   └── popup.js
├── logs
├── memory
├── orgs
├── outputs
├── screenshots
├── scripts
│   ├── check_ssl.ps1
│   ├── launch_persistent_browser.ps1
│   ├── list_models.js
│   └── test_vision.js
├── src
│   ├── core
│   │   ├── agent-registry.ts
│   │   ├── audit.ts
│   │   ├── brain.ts
│   │   ├── browser.ts
│   │   ├── chrome-mcp.ts
│   │   ├── conversation-manager.ts
│   │   ├── events.ts
│   │   ├── learner.ts
│   │   ├── mcp.ts
│   │   ├── org-agent-runner.ts       # Agent execution with human comment injection
│   │   ├── org-file-guard.ts         # Per-org file protection, proposal CRUD
│   │   ├── org-heartbeat.ts
│   │   ├── org-manager.ts
│   │   ├── org-notification-store.ts  # Persistent notification store + Telegram
│   │   ├── org-task-board.ts
│   │   ├── relay.ts
│   │   ├── sessions.ts
│   │   ├── skill-lock.ts
│   │   ├── telegram-brain.ts
│   │   ├── terminal-logger.ts
│   │   └── todo-manager.ts           # Todo engine, persistence, recurring logic
│   ├── interfaces
│   │   └── telegram.ts
│   ├── skills
│   │   ├── agent-spawn.ts
│   │   ├── browser.ts
│   │   ├── clipboard.ts
│   │   ├── files.ts
│   │   ├── http.ts
│   │   ├── imagegen.ts
│   │   ├── index.ts
│   │   ├── linkedin.ts
│   │   ├── memory.ts
│   │   ├── network.ts
│   │   ├── org-management-skill.ts
│   │   ├── org-skills.ts
│   │   ├── pdf.ts
│   │   ├── process-manager.ts
│   │   ├── python.ts
│   │   ├── scheduler.ts
│   │   ├── shell.ts
│   │   ├── system-info.ts
│   │   ├── todos.ts                   # manage_todos skill
│   │   ├── twitter.ts
│   │   └── vision.ts
│   ├── types
│   │   └── skill.ts
│   └── index.ts
├── .env.example
├── .gitignore
├── AGENTS.md
├── LICENSE
├── package-lock.json
├── package.json
├── pts_tools.json
├── README.md
├── setup.bat
├── start.bat
└── tsconfig.json
````
