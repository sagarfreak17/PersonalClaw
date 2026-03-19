import { useState, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import type { CodeProposal, ProposalContent } from '../types/org';

interface ProposalBoardProps { orgId: string; socket: Socket; }

export function ProposalBoard({ orgId, socket }: ProposalBoardProps) {
  const [proposals, setProposals] = useState<CodeProposal[]>([]);
  const [selected, setSelected] = useState<CodeProposal | null>(null);
  const [content, setContent] = useState<ProposalContent | null>(null);
  const [activeView, setActiveView] = useState<'original' | 'proposed'>('proposed');

  useEffect(() => {
    socket.emit('org:proposals:list', { orgId });
    const handleList = (data: any) => { if (data.orgId === orgId) setProposals(data.proposals ?? []); };
    const handleUpdate = (data: any) => { if (data.orgId === orgId) socket.emit('org:proposals:list', { orgId }); };
    const handleContent = (data: any) => setContent({ original: data.original, proposed: data.proposed });
    socket.on('org:proposals:list', handleList);
    socket.on('org:proposal:update', handleUpdate);
    socket.on('org:proposal:content', handleContent);
    return () => {
      socket.off('org:proposals:list', handleList);
      socket.off('org:proposal:update', handleUpdate);
      socket.off('org:proposal:content', handleContent);
    };
  }, [orgId, socket]);

  const selectProposal = (p: CodeProposal) => {
    setSelected(p); setContent(null);
    socket.emit('org:proposal:content', { orgId, proposalId: p.id });
  };

  const approve = (id: string) => { if (confirm('Apply this change to the real file?')) { socket.emit('org:proposal:approve', { orgId, proposalId: id }); setSelected(null); } };
  const reject = (id: string) => { socket.emit('org:proposal:reject', { orgId, proposalId: id }); setSelected(null); };

  const pending = proposals.filter(p => p.status === 'pending');
  const resolved = proposals.filter(p => p.status !== 'pending');

  return (
    <div className="proposal-board">
      <div className="proposal-list">
        {pending.length === 0 && resolved.length === 0 && <p className="empty-state">No proposals yet.</p>}
        {pending.length > 0 && <>
          <div className="proposal-section-header">Pending ({pending.length})</div>
          {pending.map(p => (
            <div key={p.id} className={`proposal-card proposal-card--pending ${selected?.id === p.id ? 'selected' : ''} ${p.isStale ? 'proposal-card--stale' : ''}`} onClick={() => selectProposal(p)}>
              <div className="proposal-card-path">{p.relativePath}</div>
              <div className="proposal-card-agent">{p.agentLabel}</div>
              {p.isStale && <span className="proposal-stale-badge">Stale (7+ days)</span>}
              <p className="proposal-card-explanation">{p.explanation.substring(0, 100)}...</p>
            </div>
          ))}
        </>}
        {resolved.length > 0 && <>
          <div className="proposal-section-header">Resolved ({resolved.length})</div>
          {resolved.map(p => (
            <div key={p.id} className={`proposal-card proposal-card--${p.status}`} onClick={() => selectProposal(p)}>
              <div className="proposal-card-path">{p.relativePath}</div>
              <span className={`proposal-status-badge proposal-status-badge--${p.status}`}>{p.status}</span>
            </div>
          ))}
        </>}
      </div>
      {selected && (
        <div className="proposal-detail">
          <div className="proposal-detail-header">
            <div>
              <div className="proposal-detail-path">{selected.relativePath}</div>
              <div className="proposal-detail-meta">By {selected.agentLabel} · {new Date(selected.createdAt).toLocaleString()}</div>
            </div>
            {selected.status === 'pending' && (
              <div className="proposal-detail-actions">
                <button className="btn-approve" onClick={() => approve(selected.id)}>Approve & Apply</button>
                <button className="btn-reject" onClick={() => reject(selected.id)}>Reject</button>
              </div>
            )}
          </div>
          <div className="proposal-explanation"><strong>Explanation:</strong> {selected.explanation}</div>
          <div className="proposal-diff-tabs">
            <button className={activeView === 'original' ? 'active' : ''} onClick={() => setActiveView('original')}>Original</button>
            <button className={activeView === 'proposed' ? 'active' : ''} onClick={() => setActiveView('proposed')}>Proposed</button>
          </div>
          <div className="proposal-diff-content">
            {content ? <pre>{activeView === 'original' ? content.original : content.proposed}</pre> : <p className="empty-state">Loading...</p>}
          </div>
        </div>
      )}
    </div>
  );
}
