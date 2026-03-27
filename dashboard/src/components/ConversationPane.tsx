import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Camera, Loader2, X } from 'lucide-react';
import type { Message, WorkerAgentInfo, WorkerLog } from '../types/conversation';
import type { ToolFeedItem } from '../types/org';
import { useScreenshot } from '../hooks/useScreenshot';
import { MessageCopyButton } from './MessageCopyButton';
import { LogConsole } from './LogConsole';
import { WorkerCard } from './WorkerCard';

interface ConversationPaneProps {
  conversationId: string;
  label: string;
  messages: Message[];
  workers: WorkerAgentInfo[];
  isAgentPanelOpen: boolean;
  activeWorkerCount: number;
  selectedAgentLogs: WorkerLog | null;
  isWaiting: boolean;
  isSuperUser: boolean;
  toolFeedItems?: ToolFeedItem[];
  conversationLogs?: any[]; // Allow LogEntry[] dynamically passed
  showCloseButton: boolean;
  onSend: (text: string, image?: string) => void;
  onClose: () => void;
  onAbort: () => void;
  onToggleAgentPanel: () => void;
  onRequestLogs: (agentId: string) => void;
}

export function ConversationPane(props: ConversationPaneProps) {
  const [input, setInput] = useState('');
  const [selectedLogAgentId, setSelectedLogAgentId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { pendingScreenshot, isCapturing, captureScreenshot, clearScreenshot } = useScreenshot();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [props.messages]);

  // Re-focus textarea when it becomes enabled again (after bot finishes responding)
  useEffect(() => {
    if (!props.isWaiting) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [props.isWaiting]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
      textareaRef.current.style.height =
        `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  };

  const getLogsForAssistantMessage = (index: number) => {
    if (!props.isSuperUser || !props.conversationLogs) return [];
    const currentMsg = props.messages[index];
    const prevMsg = props.messages[index - 1]; // user message
    const startTs = prevMsg ? new Date(prevMsg.timestamp).getTime() : 0;
    const endTs = new Date(currentMsg.timestamp).getTime() + 2000;
    return props.conversationLogs.filter(l => l.timestamp >= startTs && l.timestamp <= endTs);
  };

  const getActiveLogs = () => {
    if (!props.isSuperUser || !props.conversationLogs || !props.isWaiting) return [];
    const lastMsg = props.messages[props.messages.length - 1];
    const startTs = lastMsg ? new Date(lastMsg.timestamp).getTime() : 0;
    return props.conversationLogs.filter(l => l.timestamp >= startTs);
  };

  const getIdleLogs = () => {
    if (!props.isSuperUser || !props.conversationLogs || props.isWaiting) return [];
    const lastMsg = props.messages[props.messages.length - 1];
    if (!lastMsg) return [];
    const idleStartTime = new Date(lastMsg.timestamp).getTime() + 2000;
    return props.conversationLogs.filter(l => l.timestamp > idleStartTime);
  };

  const handleSend = () => {
    if (!input.trim() && !pendingScreenshot) return;
    props.onSend(input.trim(), pendingScreenshot || undefined);
    setInput('');
    clearScreenshot();
    if (textareaRef.current) textareaRef.current.style.height = '44px';
    // Re-focus after React finishes the parent re-render + scrollIntoView
    setTimeout(() => textareaRef.current?.focus(), 150);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleLogToggle = (agentId: string) => {
    const next = selectedLogAgentId === agentId ? null : agentId;
    setSelectedLogAgentId(next);
    if (next) props.onRequestLogs(agentId);
  };

  return (
    <div className="conversation-pane">
      <div className="pane-header">
        <div className="pane-header-actions">
          {props.workers.length > 0 && (
            <button className="agent-badge" onClick={props.onToggleAgentPanel}>
              <span className={`status-dot ${props.activeWorkerCount > 0 ? 'running' : 'completed'}`} />
              {props.workers.length} agent{props.workers.length !== 1 ? 's' : ''}
            </button>
          )}
          {props.showCloseButton && (
            <button className="pane-close-btn" onClick={props.onClose}>&times;</button>
          )}
        </div>
      </div>

      <div className="pane-body">
        <div className="message-list">
          {props.messages.map((msg, index) => {
            const inlineLogs = msg.role === 'assistant' ? getLogsForAssistantMessage(index) : [];
            return (
              <div key={msg.id} className={`message-bubble ${msg.role}`}>
                <div className="message-avatar">
                  {msg.role === 'assistant' ? '🤖' : '👤'}
                </div>
                <div className="message-text" style={{ width: '100%', minWidth: 0 }}>
                  {msg.role === 'assistant' && inlineLogs.length > 0 && (
                    <LogConsole logs={inlineLogs} title="Thought Process" startOpen={false} />
                  )}
                  {msg.role === 'assistant' && (
                    <MessageCopyButton text={msg.text} />
                  )}
                  {msg.image && (
                    <img src={msg.image} alt="Screenshot" className="message-image" />
                  )}
                  {msg.role === 'assistant' ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                  ) : msg.text}
                </div>
              </div>
            );
          })}
          {/* Inline tool feed removed now that LogConsole is present */}
          {props.isWaiting && (
            <div className="message-bubble assistant">
              <div className="message-avatar">🤖</div>
              <div className="message-text" style={{ width: '100%', minWidth: 0 }}>
                <div className="typing-indicator" style={{ marginBottom: props.isSuperUser ? '8px' : 0 }}><span /><span /><span /></div>
                {getActiveLogs().length > 0 && (
                  <LogConsole logs={getActiveLogs()} title="Thinking..." startOpen={true} />
                )}
              </div>
            </div>
          )}
          
          {getIdleLogs().length > 0 && (
            <div className="message-bubble system">
               <div className="message-text" style={{ width: '100%', minWidth: 0 }}>
                 <LogConsole logs={getIdleLogs()} title="System Activity" startOpen={false} />
               </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className={`agent-side-panel ${props.isAgentPanelOpen ? 'open' : ''}`}>
          <div className="agent-panel-header">
            <span>Sub-Agents</span>
            <button onClick={props.onToggleAgentPanel}>&times;</button>
          </div>
          <div className="agent-panel-body">
            {props.workers.length === 0 && (
              <p className="no-agents-msg">No sub-agents active</p>
            )}
            {props.workers.map(worker => (
              <div key={worker.agentId}>
                <WorkerCard
                  worker={worker}
                  isSuperUser={props.isSuperUser}
                  isLogsSelected={selectedLogAgentId === worker.agentId}
                  onRequestLogs={handleLogToggle}
                />
                {props.isSuperUser &&
                  selectedLogAgentId === worker.agentId &&
                  props.selectedAgentLogs?.agentId === worker.agentId && (
                  <div className="raw-logs-viewer">
                    <pre>{props.selectedAgentLogs.logs.join('\n')}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        {/* Inline console blocks are used instead of a global one */}
      </div>

      <div className="pane-input-area">
        {pendingScreenshot && (
          <div className="screenshot-preview">
            <img src={pendingScreenshot} alt="Pending screenshot" />
            <button className="screenshot-preview-remove" onClick={clearScreenshot}>
              <X size={12} />
            </button>
            <span className="screenshot-preview-label">Screenshot attached</span>
          </div>
        )}
        <div className="pane-input-row">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${props.label}\u2026`}
            rows={1}
            disabled={props.isWaiting}
          />
          <button
            className="screenshot-btn"
            onClick={captureScreenshot}
            onMouseDown={e => e.preventDefault()}
            disabled={isCapturing || props.isWaiting}
            title="Share Screenshot"
          >
            {isCapturing ? <Loader2 size={16} className="spin" /> : <Camera size={16} />}
          </button>
          {props.isWaiting ? (
            <button
              className="stop-btn"
              onClick={props.onAbort}
              title="Stop all activity in this chat"
            >
              &#9632;
            </button>
          ) : (
            <button
              onClick={handleSend}
              onMouseDown={e => e.preventDefault()}
              disabled={!input.trim() && !pendingScreenshot}
              className="send-btn"
            >&uarr;</button>
          )}
        </div>
      </div>
    </div>
  );
}
