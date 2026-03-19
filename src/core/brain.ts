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

  return `# PersonalClaw v11.0 — Autonomous Windows Agent

You are **PersonalClaw**, a locally-hosted autonomous AI agent with full system access on this Windows machine. You are not a chatbot — you are an **operator**. You have ${skills.length} tools, persistent memory, a triple-mode browser, and the ability to spawn sub-agents for parallel work.

**Current Time**: ${timestamp}

---

## Identity

You are sharp, decisive, and technically fluent. You speak like a senior engineer — direct, no filler, no hedging. When you don't know something, you say so and immediately investigate. You own mistakes without deflection. Dry humor is welcome; verbosity is not.

The user may call you "Claw". You prefer action over discussion.

---

## How You Think

For every non-trivial request, follow this internal loop:

1. **Parse** — What exactly is being asked? Check your memory for relevant context. If genuinely ambiguous, ask ONE clarifying question. Otherwise, move.
2. **Plan** — Which tools, in what order? Always take the cheapest path first (read before shell, scrape before screenshot, check status before connecting). Anticipate the most likely failure.
3. **Execute** — Call tools with intention. Read every output carefully before the next step. If something fails, diagnose the root cause before retrying — don't blindly retry.
4. **Verify** — Confirm the task is done. Report the result with evidence (output, data, confirmation).

For simple questions or greetings, skip the framework — just respond naturally.

---

## Your Skills (${skills.length} tools)

### Execution
| Tool | What it does |
|---|---|
| \`execute_powershell\` | Run any PowerShell command. Full OS access. Your primary workhorse. |
| \`manage_files\` | Read, write, append, delete, list files and directories. |
| \`run_python_script\` | Execute Python code locally for data processing, scripting, automation. |
| \`manage_clipboard\` | Read/write the Windows system clipboard. |

### Browser & Web
| Tool | What it does |
|---|---|
| \`browser\` | **Triple-mode browser**: Playwright (default isolated), Native Chrome (real logins via CDP/MCP), Extension Relay (real tabs via PersonalClaw extension). Check \`status\` first to see which modes are available. Scrape first (cheap) → click/type → screenshot only if visual layout matters. |
| \`http_request\` | REST API calls (GET/POST/PUT/DELETE) with headers, auth, and response handling. |

### Intelligence & Diagnostics
| Tool | What it does |
|---|---|
| \`system_info\` | Deep diagnostics: hardware, software, storage, updates, drivers, events, security, battery. Use specific actions. |
| \`manage_processes\` | List, search, kill processes. Start/stop/restart Windows services. Resource hogs. |
| \`network_diagnostics\` | Ping, traceroute, DNS lookups, port checks, connections, ARP, routing tables. |
| \`analyze_vision\` | Capture screenshot → Gemini Vision analysis. Expensive — use only when text tools can't answer. |

### Memory, Automation & Multi-Agent
| Tool | What it does |
|---|---|
| \`manage_long_term_memory\` | Persistent knowledge store. Learn and recall user preferences, jargon, workflows across sessions. |
| \`manage_scheduler\` | Create, list, remove cron-based recurring tasks. |
| \`manage_pdf\` | Extract text, merge, split, rotate, watermark, create PDFs. |
| \`generate_image\` | AI image generation via Gemini Imagen. Returns a viewable URL. |
| \`spawn_agent\` | Spawn a parallel sub-agent worker for independent tasks. Up to 5 concurrent. Workers cannot spawn further agents or perform destructive ops. |

---

## MSP & IT Expertise (Tier 3)

You are a **Tier 3 MSP IT Technician** with deep expertise in:
- **Platforms**: ITGlue, Nilear MTX, Datto RMM, ConnectWise Manage/Automate, HaloPSA, Meraki
- **Methodology**: Root cause analysis over surface-level fixes. Systematic investigation: logs → event viewers → service states → network paths → correlations.
- **Posture**: Read-only by default. Never change configs, restart services, or kill processes without the user's approval unless explicitly instructed otherwise.
${knowledgeBlock}
${Learner.buildContextBlock()}

---

## Communication Style

1. **Concise by default**. Lead with the answer, not the process. Expand only when the user asks "why" or "how".
2. **Rich markdown**. Use **bold** for key info, \`code\` for technical values, tables for structured data, headers to organize long responses. No walls of plain text.
3. **Show evidence**. Include relevant command output, file contents, or data — don't just describe what you found.
4. **One complete response**. Deliver the full answer in one message. Don't split across multiple turns unless the task genuinely requires back-and-forth.
5. **Display images**. If a tool returns an \`output_url\`, display it inline: \`![image](output_url)\`.

---

## Safety

- **Destructive commands** (rm -rf, format, registry deletes, service stops, process kills) require explicit user confirmation. Ask first.
- **Secrets** (.env, API keys, credentials) are never displayed unless the user specifically requests them.
- **External requests** to unknown endpoints require user awareness.
- When in doubt → ask. Better to confirm than to break something.

---

## Meta

- You run **locally on Windows**. PowerShell is your shell. Paths use backslashes.
- You are a **self-learning agent**. Knowledge from past conversations is injected above — use it proactively.
- **Batch tool calls** when possible. Parallelize independent operations.
- If you hit the tool turn limit (25 rounds), summarize progress and outline remaining work.
- Never call the same singleton-resource skill (browser, vision, clipboard) more than once in the same parallel tool batch.`;
}
import { SkillMeta, Skill } from '../types/skill.js';

// ─── Brain Config ────────────────────────────────────────────────────
export interface BrainConfig {
  agentId: string;
  conversationId: string;
  conversationLabel?: string;
  isWorker?: boolean;
  // v12 additions
  systemPromptOverride?: string;   // Full replacement for buildSystemPrompt()
  historyDir?: string;             // Override directory for saveHistory() — FIX-H
  orgId?: string;                  // Set on org agents for SkillMeta
  orgAgentId?: string;
  toolCallInterceptor?: (name: string, args: any, meta: SkillMeta) => Promise<any>; // FIX-S
}

// Exclusive-lock skills that must not run in parallel within the same Brain
const EXCLUSIVE_LOCK_SKILLS = new Set(['browser', 'analyze_vision', 'manage_clipboard']);

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

  // v11 multi-agent fields
  private agentId: string;
  private conversationId: string;
  private conversationLabel: string;
  private isWorker: boolean;
  private aborted: boolean = false;
  private config: BrainConfig;

  // v12 org fields
  private extraSkills: Skill[] = [];
  private toolFilter: ((name: string) => boolean) | null = null;

  constructor(config?: BrainConfig) {
    // Support legacy no-arg construction
    const cfg = config ?? { agentId: 'legacy_default', conversationId: 'legacy_default' };
    this.config = cfg;
    this.agentId = cfg.agentId;
    this.conversationId = cfg.conversationId;
    this.conversationLabel = cfg.conversationLabel ?? cfg.conversationId;
    this.isWorker = cfg.isWorker ?? false;

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
      agentId: this.agentId,
      conversationId: this.conversationId,
    }, 'brain');

    console.log(`[Brain:${this.agentId}] Initialized with model: ${this.activeModelId}`);
    if (!this.isWorker) {
      console.log(`[Brain:${this.agentId}] Failover chain: ${this.failoverChain.join(' → ')}`);
      console.log(`[Brain:${this.agentId}] Skills loaded: ${skills.length}`);
    }
  }

  // ─── v11 Multi-Agent Methods ──────────────────────────────────────

  abort(): void { this.aborted = true; }
  resetAbort(): void { this.aborted = false; }
  isAborted(): boolean { return this.aborted; }

  private buildMeta(): SkillMeta {
    return {
      agentId: this.agentId,
      conversationId: this.conversationId,
      conversationLabel: this.conversationLabel,
      isWorker: this.isWorker,
      orgId: this.config.orgId,
      orgAgentId: this.config.orgAgentId,
    };
  }

  getHistory(): any[] { return this.history; }
  getAgentId(): string { return this.agentId; }
  getConversationId(): string { return this.conversationId; }
  isWorkerAgent(): boolean { return this.isWorker; }

  private createModel(modelId: string): GenerativeModel {
    // Workers never get spawn_agent
    let toolDefs = getToolDefinitions();
    if (this.isWorker) {
      toolDefs = toolDefs.filter((t: any) => {
        const name = t.functionDeclarations[0].name;
        return name !== 'spawn_agent' && name !== 'manage_org'; // FIX-AJ
      });
    }
    // FIX-K: apply custom tool filter (e.g. remove manage_scheduler for org agents)
    if (this.toolFilter) {
      toolDefs = toolDefs.filter((t: any) =>
        this.toolFilter!(t.functionDeclarations[0].name)
      );
    }
    // Include any injected extra tools (e.g. org skills)
    const extraDefs = this.extraSkills.map(s => ({
      functionDeclarations: [{
        name: s.name,
        description: s.description,
        parameters: s.parameters,
      }],
    }));
    const tools = [
      ...toolDefs,
      ...extraDefs,
      ...chromeNativeAdapter.getGeminiToolDefs(),
    ];
    return genAI.getGenerativeModel({ model: modelId, tools: tools as any });
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

  /**
   * Inject additional skills into this Brain instance at runtime.
   * Used by org-agent-runner to add org-specific skills (org_create_ticket, etc.)
   * Must be called before processMessage(). Refreshes the Gemini model tool definitions.
   */
  injectExtraTools(extraSkills: Skill[]): void {
    this.extraSkills = extraSkills;
    this.refreshModel();
  }

  /**
   * Filter tools by name predicate. Called by org-agent-runner to remove
   * manage_scheduler from org agent tool definitions (FIX-K).
   * Must be called before injectExtraTools().
   */
  filterTools(predicate: (name: string) => boolean): void {
    this.toolFilter = predicate;
    this.refreshModel();
  }

  /**
   * Update the system prompt override without resetting conversation history.
   * Used by org-agent-runner to refresh latest memory/tickets between chat messages
   * while preserving the full conversation context (FIX-I).
   */
  updateSystemPromptOverride(newPrompt: string): void {
    if (this.history.length >= 1) {
      this.history[0] = { role: 'user', parts: [{ text: newPrompt }] };
      this.chat = this.model.startChat({ history: this.history });
    }
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

  clearHistory(): void {
    this.initSession();
  }

  private initSession() {
    // Org agents pass a full persona-injected prompt via systemPromptOverride
    let systemPrompt = this.config.systemPromptOverride ?? buildSystemPrompt();

    // Worker system prompt guardrail — only applied when no override is provided
    if (this.isWorker && !this.config.systemPromptOverride) {
      systemPrompt += `\n\n---\n\nWORKER AGENT CONSTRAINTS:
You are a sub-agent worker. Complete your assigned task and return the result.

You must NOT:
- Kill or terminate any processes
- Stop, start, or restart any Windows services
- Delete, clear, or reset any memory or learned preferences
- Modify or delete any scheduled jobs
- Perform any irreversible system operations

If your task requires any of the above, return an explanation of what you would
need to do and ask the parent conversation to confirm before acting.`;
    }

    this.history = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Online. PersonalClaw v11 is ready. What do you need?' }] },
    ];
    this.turnCount = 0;
    this.startNewSession(this.history);
  }

  private saveHistory() {
    try {
      // FIX-H: Use historyDir override for org agents so their session files
      // write to memory/orgs/{orgId}/agents/{agentId}/ not the global memory/ dir
      const dir = this.config.historyDir ?? MEMORY_DIR;
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const filePath = path.join(dir, `${this.sessionId}.json`);
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
          { role: 'model', parts: [{ text: 'Online. PersonalClaw v11 is ready. What do you need?' }] },
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
      `## PersonalClaw v11 Commands`,
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
        ? `\n- **Failovers**: ${Array.from(this.failoverAttempts.entries()).map(([m, c]) => `\`${m}\` failed ${c}x`).join(', ')}`
        : '';

      const barLen = 20;
      const filled = Math.round((tokens / 1_000_000) * barLen);
      const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

      const perfStats = this.perf.getStats();

      return [
        `## PersonalClaw v11 Status`,
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
      agentId: this.agentId,
      conversationId: this.conversationId,
      isWorker: this.isWorker,
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
      const meta = this.buildMeta();

      // Invoke a single tool call with abort check, meta passing, and event emissions
      const invokeTool = async (call: any) => {
        const { name, args } = call.functionCall;
        const startTime = Date.now();
        console.log(`[Brain:${this.agentId}] Tool: ${name}`, JSON.stringify(args).substring(0, 200));

        eventBus.dispatch(Events.TOOL_CALLED, {
          name, args,
          agentId: this.agentId,
          conversationId: this.conversationId,
          conversationLabel: this.conversationLabel,
          isWorker: this.isWorker,
        }, 'brain');

        try {
          // Abort check — allows kill() to cleanly stop in-flight workers
          if (this.aborted) throw new Error('Brain aborted');

          // Check extra skills first (org skills, etc.), then Chrome MCP, then standard skills
          const extraSkill = this.extraSkills.find(s => s.name === name);
          const output = this.config.toolCallInterceptor
            ? await this.config.toolCallInterceptor(name, args, meta)
            : extraSkill
              ? await extraSkill.run(args, meta)
              : chromeNativeAdapter.isChromeMCPTool(name)
                ? await chromeNativeAdapter.executeChromeTool(name, args)
                : await handleToolCall(name, args, meta);
          const elapsed = Date.now() - startTime;
          console.log(`[Brain:${this.agentId}] ${name} completed in ${elapsed}ms`);
          toolCallsThisRequest++;
          this.totalToolCalls++;

          eventBus.dispatch(Events.TOOL_COMPLETED, {
            name, durationMs: elapsed, success: true,
            agentId: this.agentId,
            conversationId: this.conversationId,
            conversationLabel: this.conversationLabel,
            isWorker: this.isWorker,
          }, 'brain');

          if (onUpdate) {
            onUpdate(`\`${name}\` completed (${elapsed}ms)`);
          }

          return {
            functionResponse: { name, response: { content: output } },
          };
        } catch (e: any) {
          const elapsed = Date.now() - startTime;
          console.error(`[Brain:${this.agentId}] ${name} failed in ${elapsed}ms:`, e.message);
          toolCallsThisRequest++;
          this.totalToolCalls++;

          eventBus.dispatch(Events.TOOL_FAILED, {
            name, error: e.message, durationMs: elapsed,
            agentId: this.agentId,
            conversationId: this.conversationId,
            conversationLabel: this.conversationLabel,
            isWorker: this.isWorker,
          }, 'brain');

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
      };

      // Parallel tool dedup — exclusive-lock skills run sequentially to prevent self-deadlock
      const parallelSafe = toolCalls.filter((t: any) => !EXCLUSIVE_LOCK_SKILLS.has(t.functionCall.name));
      const mustSequence = toolCalls.filter((t: any) => EXCLUSIVE_LOCK_SKILLS.has(t.functionCall.name));

      const parallelResults = await Promise.all(parallelSafe.map(invokeTool));
      const sequentialResults: any[] = [];
      for (const call of mustSequence) {
        sequentialResults.push(await invokeTool(call));
      }

      toolResults.push(...parallelResults, ...sequentialResults);

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
      agentId: this.agentId,
      conversationId: this.conversationId,
      isWorker: this.isWorker,
    }, 'brain');

    // Queue conversation for background self-learning analysis
    // FIX-J: also skip org agent heartbeat runs to prevent polluting personal learning profile
    if (
      !message.startsWith('[INTERNAL_SCHEDULER]') &&
      !message.startsWith('[DASHBOARD_IMAGE_UPLOAD]') &&
      !message.startsWith('[HEARTBEAT:')
    ) {
      this.learner.queueAnalysis(this.history);
    }

    if (onUpdate) onUpdate(finalTexts);
    return finalTexts || '(No response generated)';
  }
}
