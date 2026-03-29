# PersonalClaw v12.11.2 🛸

**The next-generation Windows AI agent. Local. Private. Unstoppable. Now on Android.**

Deploy an autonomous digital workforce on your Windows machine — and control it from anywhere via the Android app. Create entire organisations of AI agents that collaborate, delegate, and execute complex workflows without cloud overhead.

---

## ⚡ 30-Second Demo
1. **Create an Org**: Launch `start.bat` and define your company mission (e.g., “Build a SaaS”).
2. **Assign Roles**: Spawn a CEO, CTO, and Lead Dev.
3. **Set a Task**: Create a ticket (“Build a landing page”).
4. **Watch it Work**: Agents use Browser Relay, Vision, and PowerShell to complete the task autonomously.
5. **Go Mobile**: Open the Android app — chat, manage orgs, approve proposals, and get push notifications from anywhere.

---

## 🏗️ Why PersonalClaw?

### 🔐 100% Private & Local
Unlike cloud agents, your agent memories, workspace files, and system interactions never leave your machine. PersonalClaw uses Google Gemini locally via API with data isolation for up to 10 independent organisations.

### 🤖 Autonomous Multi-Agent Orchestration
Not just a chatbot. PersonalClaw uses a professional Kanban system where agents (CEO, CTO, Marketing, etc.) collaborate via an internal ticket board. They delegate, raise blockers, and propose code changes.

### 🛠️ 34+ Core System Skills
From **authenticated browser automation** (via extension relay) to **PowerShell system control**, **desktop app automation** (pywinauto), **automated social media posting** (Twitter/LinkedIn), and **Gemini Vision analysis**, PersonalClaw has the “hands” to do real work. Now with **Real-time Streaming** for near-instant responses.

### 📱 Android App — Control From Anywhere
Full-featured React Native app with real-time chat, org management, voice input (hold-to-talk), and push notifications. Approve proposals, resolve blockers, and monitor agents — all from your phone. Connects securely via Cloudflare Tunnel.

---

## 🚀 Quick Start (2 Minutes)

### Prerequisites
- **Node.js 18+**
- **Google Gemini API Key** (Get it free at [AI Studio](https://aistudio.google.com/))

### 1. Install & Configure
```bash
git clone https://github.com/skalra/PersonalClaw.git && cd PersonalClaw
setup.bat
```

### 2. Run
```bash
start.bat
```
Open [http://localhost:5173](http://localhost:5173).

### 3. Android App (Optional)
```bash
cd PersonalClawApp
npm install
npx expo run:android
```
Configure the server URL in Settings to connect remotely via Cloudflare Tunnel.

---

## 🏢 Org Management System
- **Org Isolation**: Every company has its own workspace and agent memories.
- **Heartbeat Engine**: Schedule agents to run on CRON (e.g., “Daily at 9 AM”).
- **Direct Agent Chat**: Message any agent privately to give specific instructions.
- **Auto-Approval**: Strategy documents and hiring decisions are auto-processed for efficiency.
- **Mobile Management**: View tickets, approve/reject proposals, and resolve blockers from the Android app with inline push notification actions.

---

## 📱 Android App

| Feature | Details |
|---------|---------|
| **Chat** | Full conversation UI, markdown rendering, hold-to-talk voice input (Gemini STT), TTS |
| **Orgs** | Browse orgs, view agents, tickets, proposals, blockers, and memory |
| **Push Notifications** | FCM-powered — inline Approve/Reject on proposals, Resolve on blockers |
| **Remote Access** | Cloudflare Tunnel — works from anywhere, not just local WiFi |
| **Tech Stack** | React Native 0.83, Expo SDK 55, expo-router v4, Zustand v5 |

---

## 📊 Latest Stats
| Metric | Value |
|--------|-------|
| **Core Skills** | 21 |
| **Org-Mgmt Skills** | 1 |
| **Org-Agent Skills** | 13 |
| **Total Skills** | 34 |
| **Dashboard Tabs** | 8 |
| **Max Orgs** | 10 |
| **Response Latency** | ~1s (Streaming) |
| **Mobile Screens** | 7 (Chat, Orgs, Activity, Metrics, Settings, Auth, Org Detail) |

---

## 📚 Documentation
- [Architecture Details](docs/ARCHITECTURE.md)
- [Agent Guidelines](AGENTS.md)
- [User Guide](docs/USER_GUIDE.md)
- [Android App Progress](docs/Updates/PersonalClaw_Android_App_Progress.md)
- [llms.txt](/llms.txt) — Optimized for AI assistants (Cursor, Claude Code)

---

*”Your machine, your command, anywhere.”* 🚀
