export interface SkillMeta {
  agentId: string;
  conversationId: string;
  conversationLabel: string;
  isWorker: boolean;
}

export interface Skill {
  name: string;
  description: string;
  parameters: any;
  run: (args: any, meta: SkillMeta) => Promise<any>;
}
