# 🏁 First-Time Setup Guide: PersonalClaw v12.2

Welcome to PersonalClaw v12.2! This version features **Autonomous AI Organisations** with workspace file management, human comment feedback, and expanded dashboard controls. Follow these steps to get running.

---

## 🛠️ Prerequisites

Before you begin, ensure you have the following installed:

1.  **Node.js (v18 or higher)**: [Download here](https://nodejs.org/).
2.  **Git**: [Download here](https://git-scm.com/).
3.  **Google Gemini API Key**: Generate a free key at [Google AI Studio](https://aistudio.google.com/).
4.  **Chrome Browser**: Required for browser automation features.

---

## 🚀 Installation & Setup (One-Click)

### 1. Clone the Repository
Open PowerShell and run:
```bash
git clone https://github.com/yourusername/PersonalClaw.git
cd PersonalClaw
```

### 2. Automatic Setup
Run the setup batch file. This will install all dependencies (Brain + Dashboard), configure your `.env` file, and prompt you for your Gemini API key:
```bash
.\setup.bat
```

### 3. Running PersonalClaw
Once setup is complete, launch the entire system with a single command:
```bash
.\start.bat
```
This will open two terminal windows (Backend and Dashboard) and launch your browser to [http://localhost:5173](http://localhost:5173).

---

## 🏢 Setting Up Your First Organisation

v12.0 is built around **AI Organisations**. To get started:

1.  Open the Dashboard at [http://localhost:5173](http://localhost:5173).
2.  Navigate to the **Organisations** tab in the sidebar.
3.  Click **Add Organisation**.
4.  **Important**: You must provide a **Root Directory** path. This is the real folder on your computer where the AI agents will perform their work (e.g., `C:\Projects\MyNewApp`).
5.  Add your first **Agent** (e.g., "AI CEO" or "Lead Developer") and set their **Heartbeat** schedule.

---

## 🖱️ Browser Setup

The agent has **built-in browser control** (Playwright) that works out of the box with its own persistent profile.

### Extension Relay (Recommended)

Install the **PersonalClaw Relay** Chrome extension to let the agent interact with your real Chrome tabs:

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer Mode** (toggle in top-right).
3. Click **Load Unpacked** and select the `extension/` folder from the PersonalClaw project.
4. The extension auto-connects to PersonalClaw (you'll see a green "ON" badge).
5. Type `/relay` in PersonalClaw chat to verify the connection.

---

## 🛡️ Usage Tips
- **Security**: This agent can execute PowerShell commands. Never share your `.env` file!
- **Organisations**: Use the Org Workspace to manage autonomous teams.
- **Workspace**: Use the Workspace tab to browse files by agent, edit them, and leave comments for agents to act on.
- **Proposals**: Only code changes appear in the Proposals tab. Documents, plans, and hiring decisions are auto-approved.
- **Board**: Click agent health cards in the Board tab to see full run details.
- **Protection**: Use Settings to configure file protection. Click “View all protected files” to see exactly what is covered.
- **Vision**: Use the Camera icon in the dashboard to share your screen with the AI.

---
*”Your machine, your command, anywhere.”* 🚀
