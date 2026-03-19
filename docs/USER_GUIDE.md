# PersonalClaw v12.2: End-User Guide 🛸
**Developed by Sagar Kalra**

![PersonalClaw Logo](assets/logo.png)

Welcome to **PersonalClaw v12.2**, your next-generation AI agent for Windows. This version features **Autonomous AI Organisations** with workspace management, human feedback comments, and an expanded dashboard.

---

## ⚡ How to Start

The fastest way to launch PersonalClaw is using the included batch files:

1. **Setup**: Run `setup.bat` once to install dependencies and configure your API key.
2. **Launch**: Run `start.bat`. This will automatically:
   - Start the Backend server (port 3000)
   - Start the Dashboard frontend (port 5173)
   - Open your browser to the dashboard.

Alternatively, you can run `npm run all` in a single terminal.

Wait a few seconds for initialization, then head to [http://localhost:5173](http://localhost:5173)!

---

## 🏢 AI Organisation System (v12)

PersonalClaw supports creating autonomous AI companies that work on your projects without constant human intervention.

### 1. Creating an Organisation
- Click the **Organisations** tab in the sidebar.
- Click **Add Organisation** to define a new company.
- **Mission**: Tell the org what its ultimate goal is.
- **Root Directory**: Point the org to a real folder on your disk. This is where the agents will work.

### 2. Building Your Team
Once an org is created, you can add multiple AI agents with specialized roles:
- **Role & Personality**: Define a CEO, a lead developer, a copywriter, etc.
- **Responsibilities**: List exactly what this agent is in charge of.
- **Autonomy**: Set whether the agent can act freely (**Full**) or needs your consent (**Approval Required**).
- **Heartbeat (Cron)**: Set a schedule for the agent to wake up and work (e.g., "Every 30 minutes" or "Every Monday at 9 AM").
- **Reports To**: Set the agent's reporting line via the dropdown in the Edit Agent modal. Shows agent name and role for each option.

### 3. The Ticket Board (Kanban)
Each organisation comes with a built-in task management system:
- **Agents Assign Work**: Agents can create and assign tickets to each other (or to you!).
- **Status Tracking**: Move tasks between **Open**, **In Progress**, **Blocked**, and **Done**.
- **Agent Collaboration**: Agents check the ticket board on every run to see what needs doing.

### 4. Board of Directors
The **Board** tab is your org command center:
- **Summary bar**: Open blockers, active agents, token usage at a glance.
- **Org chart**: Visual hierarchy of agents and reporting lines.
- **Blockers**: Resolve blockers that need human attention with resolution notes.
- **Agent Health**: Click any agent health card to expand it and see full run summaries, all file activity, and run history.

### 5. Workspace Tab
The **Workspace** tab lets you browse and interact with files agents have created:
- **Organised by agent role**: Each agent gets a collapsible section showing their files.
- **Inline editor**: Click any file to view and edit it in a textarea editor.
- **Human comments**: Leave comments on any file. When the agent runs next, your comments are injected into its system prompt so it can act on your feedback.
- Comments are stored as sidecar `.comments.json` files (hidden from the file browser).

### 6. Proposals Tab
The **Proposals** tab shows only **code change proposals** — changes agents want to make to protected files.
- Documents, plans, and hiring decisions are **auto-approved** and do not appear here.
- Review the original vs proposed diff, then approve or reject.

### 7. Direct Agent Chat
Need to talk to a specific agent privately?
- Click the **💬 Chat** icon on any agent card in the Org Workspace.
- This opens a persistent, dedicated chat pane with just that agent.
- Unlike the main command center, these agents remember who they are (CEO/Dev) and what they've been doing.

### 8. Protection Settings
The **Settings** tab lets you control which files agents must submit proposals to modify:
- **Modes**: None (agents write freely), Git (all git-tracked files protected), Manual (specific paths), Both.
- **View protected files**: Expand the "View all protected files" section to see every protected file, grouped by directory.
- **Refresh from git**: Re-snapshot git-tracked files after you've added new files to the repo.

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
- **Organisations**: `\orgs\{org-name}\` (Org config, agent memory, workspace, tickets, proposals, blockers, notifications).
- **Workspace files**: `\orgs\{org-name}\workspace\` (Agent-created files, reports, comments sidecar files).
- **Logs**: `\memory\session_TIMESTAMP.json` (Full chat records).
- **Activity feed**: `\logs\activity.jsonl` (Persisted activity feed, auto-trimmed to 1000 entries).
- **Screenshots**: `\screenshots\` (Historical visual captures).
- **Documentation**: `\docs\` (This guide and technical specs).

---

## 🧩 v11 Multi-Chat & Multi-Agent

### Multi-Pane Workspace
- Click the **+** button in the bottom-right to open a new chat pane (up to 3)
- Each pane is independent with its own AI Brain and conversation history
- Drag the divider between panes to resize
- Click **x** on a pane header to close it (history auto-saved to sessions)
- Panes are auto-labeled Chat 1, Chat 2, Chat 3

### Sub-Agent Workers
- The AI can spawn up to 5 parallel sub-agent workers per pane for independent tasks
- Workers appear in a collapsible side panel on the right of each pane
- Status indicators: blue (running), amber (waiting for resource), green (done), red (failed)
- Workers have a 5-minute timeout and cannot perform destructive operations

### Superuser Mode
- Press **Ctrl+Shift+D** to toggle superuser mode
- When enabled, completed worker cards show a **View Logs** button with raw execution data
- No visual indicator of mode — press again to toggle off

### Skill Locks
- When multiple agents use the same resource (browser, clipboard, etc.), a lock system prevents conflicts
- Workers waiting for a lock show an amber "Waiting for resource" status with holder info
- Check current locks: `GET /api/locks`

### New REST Endpoints
- `POST /api/conversations` — Create a new conversation
- `GET /api/conversations` — List all active conversations
- `DELETE /api/conversations/:id` — Close and save a conversation
- `GET /api/conversations/:id/agents` — List workers for a conversation
- `GET /api/agents/:agentId/logs` — Get raw logs for a worker
- `GET /api/locks` — Get current skill lock state

---

## 🆘 Troubleshooting
- **Extension Disconnected?** Go to `chrome://extensions` and click the **Refresh** icon.
- **Bot not responding?** Ensure `npm run dev` is running in the main project folder.

---


*“PersonalClaw: Your machine, your command, anywhere.”*

**Developed by Sagar Kalra**
