import React, { useState, useEffect } from 'react';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import type { Socket } from 'socket.io-client';
import { useConversations } from '../hooks/useConversations';
import { useAgents } from '../hooks/useAgents';
import { ConversationPane } from './ConversationPane';
import type { ToolFeedItem } from '../types/org';

interface ChatWorkspaceProps {
  socket: Socket;
  isSuperUser: boolean;
}

function PaneWithAgents({ conversationId, label, messages, isWaiting,
  isSuperUser, showCloseButton, socket, onSend, onClose, onAbort, toolFeedItems }: any) {
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

  useEffect(() => {
    if (!socket) return;
    const handler = (item: ToolFeedItem) => {
      setToolFeeds(prev => ({
        ...prev,
        [item.conversationId]: [...(prev[item.conversationId] ?? []).slice(-20), item],
      }));
    };
    socket.on('chat:tool_feed', handler);
    return () => { socket.off('chat:tool_feed', handler); };
  }, [socket]);

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
                  onSend={(text: string) => sendMessage(convo.id, text)}
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
