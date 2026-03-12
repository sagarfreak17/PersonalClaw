import { chromium, BrowserContext, Page } from 'playwright';
import { Skill } from '../types/skill.js';
import * as path from 'path';

let browser: BrowserContext | null = null;
let page: Page | null = null;

export const webSkill: Skill = {
  name: 'browse_web',
  description: 'Browses the web using Playwright. Use this for searching information, navigating to URLs, and interacting with websites.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['navigate', 'search', 'click', 'type', 'screenshot', 'extract_text', 'launch', 'close'],
        description: 'The action to perform on the web. Use "launch" for a visible persistent browser, "close" to stop it.',
      },
      url: {
        type: 'string',
        description: 'The URL to navigate to (required for navigate).',
      },
      query: {
        type: 'string',
        description: 'The search query (required for search).',
      },
      selector: {
        type: 'string',
        description: 'The CSS selector to interact with (required for click/type).',
      },
      text: {
        type: 'string',
        description: 'The text to type (required for type).',
      },
    },
    required: ['action'],
  },
  run: async ({ action, url, query, selector, text }: { action: string; url?: string; query?: string; selector?: string; text?: string }) => {
    try {
      if (action === 'launch' && browser) {
        // If user explicitly asks for 'launch' and browser is hidden, restart it
        await browser.close();
        browser = null;
      }

      if (!browser) {
        // Use a permanent 'PersonalClaw' profile folder in the project root
        // This acts exactly like a Chrome Profile (saves logins, bookmarks, history)
        const userDataDir = path.join(process.cwd(), 'browser_data', 'PersonalClaw_Profile');
        
        console.log(`[Web] Launching persistent browser at ${userDataDir}...`);
        browser = await chromium.launchPersistentContext(userDataDir, {
          headless: action !== 'launch', 
          viewport: null, // Open with natural window size
          args: ['--start-maximized', '--no-sandbox']
        }) as any;
        
        page = (browser as any).pages()[0] || await (browser as any).newPage();
      }

      if (!page) throw new Error("Could not initialize page");

      switch (action) {
        case 'navigate':
          if (!url) throw new Error("URL is required for navigate");
          await page.goto(url);
          return { success: true, currentUrl: page.url() };

        case 'launch':
          if (url) await page.goto(url);
          return { success: true, message: "Visible browser launched with persistent session." };

        case 'search':
          if (!query) throw new Error("Query is required for search");
          await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
          const results = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('h3')).slice(0, 5).map(h => h.innerText);
          });
          return { success: true, topResults: results };

        case 'click':
          if (!selector) throw new Error("Selector is required for click");
          await page.click(selector);
          return { success: true };

        case 'type':
          if (!selector || !text) throw new Error("Selector and text are required for type");
          await page.type(selector, text);
          return { success: true };

        case 'extract_text':
          const content = await page.textContent('body');
          return { success: true, text: content?.slice(0, 2000) };

        case 'screenshot':
          const screenshotPath = `screenshot_${Date.now()}.png`;
          await page.screenshot({ path: screenshotPath });
          return { success: true, path: screenshotPath };

        case 'close':
          if (browser) {
            await browser.close();
            browser = null;
            return { success: true, message: "Browser closed." };
          }
          return { error: "No browser open." };

        default:
          return { success: false, error: 'Invalid web action' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};
