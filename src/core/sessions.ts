/**
 * PersonalClaw Session Manager — Browse, search, restore, and manage conversation history.
 *
 * Sessions are stored as JSON files in the memory/ directory.
 * This manager provides search, restore, statistics, and cleanup capabilities.
 */

import * as fs from 'fs';
import * as path from 'path';

const MEMORY_DIR = path.join(process.cwd(), 'memory');

export interface SessionInfo {
  id: string;
  filename: string;
  createdAt: Date;
  turnCount: number;
  sizeKB: number;
  firstMessage?: string;
  lastMessage?: string;
}

export class SessionManager {
  /**
   * Save a conversation's history to disk.
   * Used by ConversationManager when closing a pane.
   */
  static saveSession(name: string, history: any[]): string {
    const timestamp = Date.now();
    const safeName = name.toLowerCase().replace(/\s+/g, '-'); // "Chat 1" → "chat-1"
    const sessionId = `session_${timestamp}_${safeName}`;
    const filePath = path.join(MEMORY_DIR, `${sessionId}.json`);
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
    return sessionId;
  }

  /**
   * List all saved sessions, sorted newest first.
   */
  static listSessions(limit: number = 20): SessionInfo[] {
    try {
      if (!fs.existsSync(MEMORY_DIR)) return [];

      const files = fs.readdirSync(MEMORY_DIR)
        .filter(f => f.startsWith('session_') && f.endsWith('.json'))
        .sort()
        .reverse();

      const sessions: SessionInfo[] = [];

      for (const file of files.slice(0, limit)) {
        try {
          const filePath = path.join(MEMORY_DIR, file);
          const stat = fs.statSync(filePath);
          const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

          // Extract session ID from filename
          const id = file.replace('.json', '');

          // Count user turns (skip system prompt)
          const userTurns = content.filter(
            (h: any) => h.role === 'user' && !h.parts?.[0]?.text?.startsWith('# PersonalClaw')
          );

          // Get first real user message
          const firstUserMsg = userTurns[0]?.parts?.find((p: any) => p.text)?.text?.substring(0, 100);

          // Get last message
          const lastEntry = content[content.length - 1];
          const lastMsg = lastEntry?.parts?.find((p: any) => p.text)?.text?.substring(0, 100);

          sessions.push({
            id,
            filename: file,
            createdAt: stat.birthtime,
            turnCount: userTurns.length,
            sizeKB: Math.round(stat.size / 1024),
            firstMessage: firstUserMsg,
            lastMessage: lastMsg,
          });
        } catch { /* skip corrupt sessions */ }
      }

      return sessions;
    } catch {
      return [];
    }
  }

  /**
   * Search sessions by keyword in message content.
   */
  static searchSessions(query: string, limit: number = 10): { session: SessionInfo; matches: string[] }[] {
    try {
      if (!fs.existsSync(MEMORY_DIR)) return [];

      const queryLower = query.toLowerCase();
      const files = fs.readdirSync(MEMORY_DIR)
        .filter(f => f.startsWith('session_') && f.endsWith('.json'))
        .sort()
        .reverse();

      const results: { session: SessionInfo; matches: string[] }[] = [];

      for (const file of files) {
        if (results.length >= limit) break;

        try {
          const filePath = path.join(MEMORY_DIR, file);
          const stat = fs.statSync(filePath);
          const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          const id = file.replace('.json', '');

          const matches: string[] = [];

          for (const entry of content) {
            if (entry.parts) {
              for (const part of entry.parts) {
                if (part.text && part.text.toLowerCase().includes(queryLower)) {
                  // Extract a context snippet
                  const idx = part.text.toLowerCase().indexOf(queryLower);
                  const start = Math.max(0, idx - 30);
                  const end = Math.min(part.text.length, idx + query.length + 30);
                  const snippet = (start > 0 ? '...' : '') + part.text.substring(start, end) + (end < part.text.length ? '...' : '');
                  matches.push(snippet);

                  if (matches.length >= 3) break; // Max 3 matches per session
                }
              }
            }
            if (matches.length >= 3) break;
          }

          if (matches.length > 0) {
            const userTurns = content.filter(
              (h: any) => h.role === 'user' && !h.parts?.[0]?.text?.startsWith('# PersonalClaw')
            );

            results.push({
              session: {
                id,
                filename: file,
                createdAt: stat.birthtime,
                turnCount: userTurns.length,
                sizeKB: Math.round(stat.size / 1024),
              },
              matches,
            });
          }
        } catch { /* skip corrupt */ }
      }

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Load a session's history for restoration.
   */
  static loadSession(sessionId: string): any[] | null {
    try {
      const filename = sessionId.endsWith('.json') ? sessionId : `${sessionId}.json`;
      const filePath = path.join(MEMORY_DIR, filename);

      if (!fs.existsSync(filePath)) return null;

      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Delete a specific session.
   */
  static deleteSession(sessionId: string): boolean {
    try {
      const filename = sessionId.endsWith('.json') ? sessionId : `${sessionId}.json`;
      const filePath = path.join(MEMORY_DIR, filename);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Clean up old sessions, keeping the most recent N.
   */
  static cleanup(keepCount: number = 50): number {
    try {
      if (!fs.existsSync(MEMORY_DIR)) return 0;

      const files = fs.readdirSync(MEMORY_DIR)
        .filter(f => f.startsWith('session_') && f.endsWith('.json'))
        .sort()
        .reverse();

      let deleted = 0;
      for (const file of files.slice(keepCount)) {
        try {
          fs.unlinkSync(path.join(MEMORY_DIR, file));
          deleted++;
        } catch { /* skip */ }
      }

      return deleted;
    } catch {
      return 0;
    }
  }

  /**
   * Get overall session statistics.
   */
  static getStats(): {
    totalSessions: number;
    totalSizeKB: number;
    oldestSession?: string;
    newestSession?: string;
    avgTurnsPerSession: number;
  } {
    const sessions = this.listSessions(1000);
    const totalSize = sessions.reduce((sum, s) => sum + s.sizeKB, 0);
    const avgTurns = sessions.length > 0
      ? Math.round(sessions.reduce((sum, s) => sum + s.turnCount, 0) / sessions.length)
      : 0;

    return {
      totalSessions: sessions.length,
      totalSizeKB: totalSize,
      oldestSession: sessions[sessions.length - 1]?.id,
      newestSession: sessions[0]?.id,
      avgTurnsPerSession: avgTurns,
    };
  }
}
