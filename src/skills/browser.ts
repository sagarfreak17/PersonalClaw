import { Skill, SkillMeta } from '../types/skill.js';
import { browserManager } from '../core/browser.js';
import { chromeNativeAdapter } from '../core/chrome-mcp.js';
import { extensionRelay } from '../core/relay.js';
import { skillLock } from '../core/skill-lock.js';
import { orgManager } from '../core/org-manager.js';

/**
 * Unified browser skill — the ONLY browser tool for PersonalClaw.
 *
 * THREE MODES:
 *   • playwright-managed (default) — persistent Playwright Chromium with login persistence.
 *   • native-chrome — connected to the user's real running Chrome session via CDP or Chrome MCP.
 *   • extension-relay — connected via the PersonalClaw Chrome extension for real DOM access.
 *
 * Switch to native Chrome: action="connect_native" (uses port 9222 by default).
 * Switch back to Playwright: action="disconnect_native".
 * Extension relay: auto-detected when extension is connected.
 */
export const browserSkill: Skill = {
  name: 'browser',
  description: `Control a browser. Three modes: Playwright-managed (default), native Chrome (user's real session), and Extension Relay.

NATIVE CHROME (Chrome 146+):
- "connect_native": Connect to the user's real running Chrome. Tries Chrome native MCP first, then CDP fallback.
  Use port param (default 9222). Chrome must be running with --remote-debugging-port=9222.
  Once connected, ALL browser actions below operate on the real Chrome session with real logins.
- "disconnect_native": Revert to Playwright mode.
- "status": Show current browser mode, Chrome availability, and extension relay connection.
- "chrome_call": When connected via Chrome native MCP, call a Chrome tool directly by name.
  Requires "target" = Chrome tool name, and "args" = JSON string of arguments.

EXTENSION RELAY (PersonalClaw Chrome Extension):
The extension provides a relay bridge to the user's real Chrome tabs. When the extension is connected:
- "relay_tabs": List all open Chrome tabs (id, url, title, active status).
- "relay_navigate": Navigate the active tab to a URL. Use "url" param. Optional "tab_id" to target a specific tab.
- "relay_click": Click an element in the active tab via DOM. Use "target" (text, selector, placeholder).
- "relay_type": Type text into a field. Use "target" for the field and "text" for the content.
- "relay_scrape": Scrape the active tab's content — returns text, links, forms, metadata. Very rich.
- "relay_screenshot": Capture the visible area of a tab as a base64 PNG.
- "relay_switch_tab": Switch to a tab by ID. Use "tab_id" param.
- "relay_open_tab": Open a new tab. Optional "url" param.
- "relay_close_tab": Close a tab by ID. Use "tab_id" param.
- "relay_evaluate": Run JavaScript in the active tab. Use "code" param.
- "relay_scroll": Scroll the page. Use "target" as direction (up/down/left/right/top/bottom).
- "relay_elements": Get interactive elements on the page (buttons, links, inputs) with metadata.

STANDARD BROWSER ACTIONS (Playwright/native Chrome modes):
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
- Need to interact with user's real logged-in Chrome tabs? → Use relay_ actions if extension is connected.
- Need to work with real Chrome without the extension? → connect_native first.
- Need a clean browser state or testing in isolation? → stay in Playwright mode.
- Check "status" first to see what modes are available.
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
          'relay_tabs', 'relay_navigate', 'relay_click', 'relay_type',
          'relay_scrape', 'relay_screenshot', 'relay_switch_tab',
          'relay_open_tab', 'relay_close_tab', 'relay_evaluate',
          'relay_scroll', 'relay_elements',
        ],
        description: 'The browser action to perform.',
      },
      url: {
        type: 'string',
        description: 'URL to navigate to (for "navigate", "relay_navigate", "relay_open_tab").',
      },
      target: {
        type: 'string',
        description: 'Element selector, Chrome tool name, or scroll direction. For click/type/wait: visible text, placeholder, label, or CSS selector. For chrome_call: Chrome MCP tool name. For relay_scroll: direction (up/down/left/right/top/bottom).',
      },
      text: {
        type: 'string',
        description: 'Text to type (for "type", "relay_type").',
      },
      code: {
        type: 'string',
        description: 'JavaScript code to run (for "evaluate", "relay_evaluate").',
      },
      port: {
        type: 'number',
        description: 'Chrome remote debugging port (for "connect_native", default 9222).',
      },
      args: {
        type: 'string',
        description: 'JSON-encoded arguments for Chrome MCP tool (for "chrome_call").',
      },
      tab_id: {
        type: 'number',
        description: 'Chrome tab ID for relay commands (relay_navigate, relay_click, relay_type, relay_scrape, relay_screenshot, relay_switch_tab, relay_close_tab).',
      },
    },
    required: ['action'],
  },
  run: async ({ action, url, target, text, code, port, args, tab_id }: {
    action: string;
    url?: string;
    target?: string;
    text?: string;
    code?: string;
    port?: number;
    args?: string;
    tab_id?: number;
  }, meta: SkillMeta) => {
    let release: (() => void) | undefined;
    try {
      release = await skillLock.acquireExclusive('browser_vision', {
        agentId: meta.agentId, conversationId: meta.conversationId,
        conversationLabel: meta.conversationLabel,
        operation: `browser:${action}`, acquiredAt: new Date(),
      });

      // FIX-AI: Use org-specific browser profile when in org context
      if (meta.orgId) {
        const orgBrowserDir = orgManager.getBrowserDataDir(meta.orgId);
        await browserManager.ensureProfileDir(orgBrowserDir);
      }

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

        // ── Extension Relay Actions ─────────────────────────────────

        case 'relay_tabs': {
          if (!extensionRelay.connected) return { success: false, error: 'Extension not connected. Install the PersonalClaw Relay extension in Chrome.' };
          const tabs = await extensionRelay.listTabs();
          return { success: true, data: { tabs } };
        }

        case 'relay_navigate': {
          if (!extensionRelay.connected) return { success: false, error: 'Extension not connected.' };
          if (!url) return { success: false, error: 'URL is required for relay_navigate.' };
          const result = await extensionRelay.navigate(url, tab_id);
          return { success: true, data: result };
        }

        case 'relay_click': {
          if (!extensionRelay.connected) return { success: false, error: 'Extension not connected.' };
          if (!target) return { success: false, error: 'Target is required for relay_click.' };
          const result = await extensionRelay.click(target, tab_id);
          return { success: true, data: result };
        }

        case 'relay_type': {
          if (!extensionRelay.connected) return { success: false, error: 'Extension not connected.' };
          if (!target) return { success: false, error: 'Target is required for relay_type.' };
          if (!text) return { success: false, error: 'Text is required for relay_type.' };
          const result = await extensionRelay.type(target, text, tab_id);
          return { success: true, data: result };
        }

        case 'relay_scrape': {
          if (!extensionRelay.connected) return { success: false, error: 'Extension not connected.' };
          const result = await extensionRelay.scrape(tab_id);
          return { success: true, data: result };
        }

        case 'relay_screenshot': {
          if (!extensionRelay.connected) return { success: false, error: 'Extension not connected.' };
          const result = await extensionRelay.screenshot(tab_id);
          // Save the base64 screenshot to file
          if (result?.dataUrl) {
            const fs = await import('fs');
            const path = await import('path');
            const dir = path.join(process.cwd(), 'screenshots');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const filename = `relay_${Date.now()}.png`;
            const filePath = path.join(dir, filename);
            const base64 = result.dataUrl.replace(/^data:image\/png;base64,/, '');
            fs.writeFileSync(filePath, base64, 'base64');
            return { success: true, message: `Screenshot saved to: ${filePath}`, path: filePath };
          }
          return { success: true, data: result };
        }

        case 'relay_switch_tab': {
          if (!extensionRelay.connected) return { success: false, error: 'Extension not connected.' };
          if (!tab_id) return { success: false, error: 'tab_id is required for relay_switch_tab.' };
          const result = await extensionRelay.switchTab(tab_id);
          return { success: true, data: result };
        }

        case 'relay_open_tab': {
          if (!extensionRelay.connected) return { success: false, error: 'Extension not connected.' };
          const result = await extensionRelay.openTab(url);
          return { success: true, data: result };
        }

        case 'relay_close_tab': {
          if (!extensionRelay.connected) return { success: false, error: 'Extension not connected.' };
          if (!tab_id) return { success: false, error: 'tab_id is required for relay_close_tab.' };
          const result = await extensionRelay.closeTab(tab_id);
          return { success: true, data: result };
        }

        case 'relay_evaluate': {
          if (!extensionRelay.connected) return { success: false, error: 'Extension not connected.' };
          if (!code) return { success: false, error: 'Code is required for relay_evaluate.' };
          const result = await extensionRelay.evaluate(code, tab_id);
          return { success: true, data: result };
        }

        case 'relay_scroll': {
          if (!extensionRelay.connected) return { success: false, error: 'Extension not connected.' };
          const direction = target || 'down';
          const result = await extensionRelay.scroll(direction, undefined, tab_id);
          return { success: true, data: result };
        }

        case 'relay_elements': {
          if (!extensionRelay.connected) return { success: false, error: 'Extension not connected.' };
          const result = await extensionRelay.getElements(target, tab_id);
          return { success: true, data: result };
        }

        // ── Standard Browser Actions (Playwright/native Chrome) ─────

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
    } finally {
      release?.();
    }
  },
};
