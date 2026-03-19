# PersonalClaw v12.1 — Patch: Multi-Org Protection System
## Replaces the single-repo file guard with per-org, configurable protection

> **Applies on top of v12.1 FINAL v2.** Fixes FIX-R (wrong git root) and adds
> flexible protection modes. All changes written against actual v12.1 source.

---

## WHAT THIS PATCH CHANGES

The original v12.1 plan ran `git ls-files` from `process.cwd()` (PersonalClaw's
root) for every org. This patch makes protection **per-org and configurable**:

- Each org runs `git ls-files` from its own root directory
- Manual path additions supported alongside or instead of git
- Protection mode selectable at creation and editable after
- Works for users with no git repo on their project
- Works for public users who download PersonalClaw and point it at any project

---

## DATA STRUCTURE CHANGES

### Updated `Org` interface in `src/core/org-manager.ts`

```typescript
export type ProtectionMode = 'none' | 'git' | 'manual' | 'both';

export interface Org {
  id: string;
  name: string;
  mission: string;
  rootDir: string;
  orgDir: string;
  workspaceDir: string;
  createdAt: string;
  paused: boolean;
  agents: OrgAgent[];
  // Protection — replaces flat protectedFiles array
  protection: {
    mode: ProtectionMode;
    gitFiles: string[];        // absolute paths — populated from git ls-files at rootDir
    manualPaths: string[];     // absolute paths — user-specified files/folders
    lastUpdated: string;
  };
}
```

**Computed protected set** — at runtime, union of `gitFiles` + expanded `manualPaths`:

```typescript
// Helper on OrgManager — returns the full set of protected absolute paths
getProtectedFiles(orgId: string): string[] {
  const org = this.orgs.get(orgId);
  if (!org) return [];
  const { mode, gitFiles, manualPaths } = org.protection;
  if (mode === 'none') return [];
  if (mode === 'git') return gitFiles;
  if (mode === 'manual') return this.expandManualPaths(org.rootDir, manualPaths);
  // 'both'
  return [...gitFiles, ...this.expandManualPaths(org.rootDir, manualPaths)];
}

// Expand folder paths to all files within them
private expandManualPaths(rootDir: string, manualPaths: string[]): string[] {
  const result: string[] = [];
  for (const p of manualPaths) {
    const abs = path.isAbsolute(p) ? p : path.join(rootDir, p);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      result.push(abs);
    } else if (stat.isDirectory()) {
      // Recursively add all files in the folder
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else result.push(full);
        }
      };
      walk(abs);
    }
  }
  return result;
}
```

---

## BACKEND CHANGES

### 1 — Update `src/core/org-file-guard.ts`

#### Replace `snapshotProtectedFiles()` — now takes `rootDir` param

```typescript
/**
 * Snapshot git-tracked files from the org's own root directory.
 * Returns absolute paths. Returns empty array if no git repo at rootDir.
 */
export function snapshotGitFiles(rootDir: string): string[] {
  try {
    const output = execSync('git ls-files', {
      cwd: rootDir,           // FIX: org's dir, not PersonalClaw's dir
      encoding: 'utf-8',
      timeout: 5000,
    });
    return output.split('\n')
      .filter(Boolean)
      .map(f => path.join(rootDir, f.trim()).replace(/\\/g, '/'));
  } catch {
    console.warn(`[OrgFileGuard] No git repo at ${rootDir} — git protection unavailable.`);
    return [];
  }
}

/**
 * Check if a git repo exists at the given directory.
 * Used by frontend to validate before offering git protection option.
 */
export function hasGitRepo(rootDir: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd: rootDir, timeout: 3000, stdio: 'ignore' });
    return true;
  } catch { return false; }
}
```

#### Update `isProtectedFile()` — absolute path comparison

```typescript
export function isProtectedFile(absolutePath: string, protectedFiles: string[]): boolean {
  const normalized = absolutePath.replace(/\\/g, '/');
  return protectedFiles.some(f => f.replace(/\\/g, '/') === normalized);
}
```

#### Update `createProposal()` — uses `orgManager.getProtectedFiles()`

```typescript
// Replace the direct protectedFiles reference:
// BEFORE: isProtectedFile(targetPath, org.protectedFiles)
// AFTER:
const { orgManager } = await import('./org-manager.js');
const protectedFiles = orgManager.getProtectedFiles(params.orgId);
if (isProtectedFile(params.absolutePath, protectedFiles)) { ... }
```

---

### 2 — Update `src/core/org-manager.ts`

#### Update `create()` — new protection structure

```typescript
create(params: {
  name: string;
  mission: string;
  rootDir?: string;
  protectionMode?: ProtectionMode;
  manualPaths?: string[];
}): Org {
  // ... existing dir creation logic unchanged ...

  const mode: ProtectionMode = params.protectionMode ?? 'git';
  const gitFiles = (mode === 'git' || mode === 'both')
    ? snapshotGitFiles(workspaceDir)   // snapshot from org's workspace dir
    : [];
  const manualPaths = (mode === 'manual' || mode === 'both')
    ? (params.manualPaths ?? [])
    : [];

  const org: Org = {
    id: `org_${Date.now()}`,
    name: params.name,
    mission: params.mission,
    rootDir: workspaceDir,
    orgDir,
    workspaceDir,
    createdAt: new Date().toISOString(),
    paused: false,
    agents: [],
    protection: {
      mode,
      gitFiles,
      manualPaths,
      lastUpdated: new Date().toISOString(),
    },
  };
  // ... rest unchanged ...
}
```

#### Add `updateProtection()` method — editable after creation

```typescript
updateProtection(orgId: string, params: {
  mode?: ProtectionMode;
  manualPaths?: string[];
  refreshGit?: boolean;  // re-run git ls-files
}): Org {
  const org = this.orgs.get(orgId);
  if (!org) throw new Error(`Org ${orgId} not found`);

  if (params.mode !== undefined) org.protection.mode = params.mode;
  if (params.manualPaths !== undefined) org.protection.manualPaths = params.manualPaths;

  // Re-snapshot git files if requested or if mode includes git
  if (params.refreshGit || (params.mode && (params.mode === 'git' || params.mode === 'both'))) {
    org.protection.gitFiles = snapshotGitFiles(org.workspaceDir);
    console.log(`[OrgManager] Git snapshot refreshed for ${org.name}: ${org.protection.gitFiles.length} files`);
  }

  org.protection.lastUpdated = new Date().toISOString();
  this.persist(org);
  eventBus.dispatch(Events.ORG_UPDATED, { org }, 'org-manager');
  return org;
}
```

#### Add `getProtectedFiles()` + `expandManualPaths()` + `hasGitRepo()` as shown in data structure section above.

#### Update `loadAll()` — back-fill `protection` for orgs created before this patch

```typescript
// Inside the org loading loop, after existing back-fills:
if (!org.protection) {
  // Migrate from old flat protectedFiles array
  org.protection = {
    mode: (org.protectedFiles?.length > 0) ? 'git' : 'none',
    gitFiles: org.protectedFiles ?? [],
    manualPaths: [],
    lastUpdated: new Date().toISOString(),
  };
  delete org.protectedFiles; // clean up old field
}
```

---

### 3 — Update `src/core/org-agent-runner.ts`

In `orgAwareHandleToolCall()`, replace direct `org.protectedFiles` reference:

```typescript
// BEFORE
if (isProtectedFile(targetPath, org.protectedFiles)) {

// AFTER
const protectedFiles = orgManager.getProtectedFiles(org.id);
if (org.protection.mode !== 'none' && isProtectedFile(targetPath, protectedFiles)) {
```

---

### 4 — Update `src/index.ts`

#### New REST endpoints for protection management

```typescript
// Check git availability at a given path (called by frontend before offering git option)
app.post('/api/check-git', (req, res) => {
  const { dir } = req.body;
  if (!dir) return res.status(400).json({ error: 'dir required' });
  const { hasGitRepo, snapshotGitFiles } = require('./core/org-file-guard.js');
  const available = hasGitRepo(dir);
  const count = available ? snapshotGitFiles(dir).length : 0;
  res.json({ available, fileCount: count });
});

// Update org protection settings
app.put('/api/orgs/:id/protection', (req, res) => {
  try {
    const { mode, manualPaths, refreshGit } = req.body;
    const org = orgManager.updateProtection(req.params.id, { mode, manualPaths, refreshGit });
    io.emit('org:updated', org);
    res.json(org);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});
```

#### New socket handler for protection updates

```typescript
socket.on('org:protection:update', (params: {
  orgId: string;
  mode?: ProtectionMode;
  manualPaths?: string[];
  refreshGit?: boolean;
}) => {
  try {
    const org = orgManager.updateProtection(params.orgId, {
      mode: params.mode,
      manualPaths: params.manualPaths,
      refreshGit: params.refreshGit,
    });
    io.emit('org:updated', org);
  } catch (err: any) {
    socket.emit('org:error', { message: err.message });
  }
});
```

---

## FRONTEND CHANGES

### 5 — Update `dashboard/src/types/org.ts`

```typescript
export type ProtectionMode = 'none' | 'git' | 'manual' | 'both';

export interface OrgProtection {
  mode: ProtectionMode;
  gitFiles: string[];
  manualPaths: string[];
  lastUpdated: string;
}

// Update Org interface — replace protectedFiles with protection
export interface Org {
  // ... existing fields ...
  protection: OrgProtection;  // replaces protectedFiles: string[]
}
```

---

### 6 — Update `dashboard/src/components/CreateOrgModal.tsx`

Add a Protection section to the form. This is the main UI change.

```typescript
import { useState } from 'react';
import type { ProtectionMode } from '../types/org';

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

  // Check git availability when rootDir changes
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

  // Browse button — uses Electron/native file dialog if available, else manual input
  const browsePath = async () => {
    // PersonalClaw runs on Windows. Use PowerShell via the backend to open a folder picker.
    try {
      const res = await fetch('/api/browse-folder', { method: 'POST' });
      const { path } = await res.json();
      if (path) setNewPath(path);
    } catch {
      // Fallback — user types manually
    }
  };

  const gitUnavailable = gitCheck && !gitCheck.available;
  const showGitWarning = (form.protectionMode === 'git' || form.protectionMode === 'both') && gitUnavailable;
  const showManualSection = form.protectionMode === 'manual' || form.protectionMode === 'both';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel modal-panel--wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Create New Organisation</h3>
          <button onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          {/* Basic info */}
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
              onChange={e => { setForm(f => ({ ...f, rootDir: e.target.value })); checkGit(e.target.value); }}
              placeholder="C:/Projects/MyProject"
            />
            {gitChecking && <div className="form-hint">Checking git…</div>}
            {gitCheck && !gitChecking && (
              <div className={`git-check-result ${gitCheck.available ? 'available' : 'unavailable'}`}>
                {gitCheck.available
                  ? `✅ Git repo found — ${gitCheck.fileCount} files available for protection`
                  : '⚠️ No git repository found at this path'}
              </div>
            )}
            <div className="form-hint">Full Windows path. Agents write files to the workspace subdirectory here.</div>
          </div>

          {/* Protection */}
          <div className="form-section">
            <div className="form-section-title">🔒 File Protection</div>
            <div className="form-section-desc">Choose what agents cannot directly modify. They must submit proposals for protected files.</div>

            <div className="protection-mode-grid">
              {[
                { value: 'none', label: '🔓 None', desc: 'Agents can modify any file' },
                { value: 'git', label: '📦 Git tracked', desc: 'Protect files tracked by git in the root dir', disabled: gitUnavailable ?? false },
                { value: 'manual', label: '📁 Manual', desc: 'Choose specific files and folders' },
                { value: 'both', label: '📦 + 📁 Both', desc: 'Git tracked + manual additions', disabled: gitUnavailable ?? false },
              ].map(opt => (
                <button
                  key={opt.value}
                  className={`protection-mode-btn ${form.protectionMode === opt.value ? 'active' : ''} ${opt.disabled ? 'disabled' : ''}`}
                  onClick={() => !opt.disabled && setForm(f => ({ ...f, protectionMode: opt.value as ProtectionMode }))}
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

            {/* Manual path picker */}
            {showManualSection && (
              <div className="manual-paths-section">
                <label>Protected Paths</label>
                <div className="form-hint">Add files or folders to protect. Folder paths protect all files inside.</div>
                <div className="manual-path-list">
                  {form.manualPaths.map((p, i) => (
                    <div key={i} className="manual-path-entry">
                      <span className="manual-path-icon">{p.endsWith('/') || !p.includes('.') ? '📁' : '📄'}</span>
                      <code>{p}</code>
                      <button className="manual-path-remove" onClick={() => removePath(i)}>×</button>
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
                  <button className="btn-browse" onClick={browsePath} title="Browse">📂</button>
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
```

---

### 7 — New Component: `dashboard/src/components/OrgProtectionSettings.tsx`

Allows editing protection after org creation. Rendered in a new Settings sub-tab in OrgWorkspace.

```typescript
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

  const save = (refreshGit = false) => {
    socket.emit('org:protection:update', {
      orgId: org.id, mode, manualPaths, refreshGit,
    });
    if (refreshGit) {
      // Optimistic update — re-fetch org to get new count
      socket.once('org:updated', (updatedOrg: Org) => {
        if (updatedOrg.id === org.id) setGitCount(updatedOrg.protection.gitFiles.length);
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

  return (
    <div className="protection-settings">
      <h3 className="bod-section-title">🔒 Protection Settings</h3>
      <p className="form-hint">Controls which files agents must submit proposals to modify. Changes take effect immediately.</p>

      <div className="protection-mode-grid">
        {(['none', 'git', 'manual', 'both'] as ProtectionMode[]).map(m => (
          <button
            key={m}
            className={`protection-mode-btn ${mode === m ? 'active' : ''}`}
            onClick={() => setMode(m)}
          >
            <div className="protection-mode-label">
              {m === 'none' ? '🔓 None' : m === 'git' ? '📦 Git' : m === 'manual' ? '📁 Manual' : '📦 + 📁 Both'}
            </div>
          </button>
        ))}
      </div>

      {(mode === 'git' || mode === 'both') && (
        <div className="protection-git-info">
          <span>📦 {gitCount} files from git snapshot</span>
          <button className="btn-refresh-git" onClick={() => save(true)}>🔄 Refresh from git</button>
          <span className="form-hint">Last updated: {new Date(org.protection.lastUpdated).toLocaleString()}</span>
        </div>
      )}

      {showManual && (
        <div className="manual-paths-section">
          <label>Manual Protected Paths</label>
          <div className="manual-path-list">
            {manualPaths.map((p, i) => (
              <div key={i} className="manual-path-entry">
                <code>{p}</code>
                <button className="manual-path-remove" onClick={() => setManualPaths(prev => prev.filter((_, j) => j !== i))}>×</button>
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
          {saved ? '✅ Saved' : 'Save Protection Settings'}
        </button>
      </div>
    </div>
  );
}
```

---

### 8 — Add browse-folder endpoint to `src/index.ts`

Opens a PowerShell folder picker dialog on Windows:

```typescript
app.post('/api/browse-folder', async (req, res) => {
  try {
    const { execSync } = await import('child_process');
    // PowerShell folder browser dialog
    const result = execSync(
      `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select folder to protect'; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $f.SelectedPath } else { '' }"`,
      { encoding: 'utf-8', timeout: 30000 }
    ).trim();
    res.json({ path: result || null });
  } catch {
    res.json({ path: null });
  }
});

app.post('/api/browse-file', async (req, res) => {
  try {
    const { execSync } = await import('child_process');
    const result = execSync(
      `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Multiselect = $false; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $f.FileName } else { '' }"`,
      { encoding: 'utf-8', timeout: 30000 }
    ).trim();
    res.json({ path: result || null });
  } catch {
    res.json({ path: null });
  }
});
```

---

### 9 — Update `dashboard/src/components/OrgWorkspace.tsx`

Add Settings sub-tab:

```typescript
// Update tab type
type OrgSubTab = 'agents' | 'tickets' | 'board' | 'proposals' | 'activity' | 'memory' | 'settings';

// Add import
import { OrgProtectionSettings } from './OrgProtectionSettings';

// Add Settings tab button
{tab === 'settings' ? '⚙️ Settings' : ...}

// Add Settings tab content
{subTab === 'settings' && (
  <OrgProtectionSettings org={activeOrg} socket={socket} />
)}
```

---

## CSS ADDITIONS

Append to `dashboard/src/index.css`:

```css
/* ===== PROTECTION SETTINGS ===== */
.protection-settings { display: flex; flex-direction: column; gap: 20px; max-width: 640px; }
.protection-mode-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.protection-mode-btn {
  padding: 12px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.03); color: inherit; cursor: pointer;
  text-align: left; transition: all 0.15s; display: flex; flex-direction: column; gap: 4px;
}
.protection-mode-btn:hover { background: rgba(255,255,255,0.07); }
.protection-mode-btn.active { border-color: var(--accent-primary, #6366f1); background: rgba(99,102,241,0.12); }
.protection-mode-btn.disabled { opacity: 0.35; cursor: not-allowed; }
.protection-mode-label { font-size: 13px; font-weight: 600; }
.protection-mode-desc { font-size: 11px; opacity: 0.5; line-height: 1.3; }
.protection-git-info { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: rgba(255,255,255,0.03); border-radius: 8px; padding: 10px 14px; font-size: 13px; }
.btn-refresh-git { padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.15); background: none; color: inherit; cursor: pointer; font-size: 12px; }
.btn-refresh-git:hover { background: rgba(255,255,255,0.07); }
.git-check-result { font-size: 12px; padding: 6px 10px; border-radius: 6px; margin-top: 4px; }
.git-check-result.available { background: rgba(34,197,94,0.1); color: #4ade80; }
.git-check-result.unavailable { background: rgba(245,158,11,0.1); color: #fbbf24; }
.manual-paths-section { display: flex; flex-direction: column; gap: 8px; }
.manual-path-list { background: rgba(0,0,0,0.2); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 4px; min-height: 60px; }
.manual-path-entry { display: flex; align-items: center; gap: 8px; padding: 5px 8px; background: rgba(255,255,255,0.04); border-radius: 6px; font-size: 12px; }
.manual-path-icon { flex-shrink: 0; }
.manual-path-entry code { flex: 1; }
.manual-path-remove { background: none; border: none; color: #f87171; cursor: pointer; font-size: 16px; opacity: 0.6; line-height: 1; padding: 0 4px; }
.manual-path-remove:hover { opacity: 1; }
.manual-path-input-row { display: flex; gap: 6px; }
.manual-path-input-row input { flex: 1; padding: 8px 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 7px; color: inherit; font-size: 13px; }
.btn-browse { padding: 8px 10px; border-radius: 7px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: inherit; cursor: pointer; font-size: 14px; }
.btn-browse:hover { background: rgba(255,255,255,0.08); }
.btn-add-path { padding: 8px 14px; border-radius: 7px; border: none; background: var(--accent-primary, #6366f1); color: white; cursor: pointer; font-size: 13px; white-space: nowrap; }
.btn-add-path:disabled { opacity: 0.35; cursor: not-allowed; }
.form-section { display: flex; flex-direction: column; gap: 12px; padding: 16px; background: rgba(255,255,255,0.02); border-radius: 10px; border: 1px solid rgba(255,255,255,0.06); }
.form-section-title { font-size: 13px; font-weight: 700; }
.form-section-desc { font-size: 12px; opacity: 0.5; margin: -6px 0 0; }
```

---

## IMPLEMENTATION ORDER FOR THIS PATCH

Run `npx tsc --noEmit` after each phase.

### Phase A — Backend (Opus 4.6)
1. Update `src/core/org-file-guard.ts` — replace `snapshotProtectedFiles` with `snapshotGitFiles(rootDir)`, `hasGitRepo()`, updated `isProtectedFile()`, updated `createProposal()` call
2. Update `src/core/org-manager.ts` — new `ProtectionMode` type, updated `Org` interface, updated `create()`, add `updateProtection()`, add `getProtectedFiles()`, add `expandManualPaths()`, add `getBrowserDataDir()`, update `loadAll()` migration
3. Update `src/core/org-agent-runner.ts` — replace `org.protectedFiles` with `orgManager.getProtectedFiles(org.id)` + `org.protection.mode !== 'none'` check
4. Update `src/index.ts` — add `/api/check-git`, `/api/browse-folder`, `/api/browse-file`, `/api/orgs/:id/protection` endpoints, add `org:protection:update` socket handler
5. ✅ `npx tsc --noEmit`
6. Start server. Verify:
   - `POST /api/check-git` with PersonalClaw dir → `{ available: true, fileCount: N }`
   - `POST /api/check-git` with non-git dir → `{ available: false, fileCount: 0 }`
   - Create org with `protectionMode: 'git'` → `org.protection.gitFiles` contains paths from that org's root dir, not PersonalClaw's
   - Create org with `protectionMode: 'manual'` + paths → `org.protection.manualPaths` populated
   - `PUT /api/orgs/:id/protection` updates and persists

### Phase B — Frontend (Opus 4.6)
7. Add `ProtectionMode` and `OrgProtection` to `dashboard/src/types/org.ts`, update `Org` interface
8. Update `dashboard/src/components/CreateOrgModal.tsx` — add protection section, git check, manual path picker
9. Create `dashboard/src/components/OrgProtectionSettings.tsx`
10. Update `dashboard/src/components/OrgWorkspace.tsx` — add Settings tab
11. Append CSS

### Phase C — Integration Tests
12. **Git protection** — create PersonalClaw org with Git mode → `protectedFiles` contains PersonalClaw files only
13. **Separate org git protection** — create MSP Genie org pointing at MSP Genie dir → `protectedFiles` contains MSP Genie files, zero overlap with PersonalClaw
14. **No git repo** — point at a non-git dir → git option shows ⚠️ warning → git + both buttons disabled → can still choose Manual or None
15. **Manual paths** — add `src/` and `config/settings.json` → agent tries to write there → intercepted → proposal created
16. **Both mode** — git + manual → both sets protected
17. **None mode** — agent writes freely to any path → no interception
18. **Edit protection after creation** — switch from Git to Both, add manual path → saved → new path immediately protected
19. **Refresh git** — add a new file to git (`git add`) → click Refresh → count updates
20. **Browse button** — click 📂 → Windows folder picker opens → selected path populates input
21. **Multi-org isolation** — PersonalClaw org protected files ≠ MSP Genie protected files — confirmed in `org.json` for each

---

## CONSTRAINTS

1. **`snapshotGitFiles(rootDir)` always uses the org's own `rootDir`** — never `process.cwd()`.
2. **Protected file paths stored as absolute** — comparison is always absolute path to absolute path.
3. **`expandManualPaths()` is called at check time**, not at save time — so adding new files to a protected folder is automatically covered without re-saving.
4. **`org.protection.mode === 'none'` skips interception entirely** — no file check needed, no overhead.
5. **Migration in `loadAll()`** — old `protectedFiles` array becomes `protection.gitFiles` with mode `'git'` (or `'none'` if empty).
6. **Browse button is Windows-only** (PowerShell dialog) — graceful fallback to manual text input if it fails.
7. **`/api/check-git` is called on rootDir blur**, not on every keystroke — debounce or blur event only.
8. **Git disabled buttons in modal** only when `gitCheck` has returned `available: false` — not while checking.
