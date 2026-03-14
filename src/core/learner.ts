/**
 * PersonalClaw Self-Learning Engine
 * 
 * Passively analyzes conversations to learn about the user:
 * - Communication style & tone
 * - Intent patterns ("when user says X, they mean Y")
 * - Domain knowledge & terminology
 * - Workflow preferences
 * - Corrections & self-improvement
 * - Tool preferences
 * 
 * Runs asynchronously after conversations — never blocks the main response.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const MEMORY_DIR = path.join(process.cwd(), 'memory');
const LEARNINGS_FILE = path.join(MEMORY_DIR, 'self_learned.json');
const LEARNING_LOG_FILE = path.join(MEMORY_DIR, 'learning_log.json');

// ─── Structured Memory Schema ────────────────────────────────────────

export interface UserProfile {
  name?: string;
  role?: string;
  company?: string;
  timezone?: string;
  expertise_level?: string;
  notes: string[];
}

export interface IntentPattern {
  trigger: string;       // What the user says
  meaning: string;       // What they actually mean
  confidence: number;    // 0-1 scale
  seen_count: number;    // How many times this was observed
  last_seen: string;     // ISO timestamp
}

export interface CommunicationStyle {
  tone: string;                  // e.g., "casual", "direct", "technical"
  verbosity: string;             // e.g., "brief", "detailed"
  uses_abbreviations: boolean;
  common_shorthand: Record<string, string>;  // e.g., "rn" -> "right now"
  preferred_response_format: string;         // e.g., "bullet points", "paragraphs"
  emoji_usage: string;           // e.g., "frequent", "minimal", "none"
  notes: string[];
}

export interface WorkflowPattern {
  name: string;
  description: string;
  steps: string[];
  frequency: string;    // e.g., "daily", "weekly", "as-needed"
  last_used: string;
}

export interface ToolPreference {
  tool: string;
  preference: string;   // How the user prefers to use this tool
  avoid: string[];       // What NOT to do with this tool
}

export interface Correction {
  timestamp: string;
  what_ai_did: string;
  what_user_wanted: string;
  lesson: string;
}

export interface DomainKnowledge {
  category: string;       // e.g., "MSP", "networking", "clients"
  term: string;
  meaning: string;
}

export interface SelfLearnedMemory {
  version: number;
  last_updated: string;
  total_conversations_analyzed: number;
  user_profile: UserProfile;
  communication_style: CommunicationStyle;
  intent_patterns: IntentPattern[];
  workflow_patterns: WorkflowPattern[];
  tool_preferences: ToolPreference[];
  corrections: Correction[];
  domain_knowledge: DomainKnowledge[];
  raw_insights: string[];  // Catch-all for things that don't fit categories
}

// ─── Default empty memory ────────────────────────────────────────────

function createEmptyMemory(): SelfLearnedMemory {
  return {
    version: 1,
    last_updated: new Date().toISOString(),
    total_conversations_analyzed: 0,
    user_profile: { notes: [] },
    communication_style: {
      tone: 'unknown',
      verbosity: 'unknown',
      uses_abbreviations: false,
      common_shorthand: {},
      preferred_response_format: 'unknown',
      emoji_usage: 'unknown',
      notes: [],
    },
    intent_patterns: [],
    workflow_patterns: [],
    tool_preferences: [],
    corrections: [],
    domain_knowledge: [],
    raw_insights: [],
  };
}

// ─── File I/O ────────────────────────────────────────────────────────

export function loadLearnedMemory(): SelfLearnedMemory {
  try {
    if (fs.existsSync(LEARNINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(LEARNINGS_FILE, 'utf8'));
      return { ...createEmptyMemory(), ...raw };
    }
  } catch (e) {
    console.error('[Learner] Failed to load learned memory:', e);
  }
  return createEmptyMemory();
}

function saveLearnedMemory(memory: SelfLearnedMemory) {
  try {
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    memory.last_updated = new Date().toISOString();
    fs.writeFileSync(LEARNINGS_FILE, JSON.stringify(memory, null, 2));
  } catch (e) {
    console.error('[Learner] Failed to save learned memory:', e);
  }
}

function logLearning(entry: { timestamp: string; type: string; detail: string }) {
  try {
    let log: any[] = [];
    if (fs.existsSync(LEARNING_LOG_FILE)) {
      log = JSON.parse(fs.readFileSync(LEARNING_LOG_FILE, 'utf8'));
    }
    log.push(entry);
    // Keep only the last 200 log entries
    if (log.length > 200) log = log.slice(-200);
    fs.writeFileSync(LEARNING_LOG_FILE, JSON.stringify(log, null, 2));
  } catch { /* non-critical */ }
}

// ─── Analysis Prompt ─────────────────────────────────────────────────

const ANALYSIS_PROMPT = `You are a conversation analyst for an AI assistant called PersonalClaw. Your job is to analyze a conversation and extract learnable insights about the USER (not the AI).

Analyze the conversation and return a JSON object with ONLY the fields that have new, actionable insights. Do NOT return fields with no new information. Be highly selective — only extract things that would genuinely improve future interactions.

Return JSON in this exact schema (include only fields with actual findings):

{
  "user_profile_updates": {
    "name": "string or null",
    "role": "string or null", 
    "company": "string or null",
    "expertise_level": "string or null",
    "new_notes": ["array of new factual observations about the user"]
  },
  "communication_style_updates": {
    "tone": "casual/formal/technical/mixed or null",
    "verbosity": "brief/moderate/detailed or null",
    "uses_abbreviations": true/false/null,
    "new_shorthand": {"abbreviation": "meaning"},
    "preferred_response_format": "string or null",
    "emoji_usage": "frequent/moderate/minimal/none or null",
    "new_notes": ["observations about how the user communicates"]
  },
  "new_intent_patterns": [
    {
      "trigger": "what the user typed or how they phrased something",
      "meaning": "what they actually wanted the AI to do"
    }
  ],
  "new_workflow_patterns": [
    {
      "name": "short name for the workflow",
      "description": "what this workflow accomplishes",
      "steps": ["step 1", "step 2"]
    }
  ],
  "new_tool_preferences": [
    {
      "tool": "tool name",
      "preference": "how user prefers to use it",
      "avoid": ["things user does NOT want"]
    }
  ],
  "new_corrections": [
    {
      "what_ai_did": "what the AI did wrong",
      "what_user_wanted": "what the user actually wanted",
      "lesson": "what to do differently next time"
    }
  ],
  "new_domain_knowledge": [
    {
      "category": "category like MSP, networking, etc.",
      "term": "the term or concept",
      "meaning": "what it means in context"
    }
  ],
  "raw_insights": ["any other important observations that don't fit the above categories"]
}

IMPORTANT RULES:
1. Only extract things you are CONFIDENT about. No guessing.
2. Focus on patterns, not one-off exchanges.
3. If the user corrected the AI or rephrased something, that's a HIGH-VALUE learning opportunity.
4. If the user used shorthand, slang, or abbreviations, capture the mapping.
5. If the conversation reveals nothing new, return an empty object: {}
6. Return ONLY valid JSON, no markdown fences, no explanation.`;

// ─── Core Learning Engine ────────────────────────────────────────────

export class Learner {
  private analysisModel: any;
  private isAnalyzing: boolean = false;
  private analysisQueue: any[][] = [];

  constructor() {
    // Use a cheap model for analysis to save tokens
    this.analysisModel = genAI.getGenerativeModel({
      model: process.env.GEMINI_LEARNER_MODEL || 'gemini-2.5-flash',
    });
    console.log('[Learner] Self-learning engine initialized.');
  }

  /**
   * Queue a conversation for background analysis.
   * Called after each user interaction completes.
   */
  public queueAnalysis(conversationHistory: any[]) {
    // Only analyze if there's enough substance (at least 2 user turns after system prompt)
    const userTurns = conversationHistory.filter(
      (h: any) => h.role === 'user' && !h.parts?.[0]?.text?.startsWith('# PersonalClaw')
    );

    if (userTurns.length < 2) return;

    this.analysisQueue.push(conversationHistory);
    this.processQueue();
  }

  /**
   * Process the analysis queue (non-blocking).
   */
  private async processQueue() {
    if (this.isAnalyzing || this.analysisQueue.length === 0) return;

    this.isAnalyzing = true;
    const history = this.analysisQueue.shift()!;

    try {
      await this.analyzeConversation(history);
    } catch (e) {
      console.error('[Learner] Analysis failed (non-fatal):', e);
    }

    this.isAnalyzing = false;

    // Process next in queue if any
    if (this.analysisQueue.length > 0) {
      setTimeout(() => this.processQueue(), 2000);
    }
  }

  /**
   * Analyze a conversation and merge insights into learned memory.
   */
  private async analyzeConversation(history: any[]) {
    // Extract just the text parts for analysis (skip tool calls/responses to save tokens)
    const textExchanges = history
      .filter((h: any) => {
        if (h.role === 'user' || h.role === 'model') {
          return h.parts?.some((p: any) => p.text);
        }
        return false;
      })
      .map((h: any) => ({
        role: h.role,
        text: h.parts
          .filter((p: any) => p.text)
          .map((p: any) => p.text)
          .join('\n')
          .substring(0, 500), // Truncate long messages
      }))
      .slice(-20); // Last 20 exchanges max

    if (textExchanges.length < 3) return;

    const conversationText = textExchanges
      .map((e: any) => `[${e.role.toUpperCase()}]: ${e.text}`)
      .join('\n\n');

    console.log('[Learner] 🧬 Analyzing conversation for learnable insights...');

    try {
      const result = await this.analysisModel.generateContent([
        ANALYSIS_PROMPT,
        `\n\nCONVERSATION TO ANALYZE:\n${conversationText}`,
      ]);

      const responseText = result.response.text().trim();

      // Parse JSON response
      let insights: any;
      try {
        // Handle potential markdown fences
        const cleaned = responseText
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
        insights = JSON.parse(cleaned);
      } catch {
        console.warn('[Learner] Failed to parse analysis response as JSON. Skipping.');
        return;
      }

      // Only merge if we got something
      if (Object.keys(insights).length === 0) {
        console.log('[Learner] No new insights found in this conversation.');
        return;
      }

      this.mergeInsights(insights);
      console.log('[Learner] ✅ Insights merged successfully.');
    } catch (e: any) {
      // Rate limit or other API error — just skip this analysis
      if (e.message?.includes('429')) {
        console.warn('[Learner] Rate limited during analysis. Will retry later.');
        this.analysisQueue.unshift(history); // Put it back in the queue
      } else {
        console.error('[Learner] Analysis API error:', e.message);
      }
    }
  }

  /**
   * Merge new insights into the persistent learned memory.
   */
  private mergeInsights(insights: any) {
    const memory = loadLearnedMemory();
    const now = new Date().toISOString();
    let learnedSomething = false;

    // ── User Profile Updates ──
    if (insights.user_profile_updates) {
      const u = insights.user_profile_updates;
      if (u.name) { memory.user_profile.name = u.name; learnedSomething = true; }
      if (u.role) { memory.user_profile.role = u.role; learnedSomething = true; }
      if (u.company) { memory.user_profile.company = u.company; learnedSomething = true; }
      if (u.expertise_level) { memory.user_profile.expertise_level = u.expertise_level; learnedSomething = true; }
      if (u.new_notes?.length) {
        for (const note of u.new_notes) {
          if (!memory.user_profile.notes.includes(note)) {
            memory.user_profile.notes.push(note);
            learnedSomething = true;
            logLearning({ timestamp: now, type: 'user_profile', detail: note });
          }
        }
        // Cap at 50 notes
        if (memory.user_profile.notes.length > 50) {
          memory.user_profile.notes = memory.user_profile.notes.slice(-50);
        }
      }
    }

    // ── Communication Style ──
    if (insights.communication_style_updates) {
      const c = insights.communication_style_updates;
      if (c.tone) { memory.communication_style.tone = c.tone; learnedSomething = true; }
      if (c.verbosity) { memory.communication_style.verbosity = c.verbosity; learnedSomething = true; }
      if (c.uses_abbreviations !== null && c.uses_abbreviations !== undefined) {
        memory.communication_style.uses_abbreviations = c.uses_abbreviations;
        learnedSomething = true;
      }
      if (c.preferred_response_format) {
        memory.communication_style.preferred_response_format = c.preferred_response_format;
        learnedSomething = true;
      }
      if (c.emoji_usage) { memory.communication_style.emoji_usage = c.emoji_usage; learnedSomething = true; }
      if (c.new_shorthand) {
        for (const [abbr, meaning] of Object.entries(c.new_shorthand)) {
          memory.communication_style.common_shorthand[abbr] = meaning as string;
          learnedSomething = true;
          logLearning({ timestamp: now, type: 'shorthand', detail: `"${abbr}" → "${meaning}"` });
        }
      }
      if (c.new_notes?.length) {
        for (const note of c.new_notes) {
          if (!memory.communication_style.notes.includes(note)) {
            memory.communication_style.notes.push(note);
            learnedSomething = true;
          }
        }
        if (memory.communication_style.notes.length > 30) {
          memory.communication_style.notes = memory.communication_style.notes.slice(-30);
        }
      }
    }

    // ── Intent Patterns ──
    if (insights.new_intent_patterns?.length) {
      for (const pattern of insights.new_intent_patterns) {
        const existing = memory.intent_patterns.find(
          (p: IntentPattern) => p.trigger.toLowerCase() === pattern.trigger.toLowerCase()
        );
        if (existing) {
          existing.seen_count++;
          existing.confidence = Math.min(1, existing.confidence + 0.1);
          existing.last_seen = now;
          existing.meaning = pattern.meaning; // Update in case it refined
        } else {
          memory.intent_patterns.push({
            trigger: pattern.trigger,
            meaning: pattern.meaning,
            confidence: 0.5,
            seen_count: 1,
            last_seen: now,
          });
          learnedSomething = true;
          logLearning({ timestamp: now, type: 'intent_pattern', detail: `"${pattern.trigger}" → "${pattern.meaning}"` });
        }
      }
      // Keep only 100 highest-confidence patterns
      memory.intent_patterns.sort((a, b) => b.confidence - a.confidence);
      if (memory.intent_patterns.length > 100) {
        memory.intent_patterns = memory.intent_patterns.slice(0, 100);
      }
    }

    // ── Workflow Patterns ──
    if (insights.new_workflow_patterns?.length) {
      for (const wf of insights.new_workflow_patterns) {
        const existing = memory.workflow_patterns.find(
          (w: WorkflowPattern) => w.name.toLowerCase() === wf.name.toLowerCase()
        );
        if (!existing) {
          memory.workflow_patterns.push({
            name: wf.name,
            description: wf.description,
            steps: wf.steps || [],
            frequency: wf.frequency || 'as-needed',
            last_used: now,
          });
          learnedSomething = true;
          logLearning({ timestamp: now, type: 'workflow', detail: wf.name });
        } else {
          existing.last_used = now;
          if (wf.steps?.length) existing.steps = wf.steps;
        }
      }
      // Cap at 50 workflows
      if (memory.workflow_patterns.length > 50) {
        memory.workflow_patterns = memory.workflow_patterns.slice(-50);
      }
    }

    // ── Tool Preferences ──
    if (insights.new_tool_preferences?.length) {
      for (const tp of insights.new_tool_preferences) {
        const existing = memory.tool_preferences.find(
          (t: ToolPreference) => t.tool === tp.tool
        );
        if (existing) {
          existing.preference = tp.preference;
          if (tp.avoid?.length) existing.avoid = [...new Set([...existing.avoid, ...tp.avoid])];
        } else {
          memory.tool_preferences.push({
            tool: tp.tool,
            preference: tp.preference,
            avoid: tp.avoid || [],
          });
          learnedSomething = true;
          logLearning({ timestamp: now, type: 'tool_preference', detail: `${tp.tool}: ${tp.preference}` });
        }
      }
    }

    // ── Corrections (Self-Improvement) ──
    if (insights.new_corrections?.length) {
      for (const corr of insights.new_corrections) {
        memory.corrections.push({
          timestamp: now,
          what_ai_did: corr.what_ai_did,
          what_user_wanted: corr.what_user_wanted,
          lesson: corr.lesson,
        });
        learnedSomething = true;
        logLearning({ timestamp: now, type: 'correction', detail: corr.lesson });
      }
      // Keep only last 50 corrections
      if (memory.corrections.length > 50) {
        memory.corrections = memory.corrections.slice(-50);
      }
    }

    // ── Domain Knowledge ──
    if (insights.new_domain_knowledge?.length) {
      for (const dk of insights.new_domain_knowledge) {
        const existing = memory.domain_knowledge.find(
          (d: DomainKnowledge) => d.term.toLowerCase() === dk.term.toLowerCase()
        );
        if (!existing) {
          memory.domain_knowledge.push({
            category: dk.category,
            term: dk.term,
            meaning: dk.meaning,
          });
          learnedSomething = true;
          logLearning({ timestamp: now, type: 'domain_knowledge', detail: `${dk.term}: ${dk.meaning}` });
        }
      }
      // Cap at 200 terms
      if (memory.domain_knowledge.length > 200) {
        memory.domain_knowledge = memory.domain_knowledge.slice(-200);
      }
    }

    // ── Raw Insights ──
    if (insights.raw_insights?.length) {
      for (const insight of insights.raw_insights) {
        if (!memory.raw_insights.includes(insight)) {
          memory.raw_insights.push(insight);
          learnedSomething = true;
          logLearning({ timestamp: now, type: 'raw_insight', detail: insight });
        }
      }
      if (memory.raw_insights.length > 50) {
        memory.raw_insights = memory.raw_insights.slice(-50);
      }
    }

    if (learnedSomething) {
      memory.total_conversations_analyzed++;
      saveLearnedMemory(memory);
      console.log(`[Learner] 📚 Updated self-learned memory (${memory.total_conversations_analyzed} conversations analyzed total).`);
    }
  }

  /**
   * Build a formatted context block from learned memory for injection into the system prompt.
   */
  public static buildContextBlock(): string {
    let memory: SelfLearnedMemory;
    try {
      if (!fs.existsSync(LEARNINGS_FILE)) return '';
      memory = JSON.parse(fs.readFileSync(LEARNINGS_FILE, 'utf8'));
    } catch {
      return '';
    }

    const sections: string[] = [];

    // User Profile
    const p = memory.user_profile;
    if (p.name || p.role || p.company || p.notes?.length) {
      const profileParts: string[] = [];
      if (p.name) profileParts.push(`Name: ${p.name}`);
      if (p.role) profileParts.push(`Role: ${p.role}`);
      if (p.company) profileParts.push(`Company: ${p.company}`);
      if (p.expertise_level) profileParts.push(`Expertise: ${p.expertise_level}`);
      if (p.notes?.length) profileParts.push(`Notes: ${p.notes.slice(-5).join('; ')}`);
      sections.push(`### 👤 User Profile\n${profileParts.map(x => `  • ${x}`).join('\n')}`);
    }

    // Communication Style
    const c = memory.communication_style;
    if (c.tone !== 'unknown' || Object.keys(c.common_shorthand || {}).length > 0) {
      const styleParts: string[] = [];
      if (c.tone !== 'unknown') styleParts.push(`Tone: ${c.tone}`);
      if (c.verbosity !== 'unknown') styleParts.push(`Verbosity preference: ${c.verbosity}`);
      if (c.preferred_response_format !== 'unknown') styleParts.push(`Preferred format: ${c.preferred_response_format}`);
      if (c.emoji_usage !== 'unknown') styleParts.push(`Emoji: ${c.emoji_usage}`);
      if (c.uses_abbreviations) styleParts.push(`Uses abbreviations/shorthand frequently`);
      const shorthand = Object.entries(c.common_shorthand || {});
      if (shorthand.length > 0) {
        styleParts.push(`Shorthand dictionary: ${shorthand.map(([a, m]) => `"${a}" = "${m}"`).join(', ')}`);
      }
      if (c.notes?.length) styleParts.push(`Style notes: ${c.notes.slice(-3).join('; ')}`);
      sections.push(`### 💬 Communication Style\n${styleParts.map(x => `  • ${x}`).join('\n')}\nMatch this style in your responses.`);
    }

    // Intent Patterns (high confidence only)
    const highConfPatterns = (memory.intent_patterns || [])
      .filter(p => p.confidence >= 0.6)
      .slice(0, 15);
    if (highConfPatterns.length > 0) {
      const patternLines = highConfPatterns
        .map(p => `  • "${p.trigger}" → ${p.meaning}`)
        .join('\n');
      sections.push(`### 🎯 Known Intent Patterns\nWhen the user says these things, this is what they mean:\n${patternLines}`);
    }

    // Workflow Patterns
    if (memory.workflow_patterns?.length) {
      const wfLines = memory.workflow_patterns.slice(-10)
        .map(w => `  • **${w.name}**: ${w.description}`)
        .join('\n');
      sections.push(`### ⚡ Established Workflows\n${wfLines}`);
    }

    // Tool Preferences
    if (memory.tool_preferences?.length) {
      const tpLines = memory.tool_preferences
        .map(t => {
          let line = `  • **${t.tool}**: ${t.preference}`;
          if (t.avoid?.length) line += ` (AVOID: ${t.avoid.join(', ')})`;
          return line;
        })
        .join('\n');
      sections.push(`### 🔧 Tool Preferences\n${tpLines}`);
    }

    // Recent Corrections (lessons learned)
    if (memory.corrections?.length) {
      const recentCorrections = memory.corrections.slice(-5);
      const corrLines = recentCorrections
        .map(c => `  • ❌ Did: ${c.what_ai_did} → ✅ Should: ${c.lesson}`)
        .join('\n');
      sections.push(`### 📝 Lessons from Past Mistakes\n${corrLines}\nDo NOT repeat these mistakes.`);
    }

    // Domain Knowledge
    if (memory.domain_knowledge?.length) {
      const dkGroups = new Map<string, DomainKnowledge[]>();
      memory.domain_knowledge.forEach(dk => {
        if (!dkGroups.has(dk.category)) dkGroups.set(dk.category, []);
        dkGroups.get(dk.category)!.push(dk);
      });
      const dkLines: string[] = [];
      dkGroups.forEach((terms, cat) => {
        dkLines.push(`  **${cat}**: ${terms.slice(-10).map(t => `${t.term} (${t.meaning})`).join(', ')}`);
      });
      sections.push(`### 📖 Domain Knowledge\n${dkLines.join('\n')}`);
    }

    // Raw insights
    if (memory.raw_insights?.length) {
      const insightLines = memory.raw_insights.slice(-5)
        .map(i => `  • ${i}`)
        .join('\n');
      sections.push(`### 💡 Other Observations\n${insightLines}`);
    }

    if (sections.length === 0) return '';

    return `\n## 🧬 Self-Learned Knowledge (auto-generated from past conversations)
The following was learned by observing how you interact with the user. Apply it to every response.
Conversations analyzed: ${memory.total_conversations_analyzed} | Last updated: ${memory.last_updated?.split('T')[0] || 'never'}

${sections.join('\n\n')}`;
  }

  /**
   * Get a summary of what's been learned (for /learned command).
   */
  public static getLearningSummary(): string {
    const memory = loadLearnedMemory();

    if (memory.total_conversations_analyzed === 0) {
      return `## 🧬 Self-Learning Status\n\n📭 **No conversations analyzed yet.** The learning engine runs in the background after each conversation. Keep chatting and I'll start picking up your patterns!`;
    }

    const lines = [
      `## 🧬 Self-Learning Status`,
      ``,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| **Conversations Analyzed** | ${memory.total_conversations_analyzed} |`,
      `| **Last Updated** | ${memory.last_updated || 'never'} |`,
      `| **Intent Patterns** | ${memory.intent_patterns?.length || 0} learned |`,
      `| **Shorthand Mappings** | ${Object.keys(memory.communication_style?.common_shorthand || {}).length} |`,
      `| **Workflow Patterns** | ${memory.workflow_patterns?.length || 0} |`,
      `| **Tool Preferences** | ${memory.tool_preferences?.length || 0} |`,
      `| **Corrections** | ${memory.corrections?.length || 0} lessons |`,
      `| **Domain Terms** | ${memory.domain_knowledge?.length || 0} |`,
      `| **Raw Insights** | ${memory.raw_insights?.length || 0} |`,
      ``,
    ];

    // User profile snapshot
    const p = memory.user_profile;
    if (p.name || p.role) {
      lines.push(`### 👤 User Profile`);
      if (p.name) lines.push(`- **Name**: ${p.name}`);
      if (p.role) lines.push(`- **Role**: ${p.role}`);
      if (p.company) lines.push(`- **Company**: ${p.company}`);
      if (p.expertise_level) lines.push(`- **Level**: ${p.expertise_level}`);
      lines.push('');
    }

    // Communication style
    const c = memory.communication_style;
    if (c.tone !== 'unknown') {
      lines.push(`### 💬 Communication Style`);
      lines.push(`- **Tone**: ${c.tone}`);
      if (c.verbosity !== 'unknown') lines.push(`- **Verbosity**: ${c.verbosity}`);
      if (c.emoji_usage !== 'unknown') lines.push(`- **Emoji**: ${c.emoji_usage}`);
      const shorthand = Object.entries(c.common_shorthand || {});
      if (shorthand.length > 0) {
        lines.push(`- **Shorthand**: ${shorthand.map(([a, m]) => `\`${a}\` → ${m}`).join(', ')}`);
      }
      lines.push('');
    }

    // Top intent patterns
    const topPatterns = (memory.intent_patterns || [])
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
    if (topPatterns.length > 0) {
      lines.push(`### 🎯 Top Intent Patterns`);
      lines.push(`| When You Say | I Understand | Confidence |`);
      lines.push(`|-------------|-------------|------------|`);
      topPatterns.forEach(p => {
        lines.push(`| "${p.trigger}" | ${p.meaning} | ${(p.confidence * 100).toFixed(0)}% |`);
      });
      lines.push('');
    }

    // Recent corrections
    if (memory.corrections?.length) {
      const recent = memory.corrections.slice(-3);
      lines.push(`### 📝 Recent Lessons`);
      recent.forEach(c => {
        lines.push(`- ${c.lesson}`);
      });
      lines.push('');
    }

    lines.push(`💡 Use \`/learned clear\` to reset all self-learned data.`);
    lines.push(`💡 Use \`/learned log\` to see the raw learning log.`);

    return lines.join('\n');
  }

  /**
   * Get the raw learning log.
   */
  public static getLearningLog(): string {
    try {
      if (!fs.existsSync(LEARNING_LOG_FILE)) {
        return '📋 **Learning log is empty.** No insights captured yet.';
      }
      const log = JSON.parse(fs.readFileSync(LEARNING_LOG_FILE, 'utf8'));
      if (log.length === 0) return '📋 **Learning log is empty.**';

      const recent = log.slice(-20);
      const lines = [
        `## 📋 Learning Log (last ${recent.length} entries)`,
        ``,
        `| Time | Type | Detail |`,
        `|------|------|--------|`,
      ];
      recent.forEach((e: any) => {
        const time = e.timestamp ? new Date(e.timestamp).toLocaleString() : 'unknown';
        const detail = (e.detail || '').substring(0, 80);
        lines.push(`| ${time} | \`${e.type}\` | ${detail} |`);
      });

      return lines.join('\n');
    } catch (e: any) {
      return `❌ Error reading log: ${e.message}`;
    }
  }

  /**
   * Clear all self-learned data.
   */
  public static clearLearnings(): string {
    try {
      if (fs.existsSync(LEARNINGS_FILE)) fs.unlinkSync(LEARNINGS_FILE);
      if (fs.existsSync(LEARNING_LOG_FILE)) fs.unlinkSync(LEARNING_LOG_FILE);
      return '🗑️ All self-learned data has been cleared. Starting fresh.';
    } catch (e: any) {
      return `❌ Error clearing data: ${e.message}`;
    }
  }
}
