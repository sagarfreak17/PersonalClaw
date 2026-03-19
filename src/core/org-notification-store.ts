import * as fs from 'fs';
import * as path from 'path';
import { orgManager } from './org-manager.js';

export interface StoredNotification {
  id: string;
  orgId: string;
  orgName: string;
  agentName: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
  type: 'blocker' | 'proposal' | 'agent' | 'digest' | 'cascade';
  timestamp: number;
  telegramSent: boolean;
  telegramAttempts: number;
}

const MAX_TELEGRAM_LENGTH = 3800; // FIX-AG: Telegram 4096 char limit with buffer
const pendingTelegram: StoredNotification[] = [];
let telegramSendFn: ((msg: string) => Promise<void>) | null = null;

// FIX-AK: Blocker cascade tracking — orgId → timestamps of recent blockers
const recentBlockerTimestamps: Map<string, number[]> = new Map();
const BLOCKER_CASCADE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const BLOCKER_CASCADE_THRESHOLD = 3;

export function setTelegramSender(fn: (msg: string) => Promise<void>) {
  telegramSendFn = fn;
}

function truncateForTelegram(msg: string): string {
  // FIX-AG
  if (msg.length <= MAX_TELEGRAM_LENGTH) return msg;
  return msg.substring(0, MAX_TELEGRAM_LENGTH) + '...';
}

function getNotificationFile(orgId: string): string {
  const org = orgManager.get(orgId);
  if (!org) throw new Error(`Org ${orgId} not found`);
  return path.join(org.orgDir, 'notifications.jsonl');
}

export function storeNotification(
  notif: Omit<StoredNotification, 'id' | 'telegramSent' | 'telegramAttempts'>
): StoredNotification {
  // FIX-AK: Blocker cascade detection
  if (notif.type === 'blocker') {
    const now = Date.now();
    const timestamps = recentBlockerTimestamps.get(notif.orgId) ?? [];
    const recent = timestamps.filter(t => now - t < BLOCKER_CASCADE_WINDOW_MS);
    recent.push(now);
    recentBlockerTimestamps.set(notif.orgId, recent);

    if (recent.length === BLOCKER_CASCADE_THRESHOLD) {
      // Send single cascade alert instead of individual notifications for this and future ones
      const cascadeMsg = `🚨 *[${notif.orgName}]* Multiple agents blocked (${recent.length} in 5 min). Check the Board of Directors immediately.`;
      storeNotification({
        orgId: notif.orgId,
        orgName: notif.orgName,
        agentName: 'System',
        message: cascadeMsg,
        level: 'error',
        type: 'cascade',
        timestamp: now,
      });
      // Suppress this individual notification's Telegram (cascade sent instead)
    }
  }

  const full: StoredNotification = {
    ...notif,
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    telegramSent: false,
    telegramAttempts: 0,
  };

  try {
    const file = getNotificationFile(notif.orgId);
    fs.appendFileSync(file, JSON.stringify(full) + '\n');
  } catch (e) {
    console.error('[OrgNotificationStore] Failed to persist notification:', e);
  }

  pendingTelegram.push(full);
  flushTelegramQueue();
  return full;
}

export function getNotifications(orgId: string, count = 50): StoredNotification[] {
  try {
    const file = getNotificationFile(orgId);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf-8')
      .split('\n').filter(Boolean)
      .slice(-count)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

async function flushTelegramQueue(): Promise<void> {
  if (!telegramSendFn) return;
  const toSend = pendingTelegram.filter(n => !n.telegramSent && n.telegramAttempts < 5);
  for (const notif of toSend) {
    try {
      const emoji = notif.level === 'error' ? '🔴'
        : notif.level === 'warning' ? '🟡'
        : notif.type === 'proposal' ? '📋'
        : notif.type === 'blocker' ? '🚧'
        : '🟢';
      const msg = truncateForTelegram(`${emoji} *[${notif.orgName}]* ${notif.agentName}\n${notif.message}`);
      await telegramSendFn(msg);
      notif.telegramSent = true;
      const idx = pendingTelegram.indexOf(notif);
      if (idx > -1) pendingTelegram.splice(idx, 1);
    } catch { notif.telegramAttempts++; }
  }
}

setInterval(flushTelegramQueue, 2 * 60 * 1000);

export async function sendDailyDigest(orgId: string): Promise<void> {
  const org = orgManager.get(orgId);
  if (!org || org.paused) return;
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = getNotifications(orgId, 200).filter(n => n.timestamp > since && n.type !== 'digest');
  if (recent.length === 0) return; // Skip empty digest
  const blockers = recent.filter(n => n.type === 'blocker').length;
  const proposals = recent.filter(n => n.type === 'proposal').length;
  const agentEvents = recent.filter(n => n.type === 'agent').length;
  const summary = `📊 *Daily Digest — ${org.name}*\n\nLast 24h:\n• ${agentEvents} agent notifications\n• ${proposals} pending proposal${proposals !== 1 ? 's' : ''}\n• ${blockers} blocker${blockers !== 1 ? 's' : ''}\n\nCheck Board of Directors for details.`;
  storeNotification({ orgId, orgName: org.name, agentName: 'System', message: summary, level: 'info', type: 'digest', timestamp: Date.now() });
}
