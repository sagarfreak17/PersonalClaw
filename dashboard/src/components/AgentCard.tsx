import { useState } from 'react';
import type { OrgAgent } from '../types/org';

const STATUS_COLORS: Record<string, string> = {
  running: '#3b82f6', sleeping: '#6b7280', completed: '#22c55e',
  failed: '#ef4444', paused: '#f59e0b', skipped: '#6b7280',
};

interface AgentCardProps {
  agent: OrgAgent;
  allAgents: OrgAgent[];
  isRunning: boolean;
  onTrigger: () => void;
  onChat: () => void;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  onEdit: (updates: any) => void;
}

export function AgentCard({ agent, allAgents, isRunning, onTrigger, onChat, onPause, onResume, onDelete, onEdit }: AgentCardProps) {
  const [showEdit, setShowEdit] = useState(false);
  const status = agent.paused ? 'paused' : isRunning ? 'running' : (agent.lastRunStatus ?? 'sleeping');
  const statusLabel = agent.paused ? 'Paused' : isRunning ? 'Running…'
    : agent.lastRunStatus === 'completed' ? 'Done'
    : agent.lastRunStatus === 'failed' ? 'Failed'
    : 'Sleeping';
  const lastRun = agent.lastRunAt ? new Date(agent.lastRunAt).toLocaleString() : 'Never';

  return (
    <div className={`agent-card ${agent.paused ? 'agent-card--paused' : ''}`}>
      <div className="agent-card-header">
        <div className="agent-avatar">{agent.name.charAt(0).toUpperCase()}</div>
        <div className="agent-info">
          <div className="agent-name">{agent.name}</div>
          <div className="agent-role">{agent.role}</div>
        </div>
        <div className="agent-status-badge" style={{ background: `${STATUS_COLORS[status]}22`, color: STATUS_COLORS[status] }}>
          {isRunning && <span className="pulse-dot" style={{ background: STATUS_COLORS.running }} />}
          {statusLabel}
        </div>
      </div>
      <div className="agent-meta">
        <div className="agent-meta-item">
          <span className="meta-label">Heartbeat</span>
          <code>{agent.heartbeat.cron}</code>
        </div>
        <div className="agent-meta-item">
          <span className="meta-label">Last run</span>
          <span>{lastRun}</span>
        </div>
        <div className="agent-meta-item">
          <span className="meta-label">Autonomy</span>
          <span>{agent.autonomyLevel === 'full' ? '🟢 Full' : '🟡 Approval required'}</span>
        </div>
        <div className="agent-meta-item">
          <span className="meta-label">Reports to</span>
          <span>{agent.reportingTo ? (allAgents.find(a => a.id === agent.reportingTo)?.name ?? 'Unknown') : 'Nobody'}</span>
        </div>
      </div>
      <p className="agent-responsibilities">
        {agent.responsibilities.substring(0, 140)}{agent.responsibilities.length > 140 ? '…' : ''}
      </p>
      <div className="agent-actions">
        <button className="agent-btn agent-btn--primary" onClick={onChat}>💬 Chat</button>
        <button className="agent-btn" onClick={() => setShowEdit(true)}>✏️ Edit</button>
        <button className="agent-btn" onClick={onTrigger} disabled={isRunning || agent.paused}>⚡ Run</button>
        <button className="agent-btn" onClick={agent.paused ? onResume : onPause}>
          {agent.paused ? '▶' : '⏸'}
        </button>
        <button className="agent-btn agent-btn--danger" onClick={() => {
          if (confirm(`Delete ${agent.name}? This cannot be undone.`)) onDelete();
        }}>🗑</button>
      </div>
      {showEdit && (
        <EditAgentModal agent={agent} allAgents={allAgents} onSubmit={(updates) => { onEdit(updates); setShowEdit(false); }} onClose={() => setShowEdit(false)} />
      )}
    </div>
  );
}

function EditAgentModal({ agent, allAgents, onSubmit, onClose }: { agent: OrgAgent; allAgents: OrgAgent[]; onSubmit: (updates: any) => void; onClose: () => void }) {
  const [form, setForm] = useState({
    name: agent.name,
    role: agent.role,
    personality: agent.personality,
    responsibilities: agent.responsibilities,
    goals: agent.goals.join('\n'),
    heartbeatCron: agent.heartbeat.cron,
    autonomyLevel: agent.autonomyLevel,
    reportingTo: agent.reportingTo ?? '',
  });
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (!form.name || !form.role || !form.personality || !form.responsibilities) {
      setError('Name, role, personality, and responsibilities are required.');
      return;
    }
    onSubmit({
      name: form.name,
      role: form.role,
      personality: form.personality,
      responsibilities: form.responsibilities,
      goals: form.goals.split('\n').filter(g => g.trim()),
      heartbeatCron: form.heartbeatCron,
      autonomyLevel: form.autonomyLevel,
      reportingTo: form.reportingTo || null,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel modal-panel--wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit Agent — {agent.name}</h3>
          <button onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}
          <div className="form-row">
            <div className="form-group">
              <label>Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Role</label>
              <input value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label>Personality</label>
            <textarea value={form.personality} onChange={e => setForm(f => ({ ...f, personality: e.target.value }))} rows={3} />
          </div>
          <div className="form-group">
            <label>Responsibilities</label>
            <textarea value={form.responsibilities} onChange={e => setForm(f => ({ ...f, responsibilities: e.target.value }))} rows={4} />
          </div>
          <div className="form-group">
            <label>Goals (one per line)</label>
            <textarea value={form.goals} onChange={e => setForm(f => ({ ...f, goals: e.target.value }))} rows={3} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Heartbeat Schedule (cron)</label>
              <input value={form.heartbeatCron} onChange={e => setForm(f => ({ ...f, heartbeatCron: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Autonomy Level</label>
              <select value={form.autonomyLevel} onChange={e => setForm(f => ({ ...f, autonomyLevel: e.target.value }))}>
                <option value="full">Full — act without asking</option>
                <option value="approval_required">Approval required for destructive/external ops</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Reports To</label>
            <select value={form.reportingTo} onChange={e => setForm(f => ({ ...f, reportingTo: e.target.value }))}>
              <option value="">Nobody</option>
              {allAgents.filter(a => a.id !== agent.id).map(a => (
                <option key={a.id} value={a.id}>{a.name} — {a.role}</option>
              ))}
            </select>
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={handleSubmit}>Save Changes</button>
            <button onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
