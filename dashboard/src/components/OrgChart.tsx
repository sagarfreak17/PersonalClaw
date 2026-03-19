import type { OrgAgent } from '../types/org';

interface OrgChartProps {
  agents: OrgAgent[];
}

export function OrgChart({ agents }: OrgChartProps) {
  if (agents.length === 0) return <p className="empty-state">No agents yet.</p>;

  // Build hierarchy
  const roots = agents.filter(a => !a.reportingTo || !agents.find(b => b.id === a.reportingTo));
  const getChildren = (parentId: string) => agents.filter(a => a.reportingTo === parentId);

  const STATUS_COLORS: Record<string, string> = {
    completed: '#22c55e', failed: '#ef4444', skipped: '#6b7280', sleeping: '#6b7280',
  };

  function renderNode(agent: OrgAgent, depth: number): JSX.Element {
    const children = getChildren(agent.id);
    const statusColor = agent.paused ? '#f59e0b' : STATUS_COLORS[agent.lastRunStatus ?? 'sleeping'];
    return (
      <div key={agent.id} className="org-chart-node-wrap" style={{ paddingLeft: depth > 0 ? 32 : 0 }}>
        {depth > 0 && <div className="org-chart-connector" />}
        <div className="org-chart-node">
          <div className="org-chart-avatar" style={{ background: `${statusColor}33`, border: `2px solid ${statusColor}` }}>
            {agent.name.charAt(0).toUpperCase()}
          </div>
          <div className="org-chart-info">
            <div className="org-chart-name">{agent.name}</div>
            <div className="org-chart-role">{agent.role}</div>
            <div className="org-chart-status" style={{ color: statusColor }}>
              {agent.paused ? 'Paused' : agent.lastRunStatus ?? 'Sleeping'}
            </div>
          </div>
        </div>
        {children.length > 0 && (
          <div className="org-chart-children">
            {children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="org-chart">
      <h3 className="bod-section-title">Org Chart</h3>
      <div className="org-chart-tree">
        {roots.map(root => renderNode(root, 0))}
      </div>
    </div>
  );
}
