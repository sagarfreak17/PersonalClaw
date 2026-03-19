import { orgManager, AutonomyLevel } from '../core/org-manager.js';
import { orgHeartbeat } from '../core/org-heartbeat.js';
import type { Skill, SkillMeta } from '../types/skill.js';

export const orgManagementSkill: Skill = {
  name: 'manage_org',
  description: `Manage PersonalClaw AI organisations and their agents. Actions:
- create_org: Create a new organisation (requires name, mission)
- list_orgs: List all organisations
- delete_org: Delete an org (requires orgId)
- add_agent: Add an agent to an org (requires orgId, name, role, personality, responsibilities, heartbeatCron. allowDuplicateRole: boolean)
- list_agents: List agents in an org (requires orgId)
- remove_agent: Remove an agent (requires orgId, agentId)
- trigger_agent: Manually trigger an agent's heartbeat (requires orgId, agentId)
- pause_org: Pause all agents in an org (requires orgId)
- resume_org: Resume all agents in an org (requires orgId)
- pause_agent: Pause a specific agent (requires orgId, agentId)
- resume_agent: Resume a specific agent (requires orgId, agentId)

Use this when the user asks you to set up an org, define an agent, or manage the AI company system via chat.`,
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string' },
      orgId: { type: 'string' },
      agentId: { type: 'string' },
      name: { type: 'string' },
      mission: { type: 'string' },
      rootDir: { type: 'string' },
      role: { type: 'string' },
      personality: { type: 'string' },
      responsibilities: { type: 'string' },
      goals: { type: 'array', items: { type: 'string' } },
      autonomyLevel: { type: 'string', enum: ['full', 'approval_required'] },
      heartbeatCron: { type: 'string' },
      reportingTo: { type: 'string' },
      allowDuplicateRole: { type: 'boolean' },
    },
    required: ['action'],
  },
  run: async (args: any, _meta: SkillMeta) => {
    try {
      switch (args.action) {
        case 'create_org':
          return { success: true, org: orgManager.create({ name: args.name, mission: args.mission, rootDir: args.rootDir }) };
        case 'list_orgs':
          return { orgs: orgManager.list() };
        case 'delete_org':
          orgManager.delete(args.orgId);
          return { success: true };
        case 'add_agent': {
          // Auto-set reportingTo to calling agent if called by an org agent
          const callerReportingTo = _meta.orgAgentId ?? (args.reportingTo ?? null);
          const agent = orgManager.addAgent(args.orgId, {
            name: args.name,
            role: args.role,
            personality: args.personality,
            responsibilities: args.responsibilities,
            goals: args.goals ?? [],
            autonomyLevel: (args.autonomyLevel ?? 'full') as AutonomyLevel,
            heartbeatCron: args.heartbeatCron ?? '0 9 * * *',
            reportingTo: callerReportingTo,
            allowDuplicateRole: args.allowDuplicateRole ?? false,
          });
          // FIX-N: direct method call — scheduleAgent is public
          orgHeartbeat.scheduleAgent(args.orgId, agent.id);
          return { success: true, agent };
        }
        case 'list_agents': {
          const org = orgManager.get(args.orgId);
          return { agents: org?.agents ?? [] };
        }
        case 'remove_agent':
          orgManager.deleteAgent(args.orgId, args.agentId);
          return { success: true };
        case 'trigger_agent':
          await orgHeartbeat.triggerAgent(args.orgId, args.agentId, 'manual');
          return { success: true, message: 'Agent triggered. Check the org dashboard for results.' };
        case 'pause_org':
          orgManager.update(args.orgId, { paused: true });
          return { success: true };
        case 'resume_org':
          orgManager.update(args.orgId, { paused: false });
          return { success: true };
        case 'pause_agent':
          orgManager.updateAgent(args.orgId, args.agentId, { paused: true });
          return { success: true };
        case 'resume_agent':
          orgManager.updateAgent(args.orgId, args.agentId, { paused: false });
          return { success: true };
        default:
          return { error: `Unknown action: ${args.action}` };
      }
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
};
