import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { getToolDefinitions, handleToolCall, skills } from '../skills/index.js';
import { chromeNativeAdapter, ChromeNativeAdapter } from './chrome-mcp.js';
import { browserManager } from './browser.js';
import { extensionRelay } from './relay.js';
import { Learner } from './learner.js';
import { eventBus, Events } from './events.js';
import { audit } from './audit.js';
import { SessionManager } from './sessions.js';

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

function getFailoverChain(): string[] {
  const envModel = process.env.GEMINI_MODEL;
  const chain = MODEL_REGISTRY.map(m => m.id);

  if (envModel && !chain.includes(envModel)) {
    chain.unshift(envModel);
  } else if (envModel) {
    const idx = chain.indexOf(envModel);
    if (idx > 0) {
      chain.splice(idx, 1);
      chain.unshift(envModel);
    }
  }

  return chain;
}

// ─── Performance Tracker ────────────────────────────────────────────
interface PerfRecord {
  timestamp: number;
  durationMs: number;
  toolCalls: number;
  model: string;
  tokens?: number;
}

class PerformanceTracker {
  private records: PerfRecord[] = [];
  private maxRecords = 200;

  record(data: PerfRecord) {
    this.records.push(data);
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  getStats(): {
    totalRequests: number;
    avgResponseMs: number;
    p50Ms: number;
    p95Ms: number;
    avgToolCalls: number;
    totalToolCalls: number;
    modelUsage: Record<string, number>;
  } {
    if (this.records.length === 0) {
      return { totalRequests: 0, avgResponseMs: 0, p50Ms: 0, p95Ms: 0, avgToolCalls: 0, totalToolCalls: 0, modelUsage: {} };
    }

    const durations = this.records.map(r => r.durationMs).sort((a, b) => a - b);
    const toolCounts = this.records.map(r => r.toolCalls);
    const totalTools = toolCounts.reduce((a, b) => a + b, 0);

    const modelUsage: Record<string, number> = {};
    for (const r of this.records) {
      modelUsage[r.model] = (modelUsage[r.model] || 0) + 1;
    }

    return {
      totalRequests: this.records.length,
      avgResponseMs: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      p50Ms: durations[Math.floor(durations.length * 0.5)],
      p95Ms: durations[Math.floor(durations.length * 0.95)],
      avgToolCalls: Math.round((totalTools / this.records.length) * 10) / 10,
      totalToolCalls: totalTools,
      modelUsage,
    };
  }

  getRecentRecords(count: number = 20): PerfRecord[] {
    return this.records.slice(-count);
  }
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

  let knowledgeBlock = '';
  try {
    if (fs.existsSync(KNOWLEDGE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, 'utf8'));
      const entries = Object.entries(raw)
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join('\n');
      if (entries) {
        knowledgeBlock = `
## Learned User Knowledge (from manual memory)
${entries}
Use this knowledge proactively. Adapt your tone, shortcuts, and workflow to match what you've learned.`;
      }
    }
  } catch { /* ignore corrupt file */ }

  return `# PersonalClaw v10.0 — Autonomous Windows Agent

You are **PersonalClaw**, a state-of-the-art, locally-hosted AI agent operating on the user's Windows machine. You are not a chatbot. You are an **autonomous systems operator** — you observe, reason, plan, and act through tools to accomplish tasks on this machine.

**Current Time**: ${timestamp}

---

## Identity & Personality
- Sharp, decisive, efficient. No hedging or over-explaining unless asked.
- Speak like a competent colleague. Direct. Technical language is natural.
- Mistakes get owned immediately. Never bluff.
- Dry humor when appropriate. Work comes first.
- Name: **PersonalClaw**. The user may call you "Claw".

---

## Reasoning Framework

Before acting on non-trivial requests:

### 1. UNDERSTAND — Parse the request
- What exactly is being asked? Is anything ambiguous? Ask ONE clarifying question max.
- Does long-term memory or context change the approach?

### 2. PLAN — Design the approach
- What tools needed? In what order?
- Cheapest path first (scrape before screenshot, read before shell).
- Anticipate the most likely failure.

### 3. ACT — Execute with precision
- Call tools decisively. Don't randomly try things.
- Read tool output carefully before next step.
- If a tool fails, diagnose WHY before retrying.

### 4. VERIFY — Confirm the result
- After completing a task, verify it worked.
- Report results concisely with relevant data.

---

## Available Skills (${skills.length} tools)

### Core Tools
- **execute_powershell** — Run any PowerShell command. Full system access.
- **manage_files** — File CRUD: read, write, append, delete, list.
- **run_python_script** — Execute Python code directly.
- **manage_clipboard** — Read/write system clipboard.

### Browser & Web
- **browser** — Triple-mode browser automation.

  **Mode 1 — Playwright (default)**: Persistent Chromium with its own login profile.
  **Mode 2 — Native Chrome (Chrome 146+)**: Connected to the user's actual running Chrome session
  via Chrome MCP server (SSE) or CDP fallback. Has all real logins, cookies, and tabs.
  **Mode 3 — Extension Relay**: The PersonalClaw Chrome extension bridges to the user's real
  Chrome tabs via WebSocket. Rich DOM interaction — click, type, scrape with links/forms, scroll,
  get interactive elements. No --remote-debugging-port needed — just install the extension.

  **Decision guide**:
  - Extension connected? Use relay_ actions for real-tab interaction (relay_tabs, relay_scrape, relay_click, etc.).
  - Need Chrome DevTools-level access? Use connect_native for CDP/MCP mode.
  - Need clean isolated browser? Stay in Playwright mode.
  - Check status first: use browser skill with action="status" to see all available modes.

  WORKFLOW: scrape first (cheap) → click/type → screenshot only if needed.

- **http_request** — Make HTTP requests (GET/POST/PUT/DELETE). For REST APIs, webhooks, data fetching.

### System Intelligence
- **system_info** — Deep system diagnostics: hardware, software, storage, updates, drivers, events, security, battery, env vars.
- **manage_processes** — Process/service management: list, search, kill, start/stop/restart services, startup apps, resource hogs.
- **network_diagnostics** — Network troubleshooting: ping, traceroute, DNS, port checks, connections, interfaces, ARP, routing.
- **analyze_vision** — Screenshot capture & Gemini Vision analysis. Expensive — use only when text tools can't answer.

### Memory & Automation
- **manage_long_term_memory** — Persistent knowledge store. Learn/recall/forget user preferences.
- **manage_scheduler** — Cron job management for recurring tasks.
- **paperclip_orchestration** — Paperclip multi-agent task management.

---

## Tool Best Practices

- **Browser**: Check status first to see available modes. Extension relay for real-tab work, connect_native for CDP/MCP, Playwright for isolation. Scrape before screenshot.
- **PowerShell**: Prefer single-line pipelines. Write complex scripts to file first.
- **HTTP**: Use for API integrations. Check response status codes.
- **System Info**: Use specific actions (hardware, storage, etc.) — not overview for everything.
- **Process Manager**: Kill processes by PID when possible for precision.
- **Network**: Start with ping, escalate to traceroute/DNS as needed.
- **Vision**: LAST RESORT for visual analysis. Text tools are cheaper.
- **Safety**: NEVER run destructive commands without user confirmation.

---

## MSP & IT Specialization

You are a **Tier 3 MSP IT Technician**. You know:
- ITGlue, Meraki, ConnectWise Manage/Automate, Nilear, HaloPSA
- Root cause analysis over surface-level symptoms
- Systematic investigation: logs → event viewers → service states → network paths
- Read-only by default. Don't change configs without approval.
${knowledgeBlock}
${Learner.buildContextBlock()}

---

## Communication Rules

1. **Be concise**. Short, actionable responses by default.
2. **Use markdown**. Headers, bold, code blocks, lists.
3. **Show, don't tell**. Include command output, file contents, data.
4. **One message per task**. Complete answer in one response.
5. **Errors get context**. Show the error AND your diagnosis.

---

## Safety Guardrails

- **NEVER** execute destructive commands without confirmation (rm -rf, format, registry deletes).
- **NEVER** expose .env files, API keys, or credentials unless explicitly requested.
- **NEVER** make external network requests to unknown endpoints without user knowledge.
- If unsure whether an action is destructive, **ask first**.

---

## Meta-Rules

- If the user says "fix it" — recall context, ask ONE question if truly ambiguous, otherwise handle it.
- Batch tool calls logically. Parallelize when possible.
- If you hit the tool turn limit, summarize progress and remaining work.
- You are running **locally on Windows**. PowerShell is your shell.
- You are a self-learning agent. Knowledge from past conversations is injected above. Use it naturally.`;
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
  private learner: Learner;
  private perf: PerformanceTracker;
  private totalToolCalls: number = 0;

  constructor() {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
      console.error('\n[CRITICAL] GEMINI_API_KEY is missing or invalid in .env!');
      console.error('Please run setup.bat or manually update your .env file.\n');
    }

    this.failoverChain = getFailoverChain();
    this.activeModelId = this.failoverChain[0];
    this.model = this.createModel(this.activeModelId);
    this.sessionId = `session_${Date.now()}`;
    this.sessionStartTime = Date.now();
    this.learner = new Learner();
    this.perf = new PerformanceTracker();
    this.initSession();

    eventBus.dispatch(Events.SESSION_STARTED, {
      sessionId: this.sessionId,
      model: this.activeModelId,
    }, 'brain');

    console.log(`[Brain] Initialized with model: ${this.activeModelId}`);
    console.log(`[Brain] Failover chain: ${this.failoverChain.join(' → ')}`);
    console.log(`[Brain] Skills loaded: ${skills.length}`);
  }

  private createModel(modelId: string): GenerativeModel {
    const tools = [
      ...getToolDefinitions(),
      // Dynamically include Chrome native MCP tools when connected (Chrome 146+)
      ...chromeNativeAdapter.getGeminiToolDefs(),
    ];
    return genAI.getGenerativeModel({
      model: modelId,
      tools: tools as any,
    });
  }

  /**
   * Refresh the Gemini model with current tool definitions.
   * Call this after connecting/disconnecting from native Chrome to include Chrome MCP tools.
   */
  refreshModel(): void {
    this.model = this.createModel(this.activeModelId);
    this.chat = this.model.startChat({ history: this.history });
    console.log('[Brain] Model refreshed with updated tool definitions.');
  }

  // ─── Getters for external access ──────────────────────────────────

  get currentModel(): string { return this.activeModelId; }
  get currentSessionId(): string { return this.sessionId; }
  get turns(): number { return this.turnCount; }
  get uptime(): number { return Date.now() - this.sessionStartTime; }
  get toolCallCount(): number { return this.totalToolCalls; }
  get performanceStats() { return this.perf.getStats(); }

  /**
   * Attempt to fail over to the next model in the chain.
   */
  private async failoverToNextModel(failedModelId: string, error: string): Promise<boolean> {
    const currentIdx = this.failoverChain.indexOf(failedModelId);
    const nextIdx = currentIdx + 1;

    if (nextIdx >= this.failoverChain.length) {
      console.error(`[Brain] All models in failover chain exhausted. Last error: ${error}`);
      return false;
    }

    const nextModelId = this.failoverChain[nextIdx];
    const nextModelInfo = MODEL_REGISTRY.find(m => m.id === nextModelId);
    const nextName = nextModelInfo?.name || nextModelId;

    console.warn(`[Brain] Model "${failedModelId}" failed: ${error}`);
    console.warn(`[Brain] Failing over to: ${nextName} (${nextModelId})`);

    eventBus.dispatch(Events.MODEL_FAILOVER, {
      from: failedModelId,
      to: nextModelId,
      reason: error,
    }, 'brain');

    this.activeModelId = nextModelId;
    this.model = this.createModel(nextModelId);

    const count = (this.failoverAttempts.get(failedModelId) || 0) + 1;
    this.failoverAttempts.set(failedModelId, count);

    this.chat = this.model.startChat({ history: this.history });

    return true;
  }

  /**
   * Send a message with automatic model failover on critical errors.
   */
  private async sendWithFailover(payload: any): Promise<any> {
    let lastError = '';
    const startModelId = this.activeModelId;

    for (let attempt = 0; attempt < this.failoverChain.length; attempt++) {
      try {
        const result = await this.chat.sendMessage(payload);
        return result;
      } catch (e: any) {
        lastError = e.message || String(e);

        const isModelError =
          lastError.includes('404') ||
          lastError.includes('not found') ||
          lastError.includes('not supported') ||
          lastError.includes('is not available') ||
          lastError.includes('deprecated') ||
          lastError.includes('PERMISSION_DENIED') ||
          lastError.includes('503') ||
          lastError.includes('UNAVAILABLE') ||
          lastError.includes('INTERNAL');

        if (lastError.includes('429') || lastError.includes('RESOURCE_EXHAUSTED')) {
          const retryAfter = Math.pow(2, attempt + 1) * 1000;
          console.warn(`[Brain] Rate limited on ${this.activeModelId}. Waiting ${retryAfter}ms...`);
          await new Promise(r => setTimeout(r, retryAfter));

          if (attempt >= 1) {
            const didFailover = await this.failoverToNextModel(this.activeModelId, lastError);
            if (!didFailover) break;
            continue;
          }
          continue;
        }

        if (lastError.includes('context length') || lastError.includes('token limit') || lastError.includes('too long')) {
          console.warn('[Brain] Context overflow. Compacting...');
          await this.compactHistoryIfNeeded();
          continue;
        }

        if (isModelError) {
          const didFailover = await this.failoverToNextModel(this.activeModelId, lastError);
          if (!didFailover) break;
          continue;
        }

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
        parts: [{ text: 'Online. PersonalClaw v10 is ready. What do you need?' }],
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
    this.activeModelId = this.failoverChain[0];
    this.model = this.createModel(this.activeModelId);
    this.totalToolCalls = 0;
    this.initSession();

    eventBus.dispatch(Events.SESSION_RESET, { sessionId: this.sessionId }, 'brain');

    return `New session initialized.\n- **Model**: \`${this.activeModelId}\`\n- Long-term memory preserved.\n- Failover chain reset.`;
  }

  /**
   * Restore a previous session's conversation history.
   */
  public async restoreSession(sessionId: string): Promise<string> {
    const history = SessionManager.loadSession(sessionId);
    if (!history) {
      return `Session \`${sessionId}\` not found.`;
    }

    this.sessionId = sessionId;
    this.history = history;
    this.turnCount = history.filter((h: any) => h.role === 'user').length;
    this.startNewSession(history);

    return `Session \`${sessionId}\` restored.\n- **Turns**: ${this.turnCount}\n- **Model**: \`${this.activeModelId}\``;
  }

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
          { role: 'model', parts: [{ text: 'Online. PersonalClaw v10 is ready. What do you need?' }] },
          { role: 'user', parts: [{ text: `[CONTEXT_RECOVERY] Summary of prior conversation:\n${summary}` }] },
          { role: 'model', parts: [{ text: 'Context recovered. Continuing where we left off.' }] },
          ...recentHistory,
        ];

        this.startNewSession(this.history);

        eventBus.dispatch(Events.CONTEXT_COMPACTED, {
          oldTokens: totalTokens,
          newTokens: this.history.length,
        }, 'brain');

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
      `## PersonalClaw v10 Commands`,
      ``,
      `### Session`,
      `| Command | Description |`,
      `|---------|-------------|`,
      `| \`/new\` | Start fresh session (preserves memory) |`,
      `| \`/status\` | Full system status — model, tokens, uptime, skills |`,
      `| \`/compact\` | Compress conversation history to free tokens |`,
      `| \`/sessions\` | Browse saved conversation sessions |`,
      `| \`/restore <id>\` | Restore a previous session |`,
      `| \`/search <query>\` | Search through past conversations |`,
      ``,
      `### Models`,
      `| Command | Description |`,
      `|---------|-------------|`,
      `| \`/models\` | Show all available models and failover chain |`,
      `| \`/model <id>\` | Switch active model |`,
      ``,
      `### Memory & Knowledge`,
      `| Command | Description |`,
      `|---------|-------------|`,
      `| \`/memory\` | Show all learned long-term knowledge |`,
      `| \`/forget <key>\` | Remove a specific memory key |`,
      ``,
      `### Tools & Debug`,
      `| Command | Description |`,
      `|---------|-------------|`,
      `| \`/skills\` | List all loaded skills with descriptions |`,
      `| \`/jobs\` | Show all scheduled cron jobs |`,
      `| \`/ping\` | Quick health check |`,
      `| \`/export\` | Export current session history to file |`,
      `| \`/perf\` | Performance statistics |`,
      `| \`/audit\` | Recent audit log entries |`,
      ``,
      `### Quick Actions`,
      `| Command | Description |`,
      `|---------|-------------|`,
      `| \`/chrome [port]\` | Connect to real Chrome (native MCP/CDP, default port 9222) |`,
      `| \`/relay\` | Show extension relay status and connected tabs |`,
      `| \`/screenshot\` | Capture and analyze the screen |`,
      `| \`/sysinfo\` | Quick system snapshot |`,
      `| \`/ip\` | Show IP addresses and network info |`,
      `| \`/procs\` | Top resource-consuming processes |`,
      ``,
      `### Self-Learning`,
      `| Command | Description |`,
      `|---------|-------------|`,
      `| \`/learned\` | Show everything I've learned about you |`,
      `| \`/learned log\` | View raw learning log |`,
      `| \`/learned clear\` | Reset all self-learned data |`,
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

      const uptimeMs = Date.now() - this.sessionStartTime;
      const uptimeMin = Math.floor(uptimeMs / 60000);
      const uptimeHrs = Math.floor(uptimeMin / 60);
      const uptime = uptimeHrs > 0
        ? `${uptimeHrs}h ${uptimeMin % 60}m`
        : `${uptimeMin}m`;

      const modelInfo = MODEL_REGISTRY.find(m => m.id === this.activeModelId);
      const modelName = modelInfo ? `${modelInfo.name} (\`${this.activeModelId}\`)` : `\`${this.activeModelId}\``;

      const failoverHistory = this.failoverAttempts.size > 0
        ? `\n- **Failovers**: ${[...this.failoverAttempts.entries()].map(([m, c]) => `\`${m}\` failed ${c}x`).join(', ')}`
        : '';

      const barLen = 20;
      const filled = Math.round((tokens / 1_000_000) * barLen);
      const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

      const perfStats = this.perf.getStats();

      return [
        `## PersonalClaw v10 Status`,
        ``,
        `| | |`,
        `|---|---|`,
        `| **Session** | \`${this.sessionId}\` |`,
        `| **Uptime** | ${uptime} |`,
        `| **Turns** | ${this.turnCount} |`,
        `| **Tool Calls** | ${this.totalToolCalls} |`,
        `| **Model** | ${modelName} |`,
        `| **Status** | ${modelInfo?.status || 'unknown'} / ${modelInfo?.tier || 'custom'} |`,
        ``,
        `### Token Usage`,
        `\`${bar}\` ${tokens.toLocaleString()} / 1,000,000 (${pct}%)`,
        ``,
        `### Performance`,
        `| Metric | Value |`,
        `|--------|-------|`,
        `| **Avg Response** | ${perfStats.avgResponseMs}ms |`,
        `| **P50 / P95** | ${perfStats.p50Ms}ms / ${perfStats.p95Ms}ms |`,
        `| **Avg Tools/Request** | ${perfStats.avgToolCalls} |`,
        ``,
        `### Skills (${toolNames.length})`,
        `\`${toolNames.join('` `')}\``,
        failoverHistory,
      ].filter(Boolean).join('\n');
    } catch (e: any) {
      return `**Status**: Session \`${this.sessionId}\` active | Model: \`${this.activeModelId}\` | Error: ${e.message}`;
    }
  }

  private handleModels(): string {
    const chain = this.failoverChain;
    const lines = [
      `## Model Registry & Failover Chain`,
      ``,
      `**Active Model**: \`${this.activeModelId}\``,
      `**Failover Order**: ${chain.map((m, i) => i === 0 ? `**${m}**` : m).join(' → ')}`,
      ``,
      `| # | Model | API ID | Status | Tier | Description |`,
      `|---|-------|--------|--------|------|-------------|`,
    ];

    MODEL_REGISTRY.forEach((m) => {
      const isActive = m.id === this.activeModelId ? ' (active)' : '';
      const position = chain.indexOf(m.id) + 1;
      const failCount = this.failoverAttempts.get(m.id);
      const failInfo = failCount ? ` (failed ${failCount}x)` : '';
      lines.push(
        `| ${position} | **${m.name}**${isActive} | \`${m.id}\` | ${m.status} | ${m.tier} | ${m.description}${failInfo} |`
      );
    });

    lines.push('');
    lines.push(`Switch model: \`/model <api-id>\``);
    lines.push(`Set default: Add \`GEMINI_MODEL=<api-id>\` to your \`.env\` file`);

    return lines.join('\n');
  }

  private handleSwitchModel(modelId: string): string {
    const registryModel = MODEL_REGISTRY.find(m => m.id === modelId);
    this.activeModelId = modelId;
    this.model = this.createModel(modelId);
    this.chat = this.model.startChat({ history: this.history });

    const name = registryModel ? registryModel.name : modelId;
    const warning = registryModel ? '' : '\nThis model is not in the registry — failover won\'t apply to it.';

    return `Switched to **${name}** (\`${modelId}\`)${warning}\n\nSession preserved. No context lost.`;
  }

  private handleMemory(): string {
    try {
      if (!fs.existsSync(KNOWLEDGE_FILE)) {
        return '**Long-term memory is empty.** I haven\'t learned anything yet. Talk to me!';
      }

      const raw = JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, 'utf8'));
      const entries = Object.entries(raw);

      if (entries.length === 0) {
        return '**Long-term memory is empty.** No knowledge stored yet.';
      }

      const lines = [
        `## Long-Term Memory (${entries.length} entries)`,
        ``,
        `| Key | Value |`,
        `|-----|-------|`,
      ];

      entries.forEach(([k, v]) => {
        const val = typeof v === 'string' ? v : JSON.stringify(v);
        const display = val.length > 100 ? val.substring(0, 100) + '...' : val;
        lines.push(`| \`${k}\` | ${display} |`);
      });

      lines.push('');
      lines.push(`Forget: \`/forget <key>\``);

      return lines.join('\n');
    } catch (e: any) {
      return `Error reading memory: ${e.message}`;
    }
  }

  private handleForget(key: string): string {
    try {
      if (!key) return 'Usage: `/forget <key>` — specify which memory key to remove.';
      if (!fs.existsSync(KNOWLEDGE_FILE)) return `No memory file found. Nothing to forget.`;

      const raw = JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, 'utf8'));

      if (!(key in raw)) {
        const available = Object.keys(raw).map(k => `\`${k}\``).join(', ');
        return `Key \`${key}\` not found. Available keys: ${available || 'none'}`;
      }

      const oldValue = raw[key];
      delete raw[key];
      fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(raw, null, 2));

      return `Forgotten: \`${key}\`\n> Was: ${typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue)}`;
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  }

  private handleSkills(): string {
    const lines = [
      `## Loaded Skills (${skills.length})`,
      ``,
      `| # | Skill Name | Description |`,
      `|---|-----------|-------------|`,
    ];

    skills.forEach((skill, i) => {
      const desc = skill.description.split('\n')[0].substring(0, 80);
      lines.push(`| ${i + 1} | \`${skill.name}\` | ${desc} |`);
    });

    return lines.join('\n');
  }

  private async handleJobs(): Promise<string> {
    try {
      const jobsFile = path.join(MEMORY_DIR, 'scheduled_jobs.json');
      if (!fs.existsSync(jobsFile)) {
        return '**No scheduled jobs.** Use the scheduler skill to create one.';
      }

      const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));

      if (!jobs.length) {
        return '**No scheduled jobs.**';
      }

      const lines = [
        `## Scheduled Jobs (${jobs.length})`,
        ``,
        `| ID | Schedule | Command |`,
        `|----|----------|---------|`,
      ];

      jobs.forEach((job: any) => {
        lines.push(`| \`${job.id}\` | \`${job.expression}\` | ${job.command} |`);
      });

      return lines.join('\n');
    } catch (e: any) {
      return `Error reading jobs: ${e.message}`;
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

      return `Session exported to:\n\`${filePath}\`\n\n- **Turns**: ${this.turnCount}\n- **Tokens**: ${tokenResult.totalTokens.toLocaleString()}\n- **Size**: ${(fs.statSync(filePath).size / 1024).toFixed(1)} KB`;
    } catch (e: any) {
      return `Export failed: ${e.message}`;
    }
  }

  private handlePerf(): string {
    const stats = this.perf.getStats();

    if (stats.totalRequests === 0) {
      return `## Performance\n\nNo requests recorded yet. Start chatting to see performance data!`;
    }

    const lines = [
      `## Performance Statistics`,
      ``,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| **Total Requests** | ${stats.totalRequests} |`,
      `| **Avg Response Time** | ${stats.avgResponseMs}ms |`,
      `| **P50 Latency** | ${stats.p50Ms}ms |`,
      `| **P95 Latency** | ${stats.p95Ms}ms |`,
      `| **Total Tool Calls** | ${stats.totalToolCalls} |`,
      `| **Avg Tools/Request** | ${stats.avgToolCalls} |`,
      ``,
      `### Model Usage`,
      `| Model | Requests |`,
      `|-------|----------|`,
    ];

    for (const [model, count] of Object.entries(stats.modelUsage)) {
      const info = MODEL_REGISTRY.find(m => m.id === model);
      lines.push(`| ${info?.name || model} | ${count} |`);
    }

    // Recent response times
    const recent = this.perf.getRecentRecords(10);
    if (recent.length > 0) {
      lines.push('');
      lines.push('### Recent Requests');
      lines.push('| Time | Duration | Tools |');
      lines.push('|------|----------|-------|');
      for (const r of recent.reverse()) {
        const time = new Date(r.timestamp).toLocaleTimeString();
        lines.push(`| ${time} | ${r.durationMs}ms | ${r.toolCalls} |`);
      }
    }

    return lines.join('\n');
  }

  private handleSessions(): string {
    const sessions = SessionManager.listSessions(15);

    if (sessions.length === 0) {
      return `## Sessions\n\nNo saved sessions found.`;
    }

    const stats = SessionManager.getStats();
    const lines = [
      `## Session History (${stats.totalSessions} total, ${stats.totalSizeKB} KB)`,
      ``,
      `| Session ID | Date | Turns | Size | Preview |`,
      `|-----------|------|-------|------|---------|`,
    ];

    for (const s of sessions) {
      const date = s.createdAt.toLocaleDateString();
      const preview = s.firstMessage ? s.firstMessage.substring(0, 40) + (s.firstMessage.length > 40 ? '...' : '') : '-';
      const isCurrent = s.id === this.sessionId ? ' **(current)**' : '';
      lines.push(`| \`${s.id}\`${isCurrent} | ${date} | ${s.turnCount} | ${s.sizeKB}KB | ${preview} |`);
    }

    lines.push('');
    lines.push('Restore: `/restore <session_id>`');
    lines.push('Search: `/search <query>`');

    return lines.join('\n');
  }

  private handleSearch(query: string): string {
    if (!query) return 'Usage: `/search <query>` — search through past conversations.';

    const results = SessionManager.searchSessions(query, 10);

    if (results.length === 0) {
      return `No sessions found matching "${query}".`;
    }

    const lines = [
      `## Search Results for "${query}" (${results.length} sessions)`,
      ``,
    ];

    for (const { session, matches } of results) {
      const date = session.createdAt.toLocaleDateString();
      lines.push(`### \`${session.id}\` (${date}, ${session.turnCount} turns)`);
      for (const match of matches) {
        lines.push(`> ${match}`);
      }
      lines.push('');
    }

    lines.push('Restore: `/restore <session_id>`');

    return lines.join('\n');
  }

  private async handleChromeConnect(port: number): Promise<string> {
    if (chromeNativeAdapter.isConnected()) {
      const mode = chromeNativeAdapter.getMode();
      const currentPort = chromeNativeAdapter.getPort();
      return [
        `## Native Chrome — Already Connected`,
        ``,
        `- **Mode**: \`${mode}\``,
        `- **Port**: \`${currentPort}\``,
        ``,
        `All browser skill actions are operating on your real Chrome session.`,
        `Disconnect: \`browser(action="disconnect_native")\``,
      ].join('\n');
    }

    const probe = await ChromeNativeAdapter.probe(port);

    if (!probe.available) {
      return [
        `## Native Chrome — Not Found on Port ${port}`,
        ``,
        `Chrome is not accessible at \`localhost:${port}\`.`,
        ``,
        `**To enable:**`,
        `\`\`\``,
        `# Option 1 — Launch Chrome with remote debugging:`,
        `chrome.exe --remote-debugging-port=${port} --user-data-dir=%TEMP%\\chrome-debug`,
        ``,
        `# Option 2 — Enable in Chrome DevTools:`,
        `chrome://inspect/#remote-debugging → Listen on localhost:${port}`,
        `\`\`\``,
        ``,
        `Chrome 146+ automatically activates the native MCP server when remote debugging is enabled.`,
      ].join('\n');
    }

    const result = await browserManager.connectNative(port);
    this.refreshModel(); // Reload tool definitions to include Chrome MCP tools if available

    const mode = chromeNativeAdapter.getMode();
    const mcpTools = chromeNativeAdapter.getMCPToolNames();

    const lines = [
      `## Native Chrome Connected`,
      ``,
      `- **Mode**: \`${mode}\``,
      `- **Port**: \`${port}\``,
      `- **Chrome**: ${probe.version}`,
      `- **Open tabs**: ${probe.tabs}`,
    ];

    if (mcpTools.length > 0) {
      lines.push(`- **Chrome MCP tools**: ${mcpTools.length} (${mcpTools.slice(0, 5).join(', ')}${mcpTools.length > 5 ? '...' : ''})`);
    }

    lines.push(``, `All browser skill actions now operate on **your real Chrome session**. Real logins, real tabs, no re-authentication.`);

    return lines.join('\n');
  }

  private handleRelay(): string {
    const status = extensionRelay.getStatus();
    const lines = [
      `## Extension Relay`,
      ``,
      `| | |`,
      `|---|---|`,
      `| **Status** | ${status.connected ? 'Connected' : 'Disconnected'} |`,
      `| **Endpoint** | ws://localhost:3000/relay |`,
      `| **Open Tabs** | ${status.tabs} |`,
    ];

    if (status.connected && status.tabList.length > 0) {
      lines.push(``, `### Tabs`);
      lines.push(`| ID | Title | URL |`);
      lines.push(`|----|-------|-----|`);
      for (const tab of status.tabList.slice(0, 20)) {
        const title = tab.title.substring(0, 40) + (tab.title.length > 40 ? '...' : '');
        const url = tab.url.substring(0, 50) + (tab.url.length > 50 ? '...' : '');
        const active = tab.active ? ' (active)' : '';
        lines.push(`| ${tab.id} | ${title}${active} | ${url} |`);
      }
    }

    if (!status.connected) {
      lines.push(``, `### Setup`);
      lines.push(`1. Load the extension from \`extension/\` folder in \`chrome://extensions\` (Developer Mode → Load Unpacked).`);
      lines.push(`2. The extension auto-connects to \`ws://127.0.0.1:3000/relay\`.`);
      lines.push(`3. Once connected, use \`relay_*\` browser actions to interact with your real Chrome tabs.`);
    }

    return lines.join('\n');
  }

  private handleAudit(): string {
    const entries = audit.getRecent(20);

    if (entries.length === 0) {
      return `## Audit Log\n\nNo audit entries recorded yet.`;
    }

    const stats = audit.getStats();
    const lines = [
      `## Audit Log (${stats.total} total entries)`,
      ``,
      `### Summary`,
      `| Level | Count |`,
      `|-------|-------|`,
    ];

    for (const [level, count] of Object.entries(stats.byLevel)) {
      lines.push(`| ${level} | ${count} |`);
    }

    lines.push('');
    lines.push('### Recent Entries');
    lines.push('| Time | Level | Category | Detail |');
    lines.push('|------|-------|----------|--------|');

    for (const entry of entries.slice(-15).reverse()) {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const detail = entry.detail.substring(0, 60) + (entry.detail.length > 60 ? '...' : '');
      const duration = entry.durationMs ? ` (${entry.durationMs}ms)` : '';
      lines.push(`| ${time} | ${entry.level} | ${entry.category} | ${detail}${duration} |`);
    }

    return lines.join('\n');
  }

  // ─── Main Message Processor ────────────────────────────────────────

  async processMessage(message: string, onUpdate?: (chunk: string) => void): Promise<string> {
    const msgTrimmed = message.trim();
    const msgLower = msgTrimmed.toLowerCase();

    eventBus.dispatch(Events.MESSAGE_RECEIVED, {
      text: msgTrimmed.substring(0, 200),
      source: 'user',
    }, 'brain');

    // ── Slash Commands (handled locally, no model call) ──

    if (msgLower === '/new') return await this.resetChat();
    if (msgLower === '/help') return this.handleHelp();
    if (msgLower === '/status') return await this.handleStatus();
    if (msgLower === '/models') return this.handleModels();
    if (msgLower === '/memory') return this.handleMemory();
    if (msgLower === '/skills') return this.handleSkills();
    if (msgLower === '/jobs') return await this.handleJobs();
    if (msgLower === '/export') return await this.handleExport();
    if (msgLower === '/perf') return this.handlePerf();
    if (msgLower === '/audit') return this.handleAudit();
    if (msgLower === '/relay') return this.handleRelay();
    if (msgLower === '/sessions') return this.handleSessions();

    if (msgLower === '/chrome' || msgLower.startsWith('/chrome ')) {
      const arg = msgTrimmed.split(' ')[1]?.toLowerCase();
      if (arg === 'disconnect' || arg === 'off') {
        await browserManager.disconnectNative();
        this.refreshModel();
        return 'Disconnected from native Chrome. Back to Playwright mode.';
      }
      const port = arg ? parseInt(arg) || 9222 : 9222;
      return await this.handleChromeConnect(port);
    }

    if (msgLower === '/ping') {
      const uptimeMs = Date.now() - this.sessionStartTime;
      const uptimeMin = Math.floor(uptimeMs / 60000);
      return `**Pong!** Brain is alive.\n- Model: \`${this.activeModelId}\`\n- Uptime: ${uptimeMin}m\n- Turns: ${this.turnCount}\n- Tool Calls: ${this.totalToolCalls}`;
    }

    if (msgLower === '/compact') {
      const didCompact = await this.compactHistoryIfNeeded();
      return didCompact
        ? 'Context compacted successfully. Token usage reduced.'
        : 'No compaction needed — token usage is within limits.';
    }

    if (msgLower.startsWith('/model ')) {
      const modelId = msgTrimmed.substring(7).trim();
      return this.handleSwitchModel(modelId);
    }

    if (msgLower.startsWith('/forget ')) {
      const key = msgTrimmed.substring(8).trim();
      return this.handleForget(key);
    }

    if (msgLower.startsWith('/restore ')) {
      const sessionId = msgTrimmed.substring(9).trim();
      return await this.restoreSession(sessionId);
    }

    if (msgLower.startsWith('/search ')) {
      const query = msgTrimmed.substring(8).trim();
      return this.handleSearch(query);
    }

    // Quick action commands
    if (msgLower === '/screenshot') {
      return await this.processMessage('Take a screenshot of my screen and tell me what you see.');
    }
    if (msgLower === '/sysinfo') {
      return await this.processMessage('Give me a quick system info snapshot: CPU, RAM, disk usage, OS version, IP address. Use the system_info tool with action "overview". Be concise.');
    }
    if (msgLower === '/ip') {
      return await this.processMessage('Show my network interfaces and IP addresses. Use the network_diagnostics tool with action "interfaces". Be concise.');
    }
    if (msgLower === '/procs') {
      return await this.processMessage('Show top resource-consuming processes. Use the manage_processes tool with action "resource_hogs". Be concise.');
    }

    // Self-learning commands
    if (msgLower === '/learned') return Learner.getLearningSummary();
    if (msgLower === '/learned log') return Learner.getLearningLog();
    if (msgLower === '/learned clear') return Learner.clearLearnings();

    // Unknown slash commands
    if (msgLower.startsWith('/') && !msgLower.startsWith('/new') && !msgLower.includes(' ')) {
      const known = ['/new', '/help', '/status', '/models', '/model', '/memory', '/forget', '/skills', '/jobs',
        '/compact', '/ping', '/chrome', '/relay', '/export', '/screenshot', '/sysinfo', '/learned', '/perf', '/audit',
        '/sessions', '/restore', '/search', '/ip', '/procs'];
      return `Unknown command: \`${msgTrimmed}\`\n\nAvailable commands:\n${known.map(c => `\`${c}\``).join(' ')}`;
    }

    // ── Main Processing Loop ──
    this.turnCount++;
    const requestStartTime = Date.now();
    let toolCallsThisRequest = 0;

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
        onUpdate(`Primary model unavailable. Using **${info?.name || this.activeModelId}** (failover).`);
      }
    }

    let toolTurns = 0;
    const MAX_TOOL_TURNS = 25;

    // ── Tool-Calling Loop ──
    while (response.candidates?.[0]?.content?.parts?.some((part: any) => part.functionCall)) {
      if (toolTurns >= MAX_TOOL_TURNS) {
        const bailMessage = `Reached the tool call limit (${MAX_TOOL_TURNS} rounds). Here's where I am — you may need to break this into smaller steps.`;
        if (onUpdate) onUpdate(bailMessage);
        return bailMessage;
      }
      toolTurns++;

      const allParts = response.candidates[0].content.parts;
      const toolCalls = allParts.filter((part: any) => part.functionCall);
      const toolResults: any[] = [];

      const callPromises = toolCalls.map(async (call: any) => {
        const { name, args } = call.functionCall;
        const startTime = Date.now();
        console.log(`[Brain] Tool: ${name}`, JSON.stringify(args).substring(0, 200));

        eventBus.dispatch(Events.TOOL_CALLED, { name, args }, 'brain');

        try {
          // Route chrome_ prefixed tools to Chrome native MCP adapter
          const output = chromeNativeAdapter.isChromeMCPTool(name)
            ? await chromeNativeAdapter.executeChromeTool(name, args)
            : await handleToolCall(name, args);
          const elapsed = Date.now() - startTime;
          console.log(`[Brain] ${name} completed in ${elapsed}ms`);
          toolCallsThisRequest++;
          this.totalToolCalls++;

          eventBus.dispatch(Events.TOOL_COMPLETED, { name, durationMs: elapsed }, 'brain');

          if (onUpdate) {
            onUpdate(`\`${name}\` completed (${elapsed}ms)`);
          }

          return {
            functionResponse: { name, response: { content: output } },
          };
        } catch (e: any) {
          const elapsed = Date.now() - startTime;
          console.error(`[Brain] ${name} failed in ${elapsed}ms:`, e.message);
          toolCallsThisRequest++;
          this.totalToolCalls++;

          eventBus.dispatch(Events.TOOL_FAILED, { name, error: e.message, durationMs: elapsed }, 'brain');

          if (onUpdate) {
            onUpdate(`\`${name}\` failed: ${e.message}`);
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

    // Track performance
    const requestDuration = Date.now() - requestStartTime;
    this.perf.record({
      timestamp: requestStartTime,
      durationMs: requestDuration,
      toolCalls: toolCallsThisRequest,
      model: this.activeModelId,
    });

    eventBus.dispatch(Events.MESSAGE_PROCESSED, {
      durationMs: requestDuration,
      toolCalls: toolCallsThisRequest,
      model: this.activeModelId,
    }, 'brain');

    // Queue conversation for background self-learning analysis
    if (!message.startsWith('[INTERNAL_SCHEDULER]') && !message.startsWith('[DASHBOARD_IMAGE_UPLOAD]')) {
      this.learner.queueAnalysis(this.history);
    }

    if (onUpdate) onUpdate(finalTexts);
    return finalTexts || '(No response generated)';
  }
}
