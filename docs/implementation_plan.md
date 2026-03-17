# Implementation Plan - PersonalClaw (Legacy)

> **Note:** This is the original implementation plan. For the v11 plan (multi-chat, multi-agent, skill locks), see `PersonalClaw_v11_Implementation_Plan_FINAL.md`.

Building a custom, lightweight AI agent for direct Windows control, featuring a premium web dashboard and Telegram integration.

## 🏗️ Architecture Overview

- **Agent Core (Node.js + TypeScript):** The central brain using Google's Gemini 3 Flash Preview for reasoning and tool use.
- **Skill System:** Modular architecture for Windows-specific capabilities.
- **Interfaces:**
  - **Telegram Bot:** For remote command and control.
  - **Web Dashboard:** A high-end Vite + React UI for real-time monitoring, logs, and manual intervention.
- **Execution Layer:** Shell (PowerShell), Python runner, and Unified Browser automation (Playwright + Persistent Profile).

## 📅 Roadmap

### Phase 1: Foundation & Core Logic
- [x] **Project Setup:** Initialize Node.js environment with TypeScript and Vite.
- [x] **Gemini Integration:** Configure `@google/generative-ai` with structured tool calling.
- [x] **The "Brain":** Implement the main loop that handles long-running tasks and memory.

### Phase 2: Windows Skill System
- [x] **FileSystem Skill:** Secure file CRUD operations.
- [x] **Shell Skill:** PowerShell execution with safety guards.
- [x] **Python Runner:** Capability to execute arbitrary Python scripts.
- [x] **Vision Skill:** Gemini-powered image analysis (screenshots/local files).
- [x] **Unified Browser Skill:** Advanced persistent browser control (Replaces MCP/Stagehand).

### Phase 3: Communication Channels
- [x] **Telegram Bot:** Set up `telegraf` for two-way communication.
- [x] **Websocket Server:** Real-time data stream for the dashboard.
- [x] **Web Dashboard:** Build a "Pro-level" UI (Dark mode, glassmorphism, terminal output).

### Phase 4: Full Windows Control
- [/] **System Automation:** Media controls, app launching, and window management.

- [x] **Tasker Integration:** Bridge for the OnePlus 12 server synergy.

## 🛠️ Tech Stack
- **Language:** TypeScript
- **AI Backend:** Gemini Flash 2.0 (for speed and vision)
- **Frontend:** React + Vite + Vanilla CSS
- **Communication:** Socket.io + Telegraf
- **Automation:** PowerShell + Python + Playwright

## 🔒 Security & Safety
- **Confirmation Guards:** Require manual approval for destructive shell commands.
- **Local-Only Web UI:** By default, the dashboard will bind to localhost (can be tunneled via Tailscale).
