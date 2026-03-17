import clipboardy from 'clipboardy';
import { Skill, SkillMeta } from '../types/skill.js';
import { skillLock } from '../core/skill-lock.js';

export const clipboardSkill: Skill = {
  name: 'manage_clipboard',
  description: 'Reads from or writes to the system clipboard.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'write'],
        description: 'Whether to read from or write to the clipboard.',
      },
      text: {
        type: 'string',
        description: 'The text to write (required for write).',
      },
    },
    required: ['action'],
  },
  run: async ({ action, text }: { action: string; text?: string }, meta: SkillMeta) => {
    let release: (() => void) | undefined;
    try {
      release = await skillLock.acquireExclusive('clipboard', {
        agentId: meta.agentId, conversationId: meta.conversationId,
        conversationLabel: meta.conversationLabel,
        operation: `clipboard:${action}`, acquiredAt: new Date(),
      });
      if (action === 'write') {
        if (!text) throw new Error("Text is required for write action");
        await clipboardy.write(text);
        return { success: true, message: 'Copied to clipboard.' };
      } else {
        const content = await clipboardy.read();
        return { success: true, content };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    } finally {
      release?.();
    }
  },
};
