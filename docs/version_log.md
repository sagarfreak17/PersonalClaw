# Version Log - PersonalClaw 📜

All notable changes to the PersonalClaw agent will be documented in this file.

---

## [1.17.0] - 2026-03-14
### Added
- **🧬 Self-Learning Engine**: PersonalClaw now passively learns from every conversation.
  - **User Profile**: Auto-detects name, role, company, expertise level.
  - **Communication Style**: Learns tone, verbosity, emoji usage, abbreviations/shorthand dictionary.
  - **Intent Patterns**: Maps "when user says X, they mean Y" with confidence scores.
  - **Workflow Patterns**: Remembers multi-step processes the user frequently performs.
  - **Tool Preferences**: Learns which tools the user prefers and what to avoid.
  - **Self-Correction**: Tracks mistakes and lessons to avoid repeating them.
  - **Domain Knowledge**: Builds a dictionary of user-specific terms and jargon.
  - Runs **fully asynchronous** using `gemini-2.5-flash` — never blocks user responses.
  - All learned data persisted to `memory/self_learned.json`.
  - Learning log tracked in `memory/learning_log.json`.
- **📋 New Commands**: `/learned`, `/learned log`, `/learned clear` for self-learning visibility.
- **🧠 Prompt Injection**: Learned knowledge is auto-injected into every system prompt — the AI gets smarter with every conversation.

---

## [1.16.0] - 2026-03-14
### Added
- **🔄 Model Failover Chain**: PersonalClaw now cascades through 5 models automatically on failure:
  `gemini-3.1-pro-preview` → `gemini-3-flash-preview` → `gemini-2.5-pro` → `gemini-2.5-flash` → `gemini-3.1-flash-lite-preview`
  - Handles: 404 (model not found), 503 (unavailable), rate limits (429), permission errors, and internal errors.
  - Tracks failover history and displays it in `/status`.
- **🤖 Model Registry**: Full model registry with metadata (tier, status, description, context window).
- **📋 15 Slash Commands**: Massively expanded local command system:
  - `/models` — View all models and the failover chain
  - `/model <id>` — Hot-swap the active model mid-session (no context loss)
  - `/memory` — View all stored long-term knowledge
  - `/forget <key>` — Remove a specific memory entry
  - `/skills` — List all loaded skills with descriptions
  - `/jobs` — Show all scheduled cron jobs
  - `/ping` — Quick health check
  - `/export` — Export full session history to JSON
  - `/screenshot` — Quick screen capture + analysis
  - `/sysinfo` — Quick system info snapshot via PowerShell
  - Unknown command handler with suggestions

---

## [1.15.0] - 2026-03-14
### Changed
- **🧠 Brain Overhaul**: Completely rebuilt the AI reasoning engine and system prompt from the ground up.
  - **Identity & Personality**: PersonalClaw now has a defined personality — direct, efficient, technically sharp with dry humor.
  - **Reasoning Framework**: Added structured 4-phase thinking model: Understand → Plan → Act → Verify.
  - **Tool Usage Guides**: Each skill now has in-prompt best practices, tips, and anti-patterns to prevent wasteful calls.
  - **Safety Guardrails**: Explicit rules preventing destructive commands without user confirmation, credential leaking, and rogue network requests.
  - **Communication Rules**: Defined formatting, conciseness, and markdown standards for response quality.
- **⚡ Context Window Management**: Added auto-compaction at 800k tokens — the brain now summarizes old history and rebuilds the session to avoid hitting the 1M limit.
- **🔄 Memory-Aware Boot**: The system prompt now dynamically loads `long_term_knowledge.json` at session start, making learned preferences immediately available.
- **🚀 Parallel Tool Execution**: Tool calls from the same turn are now executed concurrently via `Promise.all` instead of sequentially.
- **📡 Live Tool Streaming**: Tool progress (success/failure + execution time) is now streamed to the UI via `onUpdate` during execution.
- **🛠️ Configurable Model**: Model is now controlled via `GEMINI_MODEL` env var (defaults to `gemini-2.5-flash-preview-05-20`).
- **📊 Enhanced /status**: Now shows turn count, token usage with percentage, and active model name.
- **🗜️ /compact Command**: New slash command to manually trigger context compaction.
- **🛡️ Error Recovery**: Added context overflow detection with automatic compaction retry, and richer error context passed back to the model.

---

## [1.14.0] - 2026-03-14
### Changed
- **🚀 Browser Streamlining**: Consolidated 3 competing browser systems (Playwright MCP, Stagehand, Relay Extension) into a single unified `browser` skill.
- **🛠️ Unified Browser Architecture**: Implemented a singleton `BrowserManager` with `launchPersistentContext` for shared login storage across all AI sessions.
- **🧹 Cleanup**: Removed the relay extension WebSocket server (port 3001) and the MCP initialization cycle for a faster, lazier startup.
- **🧠 Prompt Optimization**: Rebuilt the system prompt to guide the AI toward the new unified browser workflow (Scrape -> Act -> Vision).

---

## [1.13.0] - 2026-03-13
### Added
- **🎭 Stagehand AI Browser**: Integrated `@browserbasehq/stagehand`, enabling high-level natural language browser automation ("act", "extract", "observe").
- **🏢 Paperclip Orchestration**: Added `paperclip_orchestration` skill for autonomous company ticket management and task handling.
- **🔄 Session Consistency**: Implemented singleton pattern for Stagehand and added **Independent Browser** support (`npm run browser`) so the browser window stays open even if the terminal/dashboard is closed.


---

## [1.12.0] - 2026-03-13
### Added
- **🧠 Continuous Learning Engine**: Implemented `manage_long_term_memory` skill, allowing PersonalClaw to learn user preferences, shorthand, and custom MSP workflows across sessions.
- **🛠️ Tier 3 MSP Specialization**: Tailored the system prompt for high-level IT troubleshooting. Integrated awareness of `pts_tools.json` for rapid access to ITGlue, Nilear, ConnectWise, and more.
- **⚡ Performance Overhaul**: Fixed typing lag in the dashboard by refactoring `App.tsx` and isolating the chat input into a memoized component.
- **📋 Copy to Clipboard**: Added a one-click copy button to bot messages in the dashboard with visual "check-mark" feedback.
- **🛡️ Developer Stability**: Added `dev:persist` script and optimized watcher exclusions (`browser_data`, `memory`, etc.) to prevent Playwright browsers from closing during code edits.


---

### Added
- **🎭 Multi-Agent Orchestration**: Integrated **Paperclip AI**, enabling "Zero-Human Company" management directly within the PersonalClaw environment.
- **🌐 Playwright MCP**: Replaced the legacy web skill with the full **Model Context Protocol (MCP)** server for Playwright, adding 22 granular browser automation tools.
- **🚀 Dashboard Navigation**: Fixed side tabs with animated transitions. Added new dedicated views for **System Telemetry**, **File Explorer**, and **Security/Audit Logs**.
- **📊 Context Radar**: Enhanced the `/status` command to show real-time **Token Usage** (against the 1M limit) and full session metrics.
- **Sanitized Schemas**: Implemented a JSON Schema sanitizer to bridge complex MCP tool definitions with Gemini's API requirements.

---

## [1.10.0] - 2026-03-12
### Added
- **⌨️ Slash Commands**: Added quick-access commands: `/cronjob`, `/browser`, `/status`, and `/help`.
- **📸 Screenshot Preview**: Rebuilt the dashboard capture flow to show a thumbnail preview, allowing users to add a text message before sending.
- **⚡ Typing Indicators**: Added visual feedback (animated dots) to the dashboard chat to improve user experience during AI thinking cycles.
- **🌐 Persistent Browser**: Rebuilt the web engine to use `launchPersistentContext` to save logins and session data.

---

## [1.9.0] - 2026-03-12
### Added
- **⏰ Automated Task Scheduling**: Implemented a new `manage_scheduler` skill using `node-cron`.
- **Persistent Jobs**: Scheduled tasks are saved to `memory/scheduled_jobs.json` and persist through server restarts.
- **Smart Execution**: The scheduler can trigger any natural language command (e.g., "Take a screenshot and analyze it every Monday").
- **Dashboard Feedback**: Active jobs broadcast their results to the dashboard so you can see them running in real-time.

---

## [1.8.0] - 2026-03-12
### Added
- **📸 Dashboard Vision**: Integrated a new "Camera" button in the web dashboard.
- **Native Selection**: Uses the browser's `DisplayMedia` API to allow users to capture specific windows or their entire screen "the usual way."
- **Auto-Analysis**: Screenshots are automatically saved to `/screenshots` and sent to the AI for immediate processing.

---

## [1.7.0] - 2026-03-12
### Added
- **Unified Startup**: Added `npm run all` command to launch both the Backend and Dashboard in a single terminal session using `concurrently`.
- **Developer Experience**: Simplified user documentation to focus on the single-command workflow.

---

## [1.6.0] - 2026-03-12
### Added
- **User Documentation**: Created a comprehensive `USER_GUIDE.md` for end-user onboarding, featuring icons, setup tips, and a breakdown of AI capabilities.
- **Brand Identity**: Generated a futuristic logo for PersonalClaw and integrated it into the documentation assets.

---

## [1.5.0] - 2026-03-12
### Added
- **Screenshot Archive**: Created a dedicated `screenshots/` folder.
- **Persistent Vision**: Updated the vision skill to save all captured screenshots locally for record-keeping instead of deleting them after analysis.

---

## [1.4.0] - 2026-03-12
### Added
- **Browser Relay Extension**: Built a custom Chrome extension to allow PersonalClaw to control the user's active browser tabs.
- **WebSocket Gateway**: Implemented a dedicated Relay Server on port 3001 for high-speed extension communication.
- **Relay Skill**: Added `relay_browser_command` to the AI brain, allowing it to scrape or interact with any open website.

---

## [1.3.0] - 2026-03-12
### Added
- **Persistent Memory**: Chat history is now saved locally to `memory/history.json`.
- **Session Refresh**: Added `/new` command to manually reset the conversation and refresh the LLM context.

---

## [1.2.0] - 2026-03-12
### Added
- **Telegram Interface**: Launched `@Personal_Clw_bot` for full remote Windows control via mobile.
- **Bot Security Lock**: Implemented `AUTHORIZED_CHAT_ID` whitelisting to prevent unauthorized access to the system.
- **Remote Tool Access**: Enabled all local skills (Shell, Vision, etc.) to be triggered via Telegram chat.

---

## [1.1.0] - 2026-03-12
### Added
- **Markdown Support**: Integrated `react-markdown` and `remark-gfm` for beautiful, indented message formatting in the dashboard.
- **Theme Engine**: Added a Light/Dark mode toggle with high-end "Glassmorphism" aesthetics for both themes.
- **Improved UI/UX**: Added sender icons (Bot/User) and enhanced message spacing/typography.
- **System Documentation**: Created a centralized `docs/` directory with technical specs and codebase snapshots.

### Changed
- **Model Upgrade**: Upgraded core reasoning and vision skills to **Gemini 3 Flash Preview** (March 2026 version).
- **Vision Reliability**: Fixed API identity issues (403/404) and added comprehensive logging to the vision skill.
- **Real-time Telemetry**: Finalized the connection between the dashboard UI and actual system metrics (CPU/RAM).

### Fixed
- **Env Loading**: Resolved a race condition where the Gemini API was initialized before environment variables were loaded.
- **Dashboard Metrics**: Replaced placeholder data with live Socket.io streams.

---

## [1.0.0] - 2026-03-11
### Added
- Initial release of PersonalClaw agent.
- Core Skills: Shell (PowerShell), File Management, Python Execution, Web Browsing, Vision (Screenshots), and Clipboard.
- Real-time Dashboard with Glassmorphic design.
- Integration with Google Gemini API for tool-calling.
