import { useState, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import type { Blocker, CodeProposal, OrgAgent } from '../types/org';
import { OrgChart } from './OrgChart';
import { WorkspaceBrowser } from './WorkspaceBrowser';

interface BoardOfDirectorsProps { orgId: string; orgName: string; agents: OrgAgent[]; socket: Socket; }

export function BoardOfDirectors({ orgId, orgName, agents, socket }: BoardOfDirectorsProps) {
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [proposals, setProposals] = useState<CodeProposal[]>([]);
  const [agentRuns, setAgentRuns] = useState<Record<string, any[]>>({});
  const [resolutionText, setResolutionText] = useState<Record<string, string>>({});

  useEffect(() => {
    socket.emit('org:blockers:list', { orgId });
    socket.emit('org:proposals:list', { orgId });
    agents.forEach(a => socket.emit('org:agent:activity', { orgId, agentId: a.id }));

    const hb = (d: any) => { if (d.orgId === orgId) setBlockers(d.blockers ?? []); };
    const hp = (d: any) => { if (d.orgId === orgId) setProposals(d.proposals ?? []); };
    const hbu = (d: any) => { if (d.orgId === orgId) socket.emit('org:blockers:list', { orgId }); };
    const hpu = (d: any) => { if (d.orgId === orgId) socket.emit('org:proposals:list', { orgId }); };
    const ha = (d: any) => { if (d.orgId === orgId) setAgentRuns(prev => ({ ...prev, [d.agentId]: d.runs ?? [] })); };

    socket.on('org:blockers:list', hb); socket.on('org:proposals:list', hp);
    socket.on('org:blocker:update', hbu); socket.on('org:proposal:update', hpu);
    socket.on('org:agent:activity', ha);
    return () => {
      socket.off('org:blockers:list', hb); socket.off('org:proposals:list', hp);
      socket.off('org:blocker:update', hbu); socket.off('org:proposal:update', hpu);
      socket.off('org:agent:activity', ha);
    };
  }, [orgId, socket]);

  const openBlockers = blockers.filter(b => b.status === 'open');
  const pendingProposals = proposals.filter(p => p.status === 'pending');

  const resolveBlocker = (blockerId: string) => {
    const r = resolutionText[blockerId];
    if (!r?.trim()) return;
    socket.emit('org:blocker:resolve', { orgId, blockerId, resolution: r });
    setResolutionText(prev => { const n = {...prev}; delete n[blockerId]; return n; });
  };

  // Token summary across all agents
  const totalTokens = Object.values(agentRuns).flat()
    .reduce((sum, r) => sum + (r.estimatedTokens ?? 0), 0);

  return (
    <div className="board-of-directors">
      <div className="bod-header">
        <h2>Board of Directors</h2>
        <p className="bod-subtitle">{orgName} — Your command center</p>
      </div>

      {/* Summary bar */}
      <div className="bod-summary-bar">
        <div className={`bod-summary-card ${openBlockers.length > 0 ? 'urgent' : ''}`}>
          <span className="bod-summary-count">{openBlockers.length}</span>
          <span className="bod-summary-label">Open Blockers</span>
        </div>
        <div className={`bod-summary-card ${pendingProposals.length > 0 ? 'attention' : ''}`}>
          <span className="bod-summary-count">{pendingProposals.filter(p => p.status === 'pending').length}</span>
          <span className="bod-summary-label">Pending Proposals</span>
        </div>
        <div className="bod-summary-card">
          <span className="bod-summary-count">{agents.filter(a => !a.paused && a.lastRunStatus === 'completed').length}</span>
          <span className="bod-summary-label">Active Agents</span>
        </div>
        <div className="bod-summary-card">
          <span className="bod-summary-count">{(totalTokens / 1000).toFixed(1)}K</span>
          <span className="bod-summary-label">Est. Tokens Used</span>
        </div>
      </div>

      {/* Org Chart */}
      <OrgChart agents={agents} />

      {/* Blockers */}
      {openBlockers.length > 0 && (
        <div className="bod-section">
          <h3 className="bod-section-title">Blockers Requiring Your Attention</h3>
          {openBlockers.map(b => (
            <div key={b.id} className="bod-blocker-card">
              <div className="bod-blocker-header">
                <strong>{b.title}</strong>
                <span className="bod-blocker-agent">{b.agentLabel}</span>
                <span className="bod-blocker-time">{new Date(b.createdAt).toLocaleString()}</span>
              </div>
              <p className="bod-blocker-desc">{b.description}</p>
              {b.workaroundAttempted !== 'None' && <div className="bod-blocker-workaround"><strong>Tried:</strong> {b.workaroundAttempted}</div>}
              <div className="bod-blocker-action"><strong>What you need to do:</strong> {b.humanActionRequired}</div>
              <div className="bod-blocker-resolve">
                <input placeholder="Resolution notes..." value={resolutionText[b.id] ?? ''} onChange={e => setResolutionText(p => ({ ...p, [b.id]: e.target.value }))} />
                <button className="btn-resolve" onClick={() => resolveBlocker(b.id)} disabled={!resolutionText[b.id]?.trim()}>Resolve</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending Proposals */}
      {pendingProposals.length > 0 && (
        <div className="bod-section">
          <h3 className="bod-section-title">Pending Code Proposals</h3>
          {pendingProposals.map(p => (
            <div key={p.id} className="bod-proposal-card">
              <div className="bod-proposal-header">
                <code>{p.relativePath}</code>
                <span>{p.agentLabel}</span>
                {p.isStale && <span className="proposal-stale-badge">Stale</span>}
              </div>
              <p>{p.explanation}</p>
              <div className="bod-proposal-actions">
                <button className="btn-approve" onClick={() => { if (confirm('Apply this change?')) socket.emit('org:proposal:approve', { orgId, proposalId: p.id }); }}>Approve</button>
                <button className="btn-reject" onClick={() => socket.emit('org:proposal:reject', { orgId, proposalId: p.id })}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Agent Health */}
      <div className="bod-section">
        <h3 className="bod-section-title">Agent Health</h3>
        <div className="bod-agent-health-grid">
          {agents.map(agent => {
            const runs = agentRuns[agent.id] ?? [];
            const lastRun = runs[runs.length - 1];
            const fileOps = runs.flatMap((r: any) => r.fileActivity ?? []).slice(-5);
            const agentTokens = runs.reduce((s: number, r: any) => s + (r.estimatedTokens ?? 0), 0);
            return (
              <div key={agent.id} className="bod-agent-health-card">
                <div className="bod-agent-header">
                  <strong>{agent.name}</strong>
                  <span className="bod-agent-role">{agent.role}</span>
                  <span className={`bod-agent-status ${agent.paused ? 'paused' : agent.lastRunStatus ?? 'sleeping'}`}>
                    {agent.paused ? 'Paused' : agent.lastRunStatus ?? 'Sleeping'}
                  </span>
                </div>
                <div className="bod-agent-meta">
                  <div><span className="meta-label">Last run</span> {agent.lastRunAt ? new Date(agent.lastRunAt).toLocaleString() : 'Never'}</div>
                  <div><span className="meta-label">Heartbeat</span> <code>{agent.heartbeat.cron}</code></div>
                  <div><span className="meta-label">Reports to</span> {agent.reportingTo ? agents.find(a => a.id === agent.reportingTo)?.name ?? '?' : 'Nobody'}</div>
                  <div><span className="meta-label">Est. tokens</span> {(agentTokens / 1000).toFixed(1)}K</div>
                </div>
                {lastRun && <div className="bod-last-run-summary">{lastRun.summary?.substring(0, 120)}...</div>}
                {fileOps.length > 0 && (
                  <div className="bod-file-ops">
                    {fileOps.map((op: any, i: number) => (
                      <div key={i} className="bod-file-op">
                        <span className={`file-op-badge file-op-${op.action}`}>{op.action}</span>
                        <code>{op.path.length > 55 ? '...' + op.path.slice(-55) : op.path}</code>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Workspace Browser */}
      <WorkspaceBrowser orgId={orgId} socket={socket} />
    </div>
  );
}
