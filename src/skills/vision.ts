import screenshot from 'screenshot-desktop';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Skill, SkillMeta } from '../types/skill.js';
import { skillLock } from '../core/skill-lock.js';
import * as dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const SCREENSHOTS_DIR = path.join(process.cwd(), 'screenshots');

export const visionSkill: Skill = {
  name: 'analyze_vision',
  description: 'Analyzes an image or the current screen using Gemini Vision. Use this to describe what is on the screen or to analyze a specific local image file. Screenshots are saved to the local screenshots folder.',
  parameters: {
    type: 'object',
    properties: {
      imagePath: {
        type: 'string',
        description: 'Path to a local image file. Leave empty to capture and analyze the current screen.',
      },
      prompt: {
        type: 'string',
        description: 'What you want to know about the image (e.g., "What is in this image?", "Read the text on the screen").',
      },
    },
    required: ['prompt'],
  },
  run: async ({ imagePath, prompt }: { imagePath?: string; prompt: string }, meta: SkillMeta) => {
    let release: (() => void) | undefined;
    try {
      release = await skillLock.acquireExclusive('browser_vision', {
        agentId: meta.agentId, conversationId: meta.conversationId,
        conversationLabel: meta.conversationLabel,
        operation: 'vision:analyze', acquiredAt: new Date(),
      });
      console.log(`[Vision] Starting analysis with prompt: "${prompt}"`);
      let finalPath = imagePath;

      // If no path is provided, take a screenshot
      if (!finalPath) {
        if (!fs.existsSync(SCREENSHOTS_DIR)) {
          fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
        }
        finalPath = path.join(SCREENSHOTS_DIR, `screen_${Date.now()}.png`);
        console.log(`[Vision] Capturing screenshot to: ${finalPath}`);
        await screenshot({ filename: finalPath });
      }

      if (!fs.existsSync(finalPath)) {
        console.error(`[Vision] File not found: ${finalPath}`);
        return { success: false, error: 'Image file not found.' };
      }

      console.log(`[Vision] Calling Gemini with image data...`);
      const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
      const imageData = fs.readFileSync(finalPath);
      
      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: Buffer.from(imageData).toString('base64'),
            mimeType: 'image/png',
          },
        },
      ]);

      const response = await result.response;
      console.log(`[Vision] Analysis complete.`);
      
      return {
        success: true,
        analysis: response.text(),
        savedPath: finalPath
      };
    } catch (error: any) {
      console.error(`[Vision] Error:`, error);
      return { success: false, error: error.message };
    } finally {
      release?.();
    }
  },
};
