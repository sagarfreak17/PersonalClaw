import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { getToolDefinitions, handleToolCall, skills } from '../skills/index.js';

dotenv.config();

const MEMORY_DIR = path.join(process.cwd(), 'memory');
const KNOWLEDGE_FILE = path.join(MEMORY_DIR, 'long_term_knowledge.json');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// ─── Model Registry & Failover ──────────────────────────────────────
interface ModelInfo {
  id: string;
  name: string;
  tier: 'primary' | 'fallback' | 'emergency';
  description: string;
  contextWindow: string;
  status: 'active' | 'preview' | 'stable';
}

const MODEL_REGISTRY: ModelInfo[] = [
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    tier: 'primary',
    description: 'Most intelligent — advanced reasoning, agentic coding, complex problem-solving',
    contextWindow: '1M tokens',
    status: 'preview',
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    tier: 'fallback',
    description: 'Frontier performance rivaling larger models at fraction of cost',
    contextWindow: '1M tokens',
    status: 'preview',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    tier: 'fallback',
    description: 'Deep reasoning and coding — stable GA release',
    contextWindow: '1M tokens',
    status: 'stable',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    tier: 'fallback',
    description: 'Best price-performance for high-volume reasoning tasks — stable GA',
    contextWindow: '1M tokens',
    status: 'stable',
  },
  {
    id: 'gemini-3.1-flash-lite-preview',
    name: 'Gemini 3.1 Flash-Lite',
    tier: 'emergency',
    description: 'Ultra-cheap, high-volume, low-latency — last resort failover',
    contextWindow: '1M tokens',
    status: 'preview',
  },
];

// Build the failover chain: primary → fallbacks in order → emergency
function getFailoverChain(): string[] {
  // If user has set GEMINI_MODEL in .env, put it first
  const envModel = process.env.GEMINI_MODEL;
  const chain = MODEL_REGISTRY.map(m => m.id);

  if (envModel && !chain.includes(envModel)) {
    // User specified a custom model not in our registry — put it first
    chain.unshift(envModel);
  } else if (envModel) {
    // Move user's chosen model to the front
    const idx = chain.indexOf(envModel);
    if (idx > 0) {
      chain.splice(idx, 1);
      chain.unshift(envModel);
    }
  }

  return chain;
}

// ─── System Prompt Builder ───────────────────────────────────────────
function buildSystemPrompt(): string {
  const now = new Date();
  const timestamp = now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  // Load persisted user knowledge
  let knowledgeBlock = '';
  try {
    if (fs.existsSync(KNOWLEDGE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, 'utf8'));
      const entries = Object.entries(raw)
        .map(([k, v]) => `  • ${k}: ${v}`)
        .join('\n');
      if (entries) {
        knowledgeBlock = `
## Learned User Knowledge (from long-term memory)
${entries}
Use this knowledge proactively. Adapt your tone, shortcuts, and workflow to match what you've learned.`;
      }
    }
  } catch { /* ignore corrupt file */ }

  return `# PersonalClaw — Autonomous Windows Agent

You are **PersonalClaw**, a state-of-the-art, locally-hosted AI agent operating on the user's Windows machine. You are not a chatbot. You are an **autonomous systems operator** — you observe, reason, plan, and act through tools to accomplish tasks on this machine. Think of yourself as a senior engineer with root access who happens to live inside the terminal.

**Current Time**: ${timestamp}

---

## Identity & Personality
- You are sharp, decisive, and efficient. You do NOT hedge or over-explain unless the user asks for detail.
- Speak like a competent colleague, not a corporate assistant. Be direct. Use technical language naturally.
- If you make a mistake, own it immediately and correct course. Never bluff.
- You have a dry sense of humor when appropriate, but work always comes first.
- Your name is **PersonalClaw**. The user may call you "Claw" casually.

---

## Reasoning Framework

Before taking action on any non-trivial request, follow this mental model:

### 1. UNDERSTAND — Parse the request
- What exactly is the user asking for? 
- Is anything ambiguous? If so, ask ONE clarifying question (not five).
- Does long-term memory or previous context change how you should approach this?

### 2. PLAN — Design the approach
- What tools do you need? In what order?  
- What's the cheapest path? (Scrape before screenshot. Read before shell. Think before act.)
- What could go wrong? Plan for the most likely failure.

### 3. ACT — Execute with precision
- Call tools decisively. Don't "try things out" randomly.
- When a tool returns data, **read the output carefully** before deciding your next step.
- If a tool call fails, diagnose WHY before retrying. Don't blindly repeat the same call.

### 4. VERIFY — Confirm the result
- After completing a task, verify it actually worked (re-read the file, check the output, scrape the page).
- Report results concisely. Include relevant data, not a summary of your thought process.

---

## Available Skills (Tools)

You have the following tools at your disposal. Use them wisely — every call burns tokens.

### 🖥️ execute_powershell
Run any PowerShell command. You have full system access.
- Use for: system info, service management, network diagnostics, registry, installs, process control.
- **Tip**: Prefer single-line pipelines. Avoid multi-line scripts when a one-liner works.
- **Tip**: For complex scripts, write them to a file with manage_files first, then execute.
- **Safety**: NEVER run destructive commands (format, Remove-Item -Recurse on system dirs, registry deletes) without explicit user confirmation.

### 📁 manage_files
File CRUD: read, write, append, delete, list.
- Always use absolute paths on Windows (e.g., C:\\Users\\...).
- Use this to inspect configs, write scripts, manage logs.

### 🌐 browser
Unified browser automation with persistent login sessions. **This is one tool with multiple actions.**

**CRITICAL WORKFLOW** — follow this order:
1. **scrape** → Always first. Returns page text, title, URL. Cheapest call. Gives you enough to decide next steps.
2. **click** / **type** → Interact with elements. Pass visible text (e.g., "Sign In") or a CSS selector.
3. **navigate** → Go to a direct URL when you know where you're headed.
4. **screenshot** → ONLY when visual layout matters or scrape output is ambiguous.
5. **evaluate** → Advanced JS execution. Last resort when click/type can't do it.
6. **wait** → Wait for dynamic content to load (pass CSS selector).
7. **back** / **page_info** / **close** → Navigation helpers.

**Anti-patterns to AVOID:**
- ❌ Taking a screenshot just to "see what's there" — scrape first.
- ❌ Navigating to a page and immediately screenshotting — scrape first.
- ❌ Using evaluate for simple clicks — use the click action.

### 👁️ analyze_vision
Captures and analyzes the screen or a specific image using Gemini Vision.
- Use ONLY when: the user asks "what do you see?", or text-based scraping can't explain a visual layout.
- This is expensive. Don't use it for information-gathering when text tools would work.

### 🐍 run_python_script
Executes Python code on the local machine.
- Great for: data processing, API calls, file parsing, math, automation scripts.
- The script runs in the project directory. Import any installed packages.

### 📋 manage_clipboard
Read from or write to the system clipboard.
- Useful for: extracting copied data, preparing content for paste.

### 🧠 manage_long_term_memory
Your persistent knowledge store. This is how you evolve and learn.
- **learn**: Save important user preferences, patterns, terminology, or workflow habits.
- **recall**: Retrieve stored knowledge. Do this at conversation start or when context seems relevant.
- **forget**: Remove outdated knowledge.
- You SHOULD proactively learn preferences (e.g., "user prefers PowerShell over cmd", "user's MSP uses ConnectWise + ITGlue").
- You SHOULD recall at the start of complex tasks to check for established workflows.

### ⏰ manage_scheduler
Cron job management for recurring tasks.
- Uses standard cron syntax (e.g., "0 9 * * *" = 9 AM daily).
- Jobs persist across server restarts.
- Commands are natural language — they get processed by your brain when triggered.

### 🏢 paperclip_orchestration
Interact with the Paperclip task management system (when running on localhost:3100).
- Actions: check_status, get_identity, list_assignments, checkout_task, update_task, add_comment, create_subtask.
- Always check_status first before attempting other actions.

---

## MSP & IT Specialization

You are trained as a **Tier 3 MSP IT Technician**. When the user is working on IT tasks:
- You know ITGlue, Meraki, ConnectWise Manage/Automate, Nilear, HaloPSA, and common MSP stacks.
- Always look for **root causes**, not surface-level symptoms.
- Check logs, event viewers, service states, and network paths systematically.
- When investigating, default to **read-only**. Don't change configs unless the user explicitly approves remediation.
- Use the browser to navigate MSP portals when needed (your logins are saved in the persistent browser).

---

## Communication Rules

1. **Be concise**. Default to short, actionable responses. Expand only if the user asks "explain" or "why".
2. **Use markdown**. Format your responses with headers, bold, code blocks, and lists for readability.
3. **Show, don't tell**. Include relevant command output, file contents, or data in your response. Don't just say "I checked and it looks fine."
4. **One message per task**. Don't split your response across multiple messages. Deliver the complete answer.
5. **Errors get context**. If something failed, show the error AND your diagnosis of what went wrong.
6. **Never apologize for being an AI**. You're a tool, not a person. Just do the work.

---

## Safety Guardrails

- **NEVER** execute destructive commands without user confirmation (rm -rf, format drives, registry deletes, service stops on critical infra).
- **NEVER** access or display .env files, API keys, or credentials to the user unless they explicitly request it.
- **NEVER** make external network requests to unknown endpoints without user knowledge.
- If you're unsure whether an action is destructive, **ask first**.
- If a PowerShell command could have system-wide side effects, explain what it will do before running it.
${knowledgeBlock}

---

## Meta-Rules

- If the user says something vague like "fix it" — recall the last context, ask ONE clarifying question if truly ambiguous, otherwise just handle it.
- If a task requires multiple tool calls, batch them logically. Don't call tools one at a time when they could be parallelized mentally.
- If you hit the tool turn limit, summarize what you've accomplished and what remains.
- Remember: you are running **locally on Windows**. Paths use backslashes. PowerShell is your shell. The user controls this machine.`;
}

// ─── Brain Class ─────────────────────────────────────────────────────
export class Brain {
  private chat: any;
  private history: any[] = [];
  private sessionId: string;
  private model: GenerativeModel;
  private activeModelId: string;
  private turnCount: number = 0;
  private failoverChain: string[];
  private failoverAttempts: Map<string, number> = new Map();
  private sessionStartTime: number;

  constructor() {
    this.failoverChain = getFailoverChain();
    this.activeModelId = this.failoverChain[0];
    this.model = this.createModel(this.activeModelId);
    this.sessionId = `session_${Date.now()}`;
    this.sessionStartTime = Date.now();
    this.initSession();
    console.log(`[Brain] Initialized with model: ${this.activeModelId}`);
    console.log(`[Brain] Failover chain: ${this.failoverChain.join(' → ')}`);
  }

  private createModel(modelId: string): GenerativeModel {
    return genAI.getGenerativeModel({
      model: modelId,
      tools: getToolDefinitions() as any,
    });
  }

  /**
   * Attempt to fail over to the next model in the chain.
   * Returns true if failover succeeded, false if no more models.
   */
  private async failoverToNextModel(failedModelId: string, error: string): Promise<boolean> {
    const currentIdx = this.failoverChain.indexOf(failedModelId);
    const nextIdx = currentIdx + 1;

    if (nextIdx >= this.failoverChain.length) {
      console.error(`[Brain] ❌ All models in failover chain exhausted. Last error: ${error}`);
      return false;
    }

    const nextModelId = this.failoverChain[nextIdx];
    const nextModelInfo = MODEL_REGISTRY.find(m => m.id === nextModelId);
    const nextName = nextModelInfo?.name || nextModelId;

    console.warn(`[Brain] ⚠️ Model "${failedModelId}" failed: ${error}`);
    console.warn(`[Brain] 🔄 Failing over to: ${nextName} (${nextModelId})`);

    this.activeModelId = nextModelId;
    this.model = this.createModel(nextModelId);

    // Track failover attempts
    const count = (this.failoverAttempts.get(failedModelId) || 0) + 1;
    this.failoverAttempts.set(failedModelId, count);

    // Rebuild the chat session with the new model
    this.chat = this.model.startChat({ history: this.history });

    return true;
  }

  /**
   * Send a message with automatic model failover on critical errors.
   */
  private async sendWithFailover(payload: any): Promise<any> {
    let lastError = '';
    const startModelId = this.activeModelId;

    // Try current model and failovers
    for (let attempt = 0; attempt < this.failoverChain.length; attempt++) {
      try {
        const result = await this.chat.sendMessage(payload);
        return result;
      } catch (e: any) {
        lastError = e.message || String(e);

        // Errors that warrant failover
        const isModelError =
          lastError.includes('404') ||           // Model not found
          lastError.includes('not found') ||
          lastError.includes('not supported') ||
          lastError.includes('is not available') ||
          lastError.includes('deprecated') ||
          lastError.includes('PERMISSION_DENIED') ||
          lastError.includes('503') ||           // Service unavailable
          lastError.includes('UNAVAILABLE') ||
          lastError.includes('INTERNAL');         // Internal server error

        // Rate limits — retry with backoff on SAME model first
        if (lastError.includes('429') || lastError.includes('RESOURCE_EXHAUSTED')) {
          const retryAfter = Math.pow(2, attempt + 1) * 1000;
          console.warn(`[Brain] Rate limited on ${this.activeModelId}. Waiting ${retryAfter}ms...`);
          await new Promise(r => setTimeout(r, retryAfter));

          // If we've been rate limited 2+ times on this model, try next
          if (attempt >= 1) {
            const didFailover = await this.failoverToNextModel(this.activeModelId, lastError);
            if (!didFailover) break;
            continue;
          }

          // Retry same model
          continue;
        }

        // Context overflow — compact and retry same model
        if (lastError.includes('context length') || lastError.includes('token limit') || lastError.includes('too long')) {
          console.warn('[Brain] Context overflow. Compacting...');
          await this.compactHistoryIfNeeded();
          continue;
        }

        // Model-level errors — failover immediately
        if (isModelError) {
          const didFailover = await this.failoverToNextModel(this.activeModelId, lastError);
          if (!didFailover) break;
          continue;
        }

        // Unknown error — don't failover, just throw
        throw e;
      }
    }

    throw new Error(`All models failed. Last error: ${lastError}. Chain tried: ${startModelId} → ${this.activeModelId}`);
  }

  private initSession() {
    const systemPrompt = buildSystemPrompt();
    this.history = [
      {
        role: 'user',
        parts: [{ text: systemPrompt }],
      },
      {
        role: 'model',
        parts: [{ text: 'Online. PersonalClaw is ready. What do you need?' }],
      },
    ];
    this.turnCount = 0;
    this.startNewSession(this.history);
  }

  private saveHistory() {
    try {
      if (!fs.existsSync(MEMORY_DIR)) {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
      }
      const filePath = path.join(MEMORY_DIR, `${this.sessionId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(this.history, null, 2));
    } catch (e) {
      console.error('[Brain] Failed to save history:', e);
    }
  }

  private startNewSession(history: any[]) {
    this.chat = this.model.startChat({ history });
    this.saveHistory();
  }

  public async resetChat() {
    console.log('[Brain] Starting a brand new session...');
    this.sessionId = `session_${Date.now()}`;
    this.sessionStartTime = Date.now();
    this.failoverAttempts.clear();
    // Reset to the top of the failover chain
    this.activeModelId = this.failoverChain[0];
    this.model = this.createModel(this.activeModelId);
    this.initSession();
    return `🔄 New session initialized.\n- **Model**: \`${this.activeModelId}\`\n- Long-term memory preserved.\n- Failover chain reset.`;
  }

  // Context window management — auto-compact when history gets large
  private async compactHistoryIfNeeded() {
    try {
      const history = await this.chat.getHistory();
      const tokenResult = await this.model.countTokens({ contents: history });
      const totalTokens = tokenResult.totalTokens;

      if (totalTokens > 800_000) {
        console.log(`[Brain] Token count (${totalTokens}) exceeds threshold. Auto-compacting...`);

        const summaryResult = await this.model.generateContent(
          `Summarize the following conversation history into a concise context block. Preserve: all user preferences, established workflows, active tasks, and any important decisions. Drop: tool call/response details, redundant exchanges, and small talk.\n\nHistory:\n${JSON.stringify(history.slice(2, -6), null, 2)}`
        );
        const summary = summaryResult.response.text();

        const systemPrompt = buildSystemPrompt();
        const recentHistory = history.slice(-6);

        this.history = [
          { role: 'user', parts: [{ text: systemPrompt }] },
          { role: 'model', parts: [{ text: 'Online. PersonalClaw is ready. What do you need?' }] },
          { role: 'user', parts: [{ text: `[CONTEXT_RECOVERY] Here is a summary of our prior conversation:\n${summary}` }] },
          { role: 'model', parts: [{ text: 'Context recovered. Continuing where we left off.' }] },
          ...recentHistory,
        ];

        this.startNewSession(this.history);
        console.log('[Brain] Context compacted successfully.');
        return true;
      }
      return false;
    } catch (e) {
      console.error('[Brain] Context compaction failed (non-fatal):', e);
      return false;
    }
  }

  // ─── Slash Command Handlers ────────────────────────────────────────

  private handleHelp(): string {
    return [
      `## 🛸 PersonalClaw Commands`,
      ``,
      `### 📋 Session`,
      `| Command | Description |`,
      `|---------|-------------|`,
      `| \`/new\` | Start fresh session (preserves long-term memory) |`,
      `| \`/status\` | Full system status — model, tokens, uptime, skills |`,
      `| \`/compact\` | Manually compress conversation history to free tokens |`,
      ``,
      `### 🤖 Models`,
      `| Command | Description |`,
      `|---------|-------------|`,
      `| \`/models\` | Show all available models and failover chain |`,
      `| \`/model <id>\` | Switch active model (e.g. \`/model gemini-3-flash-preview\`) |`,
      ``,
      `### 🧠 Memory & Knowledge`,
      `| Command | Description |`,
      `|---------|-------------|`,
      `| \`/memory\` | Show all learned long-term knowledge |`,
      `| \`/forget <key>\` | Remove a specific memory key |`,
      ``,
      `### 🔧 Tools & Debug`,
      `| Command | Description |`,
      `|---------|-------------|`,
      `| \`/skills\` | List all loaded skills with descriptions |`,
      `| \`/jobs\` | Show all scheduled cron jobs |`,
      `| \`/ping\` | Quick health check — confirms the brain is alive |`,
      `| \`/export\` | Export current session history to a file |`,
      ``,
      `### 🌐 Quick Actions`,
      `| Command | Description |`,
      `|---------|-------------|`,
      `| \`/screenshot\` | Capture and analyze the current screen |`,
      `| \`/sysinfo\` | Quick system snapshot (CPU, RAM, disk, network) |`,
      ``,
      `---`,
      `**Tip**: Everything else — just talk naturally. I'll figure out the tools.`,
    ].join('\n');
  }

  private async handleStatus(): Promise<string> {
    try {
      const history = await this.chat.getHistory();
      const tokenResult = await this.model.countTokens({ contents: history });
      const tokens = tokenResult.totalTokens;
      const pct = ((tokens / 1_000_000) * 100).toFixed(1);
      const toolNames = getToolDefinitions().map((t: any) => t.functionDeclarations[0].name);

      // Uptime
      const uptimeMs = Date.now() - this.sessionStartTime;
      const uptimeMin = Math.floor(uptimeMs / 60000);
      const uptimeHrs = Math.floor(uptimeMin / 60);
      const uptime = uptimeHrs > 0
        ? `${uptimeHrs}h ${uptimeMin % 60}m`
        : `${uptimeMin}m`;

      // Failover info
      const modelInfo = MODEL_REGISTRY.find(m => m.id === this.activeModelId);
      const modelName = modelInfo ? `${modelInfo.name} (\`${this.activeModelId}\`)` : `\`${this.activeModelId}\``;

      const failoverHistory = this.failoverAttempts.size > 0
        ? `\n- **Failovers**: ${[...this.failoverAttempts.entries()].map(([m, c]) => `\`${m}\` failed ${c}x`).join(', ')}`
        : '';

      // Token bar
      const barLen = 20;
      const filled = Math.round((tokens / 1_000_000) * barLen);
      const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

      return [
        `## 📊 PersonalClaw Status`,
        ``,
        `| | |`,
        `|---|---|`,
        `| **Session** | \`${this.sessionId}\` |`,
        `| **Uptime** | ${uptime} |`,
        `| **Turns** | ${this.turnCount} |`,
        `| **Model** | ${modelName} |`,
        `| **Status** | ${modelInfo?.status || 'unknown'} / ${modelInfo?.tier || 'custom'} |`,
        ``,
        `### Token Usage`,
        `\`${bar}\` ${tokens.toLocaleString()} / 1,000,000 (${pct}%)`,
        ``,
        `### Skills (${toolNames.length})`,
        `\`${toolNames.join('` `')}\``,
        failoverHistory,
      ].filter(Boolean).join('\n');
    } catch (e: any) {
      return `📊 **Status**: Session \`${this.sessionId}\` active | Model: \`${this.activeModelId}\` | Error: ${e.message}`;
    }
  }

  private handleModels(): string {
    const chain = this.failoverChain;
    const lines = [
      `## 🤖 Model Registry & Failover Chain`,
      ``,
      `**Active Model**: \`${this.activeModelId}\``,
      `**Failover Order**: ${chain.map((m, i) => i === 0 ? `**${m}**` : m).join(' → ')}`,
      ``,
      `| # | Model | API ID | Status | Tier | Description |`,
      `|---|-------|--------|--------|------|-------------|`,
    ];

    MODEL_REGISTRY.forEach((m, i) => {
      const isActive = m.id === this.activeModelId ? ' ✅' : '';
      const position = chain.indexOf(m.id) + 1;
      const failCount = this.failoverAttempts.get(m.id);
      const failInfo = failCount ? ` ⚠️ (failed ${failCount}x)` : '';
      lines.push(
        `| ${position} | **${m.name}**${isActive} | \`${m.id}\` | ${m.status} | ${m.tier} | ${m.description}${failInfo} |`
      );
    });

    lines.push('');
    lines.push(`💡 **Switch model**: \`/model <api-id>\` (e.g. \`/model gemini-3-flash-preview\`)`);
    lines.push(`💡 **Set default**: Add \`GEMINI_MODEL=<api-id>\` to your \`.env\` file`);

    return lines.join('\n');
  }

  private handleSwitchModel(modelId: string): string {
    // Check if it's in registry
    const registryModel = MODEL_REGISTRY.find(m => m.id === modelId);

    // Allow custom model IDs too
    this.activeModelId = modelId;
    this.model = this.createModel(modelId);
    this.chat = this.model.startChat({ history: this.history });

    const name = registryModel ? registryModel.name : modelId;
    const warning = registryModel ? '' : '\n⚠️ This model is not in the registry — failover won\'t apply to it.';

    return `🔄 Switched to **${name}** (\`${modelId}\`)${warning}\n\nSession preserved. No context lost.`;
  }

  private handleMemory(): string {
    try {
      if (!fs.existsSync(KNOWLEDGE_FILE)) {
        return '🧠 **Long-term memory is empty.** I haven\'t learned anything yet. Talk to me!';
      }

      const raw = JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, 'utf8'));
      const entries = Object.entries(raw);

      if (entries.length === 0) {
        return '🧠 **Long-term memory is empty.** No knowledge stored yet.';
      }

      const lines = [
        `## 🧠 Long-Term Memory (${entries.length} entries)`,
        ``,
        `| Key | Value |`,
        `|-----|-------|`,
      ];

      entries.forEach(([k, v]) => {
        const val = typeof v === 'string' ? v : JSON.stringify(v);
        // Truncate long values for display
        const display = val.length > 100 ? val.substring(0, 100) + '...' : val;
        lines.push(`| \`${k}\` | ${display} |`);
      });

      lines.push('');
      lines.push(`💡 **Forget**: \`/forget <key>\` to remove an entry`);

      return lines.join('\n');
    } catch (e: any) {
      return `🧠 Error reading memory: ${e.message}`;
    }
  }

  private handleForget(key: string): string {
    try {
      if (!key) return '❌ Usage: `/forget <key>` — specify which memory key to remove.';

      if (!fs.existsSync(KNOWLEDGE_FILE)) {
        return `❌ No memory file found. Nothing to forget.`;
      }

      const raw = JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, 'utf8'));

      if (!(key in raw)) {
        const available = Object.keys(raw).map(k => `\`${k}\``).join(', ');
        return `❌ Key \`${key}\` not found. Available keys: ${available || 'none'}`;
      }

      const oldValue = raw[key];
      delete raw[key];
      fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(raw, null, 2));

      return `🗑️ Forgotten: \`${key}\`\n> Was: ${typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue)}`;
    } catch (e: any) {
      return `❌ Error: ${e.message}`;
    }
  }

  private handleSkills(): string {
    const lines = [
      `## 🔧 Loaded Skills (${skills.length})`,
      ``,
      `| # | Skill Name | Description |`,
      `|---|-----------|-------------|`,
    ];

    skills.forEach((skill, i) => {
      // Truncate description to first sentence
      const desc = skill.description.split('\n')[0].substring(0, 80);
      lines.push(`| ${i + 1} | \`${skill.name}\` | ${desc} |`);
    });

    return lines.join('\n');
  }

  private async handleJobs(): Promise<string> {
    try {
      const jobsFile = path.join(MEMORY_DIR, 'scheduled_jobs.json');
      if (!fs.existsSync(jobsFile)) {
        return '⏰ **No scheduled jobs.** Use the scheduler skill to create one.';
      }

      const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));

      if (!jobs.length) {
        return '⏰ **No scheduled jobs.** Use the scheduler skill to create one.';
      }

      const lines = [
        `## ⏰ Scheduled Jobs (${jobs.length})`,
        ``,
        `| ID | Schedule | Command |`,
        `|----|----------|---------|`,
      ];

      jobs.forEach((job: any) => {
        lines.push(`| \`${job.id}\` | \`${job.expression}\` | ${job.command} |`);
      });

      return lines.join('\n');
    } catch (e: any) {
      return `⏰ Error reading jobs: ${e.message}`;
    }
  }

  private async handleExport(): Promise<string> {
    try {
      const exportDir = path.join(process.cwd(), 'exports');
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }

      const filename = `session_export_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const filePath = path.join(exportDir, filename);

      const history = await this.chat.getHistory();
      const tokenResult = await this.model.countTokens({ contents: history });

      const exportData = {
        sessionId: this.sessionId,
        model: this.activeModelId,
        turns: this.turnCount,
        tokens: tokenResult.totalTokens,
        exportedAt: new Date().toISOString(),
        history,
      };

      fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2));

      return `📦 Session exported to:\n\`${filePath}\`\n\n- **Turns**: ${this.turnCount}\n- **Tokens**: ${tokenResult.totalTokens.toLocaleString()}\n- **Size**: ${(fs.statSync(filePath).size / 1024).toFixed(1)} KB`;
    } catch (e: any) {
      return `❌ Export failed: ${e.message}`;
    }
  }

  // ─── Main Message Processor ────────────────────────────────────────

  async processMessage(message: string, onUpdate?: (chunk: string) => void): Promise<string> {
    const msgTrimmed = message.trim();
    const msgLower = msgTrimmed.toLowerCase();

    // ── Slash Commands (handled locally, no model call) ──

    if (msgLower === '/new') return await this.resetChat();
    if (msgLower === '/help') return this.handleHelp();
    if (msgLower === '/status') return await this.handleStatus();
    if (msgLower === '/models') return this.handleModels();
    if (msgLower === '/memory') return this.handleMemory();
    if (msgLower === '/skills') return this.handleSkills();
    if (msgLower === '/jobs') return await this.handleJobs();
    if (msgLower === '/export') return await this.handleExport();
    if (msgLower === '/ping') return `🏓 **Pong!** Brain is alive.\n- Model: \`${this.activeModelId}\`\n- Uptime: ${Math.floor((Date.now() - this.sessionStartTime) / 60000)}m\n- Turns: ${this.turnCount}`;

    if (msgLower === '/compact') {
      const didCompact = await this.compactHistoryIfNeeded();
      return didCompact
        ? '🗜️ Context compacted successfully. Token usage reduced.'
        : '🗜️ No compaction needed — token usage is within limits.';
    }

    if (msgLower.startsWith('/model ')) {
      const modelId = msgTrimmed.substring(7).trim();
      return this.handleSwitchModel(modelId);
    }

    if (msgLower.startsWith('/forget ')) {
      const key = msgTrimmed.substring(8).trim();
      return this.handleForget(key);
    }

    // /screenshot — quick action, delegate to tools directly
    if (msgLower === '/screenshot') {
      return await this.processMessage('Take a screenshot of my screen and tell me what you see.');
    }

    // /sysinfo — quick action
    if (msgLower === '/sysinfo') {
      return await this.processMessage('Give me a quick system info snapshot: CPU, RAM, disk usage, OS version, IP address. Use PowerShell. Be concise.');
    }

    // Catch unknown slash commands
    if (msgLower.startsWith('/') && !msgLower.startsWith('/new') && !msgLower.includes(' ')) {
      const known = ['/new', '/help', '/status', '/models', '/model', '/memory', '/forget', '/skills', '/jobs', '/compact', '/ping', '/export', '/screenshot', '/sysinfo'];
      return `❓ Unknown command: \`${msgTrimmed}\`\n\nAvailable commands:\n${known.map(c => `\`${c}\``).join(' ')}`;
    }

    // ── Main Processing Loop ──
    this.turnCount++;

    // Auto-compact check every 20 turns
    if (this.turnCount % 20 === 0) {
      await this.compactHistoryIfNeeded();
    }

    let result = await this.sendWithFailover(message);
    let response = result.response;

    // Notify if we failed over during initial send
    if (this.activeModelId !== this.failoverChain[0] && this.turnCount === 1) {
      if (onUpdate) {
        const info = MODEL_REGISTRY.find(m => m.id === this.activeModelId);
        onUpdate(`⚠️ Primary model unavailable. Using **${info?.name || this.activeModelId}** (failover).`);
      }
    }

    let toolTurns = 0;
    const MAX_TOOL_TURNS = 25;

    // ── Tool-Calling Loop ──
    while (response.candidates?.[0]?.content?.parts?.some((part: any) => part.functionCall)) {
      if (toolTurns >= MAX_TOOL_TURNS) {
        const bailMessage = `⚠️ Reached the tool call limit (${MAX_TOOL_TURNS} rounds). Here's where I am — you may need to break this into smaller steps.`;
        if (onUpdate) onUpdate(bailMessage);
        return bailMessage;
      }
      toolTurns++;

      const allParts = response.candidates[0].content.parts;
      const toolCalls = allParts.filter((part: any) => part.functionCall);
      const toolResults: any[] = [];

      // Process all tool calls from this turn in parallel
      const callPromises = toolCalls.map(async (call: any) => {
        const { name, args } = call.functionCall;
        const startTime = Date.now();
        console.log(`[Brain] ⚡ Tool: ${name}`, JSON.stringify(args).substring(0, 200));

        try {
          const output = await handleToolCall(name, args);
          const elapsed = Date.now() - startTime;
          console.log(`[Brain] ✅ ${name} completed in ${elapsed}ms`);

          if (onUpdate) {
            onUpdate(`🔧 \`${name}\` ✓ (${elapsed}ms)`);
          }

          return {
            functionResponse: { name, response: { content: output } },
          };
        } catch (e: any) {
          const elapsed = Date.now() - startTime;
          console.error(`[Brain] ❌ ${name} failed in ${elapsed}ms:`, e.message);

          if (onUpdate) {
            onUpdate(`🔧 \`${name}\` ✗ Error: ${e.message}`);
          }

          return {
            functionResponse: {
              name,
              response: {
                content: {
                  error: e.message,
                  suggestion: 'Analyze this error and decide whether to retry with different parameters, try an alternative approach, or report the failure to the user.',
                },
              },
            },
          };
        }
      });

      const results = await Promise.all(callPromises);
      toolResults.push(...results);

      // Send tool results back with failover
      result = await this.sendWithFailover(toolResults);
      response = result.response;
    }

    // ── Extract Final Response ──
    const finalParts = response.candidates?.[0]?.content?.parts || [];
    const finalTexts = finalParts
      .filter((part: any) => part.text)
      .map((part: any) => part.text)
      .join('\n');

    // Save updated history
    this.history = await this.chat.getHistory();
    this.saveHistory();

    if (onUpdate) onUpdate(finalTexts);
    return finalTexts || '(No response generated)';
  }
}
