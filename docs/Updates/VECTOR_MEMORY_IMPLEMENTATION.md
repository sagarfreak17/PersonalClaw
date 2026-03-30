# PersonalClaw — Vector Memory Implementation Plan
> Target version: v12.12.0
> Based on: ARCHITECTURE.md v12.11.1
> Prepared for: Gemini implementation handoff

---

## Overview

This plan upgrades PersonalClaw's memory system from flat JSON key-value lookups to a unified vector + keyword search index. The goal is to make the Brain's memory semantically useful — so it can recall relevant facts from past learning without knowing the exact key.

**Three deliverables:**
1. `src/core/memory-index.ts` — new unified memory engine
2. Updated `src/skills/memory.ts` — upgraded `manage_long_term_memory` skill
3. Updated `src/core/learner.ts` — learner writes into the new index
4. Dashboard export/import surface — Markdown correction workflow
5. Pre-compaction flush hook in `src/core/brain.ts`

---

## Architecture Decision Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| Vector storage | Local JSON file (`memory/vector_index.json`) | TypeScript-native, no native binaries, fits local-first principle |
| Embeddings | Gemini Embeddings API (`text-embedding-004` model) | Already have the API key, consistent with existing stack |
| Keyword search | JS-side filtering on same index | No extra deps, fast enough for <5K entries |
| Source of truth | JSON index | Structured, reliable, atomic writes |
| Human edit surface | Markdown export/import on demand | Correction escape hatch without runtime sync complexity |
| Compaction hook | Pre-compaction flush in `brain.ts` | Natural integration with existing 200K token threshold |

---

## Phase 1 — Core Memory Engine

### 1.1 New File: `src/core/memory-index.ts`

This is the central new file. It owns the index, all reads, all writes, and all search.

#### Index Schema

```typescript
// memory/vector_index.json structure
interface MemoryEntry {
  id: string;                    // uuid — e.g. "mem_1711000000000_abc123"
  key: string;                   // human-readable label — e.g. "user_name"
  value: string;                 // the actual memory content
  source: 'manual' | 'learner' | 'compaction_flush';
  embedding: number[];           // 768-dim float array from Gemini
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
  tags?: string[];               // optional — e.g. ["msp", "connectwise"]
}

interface MemoryIndex {
  version: 1;
  entries: MemoryEntry[];
  lastUpdated: string;
}
```

#### File path
```
memory/vector_index.json
```

#### Class: `MemoryIndexManager`

```typescript
class MemoryIndexManager {
  private indexPath: string;
  private index: MemoryIndex;
  private geminiClient: GoogleGenerativeAI;

  // Lifecycle
  async load(): Promise<void>
  private async save(): Promise<void>   // atomic write: tmp → rename

  // Write
  async upsert(key: string, value: string, source: MemoryEntry['source'], tags?: string[]): Promise<MemoryEntry>
  async delete(key: string): Promise<boolean>

  // Search — returns top-N results ranked by combined score
  async search(query: string, topK?: number): Promise<SearchResult[]>

  // Internal
  private async embed(text: string): Promise<number[]>
  private cosineSimilarity(a: number[], b: number[]): number
  private keywordScore(entry: MemoryEntry, query: string): number

  // Markdown export/import
  async exportMarkdown(): Promise<string>
  async importMarkdown(markdown: string): Promise<{ updated: number; added: number }>

  // Migration
  async migrateFromLegacy(): Promise<void>   // reads long_term_knowledge.json + self_learned.json → upserts all entries
}

interface SearchResult {
  entry: MemoryEntry;
  vectorScore: number;       // cosine similarity 0-1
  keywordScore: number;      // 0-1 based on term overlap
  combinedScore: number;     // 0.7 * vectorScore + 0.3 * keywordScore
}
```

Export singleton: `export const memoryIndex = new MemoryIndexManager()`

#### Embedding logic

Use `@google/generative-ai` (already a dependency):

```typescript
private async embed(text: string): Promise<number[]> {
  const model = this.geminiClient.getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.embedContent(text);
  return result.embedding.values;
}
```

Embed the **concatenation of key + value** so both are searchable: `"${key}: ${value}"`

#### Search logic

For a given query string:
1. Embed the query
2. Compute cosine similarity against every entry's embedding
3. Compute keyword score: count how many query words appear in `key + value`, normalize 0-1
4. Combined score = `0.7 * vectorScore + 0.3 * keywordScore`
5. Sort descending, return top-K (default 10)

Cosine similarity formula:
```typescript
private cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  return magA && magB ? dot / (magA * magB) : 0;
}
```

#### Atomic save pattern

Same pattern as `todos.json` — write to tmp, rename:
```typescript
private async save(): Promise<void> {
  const tmp = this.indexPath + '.tmp';
  await fs.promises.writeFile(tmp, JSON.stringify(this.index, null, 2), 'utf-8');
  await fs.promises.rename(tmp, this.indexPath);
}
```

#### Skill lock

Add `'memory_index'` as a new **ReadWriteLock** in `src/core/skill-lock.ts`:
- Read lock: acquired during `search()`
- Write lock: acquired during `upsert()` and `delete()`
- Timeout: 10s (same as files)

Add to `skill-lock.ts`:
```typescript
// In ReadWriteLockKey type union:
| 'memory_index'

// In LOCK_TIMEOUTS:
memory_index: 10_000,
```

---

### 1.2 Updated File: `src/skills/memory.ts`

Replace the current flat JSON implementation with calls to `memoryIndex`.

#### New actions

| Action | Was | Now |
|--------|-----|-----|
| `learn` | Write key-value to `long_term_knowledge.json` | `memoryIndex.upsert(key, value, 'manual')` |
| `recall` | Exact key lookup or dump-all | `memoryIndex.search(query)` — semantic search |
| `recall_exact` | — (new) | Find by exact key match (backwards compat) |
| `forget` | Delete by key from JSON | `memoryIndex.delete(key)` |
| `search` | — (new) | Explicit semantic search with topK param |
| `list` | — (new) | Return all entries paginated (for dashboard) |

#### Updated skill parameters

```typescript
parameters: {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['learn', 'recall', 'recall_exact', 'forget', 'search', 'list'],
    },
    key: {
      type: 'string',
      description: 'Memory key/label. Required for learn, recall_exact, forget.',
    },
    value: {
      type: 'string',
      description: 'Memory value to store. Required for learn.',
    },
    query: {
      type: 'string',
      description: 'Natural language search query. Used by recall and search actions.',
    },
    top_k: {
      type: 'number',
      description: 'Max results to return for search/recall. Default 5.',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional tags for categorization — e.g. ["msp", "connectwise"]',
    },
  },
  required: ['action'],
}
```

#### Updated skill description (critical — AI reads this)

```
manage_long_term_memory: Store and retrieve persistent knowledge that survives across sessions and context compactions.

WHEN TO USE:
- Use 'learn' to store any fact you want to remember permanently (user preferences, MSP-specific context, workflow patterns, client details).
- Use 'recall' or 'search' for semantic/fuzzy lookup — "what do I know about ConnectWise" returns relevant facts even if they weren't tagged that way.
- Use 'recall_exact' only when you know the exact key.
- Use 'forget' to remove incorrect or outdated facts.

MEMORY IS PERMANENT — it survives conversation resets and server restarts. Prefer storing structured facts: "user_preferred_ticket_format: Always include client name, priority, and estimated resolution time."
```

---

### 1.3 Updated File: `src/core/learner.ts`

The learner currently writes to `self_learned.json`. Change it to write into the memory index instead.

#### What changes

After the learner's Gemini analysis call completes and extracts structured insights, instead of writing to `self_learned.json`:

```typescript
// OLD
await fs.promises.writeFile(SELF_LEARNED_PATH, JSON.stringify(learned, null, 2));

// NEW — for each insight, upsert into memory index
for (const [key, value] of Object.entries(insights)) {
  if (value && typeof value === 'string') {
    await memoryIndex.upsert(key, value, 'learner');
  }
}
```

Keep `self_learned.json` writes for backwards compatibility with the system prompt cache check (the file mod time is used to invalidate the system prompt cache in `brain.ts`). Touch the file after upsert so the cache invalidation still works:

```typescript
// Touch self_learned.json to trigger system prompt cache rebuild
await fs.promises.writeFile(SELF_LEARNED_PATH, JSON.stringify({ lastUpdated: new Date().toISOString() }));
```

The system prompt injection of learned knowledge should now pull from `memoryIndex.search()` with a broad query, or use `memoryIndex.list()` for the top 50 most recent entries, instead of loading `self_learned.json` wholesale.

---

## Phase 2 — Pre-Compaction Flush Hook

### 2.1 Updated File: `src/core/brain.ts`

#### Where to hook in

The compaction check already runs every 10 turns when token count exceeds 200K. Before the Brain summarizes old history, add a flush step.

Locate the compaction trigger in `brain.ts` and add:

```typescript
// Before compaction summary — flush key facts to memory index
await this.flushToMemory();
```

#### `flushToMemory()` method

```typescript
private async flushToMemory(): Promise<void> {
  try {
    const history = this.getHistory();
    // Build a targeted extraction prompt
    const extractionPrompt = `
You are a memory extraction assistant. Analyze this conversation history and extract the most important facts worth preserving permanently.

Focus on:
- User preferences and working style
- MSP-specific context (clients, tools, workflows)
- Decisions made and rationale
- Technical configurations mentioned
- Corrections to previous understanding

Return a JSON array of objects: [{ "key": "short_label", "value": "concise fact" }]
Return ONLY valid JSON, no other text. Maximum 10 facts.

Conversation history:
${JSON.stringify(history.slice(-20))}
    `;

    const model = this.geminiClient.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(extractionPrompt);
    const text = result.response.text().trim();

    const facts: Array<{ key: string; value: string }> = JSON.parse(text);
    for (const fact of facts) {
      if (fact.key && fact.value) {
        await memoryIndex.upsert(fact.key, fact.value, 'compaction_flush');
      }
    }

    console.log(`[Brain] Pre-compaction flush: saved ${facts.length} facts to memory index`);
  } catch (err) {
    // Non-fatal — compaction continues regardless
    console.error('[Brain] Pre-compaction flush failed:', err);
  }
}
```

Use `gemini-2.5-flash` (same as the learner) — cheap, fast, no quota pressure on the primary model.

#### System prompt injection

Currently, `self_learned.json` is loaded wholesale into the system prompt. Replace this with a targeted recall from the memory index. In the system prompt builder:

```typescript
// OLD
const selfLearned = JSON.parse(await fs.promises.readFile(SELF_LEARNED_PATH, 'utf-8'));
const learnedSection = JSON.stringify(selfLearned, null, 2);

// NEW
const topMemories = await memoryIndex.search('user preferences working style MSP workflows', 20);
const learnedSection = topMemories
  .map(r => `- ${r.entry.key}: ${r.entry.value}`)
  .join('\n');
```

This injects the 20 most relevant memories rather than dumping everything, keeping the system prompt lean.

---

## Phase 3 — Human Correction Surface

### 3.1 Markdown Export/Import in `MemoryIndexManager`

#### `exportMarkdown()` output format

```markdown
# PersonalClaw Memory Export
> Generated: 2026-03-30T10:00:00.000Z
> Total entries: 47
> Edit values directly. Do not change the ID lines. Save and import to apply corrections.

---

<!-- id: mem_1711000000000_abc123 | source: learner | tags: msp -->
**user_name**: Sagar

<!-- id: mem_1711000000001_def456 | source: manual | tags: connectwise -->
**preferred_ticket_format**: Always include client name, priority, and SLA deadline in the first line.

<!-- id: mem_1711000000002_ghi789 | source: compaction_flush -->
**connectwise_psa_url**: https://na.myconnectwise.net

...
```

#### `importMarkdown()` logic

Parse the Markdown:
1. Split on `---` blocks
2. Extract `id` from the comment line
3. Extract `key` from the `**key**` line
4. Extract `value` from the text after the colon
5. For each parsed entry:
   - If `id` matches an existing entry and `value` changed → re-embed and update
   - If `id` doesn't exist → insert as new `manual` entry
6. Return `{ updated, added }` count

#### REST endpoints (add to `src/index.ts`)

```
GET  /api/memory/export   → returns Markdown file as download
POST /api/memory/import   → accepts Markdown body, runs importMarkdown(), returns { updated, added }
GET  /api/memory/search?q=<query>&k=<topK>  → returns JSON search results
GET  /api/memory/list?page=<n>  → paginated entry list for dashboard browser
DELETE /api/memory/:id    → delete by ID
```

#### Dashboard integration (minimal — no new tab needed)

Add a **Memory** section to the existing Skills & Config tab:
- "Export Memory" button → GET `/api/memory/export` → triggers download of `personalclaw-memory.md`
- "Import Corrections" button → file picker → POST to `/api/memory/import` → shows `{ updated, added }` toast
- Entry count display (fetched from `/api/memory/list`)

No new tab required. Keep it lightweight.

---

## Phase 4 — Migration

### 4.1 One-time migration on startup

In `src/index.ts`, after the memory index loads, run migration if `vector_index.json` doesn't exist yet:

```typescript
// In startup sequence (after existing skill init)
const vectorIndexExists = await fs.promises.access('memory/vector_index.json').then(() => true).catch(() => false);
if (!vectorIndexExists) {
  console.log('[Startup] Migrating legacy memory to vector index...');
  await memoryIndex.migrateFromLegacy();
  console.log('[Startup] Memory migration complete.');
}
```

#### `migrateFromLegacy()` logic

1. Load `memory/long_term_knowledge.json` — for each key/value pair, `upsert(key, value, 'manual')`
2. Load `memory/self_learned.json` — for each insight, `upsert(key, value, 'learner')`
3. Both files are kept on disk unchanged (don't delete legacy files — they still serve as the system prompt cache trigger)

---

## Files Changed Summary

| File | Action | What changes |
|------|--------|-------------|
| `src/core/memory-index.ts` | **NEW** | Full MemoryIndexManager class |
| `src/core/skill-lock.ts` | Update | Add `memory_index` ReadWriteLock |
| `src/skills/memory.ts` | Rewrite | Calls memoryIndex instead of flat JSON |
| `src/core/learner.ts` | Update | Upserts into memoryIndex, touches self_learned.json for cache |
| `src/core/brain.ts` | Update | `flushToMemory()` method, updated system prompt injection |
| `src/index.ts` | Update | Migration on startup, 5 new REST endpoints |
| `dashboard/src/components/` | Minor update | Export/Import buttons in Skills & Config tab |
| `docs/ARCHITECTURE.md` | Update | New memory section, updated skill count, new endpoints |

---

## Version Log Entry

```markdown
## [12.12.0] - 2026-03-30

### Vector Memory System

#### New: `src/core/memory-index.ts` — Unified Memory Engine
- `MemoryIndexManager` class with Gemini `text-embedding-004` embeddings
- Local JSON index at `memory/vector_index.json` — TypeScript-native, no native binaries
- Hybrid search: 70% vector (cosine similarity) + 30% keyword (term overlap)
- `upsert`, `delete`, `search`, `list`, `exportMarkdown`, `importMarkdown` methods
- Atomic writes (tmp → rename) consistent with todos.json pattern
- New `memory_index` ReadWriteLock in skill-lock.ts (10s timeout)
- Sources tracked per entry: `manual` | `learner` | `compaction_flush`

#### Changed: `src/skills/memory.ts`
- `manage_long_term_memory` now routes to memory index
- `recall` is now semantic search — "what do I know about ConnectWise" works
- New actions: `search` (explicit semantic), `recall_exact` (exact key), `list` (paginated)
- Backwards compatible — existing `learn`/`recall`/`forget` calls work unchanged

#### Changed: `src/core/learner.ts`
- Learner insights written into memory index (`source: 'learner'`)
- `self_learned.json` touched after writes to preserve system prompt cache invalidation

#### Changed: `src/core/brain.ts`
- `flushToMemory()` — pre-compaction fact extraction using `gemini-2.5-flash`
- Fires before every context compaction (200K token threshold)
- System prompt now injects top 20 semantically relevant memories instead of full self_learned.json dump

#### Changed: `src/index.ts`
- One-time migration on startup: legacy `long_term_knowledge.json` + `self_learned.json` → vector index
- New endpoints: `GET /api/memory/export`, `POST /api/memory/import`, `GET /api/memory/search`, `GET /api/memory/list`, `DELETE /api/memory/:id`

#### Human Correction Surface
- Export memory as human-readable Markdown → edit wrong facts → import corrections back
- Re-embeds only changed entries on import
- No runtime sync complexity — manual on-demand workflow
```

---

## Implementation Notes for Gemini

**Start with** `memory-index.ts` — get `upsert` and `search` working first with a simple test before wiring up the rest.

**Embedding API call** — use `@google/generative-ai` which is already installed:
```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = client.getGenerativeModel({ model: 'text-embedding-004' });
const result = await model.embedContent('your text here');
const embedding = result.embedding.values; // number[]
```

**Watch for circular imports** — `memory-index.ts` imports from `@google/generative-ai` only. Do NOT import from `brain.ts` or `learner.ts`. Those files import from `memory-index.ts`, not the other way.

**Skill lock pattern** — follow the existing pattern from `todos.ts`:
```typescript
const release = await skillLock.acquireWrite('memory_index', 'manage_long_term_memory');
try {
  await memoryIndex.upsert(...);
} finally {
  release();
}
```

**Do not delete** `long_term_knowledge.json` or `self_learned.json` — they are still read by the system prompt cache check in `brain.ts`.

**Index size** — at ~5K entries the JSON index will be a few MB. Performance will be fine. If it ever grows past 20K entries, a future version can switch to SQLite-vec. Don't over-engineer now.

**Error handling** — embedding calls can fail (API quota, network). Wrap all `embed()` calls in try/catch. On failure, store the entry without an embedding and skip it in vector search (keyword search still works).
```typescript
let embedding: number[] = [];
try {
  embedding = await this.embed(`${key}: ${value}`);
} catch (err) {
  console.warn('[MemoryIndex] Embedding failed, storing without vector:', err);
}
```
