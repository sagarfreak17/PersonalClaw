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
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const newSocket = io('http://localhost:3000');
    setSocket(newSocket);

    newSocket.on('metrics', (data: { cpu: number, ram: string, totalRam: string }) => {
      setMetrics(data);
    });

    newSocket.on('response', (data: { text: string }) => {
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
  }, [messages]);

  useEffect(() => {
    if (isLightTheme) {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  }, [isLightTheme]);

  const handleSendMessage = () => {
    if (!inputValue.trim() || !socket) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      text: inputValue,
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, newMessage]);
    socket.emit('message', { text: inputValue });
    setInputValue('');
  };

  const handleScreenshot = async () => {
    if (!socket) return;
    setIsCapturing(true);

    try {
      // Open the browser's native screen capture selection
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

      // Give it a tiny moment to settle
      await new Promise(r => setTimeout(r, 300));

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = canvas.toDataURL('image/png');
      
      // Stop all tracks
      stream.getTracks().forEach(track => track.stop());

      // Send to backend
      socket.emit('screenshot-capture', { image: imageData });
      
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        text: '_[Dashboard Screenshot Captured]_',
        sender: 'user',
        timestamp: new Date()
      }]);

    } catch (err) {
      console.error('Screenshot failed:', err);
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div className="dashboard-container">
      {/* Sidebar */}
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

      {/* Main Content */}
      <main className="main-content">
        {/* Top Stats */}
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

        {/* Chat Panel */}
        <div className="chat-panel">
          <div className="terminal-header">
            <div className="dot red" />
            <div className="dot yellow" />
            <div className="dot green" />
            <span style={{ marginLeft: '12px', fontSize: '0.8rem', opacity: 0.6, fontFamily: 'monospace' }}>personal-claw-v1.0.0 --active</span>
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
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>

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
              title="Capture System/Tab Screenshot"
            >
              {isCapturing ? <Loader2 size={20} className="spin" /> : <Camera size={20} />}
            </button>
            <button className="send-btn" onClick={handleSendMessage} style={{ height: '48px' }}>
              <Send size={20} />
            </button>
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
      `}</style>
    </div>
  );
};

export default App;

