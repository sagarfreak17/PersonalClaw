import { exec } from 'child_process';
import { promisify } from 'util';
import { Skill, SkillMeta } from '../types/skill.js';

import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export const pythonSkill: Skill = {
  name: 'run_python_script',
  description: 'Runs a Python script on the machine. You can provide the code directly.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The Python code to execute.',
      },
    },
    required: ['code'],
  },
  run: async ({ code }: { code: string }, _meta: SkillMeta) => {
    const tempFile = path.join(process.cwd(), 'temp_script.py');
    try {
      fs.writeFileSync(tempFile, code);
      const { stdout, stderr } = await execAsync(`python "${tempFile}"`);
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
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  },
};
