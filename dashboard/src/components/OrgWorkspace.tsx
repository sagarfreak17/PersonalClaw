import { useState, useCallback, useRef, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { Bell, X } from 'lucide-react';

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
import { EditOrgModal } from './EditOrgModal';

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
  const [showEditOrg, setShowEditOrg] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [memoryContent, setMemoryContent] = useState<any>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);

  const orgTickets = activeOrg ? (tickets[activeOrg.id] ?? []) : [];
  const orgNotifications = activeOrg ? notifications.filter(n => n.orgId === activeOrg.id) : [];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    if (showNotifications) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotifications]);


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
              <div ref={notifRef} style={{ position: 'relative', display: 'inline-block', marginRight: '8px' }}>
                <button 
                  className="btn-sm" 
                  onClick={() => setShowNotifications(!showNotifications)}
                  style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Bell size={16} /> Notifications
                  {orgNotifications.length > 0 && (
                    <span style={{ 
                      background: 'var(--accent-primary)', 
                      color: '#fff', 
                      borderRadius: '12px', 
                      padding: '2px 6px', 
                      fontSize: '0.7rem', 
                      fontWeight: 'bold',
                      marginLeft: '4px'
                    }}>
                      {orgNotifications.length}
                    </span>
                  )}
                </button>
                {showNotifications && (
                  <div style={{ 
                    position: 'absolute', 
                    right: 0, 
                    top: '110%', 
                    width: '350px', 
                    maxHeight: '400px',
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'var(--bg-panel)', 
                    border: '1px solid var(--border-color)', 
                    borderRadius: '8px', 
                    zIndex: 100, 
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)', 
                    overflow: 'hidden' 
                  }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-darker)' }}>
                      <h4 style={{ margin: 0, fontSize: '0.9rem' }}>Notifications</h4>
                      <button onClick={() => setShowNotifications(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 0 }}>
                        <X size={16} />
                      </button>
                    </div>
                    <div style={{ overflowY: 'auto', flex: 1, padding: '8px' }}>
                      {orgNotifications.length === 0 ? (
                        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem', padding: '20px 0' }}>No notifications yet.</p>
                      ) : (
                        orgNotifications.map((notif, i) => (
                          <div key={i} style={{ 
                            padding: '10px', 
                            borderBottom: '1px solid var(--border-color)', 
                            fontSize: '0.85rem',
                            background: notif.level === 'error' ? 'rgba(239, 68, 68, 0.1)' : notif.level === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
                            borderRadius: '4px',
                            marginBottom: '4px'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                              <strong style={{ color: 'var(--text)' }}>{notif.agentName}</strong>
                              <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                                {new Date(notif.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>{notif.message}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
              <button
                className={`btn-sm ${activeOrg.paused ? 'btn-success' : 'btn-warning'}`}
                onClick={() => updateOrg(activeOrg.id, { paused: !activeOrg.paused })}
              >
                {activeOrg.paused ? '▶ Resume Org' : '⏸ Pause Org'}
              </button>
              <button 
                className="btn-sm" 
                onClick={() => setShowEditOrg(true)}
              >
                ✏️ Edit Org
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
      {showEditOrg && activeOrg && (
        <EditOrgModal
          org={activeOrg}
          onSubmit={(updates) => updateOrg(activeOrg.id, updates)}
          onClose={() => setShowEditOrg(false)}
        />
      )}
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
