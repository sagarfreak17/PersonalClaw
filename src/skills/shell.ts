import { exec } from 'child_process';
import { promisify } from 'util';
import { Skill, SkillMeta } from '../types/skill.js';


const execAsync = promisify(exec);

export const shellSkill: Skill = {
  name: 'execute_powershell',
  description: 'Executes a PowerShell command on the Windows machine. Use this for system control, file management, and information gathering.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The PowerShell command to execute.',
      },
    },
    required: ['command'],
  },
  run: async ({ command }: { command: string }, _meta: SkillMeta) => {
    try {
      const { stdout, stderr } = await execAsync(`powershell -Command "${command.replace(/"/g, '`"')}"`);
      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        stdout: error.stdout?.trim(),
        stderr: error.stderr?.trim(),
      };
    }
  },
};
