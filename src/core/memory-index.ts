/**
 * PersonalClaw Vector Memory Index — Unified semantic + keyword memory engine.
 *
 * Stores facts as key-value entries with Gemini embeddings for semantic search.
 * Hybrid search: 70% vector (cosine similarity) + 30% keyword (term overlap).
 * Atomic writes (tmp -> rename). No native binaries — pure TypeScript + JSON.
 *
 * This file imports ONLY from @google/generative-ai. brain.ts and learner.ts
 * import from here, never the reverse.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Types ──────────────────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  source: 'manual' | 'learner' | 'compaction_flush';
  embedding: number[];
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

export interface MemoryIndex {
  version: 1;
  entries: MemoryEntry[];
  lastUpdated: string;
}

export interface SearchResult {
  entry: MemoryEntry;
  vectorScore: number;
  keywordScore: number;
  combinedScore: number;
}

export interface IMemoryIndexManager {
  load(): Promise<void>;
  upsert(key: string, value: string, source: MemoryEntry['source'], tags?: string[]): Promise<MemoryEntry>;
  delete(key: string): Promise<boolean>;
  deleteById(id: string): Promise<boolean>;
  search(query: string, topK?: number): Promise<SearchResult[]>;
  list(page?: number, pageSize?: number): Promise<{ entries: MemoryEntry[]; total: number }>;
  getEntryCount(): number;
  exportMarkdown(): Promise<string>;
  importMarkdown(markdown: string): Promise<{ updated: number; added: number }>;
  migrateFromLegacy(): Promise<void>;
}

// ─── Constants ──────────────────────────────────────────────────────

const MEMORY_DIR = path.join(process.cwd(), 'memory');
const INDEX_PATH = path.join(MEMORY_DIR, 'vector_index.json');
const LEGACY_KNOWLEDGE = path.join(MEMORY_DIR, 'long_term_knowledge.json');
const LEGACY_LEARNED = path.join(MEMORY_DIR, 'self_learned.json');

const EMBEDDING_MODEL = 'gemini-embedding-001';
const VECTOR_WEIGHT = 0.7;
const KEYWORD_WEIGHT = 0.3;
const DEDUP_THRESHOLD = 0.9;

// ─── Query Embedding Cache ──────────────────────────────────────────
// Avoids repeated API calls for the same query string (e.g. system prompt rebuilds)

interface CachedEmbedding {
  embedding: number[];
  timestamp: number;
}

const QUERY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const queryEmbeddingCache = new Map<string, CachedEmbedding>();

// ─── MemoryIndexManager ─────────────────────────────────────────────

class MemoryIndexManager implements IMemoryIndexManager {
  private index: MemoryIndex = { version: 1, entries: [], lastUpdated: new Date().toISOString() };
  private geminiClient: GoogleGenerativeAI;
  private loaded = false;

  constructor() {
    this.geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  }

  // ── Lifecycle ──

  async load(): Promise<void> {
    try {
      if (fs.existsSync(INDEX_PATH)) {
        const raw = await fs.promises.readFile(INDEX_PATH, 'utf-8');
        this.index = JSON.parse(raw);
      }
    } catch (e) {
      console.error('[MemoryIndex] Failed to load index, starting fresh:', e);
      this.index = { version: 1, entries: [], lastUpdated: new Date().toISOString() };
    }
    this.loaded = true;
    console.log(`[MemoryIndex] Loaded ${this.index.entries.length} entries.`);
  }

  private async save(): Promise<void> {
    if (!fs.existsSync(MEMORY_DIR)) {
      await fs.promises.mkdir(MEMORY_DIR, { recursive: true });
    }
    this.index.lastUpdated = new Date().toISOString();
    const tmp = INDEX_PATH + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(this.index, null, 2), 'utf-8');
    await fs.promises.rename(tmp, INDEX_PATH);
  }

  // ── Write ──

  async upsert(key: string, value: string, source: MemoryEntry['source'], tags?: string[]): Promise<MemoryEntry> {
    const now = new Date().toISOString();
    const existing = this.index.entries.find(e => e.key === key);

    let embedding: number[] = [];
    try {
      embedding = await this.embed(`${key}: ${value}`);
    } catch (err) {
      console.warn('[MemoryIndex] Embedding failed, storing without vector:', err);
    }

    if (existing) {
      existing.value = value;
      existing.embedding = embedding.length ? embedding : existing.embedding;
      existing.updatedAt = now;
      existing.source = source;
      if (tags) existing.tags = tags;
      await this.save();
      return existing;
    }

    const entry: MemoryEntry = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      key,
      value,
      source,
      embedding,
      createdAt: now,
      updatedAt: now,
      tags,
    };
    this.index.entries.push(entry);
    await this.save();
    return entry;
  }

  async delete(key: string): Promise<boolean> {
    const idx = this.index.entries.findIndex(e => e.key === key);
    if (idx === -1) return false;
    this.index.entries.splice(idx, 1);
    await this.save();
    return true;
  }

  async deleteById(id: string): Promise<boolean> {
    const idx = this.index.entries.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.index.entries.splice(idx, 1);
    await this.save();
    return true;
  }

  // ── Search ──

  async search(query: string, topK: number = 10): Promise<SearchResult[]> {
    if (this.index.entries.length === 0) return [];

    let queryEmbedding: number[] = [];
    try {
      queryEmbedding = await this.embedWithCache(query);
    } catch (err) {
      console.warn('[MemoryIndex] Query embedding failed, falling back to keyword-only:', err);
    }

    const queryWords = this.tokenize(query);

    const results: SearchResult[] = this.index.entries.map(entry => {
      const vectorScore = queryEmbedding.length && entry.embedding.length
        ? this.cosineSimilarity(queryEmbedding, entry.embedding)
        : 0;
      const keywordScore = this.keywordScore(entry, queryWords);

      const combinedScore = queryEmbedding.length
        ? VECTOR_WEIGHT * vectorScore + KEYWORD_WEIGHT * keywordScore
        : keywordScore; // keyword-only fallback

      return { entry, vectorScore, keywordScore, combinedScore };
    });

    results.sort((a, b) => b.combinedScore - a.combinedScore);
    return results.slice(0, topK);
  }

  /**
   * Check if a fact is already stored with high similarity.
   * Used by flushToMemory() to avoid duplicate entries.
   */
  async isDuplicate(key: string, value: string): Promise<boolean> {
    if (this.index.entries.length === 0) return false;

    // Exact key match = definitely duplicate
    if (this.index.entries.some(e => e.key === key)) return true;

    // Semantic similarity check
    try {
      const embedding = await this.embedWithCache(`${key}: ${value}`);
      for (const entry of this.index.entries) {
        if (entry.embedding.length && this.cosineSimilarity(embedding, entry.embedding) > DEDUP_THRESHOLD) {
          return true;
        }
      }
    } catch {
      // If embedding fails, just check keyword overlap
    }

    return false;
  }

  // ── List ──

  async list(page: number = 1, pageSize: number = 50): Promise<{ entries: MemoryEntry[]; total: number }> {
    const sorted = [...this.index.entries].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    const start = (page - 1) * pageSize;
    return {
      entries: sorted.slice(start, start + pageSize),
      total: this.index.entries.length,
    };
  }

  getEntryCount(): number {
    return this.index.entries.length;
  }

  // ── Markdown Export/Import ──

  async exportMarkdown(): Promise<string> {
    const sorted = [...this.index.entries].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    const lines: string[] = [
      '# PersonalClaw Memory Export',
      `> Generated: ${new Date().toISOString()}`,
      `> Total entries: ${sorted.length}`,
      '> Edit values directly. Do not change the ID lines. Save and import to apply corrections.',
      '',
      '---',
      '',
    ];

    for (const entry of sorted) {
      const tagStr = entry.tags?.length ? ` | tags: ${entry.tags.join(', ')}` : '';
      lines.push(`<!-- id: ${entry.id} | source: ${entry.source}${tagStr} -->`);
      lines.push(`**${entry.key}**: ${entry.value}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  async importMarkdown(markdown: string): Promise<{ updated: number; added: number }> {
    const entryRegex = /<!-- id: ([\w_]+) \| source: (\w+)(?:\s*\| tags: ([^>]+))? -->\n\*\*([^*]+)\*\*:\s*(.+)/g;

    let updated = 0;
    let added = 0;
    let match: RegExpExecArray | null;

    while ((match = entryRegex.exec(markdown)) !== null) {
      const [, id, , , key, value] = match;
      const trimmedKey = key.trim();
      const trimmedValue = value.trim();

      const existing = this.index.entries.find(e => e.id === id);
      if (existing) {
        if (existing.value !== trimmedValue || existing.key !== trimmedKey) {
          existing.key = trimmedKey;
          existing.value = trimmedValue;
          existing.updatedAt = new Date().toISOString();
          // Re-embed changed entries
          try {
            existing.embedding = await this.embed(`${trimmedKey}: ${trimmedValue}`);
          } catch { /* keep old embedding */ }
          updated++;
        }
      } else {
        // New entry from import
        await this.upsert(trimmedKey, trimmedValue, 'manual');
        added++;
      }
    }

    if (updated > 0 || added > 0) {
      await this.save();
    }

    return { updated, added };
  }

  // ── Migration ──

  async migrateFromLegacy(): Promise<void> {
    let migrated = 0;

    // Migrate long_term_knowledge.json
    try {
      if (fs.existsSync(LEGACY_KNOWLEDGE)) {
        const raw = JSON.parse(await fs.promises.readFile(LEGACY_KNOWLEDGE, 'utf-8'));
        const entries = Object.entries(raw);
        if (entries.length > 0) {
          const embeddings = await this.batchEmbed(
            entries.map(([k, v]) => `${k}: ${v}`)
          );
          for (let i = 0; i < entries.length; i++) {
            const [key, value] = entries[i];
            if (typeof value !== 'string') continue;
            const now = new Date().toISOString();
            this.index.entries.push({
              id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
              key,
              value,
              source: 'manual',
              embedding: embeddings[i] || [],
              createdAt: now,
              updatedAt: now,
            });
            migrated++;
          }
        }
      }
    } catch (e) {
      console.error('[MemoryIndex] Migration from long_term_knowledge.json failed:', e);
    }

    // Migrate self_learned.json — only the fact-like entries, not structured patterns
    try {
      if (fs.existsSync(LEGACY_LEARNED)) {
        const raw = JSON.parse(await fs.promises.readFile(LEGACY_LEARNED, 'utf-8'));

        // User profile notes -> facts
        const profileNotes: Array<[string, string]> = [];
        if (raw.user_profile) {
          const p = raw.user_profile;
          if (p.name) profileNotes.push(['user_name', p.name]);
          if (p.role) profileNotes.push(['user_role', p.role]);
          if (p.company) profileNotes.push(['user_company', p.company]);
          if (p.expertise_level) profileNotes.push(['user_expertise', p.expertise_level]);
          for (const note of (p.notes || []).slice(-20)) {
            const noteKey = `user_note_${note.substring(0, 30).replace(/\W+/g, '_').toLowerCase()}`;
            profileNotes.push([noteKey, note]);
          }
        }

        // Domain knowledge -> facts
        const domainFacts: Array<[string, string]> = [];
        if (raw.domain_knowledge?.length) {
          for (const dk of raw.domain_knowledge.slice(-50)) {
            domainFacts.push([`domain_${dk.term.replace(/\W+/g, '_').toLowerCase()}`, `${dk.category}: ${dk.meaning}`]);
          }
        }

        // Corrections -> facts
        const correctionFacts: Array<[string, string]> = [];
        if (raw.corrections?.length) {
          for (const c of raw.corrections.slice(-20)) {
            correctionFacts.push([`correction_${c.lesson.substring(0, 30).replace(/\W+/g, '_').toLowerCase()}`, c.lesson]);
          }
        }

        // Raw insights -> facts
        const insightFacts: Array<[string, string]> = [];
        if (raw.raw_insights?.length) {
          for (const insight of raw.raw_insights.slice(-20)) {
            insightFacts.push([`insight_${insight.substring(0, 30).replace(/\W+/g, '_').toLowerCase()}`, insight]);
          }
        }

        const allFacts = [...profileNotes, ...domainFacts, ...correctionFacts, ...insightFacts];

        if (allFacts.length > 0) {
          const embeddings = await this.batchEmbed(
            allFacts.map(([k, v]) => `${k}: ${v}`)
          );
          for (let i = 0; i < allFacts.length; i++) {
            const [key, value] = allFacts[i];
            // Skip if key already exists (from manual knowledge migration)
            if (this.index.entries.some(e => e.key === key)) continue;
            const now = new Date().toISOString();
            this.index.entries.push({
              id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
              key,
              value,
              source: 'learner',
              embedding: embeddings[i] || [],
              createdAt: now,
              updatedAt: now,
            });
            migrated++;
          }
        }
      }
    } catch (e) {
      console.error('[MemoryIndex] Migration from self_learned.json failed:', e);
    }

    if (migrated > 0) {
      await this.save();
    }
    console.log(`[MemoryIndex] Migrated ${migrated} entries from legacy files.`);
  }

  // ── Embedding ──

  private async embed(text: string): Promise<number[]> {
    const model = this.geminiClient.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent(text);
    return result.embedding.values;
  }

  private async embedWithCache(text: string): Promise<number[]> {
    const cached = queryEmbeddingCache.get(text);
    if (cached && Date.now() - cached.timestamp < QUERY_CACHE_TTL) {
      return cached.embedding;
    }
    const embedding = await this.embed(text);
    queryEmbeddingCache.set(text, { embedding, timestamp: Date.now() });

    // Prune stale cache entries
    if (queryEmbeddingCache.size > 50) {
      const now = Date.now();
      for (const [k, v] of queryEmbeddingCache) {
        if (now - v.timestamp > QUERY_CACHE_TTL) queryEmbeddingCache.delete(k);
      }
    }

    return embedding;
  }

  /**
   * Batch embed multiple texts using batchEmbedContents.
   * Falls back to sequential embed on failure.
   */
  private async batchEmbed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    try {
      const model = this.geminiClient.getGenerativeModel({ model: EMBEDDING_MODEL });
      const result = await model.batchEmbedContents({
        requests: texts.map(text => ({
          content: { role: 'user', parts: [{ text }] },
        })),
      });
      return result.embeddings.map(e => e.values);
    } catch (err) {
      console.warn('[MemoryIndex] Batch embed failed, falling back to sequential:', err);
      const results: number[][] = [];
      for (const text of texts) {
        try {
          results.push(await this.embed(text));
        } catch {
          results.push([]);
        }
        // Small delay between sequential calls to avoid rate limiting
        if (texts.length > 10) await new Promise(r => setTimeout(r, 100));
      }
      return results;
    }
  }

  // ── Scoring ──

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);
    return magA && magB ? dot / (magA * magB) : 0;
  }

  private keywordScore(entry: MemoryEntry, queryWords: string[]): number {
    if (queryWords.length === 0) return 0;
    const entryText = `${entry.key} ${entry.value} ${(entry.tags || []).join(' ')}`.toLowerCase();
    const entryWords = new Set(this.tokenize(entryText));
    let matches = 0;
    for (const w of queryWords) {
      if (entryWords.has(w) || entryText.includes(w)) matches++;
    }
    return matches / queryWords.length;
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase().split(/\W+/).filter(w => w.length > 1);
  }
}

// ─── Singleton Export ───────────────────────────────────────────────

export const memoryIndex = new MemoryIndexManager();
