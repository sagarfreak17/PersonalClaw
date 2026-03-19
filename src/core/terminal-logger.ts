/**
 * PersonalClaw Terminal Logger
 *
 * Tees all console output (log/warn/error) to a rolling daily log file.
 * Files live in logs/personalclaw-{date}.log, auto-deleted after 7 days.
 * Zero LLM token cost — pure file I/O.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

const LOGS_DIR = path.join(process.cwd(), 'logs');
const MAX_DAYS = 7;

class TerminalLogger {
  private stream: fs.WriteStream | null = null;
  private currentDate = '';
  private rotateInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Start intercepting console output.
   * Call this as the FIRST thing in src/index.ts before any other imports run.
   */
  start(): void {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    this.rotateIfNeeded();
    this.cleanup();

    // Check for date change every minute
    this.rotateInterval = setInterval(() => this.rotateIfNeeded(), 60 * 1000);

    // Clean up old files once per day
    this.cleanupInterval = setInterval(() => this.cleanup(), 24 * 60 * 60 * 1000);

    this.intercept();

    // Log startup marker
    const marker = `\n${'='.repeat(60)}\n  PersonalClaw started at ${new Date().toISOString()}\n${'='.repeat(60)}\n`;
    this.stream?.write(marker);
  }

  /**
   * Flush and close the log stream on graceful shutdown.
   */
  stop(): void {
    if (this.rotateInterval) clearInterval(this.rotateInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.stream?.end();
    this.stream = null;
  }

  private rotateIfNeeded(): void {
    const today = new Date().toISOString().split('T')[0];
    if (today === this.currentDate) return;

    this.stream?.end();
    this.currentDate = today;

    const file = path.join(LOGS_DIR, `personalclaw-${today}.log`);
    this.stream = fs.createWriteStream(file, { flags: 'a' });
  }

  private cleanup(): void {
    try {
      const cutoff = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000;
      for (const f of fs.readdirSync(LOGS_DIR)) {
        if (!f.startsWith('personalclaw-') || !f.endsWith('.log')) continue;
        const full = path.join(LOGS_DIR, f);
        try {
          if (fs.statSync(full).mtimeMs < cutoff) {
            fs.unlinkSync(full);
          }
        } catch { /* ignore individual file errors */ }
      }
    } catch { /* ignore */ }
  }

  private write(level: string, args: any[]): void {
    if (!this.stream) return;
    try {
      const timestamp = new Date().toISOString();
      const message = util.format(...args);
      this.stream.write(`[${timestamp}] [${level}] ${message}\n`);
    } catch { /* never let logging crash the server */ }
  }

  private intercept(): void {
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);

    console.log = (...args: any[]) => {
      origLog(...args);
      this.write('INFO', args);
    };

    console.warn = (...args: any[]) => {
      origWarn(...args);
      this.write('WARN', args);
    };

    console.error = (...args: any[]) => {
      origError(...args);
      this.write('ERROR', args);
    };
  }
}

export const terminalLogger = new TerminalLogger();
