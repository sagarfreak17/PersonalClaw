import * as fs from 'fs';
import * as path from 'path';
import { Skill, SkillMeta } from '../types/skill.js';
import { skillLock } from '../core/skill-lock.js';


const MEMORY_FILE = path.join(process.cwd(), 'memory', 'long_term_knowledge.json');

export const memorySkill: Skill = {
  name: 'manage_long_term_memory',
  description: 'Learns and persists important information about the user, their preferences, their specific terminology (like MSP jargon), and patterns from conversations. Use this to ensure PersonalClaw evolves with the user.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['learn', 'recall', 'forget'],
        description: 'The action to perform on the memory.',
      },
      key: {
        type: 'string',
        description: 'The category or topic of what is being learned (e.g., "user_tone", "shorthand_meanings", "workflow_preferences").',
      },
      value: {
        type: 'string',
        description: 'The specific information to learn or update.',
      },
    },
    required: ['action'],
  },
  run: async ({ action, key, value }: { action: string; key?: string; value?: string }, meta: SkillMeta) => {
    const writeActions = new Set(['learn', 'forget']);
    const holderBase = {
      agentId: meta.agentId, conversationId: meta.conversationId,
      conversationLabel: meta.conversationLabel,
      operation: `memory:${action}`, acquiredAt: new Date(),
    };
    let release: (() => void) | undefined;
    try {
      release = writeActions.has(action)
        ? await skillLock.acquireWrite('memory', holderBase)
        : await skillLock.acquireRead('memory', holderBase);
      if (!fs.existsSync(path.dirname(MEMORY_FILE))) {
        fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
      }

      let memory: Record<string, any> = {};
      if (fs.existsSync(MEMORY_FILE)) {
        memory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
      }

      switch (action) {
        case 'learn':
          if (!key || !value) return { success: false, error: 'Key and Value are required for learning.' };
          memory[key] = value;
          fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
          return { success: true, message: `Learned: ${key}` };

        case 'recall':
          if (key) {
            return { success: true, [key]: memory[key] || 'Not found' };
          }
          return { success: true, all_knowledge: memory };

        case 'forget':
          if (!key) return { success: false, error: 'Key is required to forget.' };
          delete memory[key];
          fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
          return { success: true, message: `Forgotten: ${key}` };

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
