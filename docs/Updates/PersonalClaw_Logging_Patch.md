# PersonalClaw — Logging Patch
## Terminal Log Persistence + Activity Feed Persistence

> Standalone patch. No dependency on v12.1 or protection patch.
> Applies cleanly to current codebase. Zero LLM token cost.

---

## WHAT THIS PATCH DOES

| System | Before | After |
|---|---|---|
| Terminal output | Printed, lost on restart | Written to `logs/personalclaw-{date}.log`, 7-day rolling |
| Dashboard activity feed | 100 items in RAM, lost on restart | Persisted to `logs/activity.jsonl`, 1000-entry limit, reloaded on startup |
| EventBus log | 500 events in RAM | Unchanged — RAM only, no benefit to persisting |

**Zero token cost.** These are plain text file writes. No AI calls involved.

---

## DIRECTORY STRUCTURE

```
PersonalClaw/
├── logs/                               ← NEW (add to .gitignore)
│   ├── personalclaw-2026-03-18.log     ← terminal output for that day
│   ├── personalclaw-2026-03-19.log
│   ├── activity.jsonl                  ← persisted activity feed
│   └── (files older than 7 days auto-deleted)
```

---

## STEP 1 — ADD `logs/` TO `.gitignore`

```
# Logs
logs/
```

---

## STEP 2 — NEW FILE: `src/core/terminal-logger.ts`

Intercepts `console.log`, `console.warn`, and `console.error` — still prints to
terminal AND writes to a daily rolling file. Date change detected automatically.
Files older than 7 days deleted on startup and daily.

```typescript
/**
 * PersonalClaw Terminal Logger
 *
 * Tees all console output (log/warn/error) to a rolling daily log file.
 * Files live in logs/personalclaw-{date}.log, auto-deleted after 7 days.
 * Zero LLM token cost — pure file I/O.
 */

import * as fs from 'fs';
import * as path from 'path';

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
      const message = args.map(a => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
        try { return JSON.stringify(a); } catch { return String(a); }
      }).join(' ');
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
```

---

## STEP 3 — MODIFY `src/index.ts`

### 3.1 — Add terminal logger as the very first import

```typescript
// MUST be first — before any other imports so all console output is captured
import { terminalLogger } from './core/terminal-logger.js';
terminalLogger.start();

// ... all other existing imports follow unchanged ...
import express from 'express';
// etc.
```

### 3.2 — Add activity feed persistence

Add these constants and helpers near the top of `index.ts`, immediately after
the existing `activityBuffer` declaration:

```typescript
// Existing (unchanged):
const activityBuffer: any[] = [];
const MAX_ACTIVITY = 100;

// NEW — persistence
const ACTIVITY_FILE = path.join(process.cwd(), 'logs', 'activity.jsonl');
const MAX_ACTIVITY_FILE_ENTRIES = 1000;

/**
 * Load the last 100 activity items from disk into the in-memory buffer.
 * Called once on startup so the Activity tab isn't blank after a restart.
 */
function loadActivityFromDisk(): void {
  try {
    if (!fs.existsSync(ACTIVITY_FILE)) return;
    const lines = fs.readFileSync(ACTIVITY_FILE, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .slice(-100); // only load last 100 into RAM
    for (const line of lines) {
      try { activityBuffer.push(JSON.parse(line)); } catch { /* skip corrupt lines */ }
    }
    console.log(`[Activity] Loaded ${activityBuffer.length} items from disk.`);
  } catch (e) {
    console.warn('[Activity] Failed to load from disk:', e);
  }
}

/**
 * Append one activity item to the in-memory buffer and persist to disk.
 * Trims the file every 100 writes to stay under MAX_ACTIVITY_FILE_ENTRIES.
 */
function persistActivity(item: any): void {
  // Existing in-memory logic
  activityBuffer.push(item);
  if (activityBuffer.length > MAX_ACTIVITY) activityBuffer.shift();

  // Persist to disk
  try {
    const dir = path.dirname(ACTIVITY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(ACTIVITY_FILE, JSON.stringify(item) + '\n');

    // Trim file periodically — every 100 writes
    if (activityBuffer.length % 100 === 0) {
      trimActivityFile();
    }
  } catch (e) {
    console.warn('[Activity] Failed to persist activity item:', e);
  }
}

function trimActivityFile(): void {
  try {
    if (!fs.existsSync(ACTIVITY_FILE)) return;
    const lines = fs.readFileSync(ACTIVITY_FILE, 'utf-8').split('\n').filter(Boolean);
    if (lines.length > MAX_ACTIVITY_FILE_ENTRIES) {
      const trimmed = lines.slice(-MAX_ACTIVITY_FILE_ENTRIES).join('\n') + '\n';
      const tmp = ACTIVITY_FILE + '.tmp';
      fs.writeFileSync(tmp, trimmed);
      fs.renameSync(tmp, ACTIVITY_FILE);
    }
  } catch (e) {
    console.warn('[Activity] Failed to trim activity file:', e);
  }
}
```

### 3.3 — Call `loadActivityFromDisk()` during server init

Add immediately after the existing initialisations (after `orgHeartbeat.startAll()`):

```typescript
// Load persisted activity feed into memory
loadActivityFromDisk();
```

### 3.4 — Replace direct `activityBuffer.push()` with `persistActivity()`

Find the existing EventBus wildcard listener that pushes to `activityBuffer`:

```typescript
// BEFORE
eventBus.on('*', (event) => {
  if (event.type === Events.STREAMING_CHUNK) return;
  const activityItem = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    type: event.type,
    timestamp: event.timestamp,
    source: event.source,
    summary: formatActivitySummary(event),
  };
  activityBuffer.push(activityItem);           // ← replace this
  if (activityBuffer.length > MAX_ACTIVITY) {
    activityBuffer.shift();                     // ← and this
  }
  io.emit('activity', activityItem);
});

// AFTER
eventBus.on('*', (event) => {
  if (event.type === Events.STREAMING_CHUNK) return;
  const activityItem = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    type: event.type,
    timestamp: event.timestamp,
    source: event.source,
    summary: formatActivitySummary(event),
  };
  persistActivity(activityItem);               // ← handles buffer + disk
  io.emit('activity', activityItem);
});
```

### 3.5 — Stop terminal logger in graceful shutdown

Add to the `shutdown()` function, as the very last step before `process.exit(0)`:

```typescript
const shutdown = async (signal: string) => {
  // ... all existing shutdown steps unchanged ...

  server.close(() => {
    console.log('[Server] HTTP server closed.');
    terminalLogger.stop(); // flush and close log file
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout.');
    terminalLogger.stop();
    process.exit(1);
  }, 5000);
};
```

---

## WHAT THE LOG FILES LOOK LIKE

### `logs/personalclaw-2026-03-18.log`

```
============================================================
  PersonalClaw started at 2026-03-18T09:00:00.123Z
============================================================
[2026-03-18T09:00:00.456Z] [INFO] [Server] Initializing PersonalClaw v12...
[2026-03-18T09:00:00.891Z] [INFO] [OrgManager] Loaded 2 organisations.
[2026-03-18T09:00:01.012Z] [INFO] [OrgHeartbeat] Scheduled 5 agent heartbeats across 2 organisations.
[2026-03-18T09:00:01.234Z] [INFO] [Audit] Logger initialized.
[2026-03-18T09:00:01.456Z] [INFO] [Activity] Loaded 87 items from disk.
[2026-03-18T09:00:05.678Z] [INFO] [OrgHeartbeat] ⏰ Heartbeat: Aria (CEO) in PersonalClaw Enterprise
[2026-03-18T09:00:05.901Z] [INFO] [Brain:org_agent_xxx] Initialized with model: gemini-3.1-pro-preview
[2026-03-18T09:00:07.123Z] [INFO] [Brain:org_agent_xxx] Tool: org_read_agent_memory {}
[2026-03-18T09:00:07.456Z] [INFO] [Brain:org_agent_xxx] org_read_agent_memory completed in 333ms
[2026-03-18T09:00:09.789Z] [INFO] [Brain:org_agent_xxx] Tool: manage_files {"action":"write",...}
[2026-03-18T09:00:10.012Z] [WARN] [OrgFileGuard] Intercepted write to protected file: src/core/brain.ts
[2026-03-18T09:00:10.234Z] [INFO] [Brain:org_agent_xxx] manage_files completed in 445ms
[2026-03-18T09:00:25.678Z] [INFO] [OrgAgentRunner] Agent run completed: Aria (CEO) in 19800ms
[2026-03-18T09:01:30.123Z] [ERROR] [Brain:org_agent_yyy] manage_files failed in 201ms: ENOENT no such file
```

### `logs/activity.jsonl`

```json
{"id":"act_1710507660123_abc","type":"org:agent:run_started","timestamp":1710507660123,"source":"org-agent-runner","summary":"Agent run started: Aria (CEO)"}
{"id":"act_1710507660456_def","type":"brain:tool_called","timestamp":1710507660456,"source":"brain","summary":"Tool called: org_read_agent_memory"}
{"id":"act_1710507680789_ghi","type":"org:agent:run_completed","timestamp":1710507680789,"source":"org-agent-runner","summary":"Agent run completed: Aria (CEO) in 19800ms"}
```

---

## IMPLEMENTATION ORDER

### Phase 1 (Flash)
1. Add `logs/` to `.gitignore`
2. Create `src/core/terminal-logger.ts`
3. ✅ `npx tsc --noEmit`

### Phase 2 (Flash)
4. Add `terminalLogger` import as first line of `src/index.ts`
5. Add `loadActivityFromDisk`, `persistActivity`, `trimActivityFile` helpers
6. Call `loadActivityFromDisk()` in server init
7. Replace `activityBuffer.push()` with `persistActivity()` in EventBus wildcard listener
8. Add `terminalLogger.stop()` to both shutdown paths
9. ✅ `npx tsc --noEmit`

### Integration Tests
10. **Terminal log created** — start server → `logs/personalclaw-{today}.log` exists
11. **Terminal output captured** — trigger any agent run → tool calls appear in log file with timestamps
12. **Startup marker** — log file has `====` startup banner at start of each session
13. **Date rotation** — manually test by setting system clock forward (or check logic) → new file created
14. **7-day cleanup** — create dummy `.log` files with dates > 7 days old → restart server → old files deleted
15. **Activity feed persists** — generate activity → restart server → Activity tab still shows previous items
16. **Activity file trim** — push > 1000 items → file stays under 1000 entries
17. **`logs/` not in git** — `git status` shows no `logs/` entries

---

## FILES CHANGED

### Created
```
src/core/terminal-logger.ts
```

### Modified
```
.gitignore          (add logs/)
src/index.ts        (terminal logger import, activity persistence helpers, loadActivityFromDisk, persistActivity calls, shutdown stop)
```

---

## CONSTRAINTS

1. **`terminalLogger.start()` must be the first line in `index.ts`** — before any other imports so all startup output is captured.
2. **`persistActivity()` replaces both the `push()` and `shift()` calls** — do not leave the old buffer management in place.
3. **`trimActivityFile()` uses atomic write** — `.tmp` then rename — same pattern as org files.
4. **`terminalLogger.stop()` called in both shutdown paths** — normal exit and forced timeout.
5. **`logs/` in `.gitignore`** — must be added before first run or log files will appear in `git status`.
6. **Never throw inside `write()`** — logging must never crash the server. All writes wrapped in try/catch.
7. **EventBus `STREAMING_CHUNK` still filtered** — do not persist streaming chunks to activity file.
