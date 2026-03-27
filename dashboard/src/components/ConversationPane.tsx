import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Camera, Loader2, X } from 'lucide-react';
import type { Message, WorkerAgentInfo, WorkerLog } from '../types/conversation';
import type { ToolFeedItem } from '../types/org';
import { WorkerCard } from './WorkerCard';
import { useScreenshot } from '../hooks/useScreenshot';
import { MessageCopyButton } from './MessageCopyButton';

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
