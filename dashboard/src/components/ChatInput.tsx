import React, { useState, useRef, useEffect } from 'react';
import { Send, Camera, Loader2, X } from 'lucide-react';
import { motion } from 'framer-motion';

interface ChatInputProps {
  onSendMessage: (text: string) => void;
  onScreenshot: () => void;
  isCapturing: boolean;
  pendingScreenshot: string | null;
  onRemoveScreenshot: () => void;
}

const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  onScreenshot,
  isCapturing,
  pendingScreenshot,
  onRemoveScreenshot
}) => {
  const [text, setText] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = Math.min(scrollHeight, 160) + 'px';
    }
  }, [text]);

  const handleSend = () => {
    if (!text.trim() && !pendingScreenshot) return;
    if (text.trim()) {
      setHistory(prev => [...prev.slice(-50), text.trim()]);
      setHistoryIdx(-1);
    }
    onSendMessage(text);
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }

    // Command history navigation with Up/Down
    if (e.key === 'ArrowUp' && !text) {
      e.preventDefault();
      if (history.length > 0) {
        const newIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
        setHistoryIdx(newIdx);
        setText(history[newIdx]);
      }
    }

    if (e.key === 'ArrowDown' && historyIdx >= 0) {
      e.preventDefault();
      if (historyIdx < history.length - 1) {
        const newIdx = historyIdx + 1;
        setHistoryIdx(newIdx);
        setText(history[newIdx]);
      } else {
        setHistoryIdx(-1);
        setText('');
      }
    }
  };

  // Handle file drag and drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const imageFile = files.find(f => f.type.startsWith('image/'));
    if (imageFile) {
      const reader = new FileReader();
      reader.onload = () => {
        // Use the pending screenshot mechanism
        // This is a simplification — in reality you'd want to handle this differently
        const img = reader.result as string;
        // We can't directly set pendingScreenshot from here,
        // but we can notify parent via message
        onSendMessage(`[File dropped: ${imageFile.name}]`);
      };
      reader.readAsDataURL(imageFile);
    }
  };

  return (
    <div className="input-area-outer" onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
      {pendingScreenshot && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="pending-preview"
        >
          <img src={pendingScreenshot} alt="Pending" />
          <button className="remove-preview" onClick={onRemoveScreenshot}>
            <X size={12} />
          </button>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginLeft: '10px' }}>
            Screenshot attached. Type your request and send.
          </span>
        </motion.div>
      )}
      <div className="input-area" style={{ alignItems: 'flex-end' }}>
        <textarea
          ref={textareaRef}
          placeholder="Ask PersonalClaw anything... (Ctrl+K for commands)"
          value={text}
          onChange={(e) => { setText(e.target.value); setHistoryIdx(-1); }}
          onKeyDown={handleKeyDown}
        />
        <button
          className="screenshot-btn"
          onClick={onScreenshot}
          disabled={isCapturing}
          title="Capture Screenshot"
        >
          {isCapturing ? <Loader2 size={18} className="spin" /> : <Camera size={18} />}
        </button>
        <button
          className="send-btn"
          onClick={handleSend}
          style={{ height: '44px' }}
          title="Send (Enter)"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
};

export default React.memo(ChatInput);
