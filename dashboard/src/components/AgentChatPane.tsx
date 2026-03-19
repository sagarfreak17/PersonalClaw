import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentChatMessage } from '../types/org';

interface AgentChatPaneProps {
  chatId: string;
  agentName: string;
  agentRole: string;
  messages: AgentChatMessage[];
  isWaiting: boolean;
  onSend: (text: string) => void;
  onClose: () => void;
}

export function AgentChatPane({ agentName, agentRole, messages, isWaiting, onSend, onClose }: AgentChatPaneProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isWaiting) return;
    onSend(input.trim());
    setInput('');
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
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder={`Message ${agentName}…`}
          disabled={isWaiting}
        />
        <button onClick={handleSend} disabled={!input.trim() || isWaiting}>↑</button>
      </div>
    </div>
  );
}
