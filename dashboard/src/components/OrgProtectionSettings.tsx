import { useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { Org, ProtectionMode } from '../types/org';

interface OrgProtectionSettingsProps { org: Org; socket: Socket; }

export function OrgProtectionSettings({ org, socket }: OrgProtectionSettingsProps) {
  const [mode, setMode] = useState<ProtectionMode>(org.protection.mode);
  const [manualPaths, setManualPaths] = useState<string[]>(org.protection.manualPaths);
  const [newPath, setNewPath] = useState('');
  const [saved, setSaved] = useState(false);
  const [gitCount, setGitCount] = useState(org.protection.gitFiles.length);
  const [gitFiles, setGitFiles] = useState<string[]>(org.protection.gitFiles);
  const [showAllFiles, setShowAllFiles] = useState(false);

  const save = (refreshGit = false) => {
    socket.emit('org:protection:update', {
      orgId: org.id, mode, manualPaths, refreshGit,
    });
    if (refreshGit) {
      socket.once('org:updated', (updatedOrg: Org) => {
        if (updatedOrg.id === org.id) {
          setGitCount(updatedOrg.protection.gitFiles.length);
          setGitFiles(updatedOrg.protection.gitFiles);
        }
      });
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addPath = () => {
    if (!newPath.trim()) return;
    setManualPaths(prev => [...prev, newPath.trim()]);
    setNewPath('');
  };

  const showManual = mode === 'manual' || mode === 'both';
  const showGit = mode === 'git' || mode === 'both';

  // Group git files by directory for display
  const groupedFiles = (() => {
    const groups: Record<string, string[]> = {};
    for (const f of gitFiles) {
      const parts = f.replace(/\\/g, '/').split('/');
      const filename = parts.pop() ?? f;
      const dir = parts.join('/') || '/';
      if (!groups[dir]) groups[dir] = [];
      groups[dir].push(filename);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  })();

  return (
    <div className="protection-settings">
      <h3 className="bod-section-title">Protection Settings</h3>
      <p className="form-hint">Controls which files agents must submit proposals to modify. Changes take effect immediately.</p>

      <div className="protection-mode-grid">
        {(['none', 'git', 'manual', 'both'] as ProtectionMode[]).map(m => (
          <button
            key={m}
            className={`protection-mode-btn ${mode === m ? 'active' : ''}`}
            onClick={() => setMode(m)}
          >
            <div className="protection-mode-label">
              {m === 'none' ? 'None' : m === 'git' ? 'Git' : m === 'manual' ? 'Manual' : 'Both'}
            </div>
          </button>
        ))}
      </div>

      {showGit && (
        <div className="protection-git-info">
          <span>{gitCount} files from git snapshot</span>
          <button className="btn-refresh-git" onClick={() => save(true)}>Refresh from git</button>
          <span className="form-hint">Last updated: {new Date(org.protection.lastUpdated).toLocaleString()}</span>
        </div>
      )}

      {showGit && gitFiles.length > 0 && (
        <div className="protection-file-list-section">
          <button
            className="btn-sm"
            onClick={() => setShowAllFiles(!showAllFiles)}
            style={{ marginBottom: 8 }}
          >
            {showAllFiles ? 'Hide protected files' : `View all ${gitCount} protected files`}
          </button>
          {showAllFiles && (
            <div className="protection-file-list" style={{ maxHeight: 400, overflow: 'auto', background: '#111', borderRadius: 6, padding: 12, fontSize: 12, fontFamily: 'monospace' }}>
              {groupedFiles.map(([dir, files]) => (
                <div key={dir} style={{ marginBottom: 8 }}>
                  <div style={{ color: '#60a5fa', fontWeight: 600, marginBottom: 2 }}>{dir}/</div>
                  {files.map((f, i) => (
                    <div key={i} style={{ paddingLeft: 16, color: '#d1d5db' }}>{f}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showManual && (
        <div className="manual-paths-section">
          <label>Manual Protected Paths</label>
          <div className="manual-path-list">
            {manualPaths.map((p, i) => (
              <div key={i} className="manual-path-entry">
                <code>{p}</code>
                <button className="manual-path-remove" onClick={() => setManualPaths(prev => prev.filter((_, j) => j !== i))}>&times;</button>
              </div>
            ))}
            {manualPaths.length === 0 && <div className="empty-state" style={{ padding: '12px' }}>No manual paths.</div>}
          </div>
          <div className="manual-path-input-row">
            <input value={newPath} onChange={e => setNewPath(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPath()} placeholder="src/ or config/settings.json" />
            <button className="btn-add-path" onClick={addPath} disabled={!newPath.trim()}>+ Add</button>
          </div>
        </div>
      )}

      <div className="form-actions">
        <button className="btn-primary" onClick={() => save(false)}>
          {saved ? 'Saved' : 'Save Protection Settings'}
        </button>
      </div>
    </div>
  );
}
