import { Skill, SkillMeta } from '../types/skill.js';
import { skillLock } from '../core/skill-lock.js';
import { memoryIndex } from '../core/memory-index.js';

export const memorySkill: Skill = {
  name: 'manage_long_term_memory',
  description: `Store and retrieve persistent knowledge that survives across sessions and context compactions.

WHEN TO USE:
- Use 'learn' to store any fact you want to remember permanently (user preferences, MSP-specific context, workflow patterns, client details).
- Use 'recall' or 'search' for semantic/fuzzy lookup — "what do I know about ConnectWise" returns relevant facts even if they weren't tagged that way.
- Use 'recall_exact' only when you know the exact key.
- Use 'forget' to remove incorrect or outdated facts.
- Use 'list' to browse all stored memories.

MEMORY IS PERMANENT — it survives conversation resets and server restarts. Prefer storing structured facts: "user_preferred_ticket_format: Always include client name, priority, and estimated resolution time."`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['learn', 'recall', 'recall_exact', 'forget', 'search', 'list'],
        description: 'The action to perform.',
      },
      key: {
        type: 'string',
        description: 'Memory key/label. Required for learn, recall_exact, forget.',
      },
      value: {
        type: 'string',
        description: 'Memory value to store. Required for learn.',
      },
      query: {
        type: 'string',
        description: 'Natural language search query. Used by recall and search actions.',
      },
      top_k: {
        type: 'number',
        description: 'Max results to return for search/recall. Default 5.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tags for categorization — e.g. ["msp", "connectwise"]',
      },
    },
    required: ['action'],
  },
  run: async (
    { action, key, value, query, top_k, tags }: {
      action: string; key?: string; value?: string; query?: string;
      top_k?: number; tags?: string[];
    },
    meta: SkillMeta,
  ) => {
    const writeActions = new Set(['learn', 'forget']);
    const holderBase = {
      agentId: meta.agentId,
      conversationId: meta.conversationId,
      conversationLabel: meta.conversationLabel,
      operation: `memory:${action}`,
      acquiredAt: new Date(),
    };

    let release: (() => void) | undefined;
    try {
      release = writeActions.has(action)
        ? await skillLock.acquireWrite('memory_index', holderBase)
        : await skillLock.acquireRead('memory_index', holderBase);

      switch (action) {
        case 'learn': {
          if (!key || !value) return { success: false, error: 'Key and value are required for learning.' };
          const entry = await memoryIndex.upsert(key, value, 'manual', tags);
          return { success: true, message: `Learned: ${key}`, id: entry.id };
        }

        case 'recall': {
          const q = query || key || '';
          if (!q) return { success: false, error: 'Provide a query or key for recall.' };
          const results = await memoryIndex.search(q, top_k || 5);
          if (results.length === 0) return { success: true, message: 'No relevant memories found.', results: [] };
          return {
            success: true,
            results: results.map(r => ({
              key: r.entry.key,
              value: r.entry.value,
              score: Math.round(r.combinedScore * 100) / 100,
              source: r.entry.source,
              tags: r.entry.tags,
            })),
          };
        }

        case 'recall_exact': {
          if (!key) return { success: false, error: 'Key is required for exact recall.' };
          const { entries } = await memoryIndex.list(1, 10000);
          const found = entries.find(e => e.key === key);
          if (!found) return { success: true, message: `No memory found with key: ${key}` };
          return { success: true, key: found.key, value: found.value, source: found.source, tags: found.tags };
        }

        case 'forget': {
          if (!key) return { success: false, error: 'Key is required to forget.' };
          const deleted = await memoryIndex.delete(key);
          if (!deleted) return { success: false, error: `No memory found with key: ${key}` };
          return { success: true, message: `Forgotten: ${key}` };
        }

        case 'search': {
          const q = query || '';
          if (!q) return { success: false, error: 'Query is required for search.' };
          const results = await memoryIndex.search(q, top_k || 10);
          return {
            success: true,
            total: results.length,
            results: results.map(r => ({
              key: r.entry.key,
              value: r.entry.value,
              vectorScore: Math.round(r.vectorScore * 100) / 100,
              keywordScore: Math.round(r.keywordScore * 100) / 100,
              combinedScore: Math.round(r.combinedScore * 100) / 100,
              source: r.entry.source,
              tags: r.entry.tags,
            })),
          };
        }

        case 'list': {
          const result = await memoryIndex.list(1, top_k || 20);
          return {
            success: true,
            total: result.total,
            entries: result.entries.map(e => ({
              key: e.key,
              value: e.value,
              source: e.source,
              tags: e.tags,
              updatedAt: e.updatedAt,
            })),
          };
        }

        default:
          return { success: false, error: 'Invalid action.' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    } finally {
      release?.();
    }
  },
};
