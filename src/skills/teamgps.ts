// src/skills/teamgps.ts
// Copyright (c) 2026 Scout Kalra. All rights reserved.
// PersonalClaw — Team GPS CSAT Skill

import type { Skill, SkillMeta } from '../types/skill.js';
import axios from 'axios';

const BASE_URL = 'https://api.team-gps.net/open-api/v1/csat/';

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface CsatRecord {
  id: number;
  rating: 'Positive' | 'Neutral' | 'Negative';
  comment: string;
  company: string;
  contact_name: string;
  submitted_date: string;
  team_members: Array<{ is_internal_user: boolean; identifier: string }>;
  ticket_id: string;
  ticket_type: string;
  ticket_name: string;
  tags: string[];
  ticket_queue: string;
  is_reviewed: boolean;
  reviewed_by: { full_name: string } | null;
  notes: string | null;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.TEAMGPS_API_KEY;
  if (!key) throw new Error('TEAMGPS_API_KEY is not set in your .env file.');
  return key;
}

async function fetchAll(params: Record<string, string | number | boolean>): Promise<CsatRecord[]> {
  const key = getApiKey();
  const results: CsatRecord[] = [];
  let page = 1;

  while (true) {
    const res = await axios.get(BASE_URL, {
      headers: { 'x-api-key': key, Accept: 'application/json' },
      params: { ...params, page, page_size: 100 },
      timeout: 30_000,
    });
    const data = res.data?.data;
    const pageResults: CsatRecord[] = data?.results ?? [];
    results.push(...pageResults);
    if (pageResults.length === 0 || page >= (data?.total_pages ?? 1)) break;
    page++;
  }

  return results;
}

function today(): string { return new Date().toISOString().split('T')[0]; }
function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function resolvePeriod(period: string): { from: string; to: string } {
  const t = today();
  const map: Record<string, { from: string; to: string }> = {
    last_30_days:   { from: daysAgo(30),  to: t },
    last_60_days:   { from: daysAgo(60),  to: t },
    last_90_days:   { from: daysAgo(90),  to: t },
    last_6_months:  { from: daysAgo(180), to: t },
    last_12_months: { from: daysAgo(365), to: t },
    this_month: (() => {
      const n = new Date();
      return { from: `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`, to: t };
    })(),
    last_month: (() => {
      const n = new Date();
      const f = new Date(n.getFullYear(), n.getMonth()-1, 1);
      const l = new Date(n.getFullYear(), n.getMonth(), 0);
      return { from: f.toISOString().split('T')[0], to: l.toISOString().split('T')[0] };
    })(),
    ytd: { from: `${new Date().getFullYear()}-01-01`, to: t },
  };
  if (map[period]) return map[period];
  const parts = period.split('/');
  if (parts.length === 2) return { from: parts[0], to: parts[1] };
  return { from: daysAgo(90), to: t };
}

type QueueType = 'MDE_MONTHLY' | 'INTERNAL_IT' | 'COMPANY_LEVEL';

function classifyQueue(r: CsatRecord): QueueType {
  const q = r.ticket_queue.toLowerCase();
  const tt = r.ticket_type.toLowerCase();
  if (q.includes('mde') || q.includes('rsa') || tt.includes('rsa')) return 'MDE_MONTHLY';
  if (q.includes('internal') || q.includes('helpdesk')) return 'INTERNAL_IT';
  return 'COMPANY_LEVEL';
}

function extractEngineer(r: CsatRecord): string | null {
  const qt = classifyQueue(r);
  if (qt === 'MDE_MONTHLY') {
    const m = r.ticket_name.match(/Monthly Feedback for (.+?) (?:for|For) the Month/i);
    return m ? m[1].trim() : null;
  }
  if (qt === 'INTERNAL_IT') {
    const id = r.team_members?.[0]?.identifier;
    return id && id !== 'unassigned' ? id : null;
  }
  return null;
}

function calcScore(records: CsatRecord[]) {
  const total = records.length;
  const positive = records.filter(r => r.rating === 'Positive').length;
  const neutral  = records.filter(r => r.rating === 'Neutral').length;
  const negative = records.filter(r => r.rating === 'Negative').length;
  return { total, positive, neutral, negative, score: total > 0 ? Math.round(positive/total*1000)/10 : 0 };
}

function daysSince(d: string) {
  return Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
}

// ─── SKILL ────────────────────────────────────────────────────────────────────

export const teamGpsSkill: Skill = {
  name: 'teamgps_csat',
  description: `Access and analyse Team GPS CSAT data. Use this for partner health, engineer performance, unreviewed concerns, and org-wide reporting.

Actions:
- list_companies: See all partners with review counts and scores
- partner_summary: Full CSAT analysis for one partner (score, trend, comments, notes, unreviewed concerns)
- at_risk_partners: Scan all partners and flag those with declining scores or unreviewed concerns
- engineer_scorecard: Performance scorecard for a specific engineer with risk level
- unreviewed_concerns: All Neutral/Negative reviews not yet reviewed by management
- period_summary: Org-wide digest across all partners
- search: Keyword search across all comments and internal notes

Period options: last_30_days, last_60_days, last_90_days (default), last_6_months, last_12_months, this_month, last_month, ytd, or YYYY-MM-DD/YYYY-MM-DD`,

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list_companies', 'partner_summary', 'at_risk_partners', 'engineer_scorecard', 'unreviewed_concerns', 'period_summary', 'search'],
        description: 'The analysis to run',
      },
      company: { type: 'string', description: 'Exact company name (required for partner_summary)' },
      engineer: { type: 'string', description: 'Engineer name — partial match supported (required for engineer_scorecard)' },
      query: { type: 'string', description: 'Search keyword (required for search action)' },
      period: { type: 'string', description: 'Time period. Default: last_90_days' },
    },
    required: ['action'],
  },

  run: async (args: {
    action: string;
    company?: string;
    engineer?: string;
    query?: string;
    period?: string;
  }, _meta: SkillMeta) => {
    const period = args.period ?? 'last_90_days';
    const { from, to } = resolvePeriod(period);

    try {
      switch (args.action) {

        // ── list_companies ──────────────────────────────────────
        case 'list_companies': {
          const records = await fetchAll({ from_submitted_date: from, to_submitted_date: to });
          const map = new Map<string, { pos: number; total: number }>();
          for (const r of records) {
            if (!map.has(r.company)) map.set(r.company, { pos: 0, total: 0 });
            const s = map.get(r.company)!;
            s.total++;
            if (r.rating === 'Positive') s.pos++;
          }
          const list = Array.from(map.entries())
            .map(([c, s]) => ({ company: c, total: s.total, score: Math.round(s.pos/s.total*100) }))
            .sort((a, b) => b.total - a.total);
          return { success: true, period: `${from} to ${to}`, companies: list };
        }

        // ── partner_summary ─────────────────────────────────────
        case 'partner_summary': {
          if (!args.company) return { success: false, error: 'company is required for partner_summary' };
          const records = await fetchAll({ from_submitted_date: from, to_submitted_date: to, company: args.company });
          if (records.length === 0) return { success: false, error: `No records found for "${args.company}" in this period` };

          const score = calcScore(records);
          const unreviewedConcerns = records
            .filter(r => (r.rating === 'Neutral' || r.rating === 'Negative') && !r.is_reviewed)
            .map(r => ({
              id: r.id,
              rating: r.rating,
              engineer: extractEngineer(r),
              date: r.submitted_date.split('T')[0],
              days_unreviewed: daysSince(r.submitted_date),
              comment: r.comment || null,
              ticket: r.ticket_name,
            }))
            .sort((a, b) => b.days_unreviewed - a.days_unreviewed);

          const qualitative = records
            .filter(r => r.comment?.trim() || r.notes)
            .map(r => ({
              date: r.submitted_date.split('T')[0],
              rating: r.rating,
              engineer: extractEngineer(r),
              comment: r.comment || null,
              internal_note: r.notes || null,
            }));

          const tagMap = new Map<string, { count: number; on_concern: number }>();
          for (const r of records) {
            for (const tag of r.tags) {
              if (!tagMap.has(tag)) tagMap.set(tag, { count: 0, on_concern: 0 });
              const t = tagMap.get(tag)!;
              t.count++;
              if (r.rating !== 'Positive') t.on_concern++;
            }
          }
          const tags = Array.from(tagMap.entries())
            .map(([tag, s]) => ({ tag, ...s }))
            .sort((a, b) => b.count - a.count);

          return {
            success: true,
            company: args.company,
            period: `${from} to ${to}`,
            score,
            unreviewed_concerns: unreviewedConcerns,
            qualitative_feedback: qualitative,
            tags,
          };
        }

        // ── at_risk_partners ────────────────────────────────────
        case 'at_risk_partners': {
          const records = await fetchAll({ from_submitted_date: from, to_submitted_date: to });
          const byCompany = new Map<string, CsatRecord[]>();
          for (const r of records) {
            if (!byCompany.has(r.company)) byCompany.set(r.company, []);
            byCompany.get(r.company)!.push(r);
          }

          const risks = [];
          for (const [company, recs] of byCompany) {
            if (recs.length < 2) continue;
            const score = calcScore(recs);
            const unreviewed = recs.filter(r => (r.rating === 'Neutral' || r.rating === 'Negative') && !r.is_reviewed);
            const reasons: string[] = [];
            if (score.score < 90) reasons.push(`Score ${score.score}% (below 90% target)`);
            if (unreviewed.length > 0) reasons.push(`${unreviewed.length} unreviewed concern(s)`);
            if (score.negative > 0) reasons.push(`${score.negative} negative review(s)`);
            if (reasons.length > 0) risks.push({ company, score: score.score, total: score.total, reasons, unreviewed_count: unreviewed.length });
          }

          risks.sort((a, b) => b.reasons.length - a.reasons.length || a.score - b.score);
          return { success: true, period: `${from} to ${to}`, at_risk_count: risks.length, partners: risks };
        }

        // ── engineer_scorecard ──────────────────────────────────
        case 'engineer_scorecard': {
          if (!args.engineer) return { success: false, error: 'engineer is required for engineer_scorecard' };
          const records = await fetchAll({ from_submitted_date: from, to_submitted_date: to });
          const nameLower = args.engineer.toLowerCase();
          const matched = records.filter(r => extractEngineer(r)?.toLowerCase().includes(nameLower));
          if (matched.length === 0) return { success: false, error: `No records found for engineer "${args.engineer}"` };

          const score = calcScore(matched);
          const companies = [...new Set(matched.map(r => r.company))];
          const unreviewed = matched.filter(r => (r.rating === 'Neutral' || r.rating === 'Negative') && !r.is_reviewed);
          const qualitative = matched.filter(r => r.comment?.trim() || r.notes).map(r => ({
            date: r.submitted_date.split('T')[0],
            company: r.company,
            rating: r.rating,
            comment: r.comment || null,
            note: r.notes || null,
          }));

          const riskReasons: string[] = [];
          if (score.score < 80) riskReasons.push(`Low score: ${score.score}%`);
          if (unreviewed.length > 0) riskReasons.push(`${unreviewed.length} unreviewed concern(s)`);
          if (score.negative > 0) riskReasons.push(`${score.negative} negative review(s)`);
          const risk = riskReasons.length === 0 ? 'low' : riskReasons.length <= 1 ? 'medium' : 'high';

          return {
            success: true,
            engineer: args.engineer,
            period: `${from} to ${to}`,
            companies_served: companies,
            score,
            risk_level: risk,
            risk_reasons: riskReasons,
            unreviewed_concerns: unreviewed.length,
            qualitative_feedback: qualitative,
          };
        }

        // ── unreviewed_concerns ─────────────────────────────────
        case 'unreviewed_concerns': {
          const params: Record<string, string | boolean> = {
            from_submitted_date: from,
            to_submitted_date: to,
            is_reviewed: false,
          };
          if (args.company) params.company = args.company;
          const records = await fetchAll(params);
          const concerns = records
            .filter(r => r.rating === 'Neutral' || r.rating === 'Negative')
            .map(r => ({
              id: r.id,
              company: r.company,
              rating: r.rating,
              engineer: extractEngineer(r),
              date: r.submitted_date.split('T')[0],
              days_unreviewed: daysSince(r.submitted_date),
              comment: r.comment || null,
              ticket: r.ticket_name,
              tags: r.tags,
            }))
            .sort((a, b) => b.days_unreviewed - a.days_unreviewed);

          return { success: true, period: `${from} to ${to}`, count: concerns.length, concerns };
        }

        // ── period_summary ──────────────────────────────────────
        case 'period_summary': {
          const records = await fetchAll({ from_submitted_date: from, to_submitted_date: to });
          const overall = calcScore(records);
          const byCompany = new Map<string, CsatRecord[]>();
          for (const r of records) {
            if (!byCompany.has(r.company)) byCompany.set(r.company, []);
            byCompany.get(r.company)!.push(r);
          }
          const breakdown = Array.from(byCompany.entries())
            .map(([c, recs]) => ({ company: c, ...calcScore(recs), unreviewed: recs.filter(r => (r.rating === 'Neutral' || r.rating === 'Negative') && !r.is_reviewed).length }))
            .sort((a, b) => a.score - b.score);
          const totalUnreviewed = records.filter(r => (r.rating === 'Neutral' || r.rating === 'Negative') && !r.is_reviewed).length;
          return { success: true, period: `${from} to ${to}`, overall, total_unreviewed_concerns: totalUnreviewed, partners: byCompany.size, by_company: breakdown };
        }

        // ── search ──────────────────────────────────────────────
        case 'search': {
          if (!args.query) return { success: false, error: 'query is required for search' };
          const records = await fetchAll({ from_submitted_date: from, to_submitted_date: to });
          const q = args.query.toLowerCase();
          const matches = records
            .filter(r => r.comment?.toLowerCase().includes(q) || r.notes?.toLowerCase().includes(q) || r.ticket_name?.toLowerCase().includes(q))
            .map(r => ({
              id: r.id,
              date: r.submitted_date.split('T')[0],
              company: r.company,
              rating: r.rating,
              engineer: extractEngineer(r),
              comment: r.comment || null,
              notes: r.notes || null,
              ticket: r.ticket_name,
            }))
            .sort((a, b) => b.date.localeCompare(a.date));
          return { success: true, query: args.query, period: `${from} to ${to}`, count: matches.length, results: matches };
        }

        default:
          return { success: false, error: `Unknown action: ${args.action}` };
      }
    } catch (err: any) {
      return { success: false, error: err.message ?? 'Unknown error calling Team GPS API' };
    }
  },
};
