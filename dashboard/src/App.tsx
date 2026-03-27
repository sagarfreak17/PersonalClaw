import React, { useState, useEffect, useRef, useCallback } from 'react';
import ChatInput from './components/ChatInput';
import { ChatWorkspace } from './components/ChatWorkspace';
import { OrgWorkspace } from './components/OrgWorkspace';
import { TodosTab } from './components/TodosTab';

import { io, Socket } from 'socket.io-client';
import {
  Bot,
  User,
  FileCode,
  Shield,
  LayoutDashboard,
  Activity,
  Clock,
  HardDrive,
  Cpu,
  Database,
  Copy,
  Check,
  Zap,
  Search,
  X,
  History,
  Terminal,
  Wifi,
  WifiOff,
  ChevronRight,
  ChevronLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  ArrowUp,
  Building2,
  CheckSquare,
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
  toolUpdates?: string[];
  metadata?: { model?: string; turns?: number; toolCalls?: number };
}

interface ActivityItem {
  id: string;
  type: string;
  timestamp: number;
  source: string;
  summary: string;
}

interface SkillInfo {
  name: string;
  description: string;
}

type TabType = 'command' | 'metrics' | 'activity' | 'skills' | 'orgs' | 'todos';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', text: 'Welcome back. PersonalClaw v12.6 is online and ready.', sender: 'bot', timestamp: new Date() }
  ]);

  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [metrics, setMetrics] = useState({ cpu: 0, ram: '0', totalRam: '0', disk: '0', totalDisk: '0' });
  const [isCapturing, setIsCapturing] = useState(false);
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [pendingScreenshot, setPendingScreenshot] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('command');
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>([]);
  const [toolUpdates, setToolUpdates] = useState<string[]>([]);
  const [serverInfo, setServerInfo] = useState<any>(null);
  const [loadedSkills, setLoadedSkills] = useState<SkillInfo[]>([]);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [ramHistory, setRamHistory] = useState<number[]>([]);
  const [toasts, setToasts] = useState<{ id: string; text: string; type: 'info' | 'success' | 'error' }[]>([]);
  const [isSuperUser, setIsSuperUser] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const commandPaletteRef = useRef<HTMLInputElement>(null);

  // ── Toast notifications ──
  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((text: string, type: 'info' | 'success' | 'error' = 'info') => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev.slice(-4), { id, text, type }]);
    setTimeout(() => removeToast(id), 5000);
  }, [removeToast]);

  // ── Socket.io connection ──
  useEffect(() => {
    const newSocket = io('http://localhost:3000', {
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setConnected(true);
      addToast('Connected to PersonalClaw', 'success');
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
      addToast('Disconnected from server', 'error');
    });

    newSocket.on('init', (data: any) => {
      setServerInfo(data);
      if (data.skills) setLoadedSkills(data.skills);
      if (data.activity) setActivityFeed(data.activity);
    });

    newSocket.on('metrics', (data: any) => {
      // Batch into unstable_batchedUpdates equivalent — React 18 auto-batches in event handlers
      // but socket callbacks run outside React's scope, so we use a microtask to coalesce renders
      queueMicrotask(() => {
        setMetrics(data);
        setCpuHistory(prev => [...prev.slice(-29), data.cpu]);
        setRamHistory(prev => [...prev.slice(-29), parseFloat(data.ram)]);
      });
    });

    newSocket.on('response', (data: { text: string; metadata?: any }) => {
      setIsBotTyping(false);
      setToolUpdates([]);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        text: data.text,
        sender: 'bot',
        timestamp: new Date(),
        metadata: data.metadata,
      }]);
    });

    newSocket.on('tool_update', (data: { text: string }) => {
      setToolUpdates(prev => [...prev, data.text]);
    });

    newSocket.on('activity', (item: ActivityItem) => {
      setActivityFeed(prev => [...prev.slice(-49), item]);
    });

    const handleOrgNotification = (data: any) => {
      addToast(
        `[${data.orgName}] ${data.agentName}: ${data.message}`,
        data.level === 'error' ? 'error' : data.level === 'success' ? 'success' : 'info'
      );
    };
    newSocket.on('org:notification', handleOrgNotification);

    return () => {
      newSocket.close();
    };
  }, [addToast]);

  // ── Auto-scroll ──
  useEffect(() => {
    if (activeTab === 'command') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isBotTyping, activeTab]);


  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
        setCommandSearch('');
      }
      if (e.key === 'Escape') {
        setShowCommandPalette(false);
      }
      // Superuser toggle (Alt+Shift+S) — shows raw agent logs
      if (e.altKey && e.shiftKey && e.code === 'KeyS') {
        e.preventDefault();
        console.log('Superuser mode toggle triggered');
        setIsSuperUser(prev => {
          const next = !prev;
          addToast(next ? 'Super User Mode: Enabled' : 'Super User Mode: Disabled', next ? 'success' : 'info');
          return next;
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (showCommandPalette) {
      setTimeout(() => commandPaletteRef.current?.focus(), 50);
    }
  }, [showCommandPalette]);

  // ── Send message ──
  const handleSendMessage = useCallback((text: string) => {
    if ((!text.trim() && !pendingScreenshot) || !socket) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      text: text || (pendingScreenshot ? '[Sent an image for analysis]' : ''),
      sender: 'user',
      timestamp: new Date(),
      image: pendingScreenshot || undefined
    };

    setMessages(prev => [...prev, newMessage]);
    setIsBotTyping(true);
    setToolUpdates([]);

    socket.emit('message', {
      text: text || 'Analyze this image.',
      image: pendingScreenshot
    });

    setPendingScreenshot(null);
  }, [pendingScreenshot, socket]);

  // ── Screenshot capture ──
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
        video.onloadedmetadata = () => { video.play(); resolve(true); };
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

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ── Command palette commands ──
  const commands = [
    { label: 'New Session', cmd: '/new', icon: '🔄' },
    { label: 'System Status', cmd: '/status', icon: '📊' },
    { label: 'Performance Stats', cmd: '/perf', icon: '⚡' },
    { label: 'Audit Log', cmd: '/audit', icon: '📋' },
    { label: 'Browse Sessions', cmd: '/sessions', icon: '📁' },
    { label: 'List Skills', cmd: '/skills', icon: '🔧' },
    { label: 'List Models', cmd: '/models', icon: '🤖' },
    { label: 'Memory', cmd: '/memory', icon: '🧠' },
    { label: 'Screenshot', cmd: '/screenshot', icon: '📸' },
    { label: 'System Info', cmd: '/sysinfo', icon: '💻' },
    { label: 'Network Info', cmd: '/ip', icon: '🌐' },
    { label: 'Top Processes', cmd: '/procs', icon: '📈' },
    { label: 'Scheduled Jobs', cmd: '/jobs', icon: '⏰' },
    { label: 'Self-Learning', cmd: '/learned', icon: '🧬' },
    { label: 'Compact Context', cmd: '/compact', icon: '🗜️' },
    { label: 'Export Session', cmd: '/export', icon: '📦' },
    { label: 'Help', cmd: '/help', icon: '❓' },
  ];

  const filteredCommands = commands.filter(c =>
    c.label.toLowerCase().includes(commandSearch.toLowerCase()) ||
    c.cmd.toLowerCase().includes(commandSearch.toLowerCase())
  );

  const executeCommand = (cmd: string) => {
    setShowCommandPalette(false);
    handleSendMessage(cmd);
  };

  // ── Mini sparkline renderer ──
  const Sparkline = ({ data, color, height = 40 }: { data: number[]; color: string; height?: number }) => {
    if (data.length < 2) return null;
    const max = Math.max(...data, 1);
    const w = 200;
    const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - (v / max) * height}`).join(' ');
    return (
      <svg width={w} height={height} style={{ opacity: 0.8 }}>
        <polyline fill="none" stroke={color} strokeWidth="2" points={points} />
      </svg>
    );
  };

  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="dashboard-container">
      {/* ── Sidebar ── */}
      <aside className={`sidebar ${sidebarCollapsed ? 'sidebar--collapsed' : ''}`}>
        <div className="sidebar-brand">
          <Sparkles size={22} style={{ color: 'var(--accent-primary)' }} />
          {!sidebarCollapsed && <h1>PersonalClaw</h1>}
        </div>
        {!sidebarCollapsed && <div className="version-badge">v12.6.1</div>}

        <nav style={{ flex: 1 }}>
          <ul style={{ listStyle: 'none' }}>
            <li className={`nav-item ${activeTab === 'command' ? 'active' : ''}`} onClick={() => setActiveTab('command')} title="Command Center">
              <Terminal size={18} />
              {!sidebarCollapsed && <span>Command Center</span>}
            </li>
            <li className={`nav-item ${activeTab === 'metrics' ? 'active' : ''}`} onClick={() => setActiveTab('metrics')} title="System Metrics">
              <Activity size={18} />
              {!sidebarCollapsed && <span>System Metrics</span>}
            </li>
            <li className={`nav-item ${activeTab === 'activity' ? 'active' : ''}`} onClick={() => setActiveTab('activity')} title="Activity Feed">
              <Zap size={18} />
              {!sidebarCollapsed && <span>Activity Feed</span>}
              {activityFeed.length > 0 && (
                <span className="badge">{activityFeed.length}</span>
              )}
            </li>
            <li className={`nav-item ${activeTab === 'skills' ? 'active' : ''}`} onClick={() => setActiveTab('skills')} title="Skills & Config">
              <Settings size={18} />
              {!sidebarCollapsed && <span>Skills & Config</span>}
            </li>
            <li className={`nav-item ${activeTab === 'orgs' ? 'active' : ''}`} onClick={() => setActiveTab('orgs')} title="AI Organisations">
              <Building2 size={18} />
              {!sidebarCollapsed && <span>Orgs</span>}
            </li>
            <li className={`nav-item ${activeTab === 'todos' ? 'active' : ''}`} onClick={() => setActiveTab('todos')} title="Task Management">
              <CheckSquare size={18} />
              {!sidebarCollapsed && <span>Todos</span>}
            </li>
          </ul>
        </nav>

        {/* Quick actions */}
        {!sidebarCollapsed && (
          <div className="quick-actions">
            <button className="quick-btn" onClick={() => setShowCommandPalette(true)} title="Command Palette (Ctrl+K)">
              <Search size={16} />
              <span>Commands</span>
              <kbd>Ctrl+K</kbd>
            </button>
          </div>
        )}
        {sidebarCollapsed && (
          <div className="quick-actions">
            <button className="quick-btn" onClick={() => setShowCommandPalette(true)} title="Command Palette (Ctrl+K)" style={{ justifyContent: 'center' }}>
              <Search size={16} />
            </button>
          </div>
        )}

        <div className="agent-status" style={{ marginTop: '8px' }}>
          <div className={`dot ${connected ? 'green' : 'red'}`} />
          {!sidebarCollapsed && (
            <div style={{ fontSize: '0.75rem' }}>
              <div style={{ color: 'var(--text-dim)' }}>Agent</div>
              <div style={{ fontWeight: 600 }}>{connected ? 'Online' : 'Offline'}</div>
            </div>
          )}
        </div>

        <button
          className="sidebar-collapse-btn"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </aside>

      {/* ── Main Content ── */}
      <main className="main-content">
        {/* Status bar */}
        <div className="status-grid">
          <div className="stat-card">
            <div className="stat-label"><Cpu size={14} /> CPU</div>
            <div className="stat-value">{metrics.cpu}%</div>
            <div className="stat-bar">
              <div className="stat-bar-fill" style={{ width: `${metrics.cpu}%`, background: metrics.cpu > 80 ? '#ef4444' : 'var(--accent-primary)' }} />
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label"><Database size={14} /> RAM</div>
            <div className="stat-value">{metrics.ram} / {metrics.totalRam} GB</div>
            <div className="stat-bar">
              <div className="stat-bar-fill" style={{ width: `${(parseFloat(metrics.ram) / parseFloat(metrics.totalRam)) * 100}%` }} />
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label"><HardDrive size={14} /> Disk</div>
            <div className="stat-value">{metrics.disk} / {metrics.totalDisk} GB</div>
            <div className="stat-bar">
              <div className="stat-bar-fill" style={{ width: `${parseFloat(metrics.totalDisk) > 0 ? (parseFloat(metrics.disk) / parseFloat(metrics.totalDisk)) * 100 : 0}%` }} />
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label"><Zap size={14} /> Session</div>
            <div className="stat-value">{messages.filter(m => m.sender === 'user').length} turns</div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="content-area" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* ── Command Center — Always mounted to preserve chat history ── */}
          {socket && (
            <div
              style={{
                flex: 1,
                display: activeTab === 'command' ? 'flex' : 'none',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <ChatWorkspace socket={socket} isSuperUser={isSuperUser} />
            </div>
          )}

          <AnimatePresence mode="wait">

            {/* ── System Metrics ── */}
            {activeTab === 'metrics' && (
              <motion.div
                key="metrics"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="panel-glass"
                style={{ flex: 1, padding: '30px', overflowY: 'auto' }}
              >
                <h2>System Telemetry</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px', marginTop: '24px' }}>
                  <div className="metric-card">
                    <div className="metric-header">
                      <Cpu size={20} color="var(--accent-primary)" />
                      <span>Processor Load</span>
                    </div>
                    <div className="metric-value">{metrics.cpu}%</div>
                    <Sparkline data={cpuHistory} color="var(--accent-primary)" />
                  </div>
                  <div className="metric-card">
                    <div className="metric-header">
                      <Database size={20} color="var(--accent-secondary)" />
                      <span>Memory Usage</span>
                    </div>
                    <div className="metric-value">{metrics.ram} GB</div>
                    <div className="metric-sub">of {metrics.totalRam} GB total</div>
                    <Sparkline data={ramHistory} color="var(--accent-secondary)" />
                  </div>
                  <div className="metric-card">
                    <div className="metric-header">
                      <HardDrive size={20} color="#10b981" />
                      <span>Disk Usage</span>
                    </div>
                    <div className="metric-value">{metrics.disk} GB</div>
                    <div className="metric-sub">of {metrics.totalDisk} GB on C:</div>
                    <div className="stat-bar" style={{ marginTop: '12px', height: '8px' }}>
                      <div className="stat-bar-fill" style={{
                        width: `${parseFloat(metrics.totalDisk) > 0 ? (parseFloat(metrics.disk) / parseFloat(metrics.totalDisk)) * 100 : 0}%`,
                        background: '#10b981',
                      }} />
                    </div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-header">
                      <Zap size={20} color="#f59e0b" />
                      <span>Session Info</span>
                    </div>
                    <div style={{ fontSize: '0.85rem', marginTop: '8px', lineHeight: 1.8 }}>
                      <div>Model: <code>{serverInfo?.model || 'loading...'}</code></div>
                      <div>Turns: <strong>{messages.filter(m => m.sender === 'user').length}</strong></div>
                      <div>Skills: <strong>{loadedSkills.length}</strong></div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── Activity Feed ── */}
            {activeTab === 'activity' && (
              <motion.div
                key="activity"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="panel-glass"
                style={{ flex: 1, padding: '30px', overflowY: 'auto' }}
              >
                <h2>Activity Feed</h2>
                <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginTop: '8px' }}>
                  Real-time events from all PersonalClaw subsystems
                </p>

                <div className="activity-list" style={{ marginTop: '20px' }}>
                  {activityFeed.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
                      <Activity size={40} style={{ marginBottom: '12px', opacity: 0.3 }} />
                      <p>No activity yet. Start chatting to see events here.</p>
                    </div>
                  )}
                  {[...activityFeed].reverse().map((item) => (
                    <div key={item.id} className="activity-item">
                      <div className={`activity-dot ${item.type.includes('fail') || item.type.includes('error') ? 'red' : item.type.includes('complete') || item.type.includes('connect') ? 'green' : 'blue'}`} />
                      <div style={{ flex: 1 }}>
                        <div className="activity-summary">{item.summary}</div>
                        <div className="activity-meta">
                          {formatTime(item.timestamp)} &middot; {item.source}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── Skills & Config ── */}
            {activeTab === 'skills' && (
              <motion.div
                key="skills"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="panel-glass"
                style={{ flex: 1, padding: '30px', overflowY: 'auto' }}
              >
                <h2>Loaded Skills ({loadedSkills.length})</h2>
                <div className="skills-grid" style={{ marginTop: '20px' }}>
                  {loadedSkills.map((skill) => (
                    <div key={skill.name} className="skill-card">
                      <div className="skill-name">{skill.name}</div>
                      <div className="skill-desc">{skill.description}</div>
                    </div>
                  ))}
                </div>

                <h2 style={{ marginTop: '30px' }}>Quick Commands</h2>
                <div className="commands-grid" style={{ marginTop: '16px' }}>
                  {commands.map(cmd => (
                    <button
                      key={cmd.cmd}
                      className="command-card"
                      onClick={() => executeCommand(cmd.cmd)}
                    >
                      <span className="command-icon">{cmd.icon}</span>
                      <span className="command-label">{cmd.label}</span>
                      <code className="command-cmd">{cmd.cmd}</code>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── AI Organisations ── */}
            {activeTab === 'orgs' && socket && (
              <motion.div
                key="orgs"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                style={{ flex: 1, display: 'flex', overflow: 'hidden' }}
              >
                <OrgWorkspace socket={socket} />
              </motion.div>
            )}

            {/* ── Todos ── */}
            {activeTab === 'todos' && socket && (
              <motion.div
                key="todos"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                style={{ flex: 1, display: 'flex', overflow: 'hidden' }}
              >
                <TodosTab socket={socket} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* ── Command Palette ── */}
      <AnimatePresence>
        {showCommandPalette && (
          <motion.div
            className="command-palette-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowCommandPalette(false)}
          >
            <motion.div
              className="command-palette"
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="palette-search">
                <Search size={18} />
                <input
                  ref={commandPaletteRef}
                  type="text"
                  placeholder="Type a command..."
                  value={commandSearch}
                  onChange={(e) => setCommandSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && filteredCommands.length > 0) {
                      executeCommand(filteredCommands[0].cmd);
                    }
                  }}
                />
                <kbd>ESC</kbd>
              </div>
              <div className="palette-results">
                {filteredCommands.map((cmd) => (
                  <button
                    key={cmd.cmd}
                    className="palette-item"
                    onClick={() => executeCommand(cmd.cmd)}
                  >
                    <span className="palette-icon">{cmd.icon}</span>
                    <span className="palette-label">{cmd.label}</span>
                    <code className="palette-cmd">{cmd.cmd}</code>
                  </button>
                ))}
                {filteredCommands.length === 0 && (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)' }}>
                    No commands found
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Toast Notifications ── */}
      <div className="toast-container">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              className={`toast toast-${toast.type}`}
              initial={{ opacity: 0, y: 20, x: 20 }}
              animate={{ opacity: 1, y: 0, x: 0 }}
              exit={{ opacity: 0, x: 50 }}
              onClick={() => removeToast(toast.id)}
              style={{ cursor: 'pointer' }}
              title="Click to dismiss"
            >
              {toast.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default App;
