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
