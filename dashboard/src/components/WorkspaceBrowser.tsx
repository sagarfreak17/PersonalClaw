import { useState, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import type { WorkspaceFile } from '../types/org';

interface WorkspaceBrowserProps { orgId: string; socket: Socket; }

export function WorkspaceBrowser({ orgId, socket }: WorkspaceBrowserProps) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [currentDir, setCurrentDir] = useState('/');
  const [loading, setLoading] = useState(false);

  const loadDir = (dir: string) => {
    setLoading(true);
    socket.emit('org:workspace:list', { orgId, subdir: dir === '/' ? undefined : dir });
  };

  useEffect(() => { loadDir('/'); }, [orgId]);

  useEffect(() => {
    const handler = (data: any) => {
      if (data.orgId === orgId) { setFiles(data.files ?? []); setCurrentDir(data.dir); setLoading(false); }
    };
    socket.on('org:workspace:list', handler);
    return () => { socket.off('org:workspace:list', handler); };
  }, [orgId, socket]);

  const formatSize = (bytes: number) => bytes < 1024 ? `${bytes}B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)}KB` : `${(bytes / 1048576).toFixed(1)}MB`;

  return (
    <div className="workspace-browser">
      <div className="workspace-header">
        <h3 className="bod-section-title">Workspace Files</h3>
        <div className="workspace-breadcrumb">
          <button onClick={() => loadDir('/')} className="breadcrumb-btn">workspace</button>
          {currentDir !== '/' && currentDir.split('/').filter(Boolean).map((part, i, arr) => (
            <span key={i}>
              <span className="breadcrumb-sep">/</span>
              <button className="breadcrumb-btn" onClick={() => loadDir('/' + arr.slice(0, i + 1).join('/'))}>
                {part}
              </button>
            </span>
          ))}
        </div>
      </div>
      {loading ? <p className="empty-state">Loading...</p> : (
        <div className="workspace-file-list">
          {files.length === 0 && <p className="empty-state">Empty directory.</p>}
          {files.sort((a, b) => (b.isDir ? 1 : 0) - (a.isDir ? 1 : 0)).map(f => (
            <div key={f.path} className={`workspace-file-entry ${f.isDir ? 'is-dir' : ''}`}
              onClick={() => f.isDir ? loadDir(f.path) : undefined}>
              <span className="workspace-file-icon">{f.isDir ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}</span>
              <span className="workspace-file-name">{f.name}</span>
              {!f.isDir && <span className="workspace-file-size">{formatSize(f.size)}</span>}
              {!f.isDir && f.modified && <span className="workspace-file-date">{new Date(f.modified).toLocaleDateString()}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
