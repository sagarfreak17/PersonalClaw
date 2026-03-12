import clipboardy from 'clipboardy';
import { Skill } from '../types/skill.js';

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
  run: async ({ action, text }: { action: string; text?: string }) => {
    try {
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
    }
  },
};
