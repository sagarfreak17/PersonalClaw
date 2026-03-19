import * as fs from 'fs';
import * as path from 'path';
import { orgManager, OrgAgent, Org } from './org-manager.js';
import { orgTaskBoard } from './org-task-board.js';
import { orgSkills } from '../skills/org-skills.js';
import { eventBus, Events } from './events.js';
import { getToolDefinitions } from '../skills/index.js';
import { isProtectedFile } from './org-file-guard.js';

const ORGS_DIR = path.join(process.cwd(), 'orgs');

const runningAgents: Set<string> = new Set();
const runningCounts: Map<string, number> = new Map();
const MAX_CONCURRENT_PER_ORG = 5;
const orgQueues: Map<string, Array<() => void>> = new Map();

export function getRunningCount(orgId: string): number {
  return runningCounts.get(orgId) ?? 0;
}

function incrementRunning(orgId: string) {
  runningCounts.set(orgId, (runningCounts.get(orgId) ?? 0) + 1);
}

function decrementRunning(orgId: string) {
  const count = Math.max(0, (runningCounts.get(orgId) ?? 1) - 1);
  runningCounts.set(orgId, count);
  const queue = orgQueues.get(orgId);
  if (queue?.length && count < MAX_CONCURRENT_PER_ORG) queue.shift()!();
}

function waitForSlot(orgId: string): Promise<void> {
  if (getRunningCount(orgId) < MAX_CONCURRENT_PER_ORG) return Promise.resolve();
  return new Promise(resolve => {
    if (!orgQueues.has(orgId)) orgQueues.set(orgId, []);
    orgQueues.get(orgId)!.push(resolve);
  });
}

const chatBrains: Map<string, any> = new Map();
const chatBrainLastActivity: Map<string, number> = new Map();
const CHAT_BRAIN_IDLE_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [chatId, lastActivity] of chatBrainLastActivity.entries()) {
    if (now - lastActivity > CHAT_BRAIN_IDLE_MS) {
      chatBrains.delete(chatId);
      chatBrainLastActivity.delete(chatId);
      console.log(`[OrgAgentRunner] Idle chat Brain cleaned: ${chatId}`);
    }
  }
}, 5 * 60 * 1000);

// Per-run notification counter — reset each run
export const runNotifyCounters: Map<string, number> = new Map(); // key: runId
export const activeRunIds: Map<string, string> = new Map(); // key: agentId -> runId

export function incrementNotifyCounter(runId: string): boolean {
  const count = (runNotifyCounters.get(runId) ?? 0) + 1;
  runNotifyCounters.set(runId, count);
  return count <= 5; // return false when over limit
}

// ─── System Prompt Builder ────────────────────────────────────────

function buildOrgAgentSystemPrompt(org: Org, agent: OrgAgent): string {
  let agentMemory = 'No memory yet — this is your first run.';
  try {
    const memFile = orgManager.getAgentMemoryFile(org.id, agent.id);
    if (fs.existsSync(memFile)) {
      agentMemory = JSON.stringify(JSON.parse(fs.readFileSync(memFile, 'utf-8')), null, 2);
    }
  } catch { /* ignore */ }

  let sharedMemory = 'No shared memory yet.';
  try {
    const sharedFile = orgManager.getSharedMemoryFile(org.id);
    if (fs.existsSync(sharedFile)) {
      sharedMemory = JSON.stringify(JSON.parse(fs.readFileSync(sharedFile, 'utf-8')), null, 2);
    }
  } catch { /* ignore */ }

  const myTickets = orgTaskBoard.list(org.id, { assigneeId: agent.id });
  const openTickets = myTickets.filter(t => t.status !== 'done');
  const ticketSummary = openTickets.length > 0
    ? openTickets.map(t => `- [${t.priority.toUpperCase()}] ${t.title} (${t.status}) — ID: ${t.id}`).join('\n')
    : 'No tickets assigned to you.';

  const colleagues = org.agents
    .filter(a => a.id !== agent.id)
    .map(a => `- ${a.name} (${a.role}) — ID: ${a.id}`)
    .join('\n') || 'None yet.';

  // Load unread comments on files this agent created
  let commentsFeedback = '';
  try {
    const roleSlug = agent.role.toLowerCase().replace(/\s+/g, '-');
    const agentLabel = `${agent.name} (${agent.role})`;
    const walkForComments = (dir: string, rel: string): string[] => {
      const results: string[] = [];
      if (!fs.existsSync(dir)) return results;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.endsWith('.comments.json')) {
          const targetFile = entry.name.replace('.comments.json', '');
          const targetLC = targetFile.toLowerCase();
          // Check if this file belongs to this agent
          if (targetLC.startsWith(roleSlug + '-') || targetLC.includes('/' + roleSlug + '-')) {
            const commentsPath = path.join(dir, entry.name);
            const comments = JSON.parse(fs.readFileSync(commentsPath, 'utf-8'));
            const unread = comments.filter((c: any) => !c.read);
            if (unread.length > 0) {
              results.push(`File: ${rel ? rel + '/' : ''}${targetFile}\n${unread.map((c: any) => `  - [${c.author}] ${c.text}`).join('\n')}`);
              // Mark as read
              for (const c of comments) c.read = true;
              fs.writeFileSync(commentsPath, JSON.stringify(comments, null, 2));
            }
          }
        } else if (entry.isDirectory() && entry.name !== 'proposals') {
          results.push(...walkForComments(path.join(dir, entry.name), (rel ? rel + '/' : '') + entry.name));
        }
      }
      return results;
    };
    const commentItems = walkForComments(org.workspaceDir, '');
    if (commentItems.length > 0) {
      commentsFeedback = `\n\n## Human Comments on Your Files\nThe human owner has left feedback on files you created. Review and act on these:\n${commentItems.join('\n\n')}`;
    }
  } catch { /* ignore comment loading errors */ }

  const now = new Date().toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });

  return `# ${org.name} — AI Agent System

You are **${agent.name}**, the **${agent.role}** at ${org.name}.

**Current Time**: ${now}

---

## Your Organisation
**Name**: ${org.name}
**Mission**: ${org.mission}
**Root Directory**: ${org.rootDir}

## Your Colleagues
${colleagues}

---

## Your Identity
**Role**: ${agent.role}
**Personality**: ${agent.personality}

## Your Responsibilities
${agent.responsibilities}

## Your Goals
${agent.goals.map(g => `- ${g}`).join('\n')}

---

## Your Memory (from your last session)
\`\`\`json
${agentMemory}
\`\`\`

## Shared Org Memory (visible to all agents)
\`\`\`json
${sharedMemory}
\`\`\`

## Your Current Task Queue
${ticketSummary}

---

## How You Work

You have just been activated. Follow this sequence every single run:

1. **Read your memory** — use \`org_read_agent_memory\` to recall what you were working on.
2. **Check shared memory** — use \`org_read_shared_memory\` for company-wide context.
3. **Review your tickets** — use \`org_list_tickets\` with \`assignedToMe: true\`.
4. **Create tickets BEFORE doing any work** — Before executing any task, create a ticket for it using \`org_create_ticket\`. Assign it to yourself (use your own agent ID as \`assigneeId\`). Move it to \`in_progress\` using \`org_update_ticket\`. Complete the work. Then mark it \`done\`. This applies to ALL work — research, writing documents, delegating, strategy, anything. No work without a ticket.
5. **Do the work** — based on your goals, responsibilities, and task queue, do the most important work. Use all available tools including file system, browser, code execution, and org tools.
6. **Update tickets** — use \`org_update_ticket\` to mark progress or completion.
7. **Submit major outputs for review** — After completing significant work — writing a strategy document, making a hiring decision, creating a pricing plan, or any output meant for the human owner — call \`org_submit_for_review\` with the content and type. Major decisions that affect the business direction require \`requiresApproval: true\`. Routine outputs like status reports use \`requiresApproval: false\`.
8. **Delegate if needed** — use \`org_delegate\` to assign work to colleagues.
9. **Write a report** — use \`org_write_report\` to document what you did this session.
10. **Notify if important** — use \`org_notify\` for anything the human owner should know.
11. **Save your memory** — ALWAYS call \`org_write_agent_memory\` at the end. Never skip this.

## Autonomy
${agent.autonomyLevel === 'full'
  ? 'You have **full autonomy**. Act on your own judgment. Do not ask for confirmation — just do the work.'
  : 'You require **approval for destructive or external operations**. For anything irreversible, write your intent to shared memory and notify the human owner before acting.'}

## Browser Usage
If you use the browser, your session is isolated to this organisation — your logins and cookies
are separate from other agents and from the human's browser sessions.
Your browser profile is stored at: ${orgManager.getBrowserDataDir(org.id)}

To connect the browser with your org profile, use:
  browser(action="status") to see current mode
The browser skill will automatically use your org-specific profile.

## Working in the Org Root Directory
Your primary workspace is \`${org.rootDir}\`. You have full read/write access here.

## Important Rules
- Never impersonate other agents or write on their behalf.
- Never modify another agent's private memory file.
- Never delete files from the org root without explicit human instruction.
- You do NOT have access to \`execute_powershell\` or \`run_python_script\` — these tools are
  disabled for org agents to protect the codebase. Use \`org_propose_code_change\` for code
  changes and \`manage_files\` for reading project files.
- Call \`org_write_agent_memory\` at the end of EVERY run — even if you did nothing.
- Keep your reports concise and actionable.${commentsFeedback}`;
}

// ─── Brain Factory & Interceptors ─────────────────────────────────

export interface FileActivityEntry {
  action: 'write' | 'delete' | 'create';
  path: string;
  agentId: string;
  agentLabel: string;
  timestamp: string;
}

async function orgAwareHandleToolCall(
  name: string, args: any, meta: any,
  org: Org, agent: OrgAgent, activityLog: FileActivityEntry[]
): Promise<any> {
  const { handleToolCall } = await import('../skills/index.js');

  // Check org skills first — these are not registered in the global skill index
  const orgSkill = orgSkills.find(s => s.name === name);
  if (orgSkill) {
    return orgSkill.run(args, meta);
  }

  const WRITE_SKILLS = new Set(['manage_files', 'manage_pdf']);
  const WRITE_ACTIONS = new Set(['write', 'append', 'create', 'merge', 'split', 'rotate', 'watermark', 'extract_pages']);

  if (WRITE_SKILLS.has(name) && WRITE_ACTIONS.has(args.action)) {
    const targetPath = path.resolve(args.path ?? args.output_path ?? '');
    const protectedFiles = orgManager.getProtectedFiles(org.id);
    if (org.protection.mode !== 'none' && isProtectedFile(targetPath, protectedFiles)) {
      return {
        intercepted: true,
        success: false,
        message: `This is a protected file. Use \`org_propose_code_change\` to submit a proposal. Continue with other tasks.`,
      };
    }
    // Not protected — log write activity
    activityLog.push({
      action: args.action === 'create' ? 'create' : 'write',
      path: targetPath,
      agentId: agent.id,
      agentLabel: `${agent.name} (${agent.role})`,
      timestamp: new Date().toISOString(),
    });
  }
  return handleToolCall(name, args, meta);
}

const MEMORY_BLOAT_THRESHOLD = 50 * 1024;

async function checkAndSummariseMemory(orgId: string, agentId: string): Promise<void> {
  const memFile = orgManager.getAgentMemoryFile(orgId, agentId);
  if (!fs.existsSync(memFile) || fs.statSync(memFile).size < MEMORY_BLOAT_THRESHOLD) return;
  console.log(`[OrgAgentRunner] Memory for ${agentId} > 50KB. Summarising...`);
  try {
    const { Brain } = await import('./brain.js');
    const current = JSON.parse(fs.readFileSync(memFile, 'utf-8'));
    const summaryBrain = new Brain({ agentId: `summariser_${agentId}`, conversationId: `summarise_${Date.now()}`, isWorker: true });
    const summary = await summaryBrain.processMessage(
      `Summarise this agent memory into concise JSON with same structure, keeping only the most important recent notes, top 3 priorities, top 3 pending actions. Return only valid JSON.\n\n${JSON.stringify(current, null, 2)}`
    );
    const summarised = JSON.parse(summary.replace(/```json|```/g, '').trim());
    const tmp = memFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ...summarised, lastSummarisedAt: new Date().toISOString() }, null, 2));
    fs.renameSync(tmp, memFile);
  } catch (e) { console.warn(`[OrgAgentRunner] Memory summarisation failed for ${agentId}:`, e); }
}

async function createOrgAgentBrain(org: Org, agent: OrgAgent, activityLog: FileActivityEntry[]): Promise<any> {
  // FIX-A: Lazy dynamic import breaks circular dependency
  const { Brain } = await import('./brain.js');

  const systemPromptOverride = buildOrgAgentSystemPrompt(org, agent);
  const historyDir = orgManager.getAgentMemoryDir(org.id, agent.id);

  const brain = new Brain({
    agentId: `org_${agent.id}`,
    conversationId: `org_${org.id}_${agent.id}`,
    conversationLabel: `${agent.name} (${agent.role})`,
    isWorker: false,
    systemPromptOverride,
    historyDir,
    orgId: org.id,
    orgAgentId: agent.id,
    toolCallInterceptor: (name: string, args: any, meta: any) =>
      orgAwareHandleToolCall(name, args, meta, org, agent, activityLog),
  });

  // FIX-Y: filter powershell + python. FIX-K: filter manage_scheduler.
  brain.filterTools((name: string) =>
    name !== 'manage_scheduler' &&
    name !== 'execute_powershell' &&
    name !== 'run_python_script'
  );

  // Inject org-specific skills
  brain.injectExtraTools(orgSkills);

  return brain;
}

// ─── Main Run Function ────────────────────────────────────────────

export interface OrgAgentRunResult {
  runId: string;
  agentId: string;
  orgId: string;
  trigger: 'cron' | 'event' | 'manual' | 'chat';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  response: string;
  skipped: boolean;
  skipReason?: string;
}

export async function runOrgAgent(
  orgId: string, agentId: string,
  trigger: 'cron' | 'event' | 'manual' | 'chat',
  messageOverride?: string, chatId?: string
): Promise<OrgAgentRunResult> {
  const runKey = `${orgId}:${agentId}`;
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  const startedAt = new Date().toISOString();

  if (trigger !== 'chat' && runningAgents.has(runKey)) {
    orgManager.recordRun(orgId, agentId, 'skipped');
    eventBus.dispatch(Events.ORG_AGENT_HEARTBEAT_SKIPPED, { orgId, agentId, trigger }, 'org-agent-runner');
    return { runId, agentId, orgId, trigger, startedAt, completedAt: startedAt, durationMs: 0, response: '', skipped: true, skipReason: 'Still running from previous heartbeat.' };
  }

  const org = orgManager.get(orgId);
  if (!org) throw new Error(`Org ${orgId} not found`);
  const agent = org.agents.find(a => a.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);
  if (agent.paused || org.paused) {
    return { runId, agentId, orgId, trigger, startedAt, completedAt: startedAt, durationMs: 0, response: '', skipped: true, skipReason: agent.paused ? 'Agent paused.' : 'Org paused.' };
  }

  if (trigger !== 'chat') {
    await waitForSlot(orgId);
    runningAgents.add(runKey);
    incrementRunning(orgId);
  }

  activeRunIds.set(agentId, runId);
  const startMs = Date.now();
  const activityLog: FileActivityEntry[] = [];
  await checkAndSummariseMemory(orgId, agentId);

  eventBus.dispatch(Events.ORG_AGENT_RUN_STARTED, { runId, agentId, orgId, agentName: agent.name, role: agent.role, trigger }, 'org-agent-runner');

  try {
    let brain: any;
    if (trigger === 'chat' && chatId) {
      if (!chatBrains.has(chatId)) {
        brain = await createOrgAgentBrain(org, agent, activityLog);
        chatBrains.set(chatId, brain);
      } else {
        brain = chatBrains.get(chatId);
        brain.updateSystemPromptOverride(buildOrgAgentSystemPrompt(org, agent));
      }
      chatBrainLastActivity.set(chatId, Date.now());
    } else {
      brain = await createOrgAgentBrain(org, agent, activityLog);
    }

    const prompt = messageOverride ?? `[HEARTBEAT:${trigger.toUpperCase()}] You have been activated. Begin your run now.`;
    const response = await brain.processMessage(prompt);
    const durationMs = Date.now() - startMs;
    const completedAt = new Date().toISOString();

    if (trigger !== 'chat') {
      const logFile = orgManager.getRunLogFile(orgId, agentId);
      fs.appendFileSync(logFile, JSON.stringify({
        runId, trigger, startedAt, completedAt, durationMs,
        summary: response.substring(0, 300),
        fileActivity: activityLog,
        // Token estimate: rough heuristic — 4 chars ≈ 1 token
        estimatedTokens: Math.round(response.length / 4),
      }) + '\n');
      orgManager.recordRun(orgId, agentId, 'completed');
    }

    if (activityLog.length > 0) {
      eventBus.dispatch('org:agent:file_activity', { orgId, agentId, agentName: agent.name, role: agent.role, runId, activity: activityLog }, 'org-agent-runner');
    }

    eventBus.dispatch(Events.ORG_AGENT_RUN_COMPLETED, { runId, agentId, orgId, agentName: agent.name, role: agent.role, durationMs, trigger }, 'org-agent-runner');
    return { runId, agentId, orgId, trigger, startedAt, completedAt, durationMs, response, skipped: false };

  } catch (err: any) {
    const durationMs = Date.now() - startMs;
    if (trigger !== 'chat') orgManager.recordRun(orgId, agentId, 'failed');
    eventBus.dispatch(Events.ORG_AGENT_RUN_FAILED, { runId, agentId, orgId, error: err.message, trigger }, 'org-agent-runner');
    throw err;
  } finally {
    if (trigger !== 'chat') {
      runningAgents.delete(runKey);
      decrementRunning(orgId);
    }
    runNotifyCounters.delete(runId);
    activeRunIds.delete(agentId);
  }
}

// FIX-I: Clean up persistent chat Brain when pane is closed
export function closeChatSession(chatId: string): void {
  chatBrains.delete(chatId);
  console.log(`[OrgAgentRunner] Chat session closed: ${chatId}`);
}

export function isAgentRunning(orgId: string, agentId: string): boolean {
  return runningAgents.has(`${orgId}:${agentId}`);
}

export function getAllOrgConversationIds(): string[] {
  const ids: string[] = [];
  for (const org of orgManager.list()) {
    for (const agent of org.agents) ids.push(`org_${org.id}_${agent.id}`);
  }
  return ids;
}

export function getRunningAgentsSet(): Set<string> {
  return runningAgents; // FIX-AF: exposed for stale ticket reset on startup
}
