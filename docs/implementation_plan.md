# Implementation Plan - PersonalClaw

Building a custom, lightweight AI agent for direct Windows control, featuring a premium web dashboard and Telegram integration.

## 🏗️ Architecture Overview

- **Agent Core (Node.js + TypeScript):** The central brain using Google's Gemini 3 Flash Preview for reasoning and tool use.
- **Skill System:** Modular architecture for Windows-specific capabilities.
- **Interfaces:**
  - **Telegram Bot:** For remote command and control.
  - **Web Dashboard:** A high-end Vite + React UI for real-time monitoring, logs, and manual intervention.
- **Execution Layer:** Shell (PowerShell), Python runner, and Browser automation (Playwright).

## 📅 Roadmap

### Phase 1: Foundation & Core Logic
- [ ] **Project Setup:** Initialize Node.js environment with TypeScript and Vite.
- [ ] **Gemini Integration:** Configure `@google/generative-ai` with structured tool calling.
- [ ] **The "Brain":** Implement the main loop that handles long-running tasks and memory.

### Phase 2: Windows Skill System
- [ ] **FileSystem Skill:** Secure file CRUD operations.
- [ ] **Shell Skill:** PowerShell execution with safety guards.
- [ ] **Python Runner:** Capability to execute arbitrary Python scripts.
- [ ] **Vision Skill:** Gemini-powered image analysis (screenshots/local files).
- [ ] **Web Skill:** Playwright-based browser control for search and navigation.

### Phase 3: Communication Channels
- [ ] **Telegram Bot:** Set up `telegraf` for two-way communication.
- [ ] **Websocket Server:** Real-time data stream for the dashboard.
- [ ] **Web Dashboard:** Build a "Pro-level" UI (Dark mode, glassmorphism, terminal output).

### Phase 4: Full Windows Control
- [ ] **System Automation:** Media controls, app launching, and window management.
- [ ] **Tasker Integration:** (Optional) Bridge for the OnePlus 12 server synergy.

## 🛠️ Tech Stack
- **Language:** TypeScript
- **AI Backend:** Gemini Flash 2.0 (for speed and vision)
- **Frontend:** React + Vite + Vanilla CSS
- **Communication:** Socket.io + Telegraf
- **Automation:** PowerShell + Python + Playwright

## 🔒 Security & Safety
- **Confirmation Guards:** Require manual approval for destructive shell commands.
- **Local-Only Web UI:** By default, the dashboard will bind to localhost (can be tunneled via Tailscale).
