import { shellSkill } from './shell.js';
import { pythonSkill } from './python.js';
import { fileSkill } from './files.js';
import { visionSkill } from './vision.js';
import { clipboardSkill } from './clipboard.js';
import { memorySkill } from './memory.js';
import { schedulerSkill, initScheduler } from './scheduler.js';
import { paperclipSkill } from './paperclip.js';
import { browserSkill } from './browser.js';
import { httpSkill } from './http.js';
import { networkSkill } from './network.js';
import { processManagerSkill } from './process-manager.js';
import { systemInfoSkill } from './system-info.js';
import { pdfSkill } from './pdf.js';
import { imagegenSkill } from './imagegen.js';
import { Skill } from '../types/skill.js';

export const skills: Skill[] = [
  shellSkill,
  pythonSkill,
  fileSkill,
  visionSkill,
  clipboardSkill,
  schedulerSkill,
  memorySkill,
  paperclipSkill,
  browserSkill,
  httpSkill,
  networkSkill,
  processManagerSkill,
  systemInfoSkill,
  pdfSkill,
  imagegenSkill,
];

export { initScheduler };

export const getToolDefinitions = () => {
  return skills.map(skill => ({
    functionDeclarations: [
      {
        name: skill.name,
        description: skill.description,
        parameters: skill.parameters,
      },
    ],
  }));
};

export const handleToolCall = async (name: string, args: any) => {
  const skill = skills.find(s => s.name === name);
  if (!skill) {
    throw new Error(`Skill ${name} not found`);
  }
  return await skill.run(args);
};
