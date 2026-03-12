You now have a custom, lightweight AI agent running directly on your Windows machine, powered by **Gemini 3 Flash Preview**.

> [!NOTE]
> **New Feature**: Toggle between Light and Dark mode using the Sun/Moon icon in the sidebar! Your messages now support full Markdown formatting.

## 🧠 Smart Memory
- **Multi-Session Storage**: Every time you start a new chat (or the server restarts), PersonalClaw creates a unique session file in the `/memory/` folder.
- **Refresh Session**: Type `/new` to immediately start a **brand new session**.

## 📖 Help & Guides
- **[User Guide](USER_GUIDE.md)**: Check this for a full breakdown of how to use PersonalClaw like a pro.
- **[Version Log](version_log.md)**: Track all latest features and updates.

## 🚀 How to Launch

For the most reliable experience, start the components in two separate terminal windows:

1. **AI Brain & Telegram Bot**: In the root directory, run `npm run dev`.
2. **Dashboard UI**: Inside the `dashboard` folder, run `npm run dev`.

Access the interface at `http://localhost:5173`.

---

## 🛠️ Key Capabilities

- **🐚 Full PowerShell Access**: Execute any system command. Just ask "What's my IP?" or "List my running processes."
- **🐍 Python Runner**: Runs complex scripts on the fly. "Write a script to process this CSV..."
- **📂 File Management**: Read, write, and delete files anywhere on your system.
- **👁️ Vision & Screen**: Ask "What's on my screen right now?" or "Analyze the chart in this image."
- **🌐 Web Automation**: Search the web, extract data, or click elements using Playwright.
- **📋 Clipboard Control**: Proactively read or set your system clipboard.

---

## 📱 Telegram Integration
To enable remote control from your phone:
1. Create a bot via [@BotFather](https://t.me/botfather).
2. Copy the **API Token**.
3. Paste it into your `.env` file:
   ```env
   TELEGRAM_BOT_TOKEN=your_token_here
   ```
4. Restart the server.

---

## 🏗️ Project Structure
- `src/core/brain.ts`: The Gemini reasoning engine.
- `src/skills/`: Individual capability modules.
- `src/index.ts`: The main server entry point.
- `dashboard/src/`: The glassmorphism React interface.

> [!TIP]
> **Safety First**: Since this agent has full Windows control, be mindful when asking it to delete files or run complex scripts. It uses a "Tool Use" loop, so it can chain multiple steps autonomously!
