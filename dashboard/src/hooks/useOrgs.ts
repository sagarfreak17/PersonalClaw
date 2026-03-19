import { useState, useEffect, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { Org, Ticket, OrgNotification, CodeProposal, Blocker, FileActivityEntry } from '../types/org';

export interface ActivityItem {
  id: string;
  type: string;
  timestamp: string;
  source: string;
  summary: string;
}

export function useOrgs(socket: Socket) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Record<string, Ticket[]>>({});
  const [runningAgents, setRunningAgents] = useState<Set<string>>(new Set());
  const [notifications, setNotifications] = useState<OrgNotification[]>([]);
  const [proposals, setProposals] = useState<CodeProposal[]>([]);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [agentFileActivity, setAgentFileActivity] = useState<Record<string, FileActivityEntry[]>>({});
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);

  const activeOrg = orgs.find(o => o.id === activeOrgId) ?? null;

  useEffect(() => {
    socket.emit('org:list');

    const handleOrgList = (list: Org[]) => {
      setOrgs(list);
      if (list.length > 0 && !activeOrgId) setActiveOrgId(list[0].id);
    };
    const handleOrgCreated = (org: Org) => {
      setOrgs(prev => [...prev, org]);
      setActiveOrgId(org.id);
    };
    const handleOrgUpdated = (org: Org) => {
      if (!org) return;
      setOrgs(prev => prev.map(o => o.id === org.id ? org : o));
    };
    const handleOrgDeleted = ({ orgId }: { orgId: string }) => {
      setOrgs(prev => {
        const remaining = prev.filter(o => o.id !== orgId);
        if (activeOrgId === orgId) setActiveOrgId(remaining[0]?.id ?? null);
        return remaining;
      });
    };
    const handleTicketUpdate = ({ orgId }: { orgId: string }) => {
      socket.emit('org:tickets:list', { orgId });
    };
    const handleTicketsList = ({ orgId, tickets: list }: { orgId: string; tickets: Ticket[] }) => {
      setTickets(prev => ({ ...prev, [orgId]: list }));
    };
    const handleRunUpdate = (data: any) => {
      setRunningAgents(prev => {
        const next = new Set(prev);
        const key = `${data.orgId}:${data.agentId}`;
        if (data.running) next.add(key); else next.delete(key);
        return next;
      });
    };
    const handleNotification = (notif: OrgNotification) => {
      setNotifications(prev => [notif, ...prev].slice(0, 50));
    };

    const handleProposalsList = (d: any) => { if (d.orgId === activeOrgId) setProposals(d.proposals ?? []); };
    const handleProposalUpdate = (d: any) => { if (d.orgId === activeOrgId) socket.emit('org:proposals:list', { orgId: activeOrgId }); };
    const handleBlockersList = (d: any) => { if (d.orgId === activeOrgId) setBlockers(d.blockers ?? []); };
    const handleBlockerUpdate = (d: any) => { if (d.orgId === activeOrgId) socket.emit('org:blockers:list', { orgId: activeOrgId }); };
    const handleFileActivity = (d: any) => {
      if (d.orgId === activeOrgId) {
        setAgentFileActivity(prev => ({ ...prev, [d.agentId]: [...(prev[d.agentId] ?? []).slice(-50), ...(d.activity ?? [])] }));
      }
    };
    const handleActivity = (item: ActivityItem) => {
      setActivityItems(prev => [...prev, item].slice(-200));
    };
    const handleInit = (data: any) => {
      if (data.activity) {
        setActivityItems(data.activity);
      }
    };
    const handleOrgActivity = (data: any) => {
      if (data.orgId === activeOrgId && data.items) {
        setActivityItems(data.items);
      }
    };

    socket.on('org:proposals:list', handleProposalsList);
    socket.on('org:proposal:update', handleProposalUpdate);
    socket.on('org:blockers:list', handleBlockersList);
    socket.on('org:blocker:update', handleBlockerUpdate);
    socket.on('org:agent:file_activity', handleFileActivity);
    socket.on('activity', handleActivity);
    socket.on('init', handleInit);
    socket.on('org:activity', handleOrgActivity);

    socket.on('org:list', handleOrgList);
    socket.on('org:created', handleOrgCreated);
    socket.on('org:updated', handleOrgUpdated);
    socket.on('org:deleted', handleOrgDeleted);
    socket.on('org:ticket:update', handleTicketUpdate);
    socket.on('org:tickets:list', handleTicketsList);
    socket.on('org:agent:run_update', handleRunUpdate);
    socket.on('org:notification', handleNotification);

    return () => {
      socket.off('org:list', handleOrgList);
      socket.off('org:created', handleOrgCreated);
      socket.off('org:updated', handleOrgUpdated);
      socket.off('org:deleted', handleOrgDeleted);
      socket.off('org:ticket:update', handleTicketUpdate);
      socket.off('org:tickets:list', handleTicketsList);
      socket.off('org:agent:run_update', handleRunUpdate);
      socket.off('org:notification', handleNotification);
      socket.off('org:proposals:list', handleProposalsList);
      socket.off('org:proposal:update', handleProposalUpdate);
      socket.off('org:blockers:list', handleBlockersList);
      socket.off('org:blocker:update', handleBlockerUpdate);
      socket.off('org:agent:file_activity', handleFileActivity);
      socket.off('activity', handleActivity);
      socket.off('init', handleInit);
      socket.off('org:activity', handleOrgActivity);
    };
  }, [socket, activeOrgId]);

  useEffect(() => {
    if (activeOrgId) {
      socket.emit('org:tickets:list', { orgId: activeOrgId });
      socket.emit('org:proposals:list', { orgId: activeOrgId });
      socket.emit('org:blockers:list', { orgId: activeOrgId });
      socket.emit('org:activity', { orgId: activeOrgId, count: 100 });
    }
  }, [activeOrgId, socket]);

  const createOrg = useCallback((p: { name: string; mission: string; rootDir: string }) => {
    socket.emit('org:create', p);
  }, [socket]);

  const updateOrg = useCallback((orgId: string, updates: any) => {
    socket.emit('org:update', { orgId, updates });
  }, [socket]);

  const deleteOrg = useCallback((orgId: string) => {
    socket.emit('org:delete', { orgId });
  }, [socket]);

  const addAgent = useCallback((orgId: string, agent: any) => {
    socket.emit('org:agent:create', { orgId, agent });
  }, [socket]);

  const updateAgent = useCallback((orgId: string, agentId: string, updates: any) => {
    socket.emit('org:agent:update', { orgId, agentId, updates });
  }, [socket]);

  const deleteAgent = useCallback((orgId: string, agentId: string) => {
    socket.emit('org:agent:delete', { orgId, agentId });
  }, [socket]);

  const triggerAgent = useCallback((orgId: string, agentId: string) => {
    socket.emit('org:agent:trigger', { orgId, agentId });
  }, [socket]);

  const createTicket = useCallback((orgId: string, ticket: any) => {
    socket.emit('org:ticket:create', { orgId, ticket });
  }, [socket]);

  const updateTicket = useCallback((orgId: string, ticketId: string, updates: any) => {
    socket.emit('org:ticket:update', { orgId, ticketId, updates });
  }, [socket]);

  const isAgentRunning = useCallback((orgId: string, agentId: string) => {
    return runningAgents.has(`${orgId}:${agentId}`);
  }, [runningAgents]);

  return {
    orgs, activeOrg, activeOrgId, setActiveOrgId,
    tickets, notifications, isAgentRunning,
    createOrg, updateOrg, deleteOrg,
    addAgent, updateAgent, deleteAgent, triggerAgent,
    createTicket, updateTicket,
    proposals, blockers, agentFileActivity, activityItems,
  };
}
