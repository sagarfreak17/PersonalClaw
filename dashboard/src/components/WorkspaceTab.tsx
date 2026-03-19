import { useState, useEffect, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { OrgAgent } from '../types/org';

interface WorkspaceFile {
  name: string;
  isDir: boolean;
  path: string;
  size: number;
  modified: string | null;
  agentLabel?: string;
}

interface WorkspaceTabProps {
  orgId: string;
  agents: OrgAgent[];
  socket: Socket;
}

export function WorkspaceTab({ orgId, agents, socket }: WorkspaceTabProps) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [fileError, setFileError] = useState('');
  const [fileSaving, setFileSaving] = useState(false);
  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const [fileComments, setFileComments] = useState<Record<string, any[]>>({});
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  // Load all workspace files
  const loadFiles = useCallback(() => {
    setLoading(true);
    socket.emit('org:workspace:files:all', { orgId });
  }, [orgId, socket]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  useEffect(() => {
    const handleFiles = (data: any) => {
      if (data.orgId === orgId) {
        setFiles(data.files ?? []);
        setLoading(false);
      }
    };
    const handleFileContent = (data: any) => {
      if (data.orgId === orgId && data.path === editingFile) {
        if (data.error) {
          setFileError(data.error);
          setFileContent('');
        } else {
          setFileContent(data.content ?? '');
          setFileError('');
        }
      }
    };
    const handleFileSaved = (data: any) => {
      if (data.orgId === orgId) {
        setFileSaving(false);
        if (data.error) setFileError(data.error);
      }
    };
    const handleComments = (data: any) => {
      if (data.orgId === orgId && data.path) {
        setFileComments(prev => ({ ...prev, [data.path]: data.comments ?? [] }));
      }
    };

    socket.on('org:workspace:file:content', handleFileContent);
    socket.on('org:workspace:file:saved', handleFileSaved);
    socket.on('org:workspace:files:all', handleFiles);
    socket.on('org:workspace:file:comments', handleComments);
    return () => {
      socket.off('org:workspace:file:content', handleFileContent);
      socket.off('org:workspace:file:saved', handleFileSaved);
      socket.off('org:workspace:files:all', handleFiles);
      socket.off('org:workspace:file:comments', handleComments);
    };
  }, [orgId, socket, editingFile]);

  const openFile = (filePath: string) => {
    setEditingFile(filePath);
    setFileContent('');
    setFileError('');
    socket.emit('org:workspace:file:read', { orgId, path: filePath });
    socket.emit('org:workspace:file:comments:read', { orgId, path: filePath });
  };

  const saveFile = () => {
    if (!editingFile) return;
    setFileSaving(true);
    socket.emit('org:workspace:file:write', { orgId, path: editingFile, content: fileContent });
  };

  const submitComment = (filePath: string) => {
    const text = commentText[filePath]?.trim();
    if (!text) return;
    socket.emit('org:workspace:file:comment', { orgId, path: filePath, text, author: 'Human' });
    setCommentText(prev => ({ ...prev, [filePath]: '' }));
    // Reload comments
    setTimeout(() => socket.emit('org:workspace:file:comments:read', { orgId, path: filePath }), 200);
  };

  const toggleAgent = (agentId: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId); else next.add(agentId);
      return next;
    });
  };

  // Group files by agent role/label
  const groupedByAgent = (() => {
    const groups: Record<string, { agent: OrgAgent | null; label: string; files: WorkspaceFile[] }> = {};

    // Create groups for each agent
    for (const agent of agents) {
      const roleSlug = agent.role.toLowerCase().replace(/\s+/g, '-');
      groups[agent.id] = { agent, label: `${agent.name} (${agent.role})`, files: [] };

      // Match files by role prefix in filename or agentLabel
      for (const file of files) {
        if (file.isDir) continue;
        const nameLC = file.name.toLowerCase();
        const pathLC = file.path.toLowerCase();
        if (
          file.agentLabel === `${agent.name} (${agent.role})` ||
          nameLC.startsWith(roleSlug + '-') ||
          pathLC.includes('/' + roleSlug + '-') ||
          pathLC.includes('/' + roleSlug + '/')
        ) {
          if (!groups[agent.id].files.find(f => f.path === file.path)) {
            groups[agent.id].files.push(file);
          }
        }
      }
    }

    // Unassigned files
    const assignedPaths = new Set(Object.values(groups).flatMap(g => g.files.map(f => f.path)));
    const unassigned = files.filter(f => !f.isDir && !assignedPaths.has(f.path));
    if (unassigned.length > 0) {
      groups['_unassigned'] = { agent: null, label: 'Unassigned Files', files: unassigned };
    }

    return Object.entries(groups).filter(([_, g]) => g.files.length > 0);
  })();

  const formatSize = (bytes: number) => bytes < 1024 ? `${bytes}B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)}KB` : `${(bytes / 1048576).toFixed(1)}MB`;

  if (loading) return <p className="empty-state">Loading workspace files...</p>;

  return (
    <div className="workspace-tab">
      <div className="workspace-tab-layout">
        {/* File tree by agent */}
        <div className="workspace-agent-tree">
          <h3 className="bod-section-title">Workspace Files by Agent</h3>
          {groupedByAgent.length === 0 && <p className="empty-state">No workspace files yet. Files will appear here after agents run.</p>}
          {groupedByAgent.map(([key, group]) => {
            const isExpanded = expandedAgents.has(key);
            return (
              <div key={key} className="workspace-agent-group">
                <div className="workspace-agent-group-header" onClick={() => toggleAgent(key)}>
                  <span className="workspace-agent-toggle">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                  <strong>{group.label}</strong>
                  <span className="workspace-agent-count">{group.files.length} file{group.files.length !== 1 ? 's' : ''}</span>
                </div>
                {isExpanded && (
                  <div className="workspace-agent-files">
                    {group.files.map(f => (
                      <div
                        key={f.path}
                        className={`workspace-file-item ${editingFile === f.path ? 'active' : ''}`}
                        onClick={() => openFile(f.path)}
                      >
                        <span className="workspace-file-icon">{'\uD83D\uDCC4'}</span>
                        <span className="workspace-file-name">{f.name}</span>
                        <span className="workspace-file-size">{formatSize(f.size)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* File editor */}
        <div className="workspace-file-editor">
          {!editingFile ? (
            <div className="empty-state" style={{ padding: 40 }}>
              Select a file from the left to view and edit it.
            </div>
          ) : (
            <>
              <div className="workspace-editor-header">
                <code>{editingFile}</code>
                <div className="workspace-editor-actions">
                  <button className="btn-primary btn-sm" onClick={saveFile} disabled={fileSaving || !!fileError}>
                    {fileSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button className="btn-sm" onClick={() => setEditingFile(null)}>Close</button>
                </div>
              </div>
              {fileError ? (
                <div className="workspace-editor-error" style={{ padding: 20, color: '#ef4444', background: '#1a0000', borderRadius: 6 }}>
                  Could not read file: {fileError}
                </div>
              ) : (
                <textarea
                  className="workspace-editor-textarea"
                  value={fileContent}
                  onChange={e => setFileContent(e.target.value)}
                  spellCheck={false}
                />
              )}
              {/* Comments section */}
              <div className="workspace-comments">
                <h4>Comments</h4>
                {(fileComments[editingFile] ?? []).map((c: any, i: number) => (
                  <div key={i} className="workspace-comment">
                    <strong>{c.author}</strong>
                    <span className="workspace-comment-time">{new Date(c.timestamp).toLocaleString()}</span>
                    <p>{c.text}</p>
                  </div>
                ))}
                <div className="workspace-comment-input">
                  <input
                    placeholder="Leave a comment for the agent..."
                    value={commentText[editingFile] ?? ''}
                    onChange={e => setCommentText(prev => ({ ...prev, [editingFile!]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && submitComment(editingFile!)}
                  />
                  <button className="btn-sm" onClick={() => submitComment(editingFile!)} disabled={!commentText[editingFile]?.trim()}>
                    Comment
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
