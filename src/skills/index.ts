import { shellSkill } from './shell.js';
import { pythonSkill } from './python.js';
import { fileSkill } from './files.js';
import { visionSkill } from './vision.js';
import { clipboardSkill } from './clipboard.js';
import { memorySkill } from './memory.js';
import { schedulerSkill, initScheduler } from './scheduler.js';

import { browserSkill } from './browser.js';
import { httpSkill } from './http.js';
import { networkSkill } from './network.js';
import { processManagerSkill } from './process-manager.js';
import { systemInfoSkill } from './system-info.js';
import { pdfSkill } from './pdf.js';
import { imagegenSkill } from './imagegen.js';
import { agentSpawnSkill } from './agent-spawn.js';
import { orgManagementSkill } from './org-management-skill.js';
import { linkedinSkill } from './linkedin.js';
import { twitterSkill } from './twitter.js';
import { todosSkill } from './todos.js';
import { desktopAutomationSkill } from './desktop-automation.js';
import { teamGpsSkill } from './teamgps.js';
import { Skill, SkillMeta } from '../types/skill.js';

export const skills: Skill[] = [
  shellSkill,
  pythonSkill,
  fileSkill,
  visionSkill,
  clipboardSkill,
  schedulerSkill,
  memorySkill,
  browserSkill,
  httpSkill,
  networkSkill,
  processManagerSkill,
  systemInfoSkill,
  pdfSkill,
  imagegenSkill,
  agentSpawnSkill,
  orgManagementSkill,
  linkedinSkill,
  twitterSkill,
  todosSkill,
  desktopAutomationSkill,
  teamGpsSkill,
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

const DEFAULT_META: SkillMeta = {
  agentId: 'default',
  conversationId: 'default',
  conversationLabel: 'Chat 1',
  isWorker: false,
};

export const handleToolCall = async (name: string, args: any, meta: SkillMeta = DEFAULT_META) => {
  const skill = skills.find(s => s.name === name);
  if (!skill) {
    throw new Error(`Skill ${name} not found`);
  }
  return await skill.run(args, meta);
};
