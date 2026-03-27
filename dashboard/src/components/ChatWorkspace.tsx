import React, { useState, useEffect } from 'react';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import type { Socket } from 'socket.io-client';
import { useConversations } from '../hooks/useConversations';
import { useAgents } from '../hooks/useAgents';
import { ConversationPane } from './ConversationPane';
import type { ToolFeedItem } from '../types/org';
import type { LogEntry } from '../types/conversation';

interface ChatWorkspaceProps {
  socket: Socket;
  isSuperUser: boolean;
}

function PaneWithAgents({ conversationId, label, messages, isWaiting,
  isSuperUser, showCloseButton, socket, onSend, onClose, onAbort, toolFeedItems, conversationLogs }: any) {
  const {
    workers, isPanelOpen, selectedAgentLogs,
    requestLogs, togglePanel, activeCount,
  } = useAgents(socket, conversationId);

  return (
    <ConversationPane
      conversationId={conversationId} label={label}
      messages={messages} workers={workers}
      isAgentPanelOpen={isPanelOpen} activeWorkerCount={activeCount}
      selectedAgentLogs={selectedAgentLogs} isWaiting={isWaiting}
      isSuperUser={isSuperUser} toolFeedItems={toolFeedItems}
      conversationLogs={conversationLogs}
      showCloseButton={showCloseButton}
      onSend={onSend} onClose={onClose} onAbort={onAbort}
      onToggleAgentPanel={togglePanel} onRequestLogs={requestLogs}
    />
  );
}

export function ChatWorkspace({ socket, isSuperUser }: ChatWorkspaceProps) {
  const {
    conversations, messages, isWaiting, error,
    createConversation, closeConversation, abortConversation, sendMessage,
  } = useConversations(socket);

  const [toolFeeds, setToolFeeds] = useState<Record<string, ToolFeedItem[]>>({});
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({});

  useEffect(() => {
    if (!socket) return;
    const handler = (item: ToolFeedItem) => {
      setToolFeeds(prev => ({
        ...prev,
        [item.conversationId]: [...(prev[item.conversationId] ?? []).slice(-20), item],
      }));
    };
    const logHandler = ({ conversationId, log }: { conversationId?: string; log: LogEntry }) => {
      setLogs(prev => {
        const next = { ...prev };
        // If it targets a specific conversation...
        if (conversationId) {
          next[conversationId] = [...(next[conversationId] ?? []).slice(-500), log];
        } else {
          // If global log, broadcast to all currently rendered active conversations
          for (const c of conversations) {
            next[c.id] = [...(next[c.id] ?? []).slice(-500), log];
          }
        }
        return next;
      });
    };
    
    socket.on('chat:tool_feed', handler);
    socket.on('chat:log', logHandler);
    return () => { 
      socket.off('chat:tool_feed', handler); 
      socket.off('chat:log', logHandler);
    };
  }, [socket, conversations]);

  return (
    <div className="chat-workspace">
      {error && <div className="workspace-error-toast">{error}</div>}

      {conversations.length === 0 ? (
        <div className="workspace-empty">
          <p>No active chats</p>
          <button onClick={createConversation}>Start Chat</button>
        </div>
      ) : (
        <PanelGroup direction="horizontal" className="panel-group">
          {conversations.map((convo, index) => (
            // FIX-7: React.Fragment with key — Panel and PanelResizeHandle are
            // direct children of PanelGroup as required by react-resizable-panels
            <React.Fragment key={convo.id}>
              <Panel minSize={20}>
                <PaneWithAgents
                  conversationId={convo.id}
                  label={convo.label}
                  messages={messages[convo.id] ?? []}
                  isWaiting={isWaiting[convo.id] ?? false}
                  isSuperUser={isSuperUser}
                  showCloseButton={conversations.length > 1}
                  socket={socket}
                  toolFeedItems={isSuperUser ? (toolFeeds[convo.id] ?? []) : []}
                  conversationLogs={isSuperUser ? (logs[convo.id] ?? []) : []}
                  onSend={(text: string, image?: string) => sendMessage(convo.id, text, image)}
                  onClose={() => closeConversation(convo.id)}
                  onAbort={() => abortConversation(convo.id)}
                />
              </Panel>
              {index < conversations.length - 1 && (
                <PanelResizeHandle className="panel-resize-handle" />
              )}
            </React.Fragment>
          ))}
        </PanelGroup>
      )}

      {conversations.length < 3 && (
        <button
          className="add-pane-btn"
          onClick={createConversation}
          title="Open new chat"
        >+</button>
      )}
    </div>
  );
}
