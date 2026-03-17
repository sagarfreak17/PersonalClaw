/**
 * Agent Spawn Skill — Allows primary brains to spawn sub-agent workers.
 *
 * FIX-5: meta.conversationLabel passed to agentRegistry.spawn() so worker Brain
 * displays correctly in lock UI.
 */

import { agentRegistry } from '../core/agent-registry.js';
import type { Skill, SkillMeta } from '../types/skill.js';

export const agentSpawnSkill: Skill = {
  name: 'spawn_agent',
  description: `Spawn a sub-agent worker to complete a specific task in parallel.
Use this when you have a clearly defined sub-task that can run independently.
Up to 5 workers can run simultaneously per conversation. If all slots are full, spawn queues automatically.
Workers have access to all skills. Workers CANNOT spawn further agents.
Each worker gets only its task string — it has no conversation history.
Be explicit and self-contained in the task description. Include all context the worker needs.
Do NOT call the same singleton-resource skill (browser, vision, clipboard) more than once
in the same parallel tool batch — this will cause a deadlock.
Returns the worker's final result string when complete.`,

  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Complete, self-contained task. Worker has no conversation history — include everything needed.',
      },
      context: {
        type: 'string',
        description: 'Optional background context to prepend to the task.',
      },
    },
    required: ['task'],
  },

  run: async (args: { task: string; context?: string }, meta: SkillMeta) => {
    if (meta.isWorker) {
      return { success: false, error: 'Workers cannot spawn sub-agents' };
    }
    const fullTask = args.context
      ? `Context:\n${args.context}\n\nTask:\n${args.task}`
      : args.task;
    // FIX-5: pass conversationLabel so worker Brain shows "Chat 1" in lock UI
    const result = await agentRegistry.spawn(
      meta.conversationId,
      fullTask,
      meta.conversationLabel
    );
    return { success: true, result };
  },
};
