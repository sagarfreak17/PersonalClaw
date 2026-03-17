import * as fs from 'fs';
import * as path from 'path';
import { Skill, SkillMeta } from '../types/skill.js';
import { skillLock } from '../core/skill-lock.js';


export const fileSkill: Skill = {
  name: 'manage_files',
  description: 'Reads from or writes to files on the Windows machine. Use this for configuration, logging, or general file manipulation.',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['read', 'write', 'append', 'delete', 'list'],
        description: 'The file operation to perform.',
      },
      filePath: {
        type: 'string',
        description: 'The absolute path to the file or directory.',
      },
      content: {
        type: 'string',
        description: 'The content to write or append (required for write/append).',
      },
    },
    required: ['operation', 'filePath'],
  },
  run: async ({ operation, filePath, content }: { operation: string; filePath: string; content?: string }, meta: SkillMeta) => {
    const writeOps = new Set(['write', 'append', 'delete']);
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

    if (writeOps.has(operation)) {
      const lockKey = `files:${absolutePath}` as const;
      let release: (() => void) | undefined;
      try {
        release = await skillLock.acquireWrite(lockKey, {
          agentId: meta.agentId, conversationId: meta.conversationId,
          conversationLabel: meta.conversationLabel,
          operation: `files:${operation}:${absolutePath}`, acquiredAt: new Date(),
        });
        switch (operation) {
          case 'write':
            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
            fs.writeFileSync(absolutePath, content || '');
            return { success: true, message: 'File written successfully' };
          case 'append':
            fs.appendFileSync(absolutePath, content || '');
            return { success: true, message: 'Content appended successfully' };
          case 'delete':
            if (fs.existsSync(absolutePath)) {
              if (fs.lstatSync(absolutePath).isDirectory()) {
                fs.rmSync(absolutePath, { recursive: true });
              } else {
                fs.unlinkSync(absolutePath);
              }
              return { success: true, message: 'Deleted successfully' };
            }
            return { success: false, error: 'File/Directory not found' };
          default:
            return { success: false, error: 'Invalid operation' };
        }
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        release?.();
      }
    } else {
      // read, list — no lock needed
      try {
        switch (operation) {
          case 'read':
            if (!fs.existsSync(absolutePath)) return { success: false, error: 'File not found' };
            return { success: true, content: fs.readFileSync(absolutePath, 'utf8') };
          case 'list':
            if (fs.existsSync(absolutePath) && fs.lstatSync(absolutePath).isDirectory()) {
              return { success: true, files: fs.readdirSync(absolutePath) };
            }
            return { success: false, error: 'Path is not a directory' };
          default:
            return { success: false, error: 'Invalid operation' };
        }
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }
  },
};
