import cron from 'node-cron';
import { Skill, SkillMeta } from '../types/skill.js';
import { skillLock } from '../core/skill-lock.js';
import * as fs from 'fs';
import * as path from 'path';

const JOBS_FILE = path.join(process.cwd(), 'memory', 'scheduled_jobs.json');

interface Job {
    id: string;
    expression: string;
    command: string;
}

let activeJobs: Map<string, cron.ScheduledTask> = new Map();
let savedJobs: Job[] = [];
let processMessageCallback: ((msg: string) => Promise<string>) | null = null;

export const initScheduler = (cb: (msg: string) => Promise<string>) => {
    processMessageCallback = cb;
    loadJobs();
};

const saveJobs = () => {
    const dir = path.dirname(JOBS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(JOBS_FILE, JSON.stringify(savedJobs, null, 2));
};

const loadJobs = () => {
    if (fs.existsSync(JOBS_FILE)) {
        try {
            const data = fs.readFileSync(JOBS_FILE, 'utf-8');
            savedJobs = JSON.parse(data);
            console.log(`[Scheduler] Loading ${savedJobs.length} jobs...`);
            savedJobs.forEach(job => {
                scheduleJob(job);
            });
        } catch (e) {
            console.error('[Scheduler] Failed to load jobs:', e);
        }
    }
};

const scheduleJob = (job: Job) => {
    // Stop existing if any (prevent duplicates)
    if (activeJobs.has(job.id)) {
        activeJobs.get(job.id)?.stop();
    }

    const task = cron.schedule(job.expression, async () => {
        console.log(`\x1b[36m[Scheduler] ⏰ Executing job ${job.id}: ${job.command}\x1b[0m`);
        if (processMessageCallback) {
            try {
                // We send a hidden context message to the brain
                await processMessageCallback(`[INTERNAL_SCHEDULER] Periodic Task Execution: ${job.command}`);
            } catch (err) {
                console.error(`[Scheduler] Error executing job ${job.id}:`, err);
            }
        }
    });
    activeJobs.set(job.id, task);
};

export const schedulerSkill: Skill = {
    name: 'manage_scheduler',
    description: 'Schedules recurring tasks (cron jobs). Use "add" (requires expression e.g. "0 9 * * *" for 9am daily, and command), "list", or "remove" (requires id). Use standard cron syntax.',
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['add', 'list', 'remove'],
                description: 'The action to perform.'
            },
            id: {
                type: 'string',
                description: 'Unique ID for the job.'
            },
            expression: {
                type: 'string',
                description: 'Standard cron expression. e.g. "*/30 * * * *" for every 30 mins.'
            },
            command: {
                type: 'string',
                description: 'The natural language command to execute. e.g. "Take a screenshot and summarize it"'
            }
        },
        required: ['action']
    },
    run: async ({ action, id, expression, command }: any, meta: SkillMeta) => {
        const writeActions = new Set(['add', 'remove']);
        const holderBase = {
            agentId: meta.agentId, conversationId: meta.conversationId,
            conversationLabel: meta.conversationLabel,
            operation: `scheduler:${action}`, acquiredAt: new Date(),
        };
        let release: (() => void) | undefined;
        try {
        release = writeActions.has(action)
            ? await skillLock.acquireWrite('scheduler', holderBase)
            : await skillLock.acquireRead('scheduler', holderBase);
        if (action === 'add') {
            if (!expression || !command) return { error: 'Expression and Command are required.' };
            const jobId = id || `job_${Date.now()}`;
            
            if (!cron.validate(expression)) return { error: 'Invalid cron expression.' };

            const newJob = { id: jobId, expression, command };
            
            // Update saved list (remove old if same id)
            savedJobs = savedJobs.filter(j => j.id !== jobId);
            savedJobs.push(newJob);
            
            scheduleJob(newJob);
            saveJobs();
            return { success: true, message: `Scheduled job "${jobId}" with expression "${expression}" to run: "${command}"` };
        }

        if (action === 'list') {
            return { jobs: savedJobs };
        }

        if (action === 'remove') {
            if (!id) return { error: 'Job ID is required.' };
            const task = activeJobs.get(id);
            if (task) {
                task.stop();
                activeJobs.delete(id);
                savedJobs = savedJobs.filter(j => j.id !== id);
                saveJobs();
                return { success: true, message: `Job "${id}" removed successfully.` };
            }
            return { error: `Job "${id}" not found.` };
        }

        return { error: 'Unknown action.' };
        } catch (error: any) {
            return { success: false, error: error.message };
        } finally {
            release?.();
        }
    }
};
