import { useState } from 'react';
import type { Org } from '../types/org';

interface EditOrgModalProps {
  org: Org;
  onSubmit: (updates: { name: string; mission: string }) => void;
  onClose: () => void;
}

export function EditOrgModal({ org, onSubmit, onClose }: EditOrgModalProps) {
  const [form, setForm] = useState({
    name: org.name,
    mission: org.mission,
  });
  const [error, setError] = useState('');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit Organisation</h3>
          <button onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          <div className="form-group">
            <label>Organisation Name</label>
            <input 
              value={form.name} 
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} 
              placeholder="e.g. PersonalClaw Enterprise" 
            />
          </div>
          <div className="form-group">
            <label>Mission Statement</label>
            <textarea 
              value={form.mission} 
              onChange={e => setForm(f => ({ ...f, mission: e.target.value }))} 
              rows={4} 
              placeholder="What is this org's purpose?" 
            />
          </div>

          <div className="form-actions">
            <button className="btn-primary" onClick={() => {
              if (!form.name.trim() || !form.mission.trim()) {
                setError('Name and mission are required.');
                return;
              }
              onSubmit({
                name: form.name, 
                mission: form.mission,
              });
              onClose();
            }}>Save Changes</button>
            <button onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
