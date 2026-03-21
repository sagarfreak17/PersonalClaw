import { useState, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { Todo, TodoFilter } from '../types/todos';
import { useTodos } from '../hooks/useTodos';

// Priority config
const PRIORITY = {
  high:   { color: '#ef4444', label: 'High',   dot: '🔴' },
  medium: { color: '#f59e0b', label: 'Medium', dot: '🟡' },
  low:    { color: '#22c55e', label: 'Low',    dot: '🟢' },
};

const DAYS_OF_WEEK = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

interface TodosTabProps {
  socket: Socket;
}

function TodoItem({
  todo,
  subtasks,
  onToggle,
  onDelete,
  onAddSubtask,
  onUpdate,
}: {
  todo: Todo;
  subtasks: Todo[];
  onToggle: (id: string, status: 'open' | 'done') => void;
  onDelete: (id: string) => void;
  onAddSubtask: (parentId: string, title: string) => void;
  onUpdate: (id: string, changes: Record<string, any>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [subTitle, setSubTitle] = useState('');
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(todo.title);
  const today = new Date().toISOString().split('T')[0];
  const isOverdue = todo.dueDate && todo.dueDate < today && todo.status === 'open';

  const handleEditSubmit = () => {
    if (editTitle.trim() && editTitle.trim() !== todo.title) {
      onUpdate(todo.id, { title: editTitle.trim() });
    }
    setEditing(false);
  };

  const handleSubtaskSubmit = () => {
    if (!subTitle.trim()) return;
    onAddSubtask(todo.id, subTitle.trim());
    setSubTitle('');
    setAddingSub(false);
  };

  return (
    <div className={`todo-item ${todo.status === 'done' ? 'done' : ''} priority-${todo.priority}`}>
      <div className="todo-item-main">
        {/* Checkbox */}
        <button
          className={`todo-checkbox ${todo.status === 'done' ? 'checked' : ''}`}
          onClick={() => onToggle(todo.id, todo.status)}
          aria-label={todo.status === 'done' ? 'Reopen' : 'Complete'}
        />

        {/* Priority dot */}
        <span className="todo-priority-dot" title={PRIORITY[todo.priority].label}>
          {PRIORITY[todo.priority].dot}
        </span>

        {/* Title — double-click to edit */}
        {editing ? (
          <input
            autoFocus
            className="todo-title-edit"
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleEditSubmit(); if (e.key === 'Escape') { setEditTitle(todo.title); setEditing(false); } }}
            onBlur={handleEditSubmit}
          />
        ) : (
          <span
            className={`todo-title ${todo.status === 'done' ? 'strikethrough' : ''}`}
            onDoubleClick={() => { if (todo.status === 'open') { setEditing(true); setEditTitle(todo.title); } }}
            title="Double-click to edit"
          >
            {todo.title}
          </span>
        )}

        {/* Badges */}
        <div className="todo-badges">
          {todo.dueDate && (
            <span className={`todo-due-badge ${isOverdue ? 'overdue' : ''}`}>
              {isOverdue ? '⚠ ' : ''}{todo.dueDate}
            </span>
          )}
          {todo.estimatedMinutes && (
            <span className="todo-time-badge">⏱ {todo.estimatedMinutes}m</span>
          )}
          {todo.tags.map(tag => (
            <span key={tag} className="todo-tag-badge">#{tag}</span>
          ))}
          {(todo.createdBy === 'agent' || todo.createdBy === 'ai') && (
            <span className="todo-source-badge" title={todo.sourceLabel}>
              🤖 {todo.sourceLabel}
            </span>
          )}
          {todo.instanceOf && (
            <span className="todo-recurring-badge" title="Spawned from recurring template">🔁</span>
          )}
        </div>

        {/* Actions */}
        <div className="todo-actions">
          {subtasks.length > 0 && (
            <button className="todo-expand-btn" onClick={() => setExpanded(e => !e)}>
              {expanded ? '▲' : '▼'} {subtasks.length}
            </button>
          )}
          <button className="todo-sub-btn" onClick={() => setAddingSub(a => !a)} title="Add subtask">+</button>
          <button className="todo-delete-btn" onClick={() => onDelete(todo.id)} title="Delete">×</button>
        </div>
      </div>

      {/* Notes */}
      {todo.notes && (
        <div className="todo-notes">{todo.notes}</div>
      )}

      {/* Subtasks */}
      {expanded && subtasks.length > 0 && (
        <div className="todo-subtasks">
          {subtasks.map(sub => (
            <div key={sub.id} className={`subtask-item ${sub.status === 'done' ? 'done' : ''}`}>
              <button
                className={`todo-checkbox small ${sub.status === 'done' ? 'checked' : ''}`}
                onClick={() => onToggle(sub.id, sub.status)}
              />
              <span className={`subtask-title ${sub.status === 'done' ? 'strikethrough' : ''}`}>
                {sub.title}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Add subtask input */}
      {addingSub && (
        <div className="add-subtask-row">
          <input
            autoFocus
            value={subTitle}
            onChange={e => setSubTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSubtaskSubmit();
              if (e.key === 'Escape') setAddingSub(false);
            }}
            placeholder="Subtask title..."
            className="subtask-input"
          />
          <button onClick={handleSubtaskSubmit} className="subtask-add-btn">Add</button>
        </div>
      )}
    </div>
  );
}

export function TodosTab({ socket }: TodosTabProps) {
  const { todos, filtered, stats, loading, filter, setFilter, getSubtasks, refresh } = useTodos(socket);
  const [focusMode, setFocusMode] = useState(false);
  const [addingTodo, setAddingTodo] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [newDue, setNewDue] = useState('');
  const [newTags, setNewTags] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newEstimate, setNewEstimate] = useState('');
  const [showRecurring, setShowRecurring] = useState(false);
  const [addingRecurring, setAddingRecurring] = useState(false);
  const [recTitle, setRecTitle] = useState('');
  const [recFrequency, setRecFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [recDays, setRecDays] = useState<number[]>([]);
  const [recDayOfMonth, setRecDayOfMonth] = useState('');
  const [recPriority, setRecPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [titleError, setTitleError] = useState(false);
  const [createError, setCreateError] = useState('');

  const titleRef = useRef<HTMLInputElement>(null);

  const recurringTemplates = todos.filter(t => t.isRecurringTemplate);

  const handleToggle = async (id: string, currentStatus: 'open' | 'done') => {
    const action = currentStatus === 'open' ? 'complete' : 'reopen';
    const response = await fetch(`/api/todos/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (response.ok) refresh();
  };

  const handleDelete = async (id: string) => {
    const response = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
    if (response.ok) refresh();
  };

  const handleAddSubtask = async (parentId: string, title: string) => {
    const response = await fetch('/api/todos/subtask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, title })
    });
    if (response.ok) refresh();
  };

  const handleUpdate = async (id: string, changes: Record<string, any>) => {
    const response = await fetch(`/api/todos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes)
    });
    if (response.ok) refresh();
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) {
      setTitleError(true);
      setCreateError('');
      titleRef.current?.focus();
      return;
    }
    setTitleError(false);
    setCreateError('');
    try {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          priority: newPriority,
          dueDate: newDue || undefined,
          tags: newTags ? newTags.split(',').map(t => t.trim()).filter(Boolean) : [],
          notes: newNotes || undefined,
          estimatedMinutes: newEstimate ? parseInt(newEstimate) : undefined,
          createdBy: 'user',
          sourceType: 'manual',
        })
      });
      if (response.ok) {
        setNewTitle(''); setNewPriority('medium'); setNewDue('');
        setNewTags(''); setNewNotes(''); setNewEstimate('');
        setAddingTodo(false);
        refresh();
      } else {
        const data = await response.json().catch(() => null);
        setCreateError(data?.error ?? `Server error (${response.status})`);
      }
    } catch (err: any) {
      setCreateError(`Network error: ${err.message}`);
    }
  };

  const handleCreateRecurring = async () => {
    if (!recTitle.trim()) return;
    try {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: recTitle.trim(),
          priority: recPriority,
          createdBy: 'user',
          sourceLabel: 'Recurring Setup',
          sourceType: 'manual',
          isRecurringTemplate: true,
          recurring: {
            frequency: recFrequency,
            days: recFrequency === 'weekly' ? recDays : undefined,
            dayOfMonth: recFrequency === 'monthly' && recDayOfMonth ? parseInt(recDayOfMonth) : undefined,
          },
        })
      });
      if (response.ok) {
        setRecTitle(''); setRecFrequency('daily'); setRecDays([]);
        setRecDayOfMonth(''); setRecPriority('medium');
        setAddingRecurring(false);
        refresh();
      }
    } catch (err) {
      console.error('Failed to create recurring template:', err);
    }
  };

  const FILTERS: { key: TodoFilter; label: string }[] = [
    { key: 'all', label: 'All Open' },
    { key: 'today', label: `Today${stats?.dueToday ? ` (${stats.dueToday})` : ''}` },
    { key: 'overdue', label: `Overdue${stats?.overdue ? ` (${stats.overdue})` : ''}` },
    { key: 'high', label: 'High Priority' },
    { key: 'done', label: 'Done' },
  ];

  if (loading) return <div className="todos-loading">Loading todos...</div>;

  // ── Focus Mode ──────────────────────────────────────────────────────────────
  if (focusMode) {
    const today = new Date().toISOString().split('T')[0];
    const focusList = todos.filter(t =>
      !t.parentId && !t.isRecurringTemplate &&
      t.status === 'open' && t.dueDate && t.dueDate <= today
    );
    return (
      <div className="todos-focus-mode">
        <div className="focus-header">
          <h2>Today's Focus</h2>
          <button className="focus-exit-btn" onClick={() => setFocusMode(false)}>Exit Focus</button>
        </div>
        <div className="focus-date">{new Date().toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric'
        })}</div>
        {focusList.length === 0
          ? <div className="focus-empty">Nothing due today. You're clear. 🎉</div>
          : focusList.map(todo => (
            <div key={todo.id} className={`focus-item priority-${todo.priority}`}>
              <button
                className={`todo-checkbox ${todo.status === 'done' ? 'checked' : ''}`}
                onClick={() => handleToggle(todo.id, todo.status)}
              />
              <span className="focus-title">{todo.title}</span>
              <span className="focus-priority">{PRIORITY[todo.priority].dot}</span>
            </div>
          ))
        }
        <div className="focus-progress">
          {focusList.filter(t => t.status === 'done').length} / {focusList.length} done
        </div>
      </div>
    );
  }

  // ── Normal View ─────────────────────────────────────────────────────────────
  return (
    <div className="todos-tab">
      {/* Header */}
      <div className="todos-header">
        <h2 className="todos-title">My Todos</h2>
        <div className="todos-header-actions">
          <button className="focus-mode-btn" onClick={() => setFocusMode(true)} title="Shows only today's due + overdue items in a minimal view for focused work">🎯 Focus</button>
          <button className="add-todo-btn" onClick={() => {
            setAddingTodo(a => !a);
            setTimeout(() => titleRef.current?.focus(), 50);
          }}>{addingTodo ? 'Cancel' : '+ Add'}</button>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="todos-stats-bar">
          <div className="stat-chip">
            <span className="stat-number">{stats.totalOpen}</span>
            <span className="stat-label">Open</span>
          </div>
          <div className={`stat-chip ${stats.dueToday > 0 ? 'accent' : ''}`}>
            <span className="stat-number">{stats.dueToday}</span>
            <span className="stat-label">Due Today</span>
          </div>
          <div className={`stat-chip ${stats.overdue > 0 ? 'danger' : ''}`}>
            <span className="stat-number">{stats.overdue}</span>
            <span className="stat-label">Overdue</span>
          </div>
          <div className={`stat-chip ${stats.highPriority > 0 ? 'warning' : ''}`}>
            <span className="stat-number">{stats.highPriority}</span>
            <span className="stat-label">High Priority</span>
          </div>
          <div className="stat-chip">
            <span className="stat-number">{stats.completedThisWeek}</span>
            <span className="stat-label">Done This Week</span>
          </div>
        </div>
      )}

      {/* Weekly Bar Chart */}
      {stats && stats.completedThisWeek > 0 && (
        <div className="todos-weekly-chart">
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => {
            const count = stats.completedByDay[day] ?? 0;
            const max = Math.max(...Object.values(stats.completedByDay), 1);
            return (
              <div key={day} className="chart-col">
                <div className="chart-bar-wrap">
                  <div
                    className="chart-bar"
                    style={{ height: `${(count / max) * 100}%` }}
                    title={`${count} completed`}
                  />
                </div>
                <div className="chart-label">{day}</div>
                {count > 0 && <div className="chart-count">{count}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Filter Bar */}
      <div className="todos-filter-bar">
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={`filter-btn ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >{f.label}</button>
        ))}
      </div>

      {/* Inline Add Form */}
      {addingTodo && (
        <div className="add-todo-form">
          <input
            ref={titleRef}
            value={newTitle}
            onChange={e => { setNewTitle(e.target.value); setTitleError(false); }}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setAddingTodo(false); }}
            placeholder="Todo title (required) — e.g. Check TimeZest Appointments"
            className={`add-todo-title-input ${titleError ? 'error' : ''}`}
          />
          {titleError && <span className="add-todo-title-error">Title is required</span>}
          <div className="add-todo-fields">
            <select value={newPriority} onChange={e => setNewPriority(e.target.value as any)} className="add-todo-priority">
              <option value="high">🔴 High</option>
              <option value="medium">🟡 Medium</option>
              <option value="low">🟢 Low</option>
            </select>
            <input
              type="date"
              value={newDue}
              onChange={e => setNewDue(e.target.value)}
              className="add-todo-date"
            />
            <input
              value={newTags}
              onChange={e => setNewTags(e.target.value)}
              placeholder="Tags (comma separated)"
              className="add-todo-tags"
            />
            <select value={newEstimate} onChange={e => setNewEstimate(e.target.value)} className="add-todo-estimate">
              <option value="">Time estimate</option>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="60">1 hour</option>
              <option value="120">2 hours</option>
              <option value="240">Half day</option>
            </select>
          </div>
          <textarea
            value={newNotes}
            onChange={e => setNewNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="add-todo-notes"
            rows={2}
          />
          {createError && <div className="add-todo-error">{createError}</div>}
          <div className="add-todo-actions">
            <button onClick={handleCreate} className="add-todo-submit-btn">Add Todo</button>
            <button onClick={() => setAddingTodo(false)} className="add-todo-cancel-btn">Cancel</button>
          </div>
        </div>
      )}

      {/* Todo List */}
      <div className="todos-list">
        {filtered.length === 0 ? (
          <div className="todos-empty">
            {filter === 'today' ? 'Nothing due today. 🎉' :
             filter === 'overdue' ? 'No overdue items. 🎉' :
             filter === 'done' ? 'No completed todos yet.' :
             'No todos. Add one above.'}
          </div>
        ) : (
          filtered.map(todo => (
            <TodoItem
              key={todo.id}
              todo={todo}
              subtasks={getSubtasks(todo.id)}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onAddSubtask={handleAddSubtask}
              onUpdate={handleUpdate}
            />
          ))
        )}
      </div>

      {/* Recurring Templates Section */}
      <div className="recurring-section">
        <div className="recurring-header">
          <button
            className="recurring-toggle-btn"
            onClick={() => setShowRecurring(r => !r)}
          >
            🔁 Recurring Templates ({recurringTemplates.length}) {showRecurring ? '▲' : '▼'}
          </button>
          {showRecurring && (
            <button
              className="recurring-add-btn"
              onClick={() => setAddingRecurring(a => !a)}
            >
              {addingRecurring ? 'Cancel' : '+ New Template'}
            </button>
          )}
        </div>
        {showRecurring && (
          <div className="recurring-list">
            {/* Create Recurring Form */}
            {addingRecurring && (
              <div className="recurring-create-form">
                <input
                  autoFocus
                  value={recTitle}
                  onChange={e => setRecTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateRecurring(); if (e.key === 'Escape') setAddingRecurring(false); }}
                  placeholder="Recurring todo title..."
                  className="recurring-create-title"
                />
                <div className="recurring-create-fields">
                  <select value={recFrequency} onChange={e => setRecFrequency(e.target.value as any)} className="recurring-create-freq">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                  <select value={recPriority} onChange={e => setRecPriority(e.target.value as any)} className="recurring-create-priority">
                    <option value="high">🔴 High</option>
                    <option value="medium">🟡 Medium</option>
                    <option value="low">🟢 Low</option>
                  </select>
                </div>
                {recFrequency === 'weekly' && (
                  <div className="recurring-days-picker">
                    {DAYS_OF_WEEK.map((day, i) => (
                      <button
                        key={day}
                        className={`recurring-day-btn ${recDays.includes(i) ? 'active' : ''}`}
                        onClick={() => setRecDays(d => d.includes(i) ? d.filter(x => x !== i) : [...d, i])}
                      >{day}</button>
                    ))}
                  </div>
                )}
                {recFrequency === 'monthly' && (
                  <input
                    type="number"
                    min="1" max="31"
                    value={recDayOfMonth}
                    onChange={e => setRecDayOfMonth(e.target.value)}
                    placeholder="Day of month (1-31)"
                    className="recurring-create-dom"
                  />
                )}
                <div className="recurring-create-actions">
                  <button onClick={handleCreateRecurring} className="recurring-create-submit" disabled={!recTitle.trim()}>Create Template</button>
                  <button onClick={() => setAddingRecurring(false)} className="recurring-create-cancel">Cancel</button>
                </div>
              </div>
            )}
            {recurringTemplates.length === 0 && !addingRecurring && (
              <div className="recurring-empty">No recurring todos yet. Create one above.</div>
            )}
            {recurringTemplates.map(t => (
              <div key={t.id} className="recurring-item">
                <span className="recurring-title">{t.title}</span>
                <span className="recurring-freq">
                  {t.recurring?.frequency}
                  {t.recurring?.days?.length
                    ? ` (${t.recurring.days.map(d => DAYS_OF_WEEK[d]).join(', ')})`
                    : ''}
                  {t.recurring?.dayOfMonth ? ` (day ${t.recurring.dayOfMonth})` : ''}
                </span>
                <span className="recurring-last">
                  Last: {t.recurring?.lastFiredDate ?? 'never'}
                </span>
                <button className="recurring-delete-btn" onClick={() => handleDelete(t.id)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
