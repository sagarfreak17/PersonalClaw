import type { WorkerAgentInfo } from '../types/conversation';

const STATUS_COLORS: Record<string, string> = {
  queued: '#6b7280', running: '#3b82f6',
  waiting_for_lock: '#f59e0b', completed: '#22c55e',
  failed: '#ef4444', timed_out: '#f97316',
};

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued', running: 'Running',
  waiting_for_lock: 'Waiting for resource', completed: 'Done',
  failed: 'Failed', timed_out: 'Timed out',
};

interface WorkerCardProps {
  worker: WorkerAgentInfo;
  isSuperUser: boolean;
  isLogsSelected: boolean;
  onRequestLogs: (agentId: string) => void;
}

export function WorkerCard({ worker, isSuperUser, isLogsSelected, onRequestLogs }: WorkerCardProps) {
  const elapsed = worker.completedAt
    ? Math.round((new Date(worker.completedAt).getTime() - new Date(worker.spawnedAt).getTime()) / 1000)
    : Math.round((Date.now() - new Date(worker.spawnedAt).getTime()) / 1000);

  return (
    <div className="worker-card">
      <div className="worker-card-header">
        <span className={`status-dot ${worker.status}`}
          style={{ background: STATUS_COLORS[worker.status] }} />
        <span className="worker-status-label">{STATUS_LABELS[worker.status]}</span>
        <span className="worker-elapsed">{elapsed}s</span>
      </div>
      <p className="worker-task">
        {worker.task.slice(0, 120)}{worker.task.length > 120 ? '\u2026' : ''}
      </p>
      {worker.status === 'waiting_for_lock' && worker.lockWaitInfo && (
        <div className="lock-wait-info">
          Waiting for <strong>{worker.lockWaitInfo.lockKey}</strong>
          <br />Held by <strong>{worker.lockWaitInfo.heldByConversation}</strong>
        </div>
      )}
      {isSuperUser && ['completed', 'failed'].includes(worker.status) && (
        <button className="view-logs-btn" onClick={() => onRequestLogs(worker.agentId)}>
          {isLogsSelected ? 'Hide Logs' : 'View Logs'}
        </button>
      )}
    </div>
  );
}
