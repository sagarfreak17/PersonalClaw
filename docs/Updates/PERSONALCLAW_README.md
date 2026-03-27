# Team GPS CSAT — PersonalClaw Integration

This adds Team GPS CSAT as a native PersonalClaw skill, so your AI can query
partner health, engineer scorecards, and unreviewed concerns directly from chat.

---

## Installation (3 steps)

### Step 1 — Add the skill file

Copy `PERSONALCLAW_SKILL.ts` into your PersonalClaw skills directory and rename it:

```
PersonalClaw/src/skills/teamgps.ts
```

### Step 2 — Register the skill

Open `src/skills/index.ts` and add two lines:

```typescript
// Add this import near the top with the other skill imports
import { teamGpsSkill } from './teamgps.js';

// Add teamGpsSkill to the skills array
export const skills: Skill[] = [
  // ... all your existing skills ...
  teamGpsSkill,   // ← add this
];
```

### Step 3 — Add your API key

Open your `.env` file and add:

```
TEAMGPS_API_KEY=your_api_key_here
```

Get your key from: **Team GPS → Admin Settings → Integrations → Public APIs**
Make sure the **Public APIs** toggle is ON.

### Step 4 — Rebuild and restart

```bash
npm run build
npm run all
```

---

## Usage

Once running, talk to PersonalClaw naturally:

- *"List all our Team GPS partners for the last 90 days"*
- *"Summarise MSP Corp's CSAT for last month"*
- *"Which partners are at risk right now?"*
- *"Show me Hampton's engineer scorecard for the last 90 days"*
- *"Find all unreviewed concerns older than 7 days"*
- *"Search all CSAT reviews for the word attendance"*
- *"Give me an org-wide CSAT digest for this month"*

---

## Actions Reference

| Action | Required params | What it returns |
|--------|----------------|-----------------|
| `list_companies` | period | All partners with review counts and scores |
| `partner_summary` | company, period | Score, trend, comments, notes, unreviewed concerns |
| `at_risk_partners` | period | Partners with score <90% or unreviewed concerns |
| `engineer_scorecard` | engineer, period | Ratings, risk level, qualitative feedback |
| `unreviewed_concerns` | period, (company) | All unreviewed Neutral/Negative reviews |
| `period_summary` | period | Org-wide breakdown across all partners |
| `search` | query, period | Keyword matches across comments and notes |

---

## Org Agent Usage

The skill works inside org agents too. A **Service Manager agent** on a Monday
morning cron could run:

```
Check Team GPS for unreviewed concerns from the last 7 days.
If any exist, create a ticket in the org task board for each one
and notify the dashboard.
```

A **QBR Prep agent** could run before a client meeting:

```
Pull MSP Corp's full CSAT summary for the last 6 months.
Write a report to workspace/qbr/msp-corp-talking-points.md
covering score trend, key comments, engineer performance,
and 3 recommended talking points.
```

---

## Notes

- The skill automatically classifies records by queue type (MDE Monthly,
  Internal HelpDesk, Company-Level) and routes engineer name extraction
  accordingly — no configuration needed.
- Engineer name matching is case-insensitive and partial — searching "hampton"
  will match "Hampton".
- The `notes` field (internal management notes) is included in results.
  Be mindful of who has access to PersonalClaw if these notes contain
  sensitive HR or SIP information.
