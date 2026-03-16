import { Skill } from '../types/skill.js';
import { browserManager } from '../core/browser.js';
import { chromeNativeAdapter } from '../core/chrome-mcp.js';

/**
 * Unified browser skill — the ONLY browser tool for PersonalClaw.
 *
 * TWO MODES:
 *   • playwright-managed (default) — persistent Playwright Chromium with login persistence.
 *   • native-chrome — connected to the user's real running Chrome session via CDP or Chrome MCP.
 *
 * Switch to native Chrome: action="connect_native" (uses port 9222 by default).
 * Switch back to Playwright: action="disconnect_native".
 */
export const browserSkill: Skill = {
  name: 'browser',
  description: `Control a browser. Two modes: Playwright-managed (default) and native Chrome (user's real session).

NATIVE CHROME (Chrome 146+):
- "connect_native": Connect to the user's real running Chrome. Tries Chrome native MCP first, then CDP fallback.
  Use port param (default 9222). Chrome must be running with --remote-debugging-port=9222.
  Once connected, ALL browser actions below operate on the real Chrome session with real logins.
- "disconnect_native": Revert to Playwright mode.
- "status": Show current browser mode and whether Chrome is available on port 9222.
- "chrome_call": When connected via Chrome native MCP, call a Chrome tool directly by name.
  Requires "target" = Chrome tool name, and "args" = JSON string of arguments.

BROWSER ACTIONS (work in both modes):
- "navigate": Go to a URL (requires "url").
- "click": Click an element by visible text or CSS selector (requires "target").
- "type": Type text into an input (requires "target" for field, "text" for content).
- "scrape": Get the page title, URL, and visible text. Cheap and fast — use first.
- "screenshot": Take a screenshot, returns the file path.
- "evaluate": Run raw JavaScript on the page (requires "code").
- "back": Go back in history.
- "wait": Wait for an element to appear (requires "target" as CSS selector).
- "page_info": Get current page title and URL.
- "close": Close the Playwright browser (has no effect in native Chrome mode).

DECISION GUIDE:
- Need to work with the user's logged-in accounts (email, tools, dashboards)? → connect_native first.
- Need a clean browser state or testing in isolation? → stay in Playwright mode.
- Always scrape first (cheap) → click/type → screenshot only when visual layout matters.`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'navigate', 'click', 'type', 'scrape', 'screenshot',
          'evaluate', 'back', 'wait', 'page_info', 'close',
          'connect_native', 'disconnect_native', 'status', 'chrome_call',
        ],
        description: 'The browser action to perform.',
      },
      url: {
        type: 'string',
        description: 'URL to navigate to (for "navigate").',
      },
      target: {
        type: 'string',
        description: 'Element selector or Chrome tool name. For click/type/wait: visible text, placeholder, label, or CSS selector. For chrome_call: Chrome MCP tool name.',
      },
      text: {
        type: 'string',
        description: 'Text to type (for "type").',
      },
      code: {
        type: 'string',
        description: 'JavaScript code to run (for "evaluate").',
      },
      port: {
        type: 'number',
        description: 'Chrome remote debugging port (for "connect_native", default 9222).',
      },
      args: {
        type: 'string',
        description: 'JSON-encoded arguments for Chrome MCP tool (for "chrome_call").',
      },
    },
    required: ['action'],
  },
  run: async ({ action, url, target, text, code, port, args }: {
    action: string;
    url?: string;
    target?: string;
    text?: string;
    code?: string;
    port?: number;
    args?: string;
  }) => {
    try {
      switch (action) {

        // ── Native Chrome Connection ──────────────────────────────────

        case 'connect_native': {
          const result = await browserManager.connectNative(port ?? 9222);
          return { success: true, message: result };
        }

        case 'disconnect_native': {
          const result = await browserManager.disconnectNative();
          return { success: true, message: result };
        }

        case 'status': {
          const status = await browserManager.getStatus();
          const chromeMCPTools = chromeNativeAdapter.getMCPToolNames();
          return {
            success: true,
            data: {
              ...status,
              chromeMCPTools: chromeMCPTools.length > 0 ? chromeMCPTools : undefined,
            },
          };
        }

        case 'chrome_call': {
          if (!target) return { success: false, error: 'target (Chrome tool name) is required for chrome_call.' };
          if (!chromeNativeAdapter.isConnected()) {
            return { success: false, error: 'Not connected to native Chrome. Use action="connect_native" first.' };
          }
          if (chromeNativeAdapter.getMode() !== 'chrome-mcp') {
            return { success: false, error: 'chrome_call requires Chrome native MCP mode. Currently in CDP mode — use regular browser actions instead.' };
          }
          let parsedArgs = {};
          if (args) {
            try { parsedArgs = JSON.parse(args); } catch { return { success: false, error: 'args must be valid JSON.' }; }
          }
          const result = await chromeNativeAdapter.callMCPTool(target, parsedArgs);
          return { success: true, data: result };
        }

        // ── Standard Browser Actions (both modes) ─────────────────────

        case 'navigate': {
          if (!url) return { success: false, error: 'URL is required for navigate.' };
          const result = await browserManager.navigate(url);
          return { success: true, message: result };
        }

        case 'click': {
          if (!target) return { success: false, error: 'Target is required for click (text or selector).' };
          const result = await browserManager.click(target);
          return { success: true, message: result };
        }

        case 'type': {
          if (!target) return { success: false, error: 'Target is required for type.' };
          if (!text) return { success: false, error: 'Text is required for type.' };
          const result = await browserManager.type(target, text);
          return { success: true, message: result };
        }

        case 'scrape': {
          const result = await browserManager.scrape();
          return { success: true, data: result };
        }

        case 'screenshot': {
          const path = await browserManager.screenshot();
          return { success: true, message: `Screenshot saved to: ${path}`, path };
        }

        case 'evaluate': {
          if (!code) return { success: false, error: 'Code is required for evaluate.' };
          const result = await browserManager.evaluate(code);
          return { success: true, data: result };
        }

        case 'back': {
          const result = await browserManager.back();
          return { success: true, message: result };
        }

        case 'wait': {
          if (!target) return { success: false, error: 'Target (CSS selector) is required for wait.' };
          const result = await browserManager.waitFor(target);
          return { success: true, message: result };
        }

        case 'page_info': {
          const info = await browserManager.pageInfo();
          return { success: true, data: info };
        }

        case 'close': {
          const result = await browserManager.close();
          return { success: true, message: result };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error: any) {
      console.error(`[Browser] Error in action "${action}":`, error.message);
      return { success: false, error: error.message };
    }
  },
};
