import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../types/conversation';
import { Terminal, ChevronDown, ChevronRight } from 'lucide-react';

interface LogConsoleProps {
  logs: LogEntry[];
  title?: string;
  startOpen?: boolean;
}

export function LogConsole({ logs, title = "Thinking Console", startOpen = false }: LogConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(startOpen);

  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isOpen]);

  if (logs.length === 0) return null;

  const getLogColor = (msg: string, level: string) => {
    if (level === 'ERROR') return '#ef4444'; // Red
    if (level === 'WARN') return '#f59e0b'; // Amber
    if (msg.includes('[Brain')) return '#38bdf8'; // Light blue
    if (msg.includes('[Vision]')) return '#c084fc'; // Purple
    if (msg.includes('[Learner]')) return '#34d399'; // Emerald
    if (msg.includes('[Browser]')) return '#facc15'; // Yellow
    if (msg.includes('[Server]')) return '#9ca3af'; // Gray
    if (msg.includes('[Push]')) return '#f472b6'; // Pink
    return '#e5e7eb'; // Default text color
  };

  return (
    <div className={`inline-log-console ${isOpen ? 'open' : 'closed'}`}>
      <button className="inline-log-header" onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Terminal size={14} />
        <span>{title} ({logs.length} events)</span>
      </button>
      
      {isOpen && (
        <div className="inline-log-body" ref={scrollRef}>
          {logs.map((log, index) => (
            <div key={index} className="log-line">
              <span className="log-time">
                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span 
                className="log-message" 
                style={{ color: getLogColor(log.message, log.level) }}
              >
                {log.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
