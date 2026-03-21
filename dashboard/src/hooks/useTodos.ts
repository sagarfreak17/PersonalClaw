import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Socket } from 'socket.io-client';
import type { Todo, TodoStats, TodoFilter } from '../types/todos';

export function useTodos(socket: Socket) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [stats, setStats] = useState<TodoStats | null>(null);
  const [filter, setFilter] = useState<TodoFilter>('all');
  const [loading, setLoading] = useState(true);

  const fetchTodos = useCallback(() => {
    socket.emit('todos:get_all');
  }, [socket]);

  useEffect(() => {
    // Initial fetch
    fetchTodos();

    socket.on('todos:list_all', (data: { todos: Todo[]; stats: TodoStats }) => {
      setTodos(data.todos);
      setStats(data.stats);
      setLoading(false);
    });

    // Server pushes refresh on any mutation
    socket.on('todos:refresh', fetchTodos);

    return () => {
      socket.off('todos:list_all');
      socket.off('todos:refresh');
    };
  }, [socket, fetchTodos]);

  // Derived filtered list — useMemo since this is computed data, not a callback
  const filtered = useMemo((): Todo[] => {
    const today = new Date().toISOString().split('T')[0];
    const topLevel = todos.filter(t => !t.parentId && !t.isRecurringTemplate);

    switch (filter) {
      case 'today':
        return topLevel.filter(t =>
          t.status === 'open' && t.dueDate && t.dueDate <= today
        );
      case 'high':
        return topLevel.filter(t =>
          t.status === 'open' && t.priority === 'high'
        );
      case 'done':
        return topLevel.filter(t => t.status === 'done');
      case 'overdue':
        return topLevel.filter(t =>
          t.status === 'open' && t.dueDate && t.dueDate < today
        );
      default: // 'all'
        return topLevel.filter(t => t.status === 'open');
    }
  }, [todos, filter]);

  const getSubtasks = useCallback((parentId: string): Todo[] => {
    return todos.filter(t => t.parentId === parentId);
  }, [todos]);

  return {
    todos,
    filtered,
    stats,
    loading,
    filter,
    setFilter,
    getSubtasks,
    refresh: fetchTodos,
  };
}
