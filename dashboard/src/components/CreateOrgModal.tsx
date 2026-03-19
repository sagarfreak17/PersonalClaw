import { useState } from 'react';
import type { ProtectionMode } from '../types/org';

interface CreateOrgModalProps {
  onSubmit: (params: { name: string; mission: string; rootDir: string; protectionMode: ProtectionMode; manualPaths: string[] }) => void;
  onClose: () => void;
}

interface GitCheckResult { available: boolean; fileCount: number; }

export function CreateOrgModal({ onSubmit, onClose }: CreateOrgModalProps) {
  const [form, setForm] = useState({
    name: '', mission: '', rootDir: '',
    protectionMode: 'git' as ProtectionMode,
    manualPaths: [] as string[],
  });
  const [gitCheck, setGitCheck] = useState<GitCheckResult | null>(null);
  const [gitChecking, setGitChecking] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [error, setError] = useState('');

  const checkGit = async (dir: string) => {
    if (!dir.trim()) { setGitCheck(null); return; }
    setGitChecking(true);
    try {
      const res = await fetch('/api/check-git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir }),
      });
      setGitCheck(await res.json());
    } catch { setGitCheck(null); }
    setGitChecking(false);
  };

  const addPath = () => {
    if (!newPath.trim()) return;
    setForm(f => ({ ...f, manualPaths: [...f.manualPaths, newPath.trim()] }));
    setNewPath('');
  };

  const removePath = (idx: number) => {
    setForm(f => ({ ...f, manualPaths: f.manualPaths.filter((_, i) => i !== idx) }));
  };

  const browsePath = async () => {
    try {
      const res = await fetch('/api/browse-folder', { method: 'POST' });
      const data = await res.json();
      if (data.path) setNewPath(data.path);
    } catch { /* fallback to manual */ }
  };

  const gitUnavailable = gitCheck && !gitCheck.available;
  const showGitWarning = (form.protectionMode === 'git' || form.protectionMode === 'both') && gitUnavailable;
  const showManualSection = form.protectionMode === 'manual' || form.protectionMode === 'both';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel modal-panel--wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Create New Organisation</h3>
          <button onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          <div className="form-group">
            <label>Organisation Name</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. PersonalClaw Enterprise" />
          </div>
          <div className="form-group">
            <label>Mission Statement</label>
            <textarea value={form.mission} onChange={e => setForm(f => ({ ...f, mission: e.target.value }))} rows={3} placeholder="What is this org's purpose?" />
          </div>
          <div className="form-group">
            <label>Root Directory</label>
            <input
              value={form.rootDir}
              onChange={e => { setForm(f => ({ ...f, rootDir: e.target.value })); }}
              onBlur={e => checkGit(e.target.value)}
              placeholder="C:/Projects/MyProject"
            />
            {gitChecking && <div className="form-hint">Checking git...</div>}
            {gitCheck && !gitChecking && (
              <div className={`git-check-result ${gitCheck.available ? 'available' : 'unavailable'}`}>
                {gitCheck.available
                  ? `Git repo found — ${gitCheck.fileCount} files available for protection`
                  : 'No git repository found at this path'}
              </div>
            )}
            <div className="form-hint">Full Windows path. Agents write files to the workspace subdirectory here.</div>
          </div>

          <div className="form-section">
            <div className="form-section-title">File Protection</div>
            <div className="form-section-desc">Choose what agents cannot directly modify. They must submit proposals for protected files.</div>

            <div className="protection-mode-grid">
              {[
                { value: 'none' as const, label: 'None', desc: 'Agents can modify any file', disabled: false },
                { value: 'git' as const, label: 'Git tracked', desc: 'Protect files tracked by git in the root dir', disabled: gitUnavailable ?? false },
                { value: 'manual' as const, label: 'Manual', desc: 'Choose specific files and folders', disabled: false },
                { value: 'both' as const, label: 'Both', desc: 'Git tracked + manual additions', disabled: gitUnavailable ?? false },
              ].map(opt => (
                <button
                  key={opt.value}
                  className={`protection-mode-btn ${form.protectionMode === opt.value ? 'active' : ''} ${opt.disabled ? 'disabled' : ''}`}
                  onClick={() => !opt.disabled && setForm(f => ({ ...f, protectionMode: opt.value }))}
                  disabled={opt.disabled}
                >
                  <div className="protection-mode-label">{opt.label}</div>
                  <div className="protection-mode-desc">{opt.desc}</div>
                </button>
              ))}
            </div>

            {showGitWarning && (
              <div className="form-error">No git repository at this path — git protection unavailable. Choose Manual or None.</div>
            )}

            {showManualSection && (
              <div className="manual-paths-section">
                <label>Protected Paths</label>
                <div className="form-hint">Add files or folders to protect. Folder paths protect all files inside.</div>
                <div className="manual-path-list">
                  {form.manualPaths.map((p, i) => (
                    <div key={i} className="manual-path-entry">
                      <code>{p}</code>
                      <button className="manual-path-remove" onClick={() => removePath(i)}>&times;</button>
                    </div>
                  ))}
                  {form.manualPaths.length === 0 && <div className="empty-state" style={{ padding: '12px' }}>No paths added yet.</div>}
                </div>
                <div className="manual-path-input-row">
                  <input
                    value={newPath}
                    onChange={e => setNewPath(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addPath()}
                    placeholder="src/ or src/core/brain.ts"
                  />
                  <button className="btn-browse" onClick={browsePath} title="Browse">Browse</button>
                  <button className="btn-add-path" onClick={addPath} disabled={!newPath.trim()}>+ Add</button>
                </div>
              </div>
            )}
          </div>

          <div className="form-actions">
            <button className="btn-primary" onClick={() => {
              if (!form.name.trim() || !form.mission.trim() || !form.rootDir.trim()) {
                setError('Name, mission, and root directory are required.');
                return;
              }
              if (showGitWarning) { setError('Fix protection settings before creating.'); return; }
              onSubmit({
                name: form.name, mission: form.mission, rootDir: form.rootDir,
                protectionMode: form.protectionMode, manualPaths: form.manualPaths,
              });
              onClose();
            }}>Create Organisation</button>
            <button onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
