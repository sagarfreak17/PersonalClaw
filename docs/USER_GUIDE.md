# PersonalClaw v10.0: End-User Guide 🛸
**Developed by Sagar Kalra**

![PersonalClaw Logo](assets/logo.png)

Welcome to **PersonalClaw v10.0**, your next-generation AI agent for Windows. This guide teaches you to leverage its full power.

---

## 🌟 What is PersonalClaw?

PersonalClaw is a sophisticated, locally-hosted AI agent powered by **Google Gemini** with intelligent failover. It gives you AI-powered control over your Windows machine via:

- **Web Dashboard** — Real-time chat, system metrics, activity feed, command palette
- **Telegram Bot** — Control from anywhere securely
- **REST API** — External integrations

---

## ⚡ How to Start
To launch the PersonalClaw system, you need to run two separate commands in different terminal windows:

1. **The Brain**: In the project root, run:
   ```bash
   npm run dev
   ```
2. **The Dashboard**: Navigate to the `dashboard` folder and run:
   ```bash
   npm run dev
   ```
3. **Persistence Mode**: For absolute stability (prevents browsers from closing during code changes):
   ```bash
   npm run dev:persist
   ```

Wait a few seconds for both to initialize, then head to [http://localhost:5173](http://localhost:5173)!

---

## 🚀 Ways to Connect

### 1. The Command Center (Web Dashboard)
- **URL**: [http://localhost:5173](http://localhost:5173)
- **Features**: Real-time system telemetry (CPU/RAM), glassmorphic dark/light mode, and full markdown chat experience.
- **📸 Dashboard Screenshot**: Click the **Camera icon** next to the chat box to capture any window or your entire screen. PersonalClaw will process it immediately!
- **Tip**: Use `Shift + Enter` for line breaks and `Enter` to send.

### 2. Telegram Bot (Mobile Control)
- **Bot**: [@Personal_Clw_bot](https://t.me/Personal_Clw_bot)
- **Security**: Locked to your specific Chat ID (Defined in your `.env`). No one else can command it.
- **Usage**: Send text or photos from anywhere in the world to trigger your machine.

### 3. Triple-Mode Browser (Built-in)
- **Playwright Mode (default)**: Built-in persistent browser context. Navigates, scrapes, clicks, and types on any website. Logins saved in `browser_data/`.
- **Extension Relay Mode (v10.3)**: Install the **PersonalClaw Relay** Chrome extension to bridge the agent to your **real Chrome tabs**. No flags, no remote debugging — just install and go.
  - **Setup**: `chrome://extensions` → Developer Mode → Load Unpacked → select the `extension/` folder.
  - **Quick check**: `/relay` command shows connection status and open tabs.
  - **Capabilities**: Full DOM interaction (click, type, scrape with links & forms), tab management, screenshots, JavaScript execution, scroll control, interactive element listing.
- **Native Chrome Mode (v10.2)**: Connect to your **real running Chrome** via CDP or Chrome MCP.
  - **Quick connect**: `/chrome` command or ask the agent to connect.
  - **Requires**: Chrome launched with `--remote-debugging-port=9222`, or Chrome 146+ with remote debugging enabled in `chrome://inspect/#remote-debugging`.
  - **Chrome 146+**: Automatically enables Chrome's native MCP server, giving the AI direct access to Chrome DevTools tools.

---

## 🧠 Core Capabilities

### 📸 Proactive Vision
PersonalClaw can see what you see.
- **Ask**: *"What's on my screen right now?"* or *"Analyze the Nilear page for ticket 962869."*
- **Archive**: All captures are saved to `\screenshots` for your records.

### 🐚 Windows Shell (PowerShell)
Complete system control without touching the keyboard.
- **Ask**: *"List my largest files in Downloads"* or *"Check if the backup service is running."*

### 📁 File Management
Organize, read, and create files effortlessly.
- **Ask**: *"Create a summary of my project notes"* or *"Move all .pdf files from Desktop to a new folder called Docs."*

### ⏰ Automated Scheduling (Cron Jobs)
PersonalClaw can now perform tasks on a schedule.
- **Ask**: *"Schedule a job to check my email every morning at 9am"* or *"List my scheduled jobs."*
- **Persistence**: Your jobs are saved to `\memory\scheduled_jobs.json`.

### 🧠 Long-Term Learning (Memory)
PersonalClaw evolves by learning from your conversations.
- **Capabilities**: Remembers your preferred IT troubleshooting tone, your custom MSP jargon (e.g., "The Blue Box"), and specific tool shortcuts.
- **Ask**: *"Learn that when I say 'Datto Check', I want you to log into Datto and check the alert log."*
- **Config**: Awareness of `pts_tools.json` for rapid ITGlue/ConnectWise/Nilear access.

---

> [!IMPORTANT]
> **`/new`**: Starts a fresh session (clears memory).
> **`/status`**: Shows current session ID and loaded tools.
> **Action: "scrape"**: Get the text content of the current page.
> **Action: "screenshot"**: Take a visual capture of the page.
> **Action: "close"**: Safely closes the automated browser.

---

## 🗄️ Where is my data?
- **Logs**: `\memory\session_TIMESTAMP.json` (Full chat records).
- **Screenshots**: `\screenshots\` (Historical visual captures).
- **Documentation**: `\docs\` (This guide and technical specs).

---

## 🆘 Troubleshooting
- **Extension Disconnected?** Go to `chrome://extensions` and click the **Refresh** icon.
- **Bot not responding?** Ensure `npm run dev` is running in the main project folder.

---

## 🏢 Zero-Human Company (Paperclip)

PersonalClaw now supports integration with **Paperclip AI**, an orchestration layer for running entire AI companies.

- **Access Dashboard**: Visit `http://localhost:3100`.
- **Launch Command**: Run `npx paperclipai onboard --yes` in your terminal to start the engine.
- **Workflow**: Assign tickets to specialized agents (CEO, CTO, etc.) and let them work autonomously.
- **Documentation**: See [PAPERCLIP_SOP.md](file:///c:/All Projects/PersonalClaw/docs/PAPERCLIP_SOP.md) for full setup instructions.

---

*“PersonalClaw: Your machine, your command, anywhere.”*

**Developed by Sagar Kalra**
