import { useState, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import type { ProposalContent } from '../types/org';

// Unified type for both code proposals and review submissions
interface UnifiedProposal {
  id: string;
  orgId: string;
  agentId: string;
  agentLabel: string;
  status: 'pending' | 'approved' | 'rejected';
  isStale: boolean;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  // Code proposal fields
  relativePath?: string;
  explanation?: string;
  // Review submission fields
  title?: string;
  content?: string;
  submissionType?: 'plan' | 'decision' | 'document' | 'hiring';
  requiresApproval?: boolean;
}

const SUBMISSION_TYPE_COLORS: Record<string, string> = {
  plan: '#8b5cf6',
  decision: '#f59e0b',
  document: '#3b82f6',
  hiring: '#10b981',
};

const SUBMISSION_TYPE_LABELS: Record<string, string> = {
  plan: 'Plan',
  decision: 'Decision',
  document: 'Document',
  hiring: 'Hiring',
};

function isReviewSubmission(p: UnifiedProposal): boolean {
  return !!p.submissionType;
}

interface ProposalBoardProps { orgId: string; socket: Socket; }

export function ProposalBoard({ orgId, socket }: ProposalBoardProps) {
  const [proposals, setProposals] = useState<UnifiedProposal[]>([]);
  const [selected, setSelected] = useState<UnifiedProposal | null>(null);
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

  const selectProposal = (p: UnifiedProposal) => {
    setSelected(p); setContent(null);
    socket.emit('org:proposal:content', { orgId, proposalId: p.id });
  };

  const approve = (id: string) => {
    const item = proposals.find(p => p.id === id);
    const msg = item && isReviewSubmission(item) ? 'Approve this submission?' : 'Apply this change to the real file?';
    if (confirm(msg)) { socket.emit('org:proposal:approve', { orgId, proposalId: id }); setSelected(null); }
  };
  const reject = (id: string) => { socket.emit('org:proposal:reject', { orgId, proposalId: id }); setSelected(null); };

  // Only show code proposals (not documents/plans/hiring submissions)
  const codeProposals = proposals.filter(p => !p.submissionType);
  const pending = codeProposals.filter(p => p.status === 'pending');
  const resolved = codeProposals.filter(p => p.status !== 'pending');

  const renderCardLabel = (p: UnifiedProposal) => {
    if (isReviewSubmission(p)) {
      return <div className="proposal-card-path">{p.title}</div>;
    }
    return <div className="proposal-card-path">{p.relativePath}</div>;
  };

  const renderTypeBadge = (p: UnifiedProposal) => {
    if (isReviewSubmission(p) && p.submissionType) {
      const color = SUBMISSION_TYPE_COLORS[p.submissionType] ?? '#6b7280';
      return (
        <span className="proposal-type-badge" style={{ background: `${color}22`, color, border: `1px solid ${color}44`, borderRadius: 4, padding: '1px 8px', fontSize: 12, fontWeight: 600 }}>
          {SUBMISSION_TYPE_LABELS[p.submissionType] ?? p.submissionType}
          {p.requiresApproval && ' — Approval Required'}
        </span>
      );
    }
    return <span className="proposal-type-badge" style={{ background: '#6b728022', color: '#6b7280', border: '1px solid #6b728044', borderRadius: 4, padding: '1px 8px', fontSize: 12, fontWeight: 600 }}>Code Change</span>;
  };

  return (
    <div className="proposal-board">
      <div className="proposal-list">
        {pending.length === 0 && resolved.length === 0 && <p className="empty-state">No proposals yet.</p>}
        {pending.length > 0 && <>
          <div className="proposal-section-header">Pending ({pending.length})</div>
          {pending.map(p => (
            <div key={p.id} className={`proposal-card proposal-card--pending ${selected?.id === p.id ? 'selected' : ''} ${p.isStale ? 'proposal-card--stale' : ''}`} onClick={() => selectProposal(p)}>
              {renderCardLabel(p)}
              {renderTypeBadge(p)}
              <div className="proposal-card-agent">{p.agentLabel}</div>
              {p.isStale && <span className="proposal-stale-badge">Stale (7+ days)</span>}
              <p className="proposal-card-explanation">{(p.explanation ?? p.title ?? '').substring(0, 100)}...</p>
            </div>
          ))}
        </>}
        {resolved.length > 0 && <>
          <div className="proposal-section-header">Resolved ({resolved.length})</div>
          {resolved.map(p => (
            <div key={p.id} className={`proposal-card proposal-card--${p.status}`} onClick={() => selectProposal(p)}>
              {renderCardLabel(p)}
              {renderTypeBadge(p)}
              <span className={`proposal-status-badge proposal-status-badge--${p.status}`}>{p.status}</span>
            </div>
          ))}
        </>}
      </div>
      {selected && (
        <div className="proposal-detail">
          <div className="proposal-detail-header">
            <div>
              <div className="proposal-detail-path">{isReviewSubmission(selected) ? selected.title : selected.relativePath}</div>
              {renderTypeBadge(selected)}
              <div className="proposal-detail-meta">By {selected.agentLabel} · {new Date(selected.createdAt).toLocaleString()}</div>
            </div>
            {selected.status === 'pending' && (
              <div className="proposal-detail-actions">
                <button className="btn-approve" onClick={() => approve(selected.id)}>{isReviewSubmission(selected) ? 'Approve' : 'Approve & Apply'}</button>
                <button className="btn-reject" onClick={() => reject(selected.id)}>Reject</button>
              </div>
            )}
          </div>
          <div className="proposal-explanation"><strong>{isReviewSubmission(selected) ? 'Content:' : 'Explanation:'}</strong> {selected.explanation ?? selected.title}</div>
          <div className="proposal-diff-tabs">
            {!isReviewSubmission(selected) && <button className={activeView === 'original' ? 'active' : ''} onClick={() => setActiveView('original')}>Original</button>}
            <button className={activeView === 'proposed' || isReviewSubmission(selected) ? 'active' : ''} onClick={() => setActiveView('proposed')}>
              {isReviewSubmission(selected) ? 'Full Content' : 'Proposed'}
            </button>
          </div>
          <div className="proposal-diff-content">
            {content ? <pre>{activeView === 'original' && !isReviewSubmission(selected) ? content.original : content.proposed}</pre> : <p className="empty-state">Loading...</p>}
          </div>
        </div>
      )}
    </div>
  );
}
