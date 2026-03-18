# PersonalClaw: Project Directory Structure

This document provides a comprehensive overview of the PersonalClaw codebase structure, optimized for both human developers and AI models.

## Project Overview
PersonalClaw is a local-first AI automation platform for Windows, integrating Gemini AI with local tools (skills), a React dashboard, and various communication interfaces.

## Major Directory Descriptions

- `/src`: Backend implementation in TypeScript (Node.js/Express).
- `/src/core`: Fundamental systems like the Brain, Event Bus, Session Management, and Agent Registry.
- `/src/skills`: Individual tool modules (e.g., shell, files, browser, vision) that the AI can execute.
- `/dashboard`: Frontend React + Vite application for interacting with the AI.
- `/docs`: Project documentation, implementation plans, and architectural guides.
- `/extension`: Chrome extension for relaying data to the backend.
- `/scripts`: Utility scripts for automation and setup.
- `/memory`: (Hidden/Local) Persistent data including sessions and knowledge (usually excluded from version control).

---

## Directory Tree

```
PersonalClaw/
├── dashboard
│   ├── public
│   │   └── vite.svg
│   ├── src
│   │   ├── assets
│   │   │   └── react.svg
│   │   ├── components
│   │   │   ├── ChatInput.tsx
│   │   │   ├── ChatWorkspace.tsx
│   │   │   ├── ConversationPane.tsx
│   │   │   └── WorkerCard.tsx
│   │   ├── hooks
│   │   │   ├── useAgents.ts
│   │   │   └── useConversations.ts
│   │   ├── types
│   │   │   └── conversation.ts
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
├── docs
│   ├── assets
│   │   └── logo.png
│   ├── codebase_documentation.md
│   ├── codebase_snapshot.md
│   ├── implementation_plan.md
│   ├── PER-6_ROADMAP.md
│   ├── PersonalClaw_v11_Implementation_Plan_FINAL.md
│   ├── SETUP_GUIDE.md
│   ├── USER_GUIDE.md
│   ├── V10_FEATURES.md
│   ├── version_log.md
│   └── walkthrough.md
├── exports
│   ├── session_export_2026-03-15T21-12-55-663Z.json
│   └── session_export_2026-03-16T19-11-11-500Z.json
├── extension
│   ├── background.js
│   ├── content.js
│   ├── manifest.json
│   ├── popup.html
│   └── popup.js
├── scripts
│   └── launch_persistent_browser.ps1
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
│   │   ├── relay.ts
│   │   ├── sessions.ts
│   │   ├── skill-lock.ts
│   │   └── telegram-brain.ts
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
│   │   ├── memory.ts
│   │   ├── network.ts
│   │   ├── pdf.ts
│   │   ├── process-manager.ts
│   │   ├── python.ts
│   │   ├── scheduler.ts
│   │   ├── shell.ts
│   │   ├── system-info.ts
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

```
