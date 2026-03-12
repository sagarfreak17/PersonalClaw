import { Skill } from '../types/skill.js';

let extensionSocket: any = null;
const pendingRequests = new Map();

export const setExtensionSocket = (ws: any) => {
    extensionSocket = ws;
};

export const relaySkill: Skill = {
    name: 'relay_browser_command',
    description: 'Interacts with open browser tabs. Can list tabs, execute human-like actions (click/type), or run JS code.',
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['list', 'execute', 'human_action'],
                description: '"list" tabs, "execute" JS, or "human_action" for click/type.'
            },
            code: { 
                type: 'string', 
                description: 'For "execute": JS code string. For "human_action": JSON string like {"action": "click", "selector": "#button-id"} or {"action": "type", "text": "hello", "selector": "input[name=user]"}.' 
            },
            tabId: {
                type: 'number',
                description: 'The ID of the tab to target (optional).'
            }
        },
        required: ['action']
    },
    run: async ({ action, code, tabId }: { action: string, code?: string, tabId?: number }) => {
        if (!extensionSocket) return { error: 'No browser extension connected.' };

        const id = Math.random().toString(36).substring(7);
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                pendingRequests.delete(id);
                resolve({ error: 'Command timed out' });
            }, 10000);

            pendingRequests.set(id, (data: any) => {
                clearTimeout(timeout);
                resolve(data.result);
            });

            if (action === 'list') {
                extensionSocket.send(JSON.stringify({ id, type: 'LIST_TABS' }));
            } else if (action === 'human_action') {
                extensionSocket.send(JSON.stringify({ id, type: 'HUMAN_ACTION', code, tabId }));
            } else {
                extensionSocket.send(JSON.stringify({ id, type: 'EXECUTE_ON_PAGE', code, tabId }));
            }
        });
    }
};

export const handleExtensionResponse = (data: any) => {
    const callback = pendingRequests.get(data.id);
    if (callback) {
        callback(data);
        pendingRequests.delete(data.id);
    }
};
