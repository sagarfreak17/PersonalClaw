# 🏁 First-Time Setup Guide: PersonalClaw

Follow these steps to get PersonalClaw running on your fresh Windows device.

---

## 🛠️ Prerequisites

Before you begin, ensure you have the following installed on your Windows machine:

1.  **Node.js (v18 or higher)**: [Download here](https://nodejs.org/).
2.  **Git**: [Download here](https://git-scm.com/).
3.  **Python 3.10+**: [Download here](https://www.python.org/). (Ensure "Add Python to PATH" is checked during installation).
4.  **Google Gemini API Key**: Generate a free key at [Google AI Studio](https://aistudio.google.com/).
5.  **Chrome Browser**: Required for the Browser Relay extension.

---

## 🚀 Installation & Setup

### 1. Clone the Repository
Open PowerShell and run:
```bash
git clone https://github.com/yourusername/PersonalClaw.git
cd PersonalClaw
```

### 2. Install Dependencies
Install the Brain's dependencies:
```bash
npm install
```
Install the Dashboard's dependencies:
```bash
cd dashboard
npm install
cd ..
```

### 3. Configure Environment Variables
1. Rename `.env.example` to `.env`.
2. Open `.env` and paste your `GEMINI_API_KEY`.
3. (Optional) Add your Telegram Bot info.

---

## 🖱️ Browser Extension Setup

To allow PersonalClaw to control your browser:
1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer Mode** (top right toggle).
3. Click **Load unpacked**.
4. Select the `extension` folder inside your `PersonalClaw` directory.
5. Click the circular "Refresh" icon on the extension card whenever you update the code.

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
