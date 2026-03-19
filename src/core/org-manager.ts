import * as fs from 'fs';
import * as path from 'path';
import { eventBus, Events } from './events.js';
import { orgTaskBoard } from './org-task-board.js';

const ORGS_DIR = path.join(process.cwd(), 'orgs');
const MAX_ORGS = 10;

import { snapshotGitFiles } from './org-file-guard.js';

export type AutonomyLevel = 'full' | 'approval_required';

export type ProtectionMode = 'none' | 'git' | 'manual' | 'both';

export interface AgentHeartbeat {
  cron: string;
  enabled: boolean;
}

export interface OrgAgent {
  id: string;
  orgId: string;
  name: string;
  role: string;
  personality: string;
  responsibilities: string;
  goals: string[];
  autonomyLevel: AutonomyLevel;
  heartbeat: AgentHeartbeat;
  paused: boolean;
  reportingTo: string | null;
  createdAt: string;
  lastRunAt: string | null;
  lastRunStatus: 'completed' | 'failed' | 'skipped' | null;
}

export interface Org {
  id: string;
  name: string;
  mission: string;
  rootDir: string;
  orgDir: string;
  workspaceDir: string;
  createdAt: string;
  paused: boolean;
  agents: OrgAgent[];
  protection: {
    mode: ProtectionMode;
    gitFiles: string[];
    manualPaths: string[];
    lastUpdated: string;
  };
}

class OrgManager {
  private orgs: Map<string, Org> = new Map();

  constructor() {
    this.loadAll();
  }

  private orgFile(orgId: string): string {
    return path.join(ORGS_DIR, orgId, 'org.json');
  }

  private loadAll(): void {
    // FIX-Q: migrate from old memory/orgs/ if exists
    const legacyDir = path.join(process.cwd(), 'memory', 'orgs');
    if (fs.existsSync(legacyDir) && !fs.existsSync(ORGS_DIR)) {
      console.log('[OrgManager] Migrating orgs from memory/orgs/ to orgs/...');
      fs.mkdirSync(path.dirname(ORGS_DIR), { recursive: true });
      fs.renameSync(legacyDir, ORGS_DIR);
    }
    if (!fs.existsSync(ORGS_DIR)) return;
    for (const d of fs.readdirSync(ORGS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('_deleted_'))) {
      const file = path.join(ORGS_DIR, d.name, 'org.json');
      if (!fs.existsSync(file)) continue;
      try {
        const org = JSON.parse(fs.readFileSync(file, 'utf-8'));
        // Back-fill fields for orgs created before v12.1
        if (!org.orgDir) org.orgDir = path.join(ORGS_DIR, d.name);
        if (!org.workspaceDir) org.workspaceDir = org.rootDir;
        if (!org.protection) {
          org.protection = {
            mode: (org.protectedFiles?.length > 0) ? 'git' : 'none',
            gitFiles: org.protectedFiles ?? [],
            manualPaths: [],
            lastUpdated: new Date().toISOString(),
          };
          delete org.protectedFiles;
        }
        this.orgs.set(org.id, org);
      } catch (e) { console.error(`[OrgManager] Failed to load ${file}:`, e); }
    }
    console.log(`[OrgManager] Loaded ${this.orgs.size} organisations.`);
  }

  private persist(org: Org): void {
    const dir = org.orgDir ?? path.join(ORGS_DIR, org.id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'org.json');
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(org, null, 2));
    fs.renameSync(tmp, file);
  }

  list(): Org[] {
    return Array.from(this.orgs.values());
  }

  get(orgId: string): Org | null {
    return this.orgs.get(orgId) ?? null;
  }

  create(params: {
    name: string; mission: string; rootDir?: string;
    protectionMode?: ProtectionMode; manualPaths?: string[];
  }): Org {
    if (this.orgs.size >= MAX_ORGS) throw new Error(`Maximum of ${MAX_ORGS} organisations reached.`);

    const shortId = Math.random().toString(36).slice(2, 8);
    const safeName = (params.name || 'org')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40);
    const dirName = `${safeName}-${shortId}`;
    const orgDir = path.join(ORGS_DIR, dirName);
    const workspaceDir = path.join(orgDir, 'workspace');

    fs.mkdirSync(workspaceDir, { recursive: true });

    const mode: ProtectionMode = params.protectionMode ?? 'git';
    const rootDir = workspaceDir; // rootDir = workspaceDir on create
    const gitFiles = (mode === 'git' || mode === 'both')
      ? snapshotGitFiles(rootDir)
      : [];
    const manualPaths = (mode === 'manual' || mode === 'both')
      ? (params.manualPaths ?? [])
      : [];

    const org: Org = {
      id: `org_${Date.now()}`,
      name: params.name,
      mission: params.mission,
      rootDir: workspaceDir,
      orgDir,
      workspaceDir,
      createdAt: new Date().toISOString(),
      paused: false,
      agents: [],
      protection: {
        mode,
        gitFiles,
        manualPaths,
        lastUpdated: new Date().toISOString(),
      },
    };

    this.orgs.set(org.id, org);
    this.persist(org);
    this.ensureSharedMemory(org.id);
    eventBus.dispatch(Events.ORG_CREATED, { org }, 'org-manager');
    return org;
  }

  update(orgId: string, updates: Partial<Pick<Org, 'name' | 'mission' | 'rootDir' | 'paused'>>): Org {
    const org = this.orgs.get(orgId);
    if (!org) throw new Error(`Org ${orgId} not found`);
    if (updates.rootDir && !fs.existsSync(updates.rootDir)) {
      throw new Error(`Root directory does not exist: ${updates.rootDir}`);
    }
    Object.assign(org, updates);
    this.persist(org);
    const event = updates.paused !== undefined
      ? (updates.paused ? Events.ORG_PAUSED : Events.ORG_RESUMED)
      : Events.ORG_UPDATED;
    eventBus.dispatch(event, { org }, 'org-manager');
    return org;
  }

  delete(orgId: string): void {
    const org = this.orgs.get(orgId);
    if (!org) throw new Error(`Org ${orgId} not found`);
    this.orgs.delete(orgId);
    // FIX: soft delete — rename to prevent accidental data loss
    const dir = path.join(ORGS_DIR, orgId);
    const archive = path.join(ORGS_DIR, `_deleted_${orgId}_${Date.now()}`);
    if (fs.existsSync(dir)) fs.renameSync(dir, archive);
    eventBus.dispatch(Events.ORG_DELETED, { orgId, name: org.name }, 'org-manager');
  }

  addAgent(orgId: string, params: {
    name: string; role: string; personality: string; responsibilities: string;
    goals: string[]; autonomyLevel: AutonomyLevel; heartbeatCron: string;
    reportingTo: string | null; allowDuplicateRole?: boolean;
  }): OrgAgent {
    const org = this.orgs.get(orgId);
    if (!org) throw new Error(`Org ${orgId} not found`);
    if (!params.allowDuplicateRole) {
      const existing = org.agents.find(a => a.role.toLowerCase() === params.role.toLowerCase());
      if (existing) throw new Error(`Agent with role "${params.role}" already exists (${existing.name}). Pass allowDuplicateRole: true to override.`);
    }
    const agent: OrgAgent = {
      id: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      orgId, name: params.name, role: params.role, personality: params.personality,
      responsibilities: params.responsibilities, goals: params.goals,
      autonomyLevel: params.autonomyLevel, heartbeat: { cron: params.heartbeatCron, enabled: true },
      paused: false, reportingTo: params.reportingTo,
      createdAt: new Date().toISOString(), lastRunAt: null, lastRunStatus: null,
    };
    org.agents.push(agent);
    this.persist(org);
    this.ensureAgentDirs(orgId, agent.id);
    eventBus.dispatch(Events.ORG_AGENT_CREATED, { agent, orgId }, 'org-manager');
    return agent;
  }

  updateAgent(orgId: string, agentId: string, updates: Partial<Omit<OrgAgent, 'id' | 'orgId' | 'createdAt'>>): OrgAgent {
    const org = this.orgs.get(orgId);
    if (!org) throw new Error(`Org ${orgId} not found`);
    const idx = org.agents.findIndex(a => a.id === agentId);
    if (idx === -1) throw new Error(`Agent ${agentId} not found in org ${orgId}`);
    Object.assign(org.agents[idx], updates);
    this.persist(org);
    const event = updates.paused !== undefined
      ? (updates.paused ? Events.ORG_AGENT_PAUSED : Events.ORG_AGENT_RESUMED)
      : Events.ORG_AGENT_UPDATED;
    eventBus.dispatch(event, { agent: org.agents[idx], orgId }, 'org-manager');
    return org.agents[idx];
  }

  deleteAgent(orgId: string, agentId: string): void {
    const org = this.orgs.get(orgId);
    if (!org) throw new Error(`Org ${orgId} not found`);
    org.agents = org.agents.filter(a => a.id !== agentId);
    this.persist(org);
    eventBus.dispatch(Events.ORG_AGENT_DELETED, { agentId, orgId }, 'org-manager');
  }

  recordRun(orgId: string, agentId: string, status: 'completed' | 'failed' | 'skipped'): void {
    const org = this.orgs.get(orgId);
    if (!org) return;
    const agent = org.agents.find(a => a.id === agentId);
    if (!agent) return;
    agent.lastRunAt = new Date().toISOString();
    agent.lastRunStatus = status;
    this.persist(org);
  }

  // Directory helpers
  getAgentMemoryDir(orgId: string, agentId: string): string {
    const org = this.orgs.get(orgId);
    return path.join(org?.orgDir ?? path.join(ORGS_DIR, orgId), 'agents', agentId);
  }
  getSharedMemoryFile(orgId: string): string {
    const org = this.orgs.get(orgId);
    return path.join(org?.orgDir ?? path.join(ORGS_DIR, orgId), 'shared_memory.json');
  }
  getAgentMemoryFile(orgId: string, agentId: string): string {
    return path.join(this.getAgentMemoryDir(orgId, agentId), 'memory.json');
  }
  getRunLogFile(orgId: string, agentId: string): string {
    return path.join(this.getAgentMemoryDir(orgId, agentId), 'runs.jsonl');
  }
  getBrowserDataDir(orgId: string): string {
    const org = this.orgs.get(orgId);
    return path.join(org?.orgDir ?? path.join(ORGS_DIR, orgId), 'browser_data');
  }

  updateProtection(orgId: string, params: {
    mode?: ProtectionMode;
    manualPaths?: string[];
    refreshGit?: boolean;
  }): Org {
    const org = this.orgs.get(orgId);
    if (!org) throw new Error(`Org ${orgId} not found`);

    if (params.mode !== undefined) org.protection.mode = params.mode;
    if (params.manualPaths !== undefined) org.protection.manualPaths = params.manualPaths;

    if (params.refreshGit || (params.mode && (params.mode === 'git' || params.mode === 'both'))) {
      org.protection.gitFiles = snapshotGitFiles(org.rootDir);
      console.log(`[OrgManager] Git snapshot refreshed for ${org.name}: ${org.protection.gitFiles.length} files`);
    }

    org.protection.lastUpdated = new Date().toISOString();
    this.persist(org);
    eventBus.dispatch(Events.ORG_UPDATED, { org }, 'org-manager');
    return org;
  }

  getProtectedFiles(orgId: string): string[] {
    const org = this.orgs.get(orgId);
    if (!org) return [];
    const { mode, gitFiles, manualPaths } = org.protection;
    if (mode === 'none') return [];
    if (mode === 'git') return gitFiles;
    if (mode === 'manual') return this.expandManualPaths(org.rootDir, manualPaths);
    // 'both'
    return [...gitFiles, ...this.expandManualPaths(org.rootDir, manualPaths)];
  }

  private expandManualPaths(rootDir: string, manualPaths: string[]): string[] {
    const result: string[] = [];
    for (const p of manualPaths) {
      const abs = path.isAbsolute(p) ? p : path.join(rootDir, p);
      if (!fs.existsSync(abs)) continue;
      const stat = fs.statSync(abs);
      if (stat.isFile()) {
        result.push(abs);
      } else if (stat.isDirectory()) {
        const walk = (dir: string) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else result.push(full);
          }
        };
        walk(abs);
      }
    }
    return result;
  }

  private ensureAgentDirs(orgId: string, agentId: string): void {
    const dir = this.getAgentMemoryDir(orgId, agentId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const memFile = this.getAgentMemoryFile(orgId, agentId);
    if (!fs.existsSync(memFile)) {
      fs.writeFileSync(memFile, JSON.stringify({
        agentId, orgId,
        lastUpdated: new Date().toISOString(),
        notes: '',
        currentPriorities: [],
        pendingActions: [],
        custom: {},
      }, null, 2));
    }
  }

  private ensureSharedMemory(orgId: string): void {
    const file = this.getSharedMemoryFile(orgId);
    if (!fs.existsSync(file)) {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ orgId, lastUpdated: new Date().toISOString(), companyState: '', decisions: [], announcements: [], custom: {} }, null, 2));
      fs.renameSync(tmp, file);
    }
  }
}

export const orgManager = new OrgManager();
