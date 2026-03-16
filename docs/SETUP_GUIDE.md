# 🏁 First-Time Setup Guide: PersonalClaw v10.0

Welcome to PersonalClaw v10.0! Follow these steps to get the latest version running on your Windows device.

---

## 🛠️ Prerequisites

Before you begin, ensure you have the following installed on your Windows machine:

1.  **Node.js (v18 or higher)**: [Download here](https://nodejs.org/).
2.  **Git**: [Download here](https://git-scm.com/).
3.  **Python 3.10+**: [Download here](https://www.python.org/). (Ensure "Add Python to PATH" is checked during installation).
4.  **Google Gemini API Key**: Generate a free key at [Google AI Studio](https://aistudio.google.com/).
5.  **Chrome Browser**: Required if you want to use the optional Relay extension.

---

## 🚀 Installation & Setup

### 1. Clone the Repository
Open PowerShell and run:
```bash
git clone https://github.com/yourusername/PersonalClaw.git
cd PersonalClaw
```

### 2. Automatic Setup (Recommended)
Simply run the setup batch file. This will install all dependencies, configure your `.env` file, and prompt you for your API keys:
```bash
.\setup.bat
```

### 3. Running PersonalClaw
Once setup is complete, you can launch both the Brain and the Dashboard with a single command:
```bash
.\start.bat
```

### 4. Manual Installation (Alternative)
If you prefer to do it manually:
1.  **Install Brain deps**: `npm install`
2.  **Install Browser**: `npx playwright install chromium`
3.  **Install Dashboard deps**: `cd dashboard && npm install && cd ..`
4.  **Configure `.env`**: Rename `.env.example` to `.env` and add your keys.

---

## 🖱️ Browser Setup

The agent has **built-in browser control** (Playwright) that works out of the box with its own persistent profile.

### Native Chrome Connection (Recommended for v10.2+)

To let PersonalClaw control your **real Chrome session** (with all your logins and tabs):

**Option A — Launch Chrome with remote debugging:**
```
chrome.exe --remote-debugging-port=9222 --user-data-dir=%TEMP%\chrome-debug
```

**Option B — Chrome 146+ auto-connection:**
1. Open `chrome://inspect/#remote-debugging` in Chrome.
2. Enable "Discover network targets" and add `localhost:9222`.
3. Chrome's native MCP server activates automatically.

**Then in PersonalClaw:**
- Type `/chrome` in the chat, or
- Ask the AI: *"connect to my Chrome"*

All browser actions will now operate on your real Chrome session.

---

## 🏎️ Running for the First Time

You need to run the Agent and the Dashboard in two separate terminal windows:

### Window 1: The Brain
```bash
npm run dev
```

### Window 2: The Dashboard
```bash
cd dashboard
npm run dev
```

Once both are running, open your browser to [http://localhost:5173](http://localhost:5173).

---

## 🛡️ Usage Tips
- **Security**: This agent can execute PowerShell commands. Never share your `.env` file!
- **Refresh**: Use the `/new` command in chat to clear AI memory and save tokens.
- **Vision**: Use the Camera icon in the dashboard to share your screen with the AI.

---
*“Your machine, your command.”*
