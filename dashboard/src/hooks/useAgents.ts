import { useState, useEffect, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { WorkerAgentInfo, WorkerLog } from '../types/conversation';

export function useAgents(socket: Socket, conversationId: string | null) {
  const [workers, setWorkers] = useState<WorkerAgentInfo[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [selectedAgentLogs, setSelectedAgentLogs] = useState<WorkerLog | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    socket.emit('agent:list', { conversationId });

    socket.on('agent:update', (data: {
      conversationId: string; workers: WorkerAgentInfo[];
    }) => {
      if (data.conversationId !== conversationId) return;
      setWorkers(data.workers);

      const hasActive = data.workers.some(w =>
        w.status === 'running' || w.status === 'queued' || w.status === 'waiting_for_lock'
      );
      if (hasActive) setIsPanelOpen(true);

      const allTerminal = data.workers.length > 0 && data.workers.every(w =>
        ['completed', 'failed', 'timed_out'].includes(w.status)
      );
      if (allTerminal) setTimeout(() => setIsPanelOpen(false), 3000);
    });

    socket.on('agent:logs', (log: WorkerLog) => setSelectedAgentLogs(log));

    return () => {
      socket.off('agent:update');
      socket.off('agent:logs');
    };
  }, [socket, conversationId]);

  const requestLogs = useCallback((agentId: string) =>
    socket.emit('agent:logs', { agentId }), [socket]);

  const togglePanel = useCallback(() => setIsPanelOpen(p => !p), []);

  const activeCount = workers.filter(w =>
    w.status === 'running' || w.status === 'queued' || w.status === 'waiting_for_lock'
  ).length;

  return { workers, isPanelOpen, selectedAgentLogs, requestLogs, togglePanel, activeCount };
}
