# PersonalClaw — LinkedIn Automation Plan (Local Machine)
## LLM-Driven Scheduled LinkedIn Posting via Script Replay

---

## HOW IT WORKS END TO END

```
PersonalClaw Scheduler (cron)
  → Triggers LinkedIn Agent Brain
    → Brain generates post content
    → Brain runs pre-flight checks (vision)
    → Brain calls linkedin_post skill
      → Skill writes content to file
      → Skill runs LinkedInTest.py
        → Script replays recorded mouse coordinates on local screen
          → Post goes live on LinkedIn
```

PersonalClaw and LinkedIn are both on the same local Windows machine.
The Python script controls your local screen directly — no remote execution needed.

---

## WHAT YOU NEED TO DO FIRST (ONE TIME SETUP)

**Step 1 — Create the bot folder**
```
mkdir C:\LinkedInBot
```
Put `Teacher.py` and the updated `LinkedInTest.py` (from this plan) in that folder.

**Step 2 — Install Python dependencies**
```
pip install pynput pyautogui pyperclip
```

**Step 3 — Log into LinkedIn in Chrome**
Open Chrome, go to linkedin.com, log in, check "Keep me logged in".
Leave this Chrome window open. Do not close it.

**Step 4 — Set up your screen for recording**
Before running Teacher.py, make sure:
- Chrome is open with LinkedIn on the home feed
- Page is NOT scrolled — "Start a post" bar is visible at the top
- Chrome zoom is at 100% (Ctrl+0 to reset)
- Window is in its normal position and size — do not move or resize after recording

**Step 5 — Record your coordinates**
```
python C:\LinkedInBot\Teacher.py
```
Then perform exactly these 3 clicks in order:
1. Click the **"Start a post"** box at the top of the feed
2. Click inside the **text area** that appears in the popup
3. Type a few words (dummy text), then click the **"Post" button** to submit

Press ESC to stop. This saves `linkedin_steps.json` with 3 click entries.

**Verify the recording:**
```
python -c "import json; steps = json.load(open('C:/LinkedInBot/linkedin_steps.json')); print([s for s in steps if s['type']=='click'])"
```
You should see exactly 3 click entries.

**Step 6 — Add to `.env`**
```
LINKEDIN_SCRIPT_DIR=C:\LinkedInBot
```

---

## UPDATED `LinkedInTest.py`

Replace the existing file with this version. It reads content from a file
written by PersonalClaw instead of the hardcoded string:

```python
import json
import time
import pyautogui
import pyperclip
import sys
import os

def play_recording(steps_file, content_file):
    # Read content written by PersonalClaw
    with open(content_file, "r", encoding="utf-8") as f:
        post_content = f.read().strip()

    if not post_content:
        print("Error: post_content.txt is empty.")
        sys.exit(1)

    pyperclip.copy(post_content)
    print(f"Content ready ({len(post_content)} chars). Starting in 3 seconds...")
    print("Do not touch your mouse or keyboard until done.")
    time.sleep(3)

    try:
        with open(steps_file, "r") as f:
            steps = json.load(f)
    except FileNotFoundError:
        print(f"Error: {steps_file} not found. Run Teacher.py first.")
        sys.exit(1)

    clicks = [s for s in steps if s["type"] == "click"]
    if len(clicks) < 3:
        print(f"Error: Expected 3 recorded clicks, found {len(clicks)}. Re-run Teacher.py.")
        sys.exit(1)

    click_count = 0
    last_time = 0

    for step in steps:
        delay = step["time"] - last_time
        time.sleep(max(0, delay))

        if step["type"] == "click":
            click_count += 1
            pyautogui.moveTo(step["x"], step["y"], duration=0.5)
            pyautogui.click()
            print(f"Click {click_count} at ({step['x']}, {step['y']})")

            if click_count == 2:
                # Inside text area — paste content
                time.sleep(0.5)
                pyautogui.hotkey("ctrl", "v")
                print("Content pasted.")
                time.sleep(1.5)

            if click_count == 3:
                # Post button — wait for submission
                time.sleep(2.0)
                print("Post button clicked. Waiting for submission...")

        last_time = step["time"]

    print("✅ Done. Post should be live.")

if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    steps_file = os.path.join(script_dir, "linkedin_steps.json")
    content_file = os.path.join(script_dir, "post_content.txt")

    # Accept --content-file override from PersonalClaw
    for i, arg in enumerate(sys.argv):
        if arg == "--content-file" and i + 1 < len(sys.argv):
            content_file = sys.argv[i + 1]

    play_recording(steps_file, content_file)
```

---

## NEW SKILL: `src/skills/linkedin.ts`

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { Skill, SkillMeta } from '../types/skill.js';

export const linkedinSkill: Skill = {
  name: 'linkedin_post',
  description: `Post content to LinkedIn using the configured automation script.
Handles pre-flight validation and script execution on the local machine.
The script replays recorded mouse coordinates to navigate LinkedIn and submit the post.
Call this only after generating the post content and completing pre-flight vision checks.
Use dry_run: true to validate setup without actually posting.`,

  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'Full text of the LinkedIn post. Max 3000 characters. Include hashtags.',
      },
      dry_run: {
        type: 'boolean',
        description: 'If true, validates setup only — does not post. Use before first real post.',
      },
    },
    required: ['content'],
  },

  run: async (args: any, _meta: SkillMeta) => {
    const scriptDir = process.env.LINKEDIN_SCRIPT_DIR || 'C:\\LinkedInBot';
    const scriptPath = path.join(scriptDir, 'LinkedInTest.py');
    const stepsPath = path.join(scriptDir, 'linkedin_steps.json');
    const contentPath = path.join(scriptDir, 'post_content.txt');

    // Validate setup
    if (!fs.existsSync(scriptPath)) {
      return {
        success: false,
        error: `LinkedInTest.py not found at ${scriptPath}. Set LINKEDIN_SCRIPT_DIR in .env and place scripts there.`,
      };
    }
    if (!fs.existsSync(stepsPath)) {
      return {
        success: false,
        error: `linkedin_steps.json not found at ${stepsPath}. Run Teacher.py to record coordinates first.`,
      };
    }

    // Validate click count
    try {
      const steps = JSON.parse(fs.readFileSync(stepsPath, 'utf-8'));
      const clicks = steps.filter((s: any) => s.type === 'click');
      if (clicks.length < 3) {
        return {
          success: false,
          error: `linkedin_steps.json has only ${clicks.length} click(s). Need exactly 3 (Start a post → text area → Post button). Re-run Teacher.py.`,
        };
      }
    } catch {
      return { success: false, error: 'linkedin_steps.json is corrupted. Re-run Teacher.py.' };
    }

    if (!args.content || args.content.trim().length === 0) {
      return { success: false, error: 'Post content is empty.' };
    }
    if (args.content.length > 3000) {
      return {
        success: false,
        error: `Content is ${args.content.length} characters. LinkedIn limit is 3000. Shorten the post.`,
      };
    }

    if (args.dry_run) {
      return {
        success: true,
        dry_run: true,
        message: 'Setup validated. Ready to post.',
        contentLength: args.content.length,
        scriptDir,
      };
    }

    // Write content to file
    fs.writeFileSync(contentPath, args.content, 'utf-8');

    // Execute script
    try {
      const output = execSync(
        `python "${scriptPath}" --content-file "${contentPath}"`,
        {
          cwd: scriptDir,
          encoding: 'utf-8',
          timeout: 60000, // 60s max
        }
      );
      return {
        success: true,
        output: output.trim(),
        contentLength: args.content.length,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        stderr: err.stderr?.trim() ?? '',
        hint: 'Check that Chrome is open with LinkedIn home feed visible and not scrolled.',
      };
    }
  },
};
```

Register in `src/skills/index.ts`:
```typescript
import { linkedinSkill } from './linkedin.js';
// add to skills array: linkedinSkill
```

---

## LINKEDIN AGENT: JORDAN

Create this agent in your PersonalClaw Enterprise org.

**Name:** Jordan
**Role:** LinkedIn Content Manager
**Heartbeat:** `0 9 * * 1-5` (9am weekdays)
**Autonomy:** Full
**Reports To:** CMO

**Personality:**
```
Authoritative content creator who writes for MSP owners and IT decision makers.
Writes with specificity — real numbers, real scenarios, real problems.
No generic AI hype. No motivational fluff. Posts that make people stop scrolling.
Understands that LinkedIn's algorithm rewards comments, so every post ends
with something that invites a response.
```

**Responsibilities:**
```
Write and publish one LinkedIn post every weekday.
Vary content type across the week — never the same format twice in a row.
Run pre-flight checks before every post to ensure LinkedIn is accessible.
If LinkedIn is not accessible, raise a blocker instead of failing silently.
Log every post in a content calendar file in the workspace.
Track post topics to avoid repetition.
```

**Goals:**
```
1. Post to LinkedIn every weekday at 9am without human involvement
2. Maintain a content calendar in workspace/marketing/linkedin_calendar.md
3. Rotate content: Monday=tip, Tuesday=feature, Wednesday=problem/solution, Thursday=progress, Friday=question
4. Every post must be 150-400 words, end with a question or CTA, max 5 hashtags
5. Never post the same topic twice within a 2-week window
6. Perform pre-flight checks before every post — raise blocker if LinkedIn is unreachable
```

---

## AGENT SYSTEM PROMPT ADDITIONS

Add this to Jordan's responsibilities so the Brain knows the full pre-flight sequence:

```
## Pre-Flight Checklist (run before every post)

Before calling linkedin_post, complete all of the following checks in order:

1. TAKE A SCREENSHOT: Use analyze_vision to capture the current screen state.

2. CHECK CHROME IS OPEN: Look for Chrome in the screenshot with a LinkedIn tab.
   - If Chrome is not open: use execute_powershell to open it:
     Start-Process "chrome.exe" "https://www.linkedin.com/feed/"
     Wait 5 seconds, then take another screenshot.

3. CHECK LOGGED IN: Look for the LinkedIn home feed in the screenshot.
   - If you see a login page: raise a blocker — "LinkedIn session expired.
     Please log in manually at linkedin.com and re-run."
   - Do NOT attempt to log in automatically.

4. CHECK HOME FEED PAGE: Confirm the "Start a post" bar is visible at the top.
   - If on a different LinkedIn page: use execute_powershell to navigate:
     Start-Process "chrome.exe" "https://www.linkedin.com/feed/"
     Wait 3 seconds, take another screenshot.

5. CHECK NOT SCROLLED: The "Start a post" bar should be near the top of the page.
   - If scrolled down: use execute_powershell to scroll to top:
     Add-Type -AssemblyName System.Windows.Forms
     [System.Windows.Forms.SendKeys]::SendWait("^{HOME}")
     Wait 1 second.

6. ALL CHECKS PASSED: Call linkedin_post with your generated content.

If any check cannot be resolved automatically, raise a blocker with:
- What you found in the screenshot
- What step failed
- What the human needs to do to fix it
```

---

## POST CONTENT FORMAT RULES

Add to Jordan's responsibilities:

```
## LinkedIn Post Format

Structure every post like this:
[Hook — 1 line. Question, stat, or bold claim]

[Body — 3-4 short paragraphs, 2-3 sentences each]

[CTA or question — 1 line that invites comments]

#hashtag1 #hashtag2 #hashtag3

Rules:
- 150-400 words total
- No lines longer than 10 words (LinkedIn truncates long lines)
- Never start with "I" as the first word
- Never use the phrase "game changer", "leverage", or "unlock"
- Always specific: name the tool, the time saved, the problem solved
- Max 5 hashtags, always at the end

Weekly rotation:
- Monday: Educational tip about AI automation or MSP productivity
- Tuesday: PersonalClaw feature spotlight with concrete use case
- Wednesday: MSP pain point + how PersonalClaw solves it
- Thursday: Behind the scenes — what we built, what we learned
- Friday: Question to the audience about their current challenges
```

---

## CONTENT CALENDAR FILE

Jordan should maintain `workspace/marketing/linkedin_calendar.md`. Format:

```markdown
# LinkedIn Content Calendar

## Posted
| Date | Day | Type | Topic | Performance Notes |
|------|-----|------|-------|-------------------|
| 2026-03-19 | Wed | Problem/Solution | AI automation for MSP triage | |

## Planned
| Week | Day | Type | Topic |
|------|-----|------|-------|
| W13 | Mon | Tip | How to automate ticket triage with AI |
| W13 | Tue | Feature | PersonalClaw browser automation |

## Topic Bank (unused ideas)
- The cost of manual IT triage at scale
- Why MSPs are losing talent to burnout
- PersonalClaw vs hiring a junior tech
```

---

## IMPLEMENTATION ORDER

### Phase 1 — Manual setup (you do this, 15 minutes)
1. Create `C:\LinkedInBot\`
2. Save updated `LinkedInTest.py` there
3. Save `Teacher.py` there
4. Run `pip install pynput pyautogui pyperclip`
5. Open Chrome, go to linkedin.com/feed, log in
6. Run `Teacher.py`, record 3 clicks: Start a post → text area → Post button
7. Verify `linkedin_steps.json` has 3 click entries
8. Add `LINKEDIN_SCRIPT_DIR=C:\LinkedInBot` to PersonalClaw `.env`

### Phase 2 — Skill (Flash)
9. Create `src/skills/linkedin.ts`
10. Register in `src/skills/index.ts`
11. `npx tsc --noEmit` — fix any errors

### Phase 3 — Dry run test (you do this)
12. In PersonalClaw chat: `use linkedin_post skill with dry_run: true, content: "test"`
13. Should return `{ success: true, dry_run: true }`

### Phase 4 — First real test (you do this)
14. Make sure Chrome is open with LinkedIn home feed, not scrolled
15. In PersonalClaw chat: `use linkedin_post to post: "Testing my new AI automation setup. More updates soon. #AI #Automation"`
16. Watch your screen — the script will take over mouse for ~10 seconds
17. Confirm post appears on LinkedIn

### Phase 5 — Create Jordan agent
18. Add Jordan to PersonalClaw Enterprise org with above settings
19. Trigger manually once
20. Watch Activity feed — pre-flight checks should run, then post

### Phase 6 — Schedule
21. Jordan's heartbeat `0 9 * * 1-5` handles daily posting automatically
22. Resume org if paused

---

## KNOWN LIMITATIONS AND MITIGATIONS

| Limitation | Mitigation |
|---|---|
| Coordinates break if Chrome window moves or resizes | Brain's vision pre-flight detects shifted UI and raises blocker |
| LinkedIn UI update changes button positions | Re-run Teacher.py — takes 5 minutes |
| Session expires | Brain detects login page and raises blocker |
| Mouse movement interrupted by human using computer | Script has 3s delay before starting — do not touch mouse while it runs |
| Chrome zoom not 100% | Add to pre-flight: Brain checks and warns |
| Post fails silently | Check `C:\LinkedInBot\post_content.txt` to see what was attempted |

---

## CONSTRAINTS FOR IMPLEMENTING AGENT

1. `LINKEDIN_SCRIPT_DIR` must be in `.env` — skill errors clearly if missing
2. Skill validates click count from steps file — errors if < 3 clicks recorded
3. Content written to `post_content.txt` before script runs — inspect this file if debugging
4. Script timeout is 60 seconds — enough for the full posting sequence
5. Do not increase pyautogui speed — natural timing is what avoids LinkedIn bot detection
6. Brain must always do vision pre-flight — never call `linkedin_post` cold
