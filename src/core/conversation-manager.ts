/**
 * PersonalClaw Conversation Manager — Manages up to 3 independent chat panes.
 *
 * Each conversation has its own isolated Brain instance.
 * Conversations are auto-saved to SessionManager on close.
 */

import { Brain } from './brain.js';
import { SessionManager } from './sessions.js';
import { agentRegistry } from './agent-registry.js';
import { eventBus } from './events.js';

export interface ConversationInfo {
  id: string;
  label: string;
  createdAt: string;
  lastActivityAt: string;
  messageCount: number;
}

interface Conversation {
  id: string;
  label: string;
  brain: Brain;
  createdAt: Date;
  lastActivityAt: Date;
}

class ConversationManager {
  private conversations: Map<string, Conversation> = new Map();
  private readonly MAX_CONVERSATIONS = 3;
  private readonly LABELS = ['Chat 1', 'Chat 2', 'Chat 3'];

  create(): ConversationInfo {
    if (this.conversations.size >= this.MAX_CONVERSATIONS) {
      throw new Error('Maximum of 3 conversations reached');
    }
    const label = this.nextAvailableLabel();
    const id = `conv_${Date.now()}`;
    const brain = new Brain({
      agentId: `primary_${id}`,
      conversationId: id,
      conversationLabel: label,
    });
    const convo: Conversation = {
      id, label, brain,
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };
    this.conversations.set(id, convo);
    eventBus.emit('conversation:created', { id, label });
    return this.toInfo(convo);
  }

  get(conversationId: string): Conversation {
    const convo = this.conversations.get(conversationId);
    if (!convo) throw new Error(`Conversation ${conversationId} not found`);
    return convo;
  }

  list(): ConversationInfo[] {
    return Array.from(this.conversations.values()).map(c => this.toInfo(c));
  }

  /**
   * Return the chat history for a conversation formatted for the frontend.
   * Strips system prompt, tool calls, and internal entries.
   */
  getMessages(conversationId: string): { id: string; role: string; text: string; conversationId: string }[] {
    const convo = this.get(conversationId);
    const history = convo.brain.getHistory();
    const messages: { id: string; role: string; text: string; conversationId: string }[] = [];

    // Skip first 2 entries (system prompt + initial model greeting)
    for (let i = 2; i < history.length; i++) {
      const entry = history[i];
      if (entry.role === 'function') continue;

      const text = (entry.parts || [])
        .filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join('\n')
        .trim();

      if (!text) continue;
      if (text.startsWith('[CONTEXT_RECOVERY]')) continue;

      messages.push({
        id: `hist_${conversationId}_${i}`,
        role: entry.role === 'model' ? 'assistant' : 'user',
        text,
        conversationId,
      });
    }

    return messages;
  }

  async send(conversationId: string, message: string): Promise<string> {
    const convo = this.get(conversationId);
    convo.lastActivityAt = new Date();
    return convo.brain.processMessage(message);
  }

  /**
   * Abort all in-flight work for a conversation without closing it.
   * Kills worker sub-agents and aborts the primary brain's tool loop.
   * The brain's aborted flag is reset afterwards so the next message works normally.
   * Conversation history is fully preserved.
   */
  abort(conversationId: string): void {
    const convo = this.get(conversationId);
    // Abort primary brain's current tool loop
    convo.brain.abort();
    // Kill all sub-agent workers for this conversation
    agentRegistry.killAll(conversationId);
    // Reset abort flag after a short delay so the brain can handle the next message
    setTimeout(() => convo.brain.resetAbort(), 200);
    eventBus.emit('conversation:aborted', { id: conversationId, label: convo.label });
  }

  async close(conversationId: string): Promise<void> {
    const convo = this.get(conversationId);
    const history = convo.brain.getHistory();
    SessionManager.saveSession(convo.label, history);
    agentRegistry.killAll(conversationId);
    this.conversations.delete(conversationId);
    eventBus.emit('conversation:closed', { id: conversationId, label: convo.label });
  }

  async closeAll(): Promise<void> {
    for (const id of Array.from(this.conversations.keys())) {
      await this.close(id);
    }
  }

  // Used by POST /api/chat — routes to Chat 1 if it exists, creates it if not
  getOrCreateDefault(): Conversation {
    const chat1 = Array.from(this.conversations.values()).find(c => c.label === 'Chat 1');
    if (chat1) return chat1;
    const info = this.create();
    return this.get(info.id);
  }

  private nextAvailableLabel(): string {
    const used = new Set(Array.from(this.conversations.values()).map(c => c.label));
    const available = this.LABELS.find(l => !used.has(l));
    if (!available) throw new Error('No labels available');
    return available;
  }

  private toInfo(convo: Conversation): ConversationInfo {
    return {
      id: convo.id,
      label: convo.label,
      createdAt: convo.createdAt.toISOString(),
      lastActivityAt: convo.lastActivityAt.toISOString(),
      messageCount: convo.brain.getHistory().length,
    };
  }
}

export const conversationManager = new ConversationManager();
