import { useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { useOrgs } from '../hooks/useOrgs';
import { useOrgChat } from '../hooks/useOrgChat';
import { AgentCard } from './AgentCard';
import { TicketBoard } from './TicketBoard';
import { AgentChatPane } from './AgentChatPane';
import { CreateOrgModal } from './CreateOrgModal';
import { CreateAgentModal } from './CreateAgentModal';
import { ProposalBoard } from './ProposalBoard';
import { BoardOfDirectors } from './BoardOfDirectors';
import { OrgProtectionSettings } from './OrgProtectionSettings';
import { WorkspaceTab } from './WorkspaceTab';

type OrgSubTab = 'agents' | 'tickets' | 'board' | 'workspace' | 'proposals' | 'activity' | 'memory' | 'settings';

interface OrgWorkspaceProps {
  socket: Socket;
}

export function OrgWorkspace({ socket }: OrgWorkspaceProps) {
  const {
    orgs, activeOrg, activeOrgId, setActiveOrgId,
    tickets, notifications, isAgentRunning,
    createOrg, updateOrg, deleteOrg,
    addAgent, updateAgent, deleteAgent, triggerAgent,
    createTicket, updateTicket, activityItems,
  } = useOrgs(socket);

  const {
    chats, openChatId, openChat, closeChat, sendMessage, readMemory,
  } = useOrgChat(socket);

  const [subTab, setSubTab] = useState<OrgSubTab>('agents');
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [memoryContent, setMemoryContent] = useState<any>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);

  const orgTickets = activeOrg ? (tickets[activeOrg.id] ?? []) : [];

  // FIX-O: use correlationId-based readMemory from useOrgChat
  const handleReadMemory = useCallback(async (agentId?: string) => {
    if (!activeOrg) return;
    setMemoryLoading(true);
    setMemoryContent(null);
    const content = await readMemory(activeOrg.id, agentId);
    setMemoryContent(content);
    setMemoryLoading(false);
  }, [activeOrg, readMemory]);

  const handleOpenChat = (agentId: string, agentName: string, agentRole: string) => {
    if (!activeOrg) return;
    openChat(activeOrg.id, agentId, agentName, agentRole);
  };

  if (orgs.length === 0) {
    return (
      <div className="org-empty">
        <div className="org-empty-icon">🏢</div>
        <h2>No Organisations Yet</h2>
        <p>Create your first AI-powered organisation to get started.</p>
        <button className="btn-primary btn-large" onClick={() => setShowCreateOrg(true)}>
          + Create Organisation
        </button>
        {showCreateOrg && <CreateOrgModal onSubmit={createOrg} onClose={() => setShowCreateOrg(false)} />}
      </div>
    );
  }

  return (
    <div className="org-workspace">
      {/* Org Sidebar */}
      <div className="org-sidebar">
        <div className="org-sidebar-header">Organisations</div>
        {orgs.map(org => (
          <button
            key={org.id}
            className={`org-switcher-item ${org.id === activeOrgId ? 'active' : ''} ${org.paused ? 'paused' : ''}`}
            onClick={() => setActiveOrgId(org.id)}
          >
            <div className="org-switcher-avatar">{org.name.charAt(0)}</div>
            <div className="org-switcher-info">
              <div className="org-switcher-name">{org.name}</div>
              <div className="org-switcher-count">{org.agents.length} agent{org.agents.length !== 1 ? 's' : ''}</div>
            </div>
            {org.paused && <span className="org-paused-badge">Paused</span>}
          </button>
        ))}
        <button className="org-create-btn" onClick={() => setShowCreateOrg(true)}>+ New Org</button>
      </div>

      {/* Main Area */}
      {activeOrg && (
        <div className="org-main">
          <div className="org-header">
            <div className="org-header-info">
              <h2>{activeOrg.name}</h2>
              <p className="org-mission">{activeOrg.mission}</p>
              <code className="org-rootdir">{activeOrg.rootDir}</code>
            </div>
            <div className="org-header-actions">
              <button
                className={`btn-sm ${activeOrg.paused ? 'btn-success' : 'btn-warning'}`}
                onClick={() => updateOrg(activeOrg.id, { paused: !activeOrg.paused })}
              >
                {activeOrg.paused ? '▶ Resume Org' : '⏸ Pause Org'}
              </button>
              <button className="btn-sm btn-danger" onClick={() => {
                if (confirm(`Delete ${activeOrg.name}? This cannot be undone.`)) deleteOrg(activeOrg.id);
              }}>🗑 Delete</button>
            </div>
          </div>

          <div className="org-subtabs">
            {(['agents', 'tickets', 'board', 'workspace', 'proposals', 'activity', 'memory', 'settings'] as OrgSubTab[]).map(tab => (
              <button
                key={tab}
                className={`org-subtab ${subTab === tab ? 'active' : ''}`}
                onClick={() => setSubTab(tab)}
              >
                {tab === 'agents' ? `Agents (${activeOrg.agents.length})`
                  : tab === 'tickets' ? `Tickets (${orgTickets.filter(t => t.status !== 'done').length})`
                  : tab === 'board' ? 'Board'
                  : tab === 'workspace' ? 'Workspace'
                  : tab === 'proposals' ? 'Proposals'
                  : tab === 'activity' ? 'Activity'
                  : tab === 'settings' ? 'Settings'
                  : 'Memory'}
              </button>
            ))}
          </div>

          <div className="org-tab-content">
            {subTab === 'agents' && (
              <div className="agents-grid">
                {activeOrg.agents.map(agent => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    allAgents={activeOrg.agents}
                    isRunning={isAgentRunning(activeOrg.id, agent.id)}
                    onTrigger={() => triggerAgent(activeOrg.id, agent.id)}
                    onChat={() => handleOpenChat(agent.id, agent.name, agent.role)}
                    onPause={() => updateAgent(activeOrg.id, agent.id, { paused: true })}
                    onResume={() => updateAgent(activeOrg.id, agent.id, { paused: false })}
                    onDelete={() => deleteAgent(activeOrg.id, agent.id)}
                    onEdit={(updates) => updateAgent(activeOrg.id, agent.id, updates)}
                  />
                ))}
                <button className="agent-add-card" onClick={() => setShowCreateAgent(true)}>
                  <span>+</span><span>Add Agent</span>
                </button>
              </div>
            )}

            {subTab === 'tickets' && (
              <TicketBoard
                tickets={orgTickets}
                agents={activeOrg.agents}
                onCreateTicket={(ticket) => createTicket(activeOrg.id, ticket)}
                onUpdateTicket={(ticketId, updates) => updateTicket(activeOrg.id, ticketId, updates)}
              />
            )}

            {subTab === 'board' && (
              <BoardOfDirectors orgId={activeOrg.id} orgName={activeOrg.name} agents={activeOrg.agents} socket={socket} />
            )}

            {subTab === 'workspace' && (
              <WorkspaceTab orgId={activeOrg.id} agents={activeOrg.agents} socket={socket} />
            )}

            {subTab === 'proposals' && (
              <ProposalBoard orgId={activeOrg.id} socket={socket} />
            )}

            {subTab === 'activity' && (
              <div className="org-activity-log">
                <h3>Activity — {activeOrg.name}</h3>
                {activityItems.length === 0
                  ? <p className="empty-state">No activity yet.</p>
                  : [...activityItems].reverse().map((item, i) => (
                      <div key={item.id ?? i} className="org-notification org-notification--info">
                        <div className="notif-header">
                          <strong>{item.type}</strong>
                          <span>{new Date(item.timestamp).toLocaleString()}</span>
                        </div>
                        <p>{item.summary}</p>
                      </div>
                    ))
                }
              </div>
            )}

            {subTab === 'memory' && (
              <div className="org-memory-viewer">
                <div className="memory-nav">
                  <button onClick={() => handleReadMemory()}>🌐 Shared Memory</button>
                  {activeOrg.agents.map(a => (
                    <button key={a.id} onClick={() => handleReadMemory(a.id)}>
                      {a.name}
                    </button>
                  ))}
                </div>
                <div className="memory-content">
                  {memoryLoading
                    ? <p className="empty-state">Loading…</p>
                    : memoryContent
                      ? <pre>{JSON.stringify(memoryContent, null, 2)}</pre>
                      : <p className="empty-state">Click a memory source to view it.</p>
                  }
                </div>
              </div>
            )}

            {subTab === 'settings' && (
              <OrgProtectionSettings org={activeOrg} socket={socket} />
            )}
          </div>
        </div>
      )}

      {/* Direct Agent Chat Pane */}
      {openChatId && chats[openChatId] && (
        <AgentChatPane
          chatId={openChatId}
          agentName={chats[openChatId].agentName}
          agentRole={chats[openChatId].agentRole}
          messages={chats[openChatId].messages}
          isWaiting={chats[openChatId].isWaiting}
          onSend={(text) => sendMessage(openChatId, text)}
          onClose={() => closeChat(openChatId)}
        />
      )}

      {showCreateOrg && <CreateOrgModal onSubmit={createOrg} onClose={() => setShowCreateOrg(false)} />}
      {showCreateAgent && activeOrg && (
        <CreateAgentModal
          org={activeOrg}
          onSubmit={(agent) => addAgent(activeOrg.id, agent)}
          onClose={() => setShowCreateAgent(false)}
        />
      )}
    </div>
  );
}
