import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { orgManager } from './org-manager.js';
import { eventBus } from './events.js';

export interface CodeProposal {
  id: string;
  orgId: string;
  agentId: string;
  agentLabel: string;
  relativePath: string;      // FIX-W: relative only — content on disk not here
  explanation: string;
  status: 'pending' | 'approved' | 'rejected';
  isStale: boolean;          // true if pending > 7 days
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  // Content NOT stored here — in workspace/proposals/{id}/original.txt + proposed.txt
}

/**
 * Snapshot git-tracked files from the org's own root directory.
 * Returns absolute paths. Returns empty array if no git repo at rootDir.
 */
export function snapshotGitFiles(rootDir: string): string[] {
  try {
    const output = execSync('git ls-files', {
      cwd: rootDir,
      encoding: 'utf-8',
      timeout: 5000,
    });
    return output.split('\n')
      .filter(Boolean)
      .map(f => path.join(rootDir, f.trim()).replace(/\\/g, '/'));
  } catch {
    console.warn(`[OrgFileGuard] No git repo at ${rootDir} — git protection unavailable.`);
    return [];
  }
}

/**
 * Check if a git repo exists at the given directory.
 */
export function hasGitRepo(rootDir: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd: rootDir, timeout: 3000, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

export function isProtectedFile(absolutePath: string, protectedFiles: string[]): boolean {
  const normalized = absolutePath.replace(/\\/g, '/');
  return protectedFiles.some(f => f.replace(/\\/g, '/') === normalized);
}

export function getProposalsFile(orgId: string): string {
  const org = orgManager.get(orgId);
  if (!org) throw new Error(`Org ${orgId} not found`);
  return path.join(org.orgDir, 'proposals.json');
}

export function loadProposals(orgId: string): CodeProposal[] {
  const file = getProposalsFile(orgId);
  if (!fs.existsSync(file)) return [];
  try {
    const proposals: CodeProposal[] = JSON.parse(fs.readFileSync(file, 'utf-8'));
    // Mark stale proposals (pending > 7 days)
    const now = Date.now();
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    return proposals.map(p => ({
      ...p,
      isStale: p.status === 'pending' && (now - new Date(p.createdAt).getTime()) > SEVEN_DAYS,
    }));
  } catch { return []; }
}

function saveProposals(orgId: string, proposals: CodeProposal[]): void {
  const file = getProposalsFile(orgId);
  const tmp = file + '.tmp';
  // Don't persist the computed isStale field
  const toSave = proposals.map(({ isStale: _, ...p }) => p);
  fs.writeFileSync(tmp, JSON.stringify(toSave, null, 2));
  fs.renameSync(tmp, file);
}

export function getPendingCountForAgent(orgId: string, agentId: string): number {
  return loadProposals(orgId).filter(p => p.agentId === agentId && p.status === 'pending').length;
}

export function createProposal(params: {
  orgId: string;
  agentId: string;
  agentLabel: string;
  absolutePath: string;
  proposedContent: string;
  explanation: string;
}): { success: true; proposal: CodeProposal } | { success: false; error: string } {
  // FIX-T: validate path is within project root
  const relativePath = path.relative(process.cwd(), params.absolutePath).replace(/\\/g, '/');
  if (relativePath.startsWith('..')) {
    return { success: false, error: 'Proposed path is outside the project root.' };
  }

  const proposals = loadProposals(params.orgId);

  // Block if pending proposal already exists for this file
  const conflict = proposals.find(p => p.relativePath === relativePath && p.status === 'pending');
  if (conflict) {
    return {
      success: false,
      error: `A pending proposal already exists for ${relativePath} (ID: ${conflict.id}). Resolve it first.`,
    };
  }

  // FIX-AE: max 3 pending proposals per agent
  const agentPending = proposals.filter(p => p.agentId === params.agentId && p.status === 'pending').length;
  if (agentPending >= 3) {
    return {
      success: false,
      error: `You have ${agentPending} pending proposals already. Wait for the human to review them before submitting more.`,
    };
  }

  // Write content to workspace files (FIX-W: not inline in proposals.json)
  const org = orgManager.get(params.orgId);
  if (!org) return { success: false, error: 'Org not found' };

  const proposalId = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const proposalDir = path.join(org.workspaceDir, 'proposals', proposalId);
  fs.mkdirSync(proposalDir, { recursive: true });

  const originalContent = fs.existsSync(params.absolutePath)
    ? fs.readFileSync(params.absolutePath, 'utf-8')
    : '(file does not exist yet)';

  fs.writeFileSync(path.join(proposalDir, 'original.txt'), originalContent);
  fs.writeFileSync(path.join(proposalDir, 'proposed.txt'), params.proposedContent);

  const proposal: CodeProposal = {
    id: proposalId,
    orgId: params.orgId,
    agentId: params.agentId,
    agentLabel: params.agentLabel,
    relativePath,
    explanation: params.explanation,
    status: 'pending',
    isStale: false,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
  };

  fs.writeFileSync(path.join(proposalDir, 'proposal.json'), JSON.stringify(proposal, null, 2));
  proposals.push(proposal);
  saveProposals(params.orgId, proposals);

  eventBus.dispatch('org:proposal:created', { proposal }, 'org-file-guard');
  return { success: true, proposal };
}

export function getProposalContent(orgId: string, proposalId: string): {
  original: string; proposed: string;
} | null {
  const org = orgManager.get(orgId);
  if (!org) return null;
  const proposalDir = path.join(org.workspaceDir, 'proposals', proposalId);
  try {
    return {
      original: fs.readFileSync(path.join(proposalDir, 'original.txt'), 'utf-8'),
      proposed: fs.readFileSync(path.join(proposalDir, 'proposed.txt'), 'utf-8'),
    };
  } catch { return null; }
}

export function approveProposal(orgId: string, proposalId: string): { success: boolean; error?: string } {
  const proposals = loadProposals(orgId);
  const idx = proposals.findIndex(p => p.id === proposalId);
  if (idx === -1) return { success: false, error: 'Proposal not found' };
  if (proposals[idx].status !== 'pending') return { success: false, error: `Already ${proposals[idx].status}` };

  const relativePath = proposals[idx].relativePath;
  // FIX-T: re-validate
  if (relativePath.startsWith('..')) return { success: false, error: 'Invalid path.' };

  const content = getProposalContent(orgId, proposalId);
  if (!content) return { success: false, error: 'Proposal content files not found.' };

  const absolutePath = path.resolve(process.cwd(), relativePath);
  const dir = path.dirname(absolutePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(absolutePath, content.proposed, 'utf-8');

  proposals[idx] = { ...proposals[idx], status: 'approved', resolvedAt: new Date().toISOString(), resolvedBy: 'human' };
  saveProposals(orgId, proposals);
  eventBus.dispatch('org:proposal:approved', { proposal: proposals[idx] }, 'org-file-guard');
  return { success: true };
}

export function rejectProposal(orgId: string, proposalId: string): { success: boolean; error?: string } {
  const proposals = loadProposals(orgId);
  const idx = proposals.findIndex(p => p.id === proposalId);
  if (idx === -1) return { success: false, error: 'Proposal not found' };
  if (proposals[idx].status !== 'pending') return { success: false, error: `Already ${proposals[idx].status}` };
  proposals[idx] = { ...proposals[idx], status: 'rejected', resolvedAt: new Date().toISOString(), resolvedBy: 'human' };
  saveProposals(orgId, proposals);
  eventBus.dispatch('org:proposal:rejected', { proposal: proposals[idx] }, 'org-file-guard');
  return { success: true };
}

/**
 * Reset in_progress tickets with no active runner on startup (FIX-AF).
 * Called from org-manager loadAll() after all orgs are loaded.
 */
export function resetStaleInProgressTickets(activeRunKeys: Set<string>): void {
  // This is called by index.ts after orgManager loads and passes the empty runningAgents set
  // (all empty on startup — no agents are running yet)
  // Import orgTaskBoard lazily to avoid circular dep
  import('./org-task-board.js').then(({ orgTaskBoard }) => {
    import('./org-manager.js').then(({ orgManager }) => {
      for (const org of orgManager.list()) {
        const tickets = orgTaskBoard.list(org.id, { status: 'in_progress' });
        for (const ticket of tickets) {
          const runKey = ticket.assigneeId ? `${org.id}:${ticket.assigneeId}` : null;
          if (!runKey || !activeRunKeys.has(runKey)) {
            orgTaskBoard.update(org.id, ticket.id, {
              status: 'open',
              historyEntry: 'reset to open — server restarted mid-run',
              byLabel: 'System',
              callerAgentId: 'system',
            }).catch(() => {});
          }
        }
      }
    });
  });
}
