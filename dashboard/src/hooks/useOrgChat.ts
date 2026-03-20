import { useState, useEffect, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { AgentChatMessage } from '../types/org';

interface AgentChat {
  chatId: string;
  agentId: string;
  orgId: string;
  agentName: string;
  agentRole: string;
  messages: AgentChatMessage[];
  isWaiting: boolean;
}

export function useOrgChat(socket: Socket) {
  const [chats, setChats] = useState<Record<string, AgentChat>>({});
  const [openChatId, setOpenChatId] = useState<string | null>(null);
  // FIX-O: track pending memory read requests by correlationId
  const memoryCallbacks = useRef<Map<string, (content: any) => void>>(new Map());

  useEffect(() => {
    const handleThinking = ({ chatId }: { chatId: string }) => {
      setChats(prev => ({
        ...prev,
        [chatId]: prev[chatId] ? { ...prev[chatId], isWaiting: true } : prev[chatId],
      }));
    };
    const handleResponse = ({ chatId, text }: { chatId: string; agentId: string; text: string; isError?: boolean }) => {
      setChats(prev => {
        if (!prev[chatId]) return prev;
        return {
          ...prev,
          [chatId]: {
            ...prev[chatId],
            isWaiting: false,
            messages: [
              ...prev[chatId].messages,
              { id: `msg_${Date.now()}`, role: 'assistant', text, timestamp: new Date().toISOString() },
            ],
          },
        };
      });
    };
    // FIX-O: match memory response by correlationId
    const handleMemoryContent = (data: { correlationId: string; content: any }) => {
      const cb = memoryCallbacks.current.get(data.correlationId);
      if (cb) {
        cb(data.content);
        memoryCallbacks.current.delete(data.correlationId);
      }
    };

    socket.on('org:agent:thinking', handleThinking);
    socket.on('org:agent:response', handleResponse);
    socket.on('org:memory:content', handleMemoryContent);
    return () => {
      socket.off('org:agent:thinking', handleThinking);
      socket.off('org:agent:response', handleResponse);
      socket.off('org:memory:content', handleMemoryContent);
    };
  }, [socket]);

  const openChat = useCallback((orgId: string, agentId: string, agentName: string, agentRole: string) => {
    // Check if there's an existing chat with this agent
    const existingEntry = Object.entries(chats).find(([, c]) => c.agentId === agentId && c.orgId === orgId);
    if (existingEntry) {
      setOpenChatId(existingEntry[0]);
      return existingEntry[0];
    }
    // Each chat session gets a unique ID — FIX-I: server uses this to persist Brain
    const chatId = `orgchat_${agentId}_${Date.now()}`;
    setChats(prev => ({
      ...prev,
      [chatId]: { chatId, agentId, orgId, agentName, agentRole, messages: [], isWaiting: false },
    }));
    setOpenChatId(chatId);
    return chatId;
  }, [chats]);

  const minimizeChat = useCallback((chatId: string) => {
    if (openChatId === chatId) setOpenChatId(null);
  }, [openChatId]);

  const closeChat = useCallback((chatId: string) => {
    const chat = chats[chatId];
    if (chat) {
      // FIX-I: notify server to clean up persistent Brain for this chat session
      socket.emit('org:agent:chat:close', { chatId });
    }
    setChats(prev => {
      const next = { ...prev };
      delete next[chatId];
      return next;
    });
    if (openChatId === chatId) setOpenChatId(null);
  }, [chats, openChatId, socket]);

  const sendMessage = useCallback((chatId: string, text: string, image?: string) => {
    const chat = chats[chatId];
    if (!chat) return;
    setChats(prev => ({
      ...prev,
      [chatId]: {
        ...prev[chatId],
        messages: [
          ...prev[chatId].messages,
          {
            id: `msg_${Date.now()}`, role: 'user',
            text: text || (image ? '[Sent an image for analysis]' : ''),
            timestamp: new Date().toISOString(), image,
          },
        ],
        isWaiting: true,
      },
    }));
    socket.emit('org:agent:message', {
      orgId: chat.orgId, agentId: chat.agentId, chatId,
      text: text || 'Analyze this image.', image,
    });
  }, [socket, chats]);

  // FIX-O: correlationId-based memory read
  const readMemory = useCallback((orgId: string, agentId?: string): Promise<any> => {
    return new Promise((resolve) => {
      const correlationId = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      memoryCallbacks.current.set(correlationId, resolve);
      socket.emit('org:memory:read', { orgId, agentId, correlationId });
      // Timeout safety — resolve with null after 5s to prevent dangling promises
      setTimeout(() => {
        if (memoryCallbacks.current.has(correlationId)) {
          memoryCallbacks.current.delete(correlationId);
          resolve(null);
        }
      }, 5000);
    });
  }, [socket]);

  const abortMessage = useCallback((chatId: string) => {
    socket.emit('org:agent:abort', { chatId });
  }, [socket]);

  return {
    chats, openChatId, setOpenChatId,
    openChat, closeChat, minimizeChat, sendMessage, abortMessage, readMemory,
  };
}
