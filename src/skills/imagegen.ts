import { GoogleGenerativeAI } from '@google/generative-ai';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { Skill, SkillMeta } from '../types/skill.js';

const OUTPUTS_DIR = path.join(process.cwd(), 'outputs');

async function ensureOutputsDir() {
  if (!existsSync(OUTPUTS_DIR)) {
    await mkdir(OUTPUTS_DIR, { recursive: true });
  }
}

function getTimestampedName(prefix: string, ext: string): string {
  return `${prefix}_${Date.now()}.${ext}`;
}

/**
 * Generates an image using Gemini's native image generation models (Nano Banana).
 * Compatible with gemini-3.1-flash-image-preview and gemini-3-pro-image-preview.
 */
async function generateNativeImage(
  apiKey: string,
  modelId: string,
  prompt: string,
  outputName: string
): Promise<{ path: string; model: string }> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      // @ts-ignore — responseModalities is valid in newer SDK versions/models
      responseModalities: ['TEXT', 'IMAGE'],
    },
  });

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;

    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.mimeType?.startsWith('image/')) {
        const ext = part.inlineData.mimeType.split('/')[1] ?? 'png';
        const fileName = outputName.includes('.') ? outputName : `${outputName}.${ext}`;
        const outPath = path.join(OUTPUTS_DIR, fileName);
        await writeFile(outPath, Buffer.from(part.inlineData.data, 'base64'));
        return { path: outPath, model: modelId };
      }
    }
    throw new Error(`No image returned from ${modelId}`);
  } catch (err: any) {
    console.error(`[imagegen] ${modelId} API Error:`, err.message);
    throw err;
  }
}

// ─── Skill Export ─────────────────────────────────────────────────────────────

export const imagegenSkill: Skill = {
  name: 'generate_image',
  description: `Generate high-quality images using Google's newest Gemini Pro and Flash Image models.
Two modes with auto-fallback:
- 'pro': gemini-3-pro-image-preview (highest quality, best for detailed photorealistic prompts)
- 'flash': gemini-3-1-flash-image-preview (blazing fast, great for creative and interactive use)
- 'auto': Tries pro first, falls back to flash on failure.
Saves all images to the outputs/ folder.
To display the image in the chat, use markdown: ![image](http://localhost:3000/outputs/filename.png) using the filename returned.`,
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Detailed description of the image to generate.',
      },
      model: {
        type: 'string',
        enum: ['auto', 'pro', 'flash'],
        description: 'Which model to use. "auto" tries Pro first with Flash fallback.',
        default: 'auto',
      },
      output_name: {
        type: 'string',
        description: 'Output filename without extension (e.g. "my_image"). Saved to outputs/ folder.',
      },
      aspect_ratio: {
        type: 'string',
        enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
        description: 'Desired aspect ratio (handled via prompt injection for native models).',
        default: '1:1',
      },
    },
    required: ['prompt'],
  },

  run: async (args: any, _meta: SkillMeta): Promise<any> => {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) return { success: false, error: 'GEMINI_API_KEY or GOOGLE_API_KEY not set in .env' };

    await ensureOutputsDir();

    const {
      prompt,
      model = 'auto',
      output_name,
      aspect_ratio = '1:1',
    } = args;

    if (!prompt) return { success: false, error: 'prompt is required' };

    const outputName = output_name ?? getTimestampedName('image', 'png');
    
    // Inject aspect ratio instruction into prompt for native models
    const finalPrompt = aspect_ratio !== '1:1' 
      ? `Generate an image with a ${aspect_ratio} aspect ratio. ${prompt}` 
      : prompt;

    const PRO_MODEL = 'gemini-3-pro-image-preview';
    const FLASH_MODEL = 'gemini-3.1-flash-image-preview';

    try {
      if (model === 'flash') {
        const result = await generateNativeImage(apiKey, FLASH_MODEL, finalPrompt, outputName);
        return { success: true, output_path: result.path, output_url: `http://localhost:3000/outputs/${path.basename(result.path)}`, model_used: result.model };
      }

      if (model === 'pro') {
        const result = await generateNativeImage(apiKey, PRO_MODEL, finalPrompt, outputName);
        return { success: true, output_path: result.path, output_url: `http://localhost:3000/outputs/${path.basename(result.path)}`, model_used: result.model };
      }

      // auto — try pro, fallback to flash
      try {
        const result = await generateNativeImage(apiKey, PRO_MODEL, finalPrompt, outputName);
        return { success: true, output_path: result.path, output_url: `http://localhost:3000/outputs/${path.basename(result.path)}`, model_used: result.model };
      } catch (proErr: any) {
        console.warn('[imagegen] Pro model failed, falling back to Flash:', proErr.message);
        const result = await generateNativeImage(apiKey, FLASH_MODEL, finalPrompt, outputName);
        return {
          success: true,
          output_path: result.path,
          output_url: `http://localhost:3000/outputs/${path.basename(result.path)}`,
          model_used: result.model,
          fallback: true,
          fallback_reason: proErr.message,
        };
      }
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
};
