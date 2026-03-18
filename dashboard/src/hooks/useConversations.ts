import { useState, useEffect, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { ConversationInfo, Message } from '../types/conversation';

export function useConversations(socket: Socket) {
  const [conversations, setConversations] = useState<ConversationInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [isWaiting, setIsWaiting] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    socket.emit('conversation:list');

    // Use named handlers so socket.off() only removes THIS hook's listeners,
    // not other listeners registered in App.tsx (e.g. the connect→setConnected handler).
    const onInit = (data: any) => {
      if (data.conversations) {
        const list: ConversationInfo[] = data.conversations;
        setConversations(list);
        // Drop stale message history for IDs that no longer exist after a restart
        setMessages(prev => {
          const validIds = new Set(list.map((c: ConversationInfo) => c.id));
          const next: Record<string, any[]> = {};
          for (const id of Object.keys(prev)) {
            if (validIds.has(id)) next[id] = prev[id];
          }
          // Request history for conversations that have no frontend messages
          for (const c of list) {
            if (!next[c.id] || next[c.id].length === 0) {
              socket.emit('conversation:history', { conversationId: c.id });
            }
          }
          return next;
        });
        setIsWaiting({});
        setActiveId(list.length > 0 ? list[0].id : null);
      }
    };

    // Re-request list on every reconnect so IDs are always fresh
    const onConnect = () => {
      socket.emit('conversation:list');
    };

    const onList = (list: ConversationInfo[]) => {
      setConversations(list);
      if (list.length > 0 && !activeId) setActiveId(list[0].id);
    };

    const onCreated = (info: ConversationInfo) => {
      setConversations(prev => [...prev, info]);
      setMessages(prev => ({ ...prev, [info.id]: [] }));
      setActiveId(info.id);
    };

    const onClosed = ({ conversationId }: { conversationId: string }) => {
      setConversations(prev => {
        const remaining = prev.filter(c => c.id !== conversationId);
        if (activeId === conversationId && remaining.length > 0) {
          setActiveId(remaining[0].id);
        }
        return remaining;
      });
      setMessages(prev => {
        const next = { ...prev };
        delete next[conversationId];
        return next;
      });
    };

    const onResponse = ({ conversationId, text }: { conversationId: string; text: string }) => {
      setIsWaiting(prev => ({ ...prev, [conversationId]: false }));
      setMessages(prev => ({
        ...prev,
        [conversationId]: [...(prev[conversationId] ?? []), {
          id: `msg_${Date.now()}`, role: 'assistant', text,
          timestamp: new Date().toISOString(), conversationId,
        }],
      }));
    };

    const onHistory = ({ conversationId, messages }: { conversationId: string; messages: Message[] }) => {
      setMessages(prev => {
        // Only populate if we don't already have messages (avoid overwriting active chat)
        if (prev[conversationId] && prev[conversationId].length > 0) return prev;
        return { ...prev, [conversationId]: messages };
      });
    };

    const onError = ({ message }: { message: string }) => {
      setError(message);
      setTimeout(() => setError(null), 4000);
    };

    socket.on('init', onInit);
    socket.on('connect', onConnect);
    socket.on('conversation:list', onList);
    socket.on('conversation:created', onCreated);
    socket.on('conversation:closed', onClosed);
    socket.on('response', onResponse);
    socket.on('conversation:history', onHistory);
    socket.on('conversation:error', onError);

    return () => {
      // Remove only this hook's specific handler references — safe to do
      // even if App.tsx has its own 'connect' / 'init' listeners.
      socket.off('init', onInit);
      socket.off('connect', onConnect);
      socket.off('conversation:list', onList);
      socket.off('conversation:created', onCreated);
      socket.off('conversation:closed', onClosed);
      socket.off('response', onResponse);
      socket.off('conversation:history', onHistory);
      socket.off('conversation:error', onError);
    };
  }, [socket]);

  const createConversation = useCallback(() =>
    socket.emit('conversation:create'), [socket]);

  const closeConversation = useCallback((id: string) =>
    socket.emit('conversation:close', { conversationId: id }), [socket]);

  const abortConversation = useCallback((id: string) =>
    socket.emit('conversation:abort', { conversationId: id }), [socket]);

  const sendMessage = useCallback((conversationId: string, text: string) => {
    setMessages(prev => ({
      ...prev,
      [conversationId]: [...(prev[conversationId] ?? []), {
        id: `msg_${Date.now()}`, role: 'user', text,
        timestamp: new Date().toISOString(), conversationId,
      }],
    }));
    setIsWaiting(prev => ({ ...prev, [conversationId]: true }));
    socket.emit('message', { text, conversationId });
  }, [socket]);

  return {
    conversations, activeId, messages, isWaiting, error,
    createConversation, closeConversation, abortConversation, sendMessage, setActiveId,
  };
}
