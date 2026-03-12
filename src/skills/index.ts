import { shellSkill } from './shell.js';
import { pythonSkill } from './python.js';
import { fileSkill } from './files.js';
import { webSkill } from './web.js';
import { visionSkill } from './vision.js';
import { clipboardSkill } from './clipboard.js';
import { relaySkill } from './relay.js';
import { Skill } from '../types/skill.js';

export const skills: Skill[] = [
  shellSkill,
  pythonSkill,
  fileSkill,
  webSkill,
  visionSkill,
  clipboardSkill,
  relaySkill,
];

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
