import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Send,
  Bot,
  User,
  Settings,
  FileCode,
  Shield,
  LayoutDashboard,
  Activity,
  Sun,
  Moon,
  Camera,
  Loader2,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
  image?: string;
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', text: 'Welcome back, System Admin. PersonalClaw is active and monitoring.', sender: 'bot', timestamp: new Date() }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [metrics, setMetrics] = useState({ cpu: 0, ram: '0', totalRam: '0' });
  const [isLightTheme, setIsLightTheme] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [pendingScreenshot, setPendingScreenshot] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const newSocket = io('http://localhost:3000');
    setSocket(newSocket);

    newSocket.on('metrics', (data: { cpu: number, ram: string, totalRam: string }) => {
      setMetrics(data);
    });

    newSocket.on('response', (data: { text: string }) => {
      setIsBotTyping(false);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        text: data.text,
        sender: 'bot',
        timestamp: new Date()
      }]);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isBotTyping]);

  useEffect(() => {
    if (isLightTheme) {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  }, [isLightTheme]);

  const handleSendMessage = () => {
    if ((!inputValue.trim() && !pendingScreenshot) || !socket) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      text: inputValue || (pendingScreenshot ? '[Sent an image for analysis]' : ''),
      sender: 'user',
      timestamp: new Date(),
      image: pendingScreenshot || undefined
    };

    setMessages(prev => [...prev, newMessage]);
    setIsBotTyping(true);
    
    // Send both text and optional image in one message
    socket.emit('message', { 
      text: inputValue || 'Analyze this image.', 
      image: pendingScreenshot 
    });

    setInputValue('');
    setPendingScreenshot(null);
  };

  const handleScreenshot = async () => {
    if (!socket) return;
    setIsCapturing(true);

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" } as any,
        audio: false
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      
      await new Promise((resolve) => {
        video.onloadedmetadata = () => {
          video.play();
          resolve(true);
        };
      });

      await new Promise(r => setTimeout(r, 500));

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = canvas.toDataURL('image/png');
      stream.getTracks().forEach(track => track.stop());

      setPendingScreenshot(imageData);
    } catch (err) {
      console.error('Screenshot failed:', err);
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div className="dashboard-container">
      <aside className="sidebar">
        <h1>PersonalClaw</h1>
        <nav style={{ flex: 1 }}>
          <ul style={{ listStyle: 'none' }}>
            <li className="nav-item active">
              <LayoutDashboard size={20} />
              <span>Command Center</span>
            </li>
            <li className="nav-item">
              <Activity size={20} />
              <span>System Metrics</span>
            </li>
            <li className="nav-item">
              <FileCode size={20} />
              <span>File Explorer</span>
            </li>
            <li className="nav-item">
              <Shield size={20} />
              <span>Security Logs</span>
            </li>
          </ul>
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            className="theme-toggle"
            onClick={() => setIsLightTheme(!isLightTheme)}
            title="Toggle Light/Dark Mode"
          >
            {isLightTheme ? <Moon size={20} /> : <Sun size={20} />}
          </button>
          <div className="agent-status">
            <div className="dot green" />
            <div style={{ fontSize: '0.8rem' }}>
              <div style={{ color: 'var(--text-dim)' }}>Agent Status</div>
              <div style={{ fontWeight: 600 }}>Online</div>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <div className="status-grid">
          <div className="stat-card">
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>CPU LOAD</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{metrics.cpu}%</div>
            <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '8px' }}>
              <div style={{ width: `${metrics.cpu}%`, height: '100%', background: 'var(--accent-primary)', borderRadius: '2px', transition: 'width 0.5s' }} />
            </div>
          </div>
          <div className="stat-card">
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>RAM USAGE</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{metrics.ram} GB / {metrics.totalRam} GB</div>
          </div>
          <div className="stat-card">
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>TASKS COMPLETED</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{messages.filter(m => m.sender === 'bot').length}</div>
          </div>
        </div>

        <div className="chat-panel">
          <div className="terminal-header">
            <div className="dot red" />
            <div className="dot yellow" />
            <div className="dot green" />
            <span style={{ marginLeft: '12px', fontSize: '0.8rem', opacity: 0.6, fontFamily: 'monospace' }}>personal-claw-v1.10.0 --active</span>
          </div>

          <div className="messages-container">
            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className={`message ${msg.sender}`}
                >
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ marginTop: '4px' }}>
                      {msg.sender === 'bot' ? <Bot size={18} /> : <User size={18} />}
                    </div>
                    <div className="message-text">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.text}
                      </ReactMarkdown>
                      {msg.image && (
                        <img 
                          src={msg.image} 
                          alt="Uploaded content" 
                          style={{ maxWidth: '100%', borderRadius: '8px', marginTop: '10px', border: '1px solid var(--border)' }} 
                        />
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
              {isBotTyping && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="message bot"
                  style={{ background: 'transparent', border: 'none', padding: '0 20px' }}
                >
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <Bot size={18} />
                    <div className="typing-indicator">
                      <div className="typing-dot" />
                      <div className="typing-dot" />
                      <div className="typing-dot" />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>

          <div className="input-area-outer">
            {pendingScreenshot && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="pending-preview"
              >
                <img src={pendingScreenshot} alt="Pending" />
                <button className="remove-preview" onClick={() => setPendingScreenshot(null)}>
                  <X size={14} />
                </button>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginLeft: '10px' }}>Screenshot attached. Type your request and send.</span>
              </motion.div>
            )}
            <div className="input-area" style={{ alignItems: 'flex-end' }}>
              <textarea
                placeholder="Ask PersonalClaw to do something..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
              />
              <button 
                className="screenshot-btn" 
                onClick={handleScreenshot} 
                disabled={isCapturing}
                title="Capture Screenshot"
              >
                {isCapturing ? <Loader2 size={20} className="spin" /> : <Camera size={20} />}
              </button>
              <button className="send-btn" onClick={handleSendMessage} style={{ height: '48px' }}>
                <Send size={20} />
              </button>
            </div>
          </div>
        </div>
      </main>

      <style>{`
        .nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          border-radius: 12px;
          color: var(--text-dim);
          cursor: pointer;
          transition: var(--transition);
          margin-bottom: 8px;
        }
        .nav-item:hover {
          color: var(--text-main);
          background: rgba(255,255,255,0.05);
        }
        body.light-theme .nav-item:hover {
          background: rgba(0,0,0,0.05);
        }
        .nav-item.active {
          color: white;
          background: var(--accent-primary);
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
        }
        .agent-status {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: var(--input-bg);
          border: 1px solid var(--border);
          border-radius: 16px;
          flex: 1;
        }
        .message-text p {
          margin: 0;
        }
        .theme-toggle {
          background: var(--input-bg);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-main);
          transition: var(--transition);
        }
        .theme-toggle:hover {
          border-color: var(--accent-primary);
          color: var(--accent-primary);
        }
        .screenshot-btn {
          height: 48px;
          width: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--input-bg);
          border: 1px solid var(--border);
          border-radius: 12px;
          color: var(--text-dim);
          cursor: pointer;
          transition: var(--transition);
        }
        .screenshot-btn:hover:not(:disabled) {
          border-color: var(--accent-primary);
          color: var(--accent-primary);
          background: rgba(99, 102, 241, 0.1);
        }
        .screenshot-btn:disabled {
          opacity: 0.5;
          cursor: wait;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 1s linear infinite;
        }
        .typing-indicator {
          display: flex;
          gap: 4px;
          padding: 12px 16px;
          background: var(--msg-bot-bg);
          border: 1px solid var(--border);
          border-radius: 12px;
          border-bottom-left-radius: 4px;
          width: fit-content;
        }
        .typing-dot {
          width: 6px;
          height: 6px;
          background: var(--accent-primary);
          border-radius: 50%;
          animation: typing 1.4s infinite ease-in-out;
        }
        .typing-dot:nth-child(1) { animation-delay: 0s; }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typing {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.3; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
        .input-area-outer {
          background: rgba(0, 0, 0, 0.1);
          border-top: 1px solid var(--border);
        }
        .pending-preview {
          padding: 10px 20px;
          display: flex;
          align-items: center;
          gap: 10px;
          position: relative;
        }
        .pending-preview img {
          height: 50px;
          width: 50px;
          object-fit: cover;
          border-radius: 8px;
          border: 2px solid var(--accent-primary);
        }
        .remove-preview {
          position: absolute;
          top: 5px;
          left: 55px;
          background: #ef4444;
          color: white;
          border: none;
          border-radius: 50%;
          width: 18px;
          height: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
};

export default App;
