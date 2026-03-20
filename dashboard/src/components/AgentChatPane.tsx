import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Camera, Loader2, X } from 'lucide-react';
import type { AgentChatMessage } from '../types/org';
import { useScreenshot } from '../hooks/useScreenshot';

interface AgentChatPaneProps {
  chatId: string;
  agentName: string;
  agentRole: string;
  messages: AgentChatMessage[];
  isWaiting: boolean;
  onSend: (text: string, image?: string) => void;
  onAbort: (chatId: string) => void;
  onClose: () => void;
}

export function AgentChatPane({ chatId, agentName, agentRole, messages, isWaiting, onSend, onAbort, onClose }: AgentChatPaneProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const { pendingScreenshot, isCapturing, captureScreenshot, clearScreenshot } = useScreenshot();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if ((!input.trim() && !pendingScreenshot) || isWaiting) return;
    onSend(input.trim(), pendingScreenshot || undefined);
    setInput('');
    clearScreenshot();
  };

  return (
    <div className="agent-chat-pane">
      <div className="agent-chat-header">
        <div className="agent-chat-avatar">{agentName.charAt(0)}</div>
        <div>
          <div className="agent-chat-name">{agentName}</div>
          <div className="agent-chat-role">{agentRole}</div>
        </div>
        <button className="agent-chat-close" onClick={onClose}>×</button>
      </div>
      <div className="agent-chat-messages">
        <div className="agent-chat-notice">
          Direct chat with {agentName}. This agent remembers the full context of this conversation session.
        </div>
        {messages.map(msg => (
          <div key={msg.id} className={`agent-chat-message ${msg.role}`}>
            <div className="message-text">
              {msg.image && (
                <img src={msg.image} alt="Screenshot" className="message-image" />
              )}
              {msg.role === 'assistant' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
              ) : (
                msg.text
              )}
            </div>
            <div className="message-time">{new Date(msg.timestamp).toLocaleTimeString()}</div>
          </div>
        ))}
        {isWaiting && (
          <div className="agent-chat-message assistant">
            <div className="typing-indicator"><span /><span /><span /></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="agent-chat-input">
        {pendingScreenshot && (
          <div className="screenshot-preview">
            <img src={pendingScreenshot} alt="Pending screenshot" />
            <button className="screenshot-preview-remove" onClick={clearScreenshot}>
              <X size={12} />
            </button>
            <span className="screenshot-preview-label">Screenshot attached</span>
          </div>
        )}
        <div className="agent-chat-input-row">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder={`Message ${agentName}…`}
            disabled={isWaiting}
          />
          <button
            className="screenshot-btn"
            onClick={captureScreenshot}
            disabled={isCapturing || isWaiting}
            title="Share Screenshot"
          >
            {isCapturing ? <Loader2 size={16} className="spin" /> : <Camera size={16} />}
          </button>
          {isWaiting ? (
            <button
              className="stop-btn"
              onClick={() => onAbort(chatId)}
              title="Stop all activity in this chat"
              style={{ fontSize: '1.2rem', padding: '0 12px' }}
            >
              &#9632;
            </button>
          ) : (
            <button onClick={handleSend} disabled={!input.trim() && !pendingScreenshot}>↑</button>
          )}
        </div>
      </div>
    </div>
  );
}
