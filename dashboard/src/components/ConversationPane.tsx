import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, WorkerAgentInfo, WorkerLog } from '../types/conversation';
import type { ToolFeedItem } from '../types/org';
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
  showCloseButton: boolean;
  onSend: (text: string) => void;
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [props.messages]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
      textareaRef.current.style.height =
        `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  };

  const handleSend = () => {
    if (!input.trim()) return;
    props.onSend(input.trim());
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = '44px';
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
        <span className="pane-label">{props.label}</span>
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
          {props.messages.map(msg => (
            <div key={msg.id} className={`message-bubble ${msg.role}`}>
              <div className="message-avatar">
                {msg.role === 'assistant' ? '🤖' : '👤'}
              </div>
              <div className="message-text">
                {msg.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                ) : msg.text}
              </div>
            </div>
          ))}
          {props.isSuperUser && props.toolFeedItems && props.toolFeedItems.length > 0 && (
            <div className="tool-feed-inline">
              {props.toolFeedItems.slice(-8).map((item, i) => (
                <div key={i} className={`tool-feed-item tool-feed-item--${item.type}`}>
                  <span className="tool-feed-icon">{item.type === 'started' ? '\u2699\uFE0F' : item.success === false ? '\u274C' : '\u2705'}</span>
                  <code>{item.tool}</code>
                  {item.durationMs && <span className="tool-feed-duration">{item.durationMs}ms</span>}
                  <span className="tool-feed-time">{new Date(item.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
          {props.isWaiting && (
            <div className="message-bubble assistant">
              <div className="message-avatar">🤖</div>
              <div className="typing-indicator"><span /><span /><span /></div>
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
      </div>

      <div className="pane-input-area">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${props.label}\u2026`}
          rows={1}
          disabled={props.isWaiting}
        />
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
            disabled={!input.trim()}
            className="send-btn"
          >&uarr;</button>
        )}
      </div>
    </div>
  );
}
