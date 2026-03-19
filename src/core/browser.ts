import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { ChromeNativeAdapter, chromeNativeAdapter } from './chrome-mcp.js';
import { extensionRelay } from './relay.js';

const PROFILE_DIR = path.join(process.cwd(), 'browser_data', 'PersonalClaw_Profile');
const SCREENSHOTS_DIR = path.join(process.cwd(), 'screenshots');

/**
 * BrowserManager — Single, persistent Playwright browser for PersonalClaw.
 * 
 * One browser instance. One context. One active page.
 * All browser skills route through here.
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private initializing: Promise<void> | null = null;
  private currentProfileDir: string = PROFILE_DIR;

  /**
   * Get the active page.
   *
   * Priority:
   *   1. Native Chrome via CDP (real user session — preferred when connected)
   *   2. Playwright-managed Chromium (persistent profile, fallback / default)
   */
  async getPage(): Promise<Page> {
    // 1. Prefer real Chrome via CDP when connected
    if (chromeNativeAdapter.getMode() === 'cdp') {
      const nativePage = await chromeNativeAdapter.getActivePage();
      if (nativePage && !nativePage.isClosed()) {
        return nativePage;
      }
      // CDP page gone — fall through to Playwright
    }

    // 2. Playwright managed instance
    if (this.initializing) {
      await this.initializing;
    }

    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    this.initializing = this.launch();
    await this.initializing;
    this.initializing = null;

    return this.page!;
  }

  private async launch(): Promise<void> {
    // Clean up any existing state
    await this.cleanup();

    console.log('[Browser] Launching Chromium with persistent profile...');

    // Ensure profile directory exists
    if (!fs.existsSync(this.currentProfileDir)) {
      fs.mkdirSync(this.currentProfileDir, { recursive: true });
    }

    // Use launchPersistentContext for login persistence across sessions
    this.context = await chromium.launchPersistentContext(this.currentProfileDir, {
      headless: false,
      viewport: null,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--start-maximized',
      ],
    });

    // Use the first page or create one
    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

    // Handle page close — get a new page if available or set null
    this.page.on('close', () => {
      const pages = this.context?.pages() || [];
      this.page = pages.length > 0 ? pages[0] : null;
    });

    console.log('[Browser] Ready.');
  }

  /**
   * Navigate to a URL.
   */
  async navigate(url: string): Promise<string> {
    const page = await this.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return `Navigated to ${url} — Title: "${await page.title()}"`;
  }

  /**
   * Click an element by text content or CSS selector.
   */
  async click(target: string): Promise<string> {
    const page = await this.getPage();

    // Try text-based matching first (most intuitive for AI)
    try {
      const textLocator = page.getByText(target, { exact: false }).first();
      if (await textLocator.isVisible({ timeout: 3000 })) {
        await textLocator.click();
        return `Clicked element with text "${target}"`;
      }
    } catch { /* fall through to selector */ }

    // Try role-based matching
    try {
      const roleLocator = page.getByRole('button', { name: target }).or(
        page.getByRole('link', { name: target })
      ).or(
        page.getByRole('tab', { name: target })
      ).or(
        page.getByRole('menuitem', { name: target })
      ).first();
      if (await roleLocator.isVisible({ timeout: 2000 })) {
        await roleLocator.click();
        return `Clicked role element "${target}"`;
      }
    } catch { /* fall through to selector */ }

    // Fall back to CSS selector
    try {
      await page.click(target, { timeout: 5000 });
      return `Clicked element matching selector "${target}"`;
    } catch (e: any) {
      throw new Error(`Could not find clickable element "${target}": ${e.message}`);
    }
  }

  /**
   * Type text into an element.
   */
  async type(target: string, text: string): Promise<string> {
    const page = await this.getPage();

    // Try placeholder text first
    try {
      const placeholder = page.getByPlaceholder(target, { exact: false }).first();
      if (await placeholder.isVisible({ timeout: 2000 })) {
        await placeholder.fill(text);
        return `Typed "${text}" into field with placeholder "${target}"`;
      }
    } catch { /* fall through */ }

    // Try label
    try {
      const label = page.getByLabel(target, { exact: false }).first();
      if (await label.isVisible({ timeout: 2000 })) {
        await label.fill(text);
        return `Typed "${text}" into field labeled "${target}"`;
      }
    } catch { /* fall through */ }

    // Fall back to CSS selector
    try {
      await page.fill(target, text, { timeout: 5000 });
      return `Typed "${text}" into "${target}"`;
    } catch (e: any) {
      throw new Error(`Could not find input "${target}": ${e.message}`);
    }
  }

  /**
   * Scrape visible text from the current page (cheap, fast).
   */
  async scrape(): Promise<{ title: string; url: string; text: string }> {
    const page = await this.getPage();

    const title = await page.title();
    const url = page.url();

    // Extract meaningful text content, similar to the old relay scraper
    const text = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      const forbidden = clone.querySelectorAll('script, style, nav, footer, iframe, svg, [aria-hidden="true"], noscript');
      forbidden.forEach(el => el.remove());

      const blocks = clone.querySelectorAll('div, p, h1, h2, h3, h4, h5, h6, tr, li, td, th, section, article, main');
      blocks.forEach(el => {
        const nl = document.createTextNode('\n');
        el.parentNode?.insertBefore(nl, el);
      });

      return clone.innerText
        .replace(/\n\s*\n/g, '\n')
        .replace(/\t+/g, ' ')
        .substring(0, 15000);
    });

    return { title, url, text };
  }

  /**
   * Take a screenshot and return the file path.
   */
  async screenshot(): Promise<string> {
    const page = await this.getPage();

    if (!fs.existsSync(SCREENSHOTS_DIR)) {
      fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }

    const filename = `screenshot_${Date.now()}.png`;
    const filePath = path.join(SCREENSHOTS_DIR, filename);
    await page.screenshot({ path: filePath, fullPage: false });

    return filePath;
  }

  /**
   * Run raw JavaScript on the page and return the result.
   */
  async evaluate(code: string): Promise<any> {
    const page = await this.getPage();
    return await page.evaluate(code);
  }

  /**
   * Go back in browser history.
   */
  async back(): Promise<string> {
    const page = await this.getPage();
    await page.goBack({ waitUntil: 'domcontentloaded' });
    return `Went back — now on: "${await page.title()}" (${page.url()})`;
  }

  /**
   * Wait for an element to appear.
   */
  async waitFor(selector: string, timeout: number = 10000): Promise<string> {
    const page = await this.getPage();
    await page.waitForSelector(selector, { timeout });
    return `Element "${selector}" appeared.`;
  }

  /**
   * Get current page info.
   */
  async pageInfo(): Promise<{ title: string; url: string }> {
    const page = await this.getPage();
    return {
      title: await page.title(),
      url: page.url(),
    };
  }

  /**
   * Close the browser entirely.
   */
  async ensureProfileDir(profileDir: string): Promise<void> {
    if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
    // Only switch profile if different from current
    if (this.currentProfileDir !== profileDir) {
      await this.close(); // close current browser
      this.currentProfileDir = profileDir;
      // Browser will relaunch with new profile on next getPage() call
    }
  }

  async close(): Promise<string> {
    await this.cleanup();
    return 'Browser closed.';
  }

  // ─── Native Chrome Integration (Chrome 146+) ───────────────────────

  /**
   * Connect to the user's already-running Chrome session.
   *
   * Tries Chrome 146+ native MCP first, then CDP fallback.
   * Once connected, all browser skill actions operate on the real Chrome.
   *
   * @param port  Chrome remote debugging port (default 9222)
   */
  async connectNative(port = 9222): Promise<string> {
    const result = await chromeNativeAdapter.connect(port);
    return result.message;
  }

  /**
   * Disconnect from native Chrome and revert to Playwright-managed mode.
   */
  async disconnectNative(): Promise<string> {
    await chromeNativeAdapter.disconnect();
    return 'Disconnected from native Chrome. Back to Playwright-managed mode.';
  }

  /**
   * Report the current browser mode and Chrome/extension availability.
   */
  async getStatus(): Promise<{
    mode: string;
    port?: number;
    chromeAvailable?: { available: boolean; tabs: number; version: string };
    extensionRelay?: { connected: boolean; tabs: number };
  }> {
    const nativeMode = chromeNativeAdapter.getMode();
    const relayStatus = extensionRelay.getStatus();

    if (nativeMode !== 'disconnected') {
      return { mode: nativeMode, port: chromeNativeAdapter.getPort(), extensionRelay: relayStatus };
    }

    if (relayStatus.connected) {
      return { mode: 'extension-relay', extensionRelay: relayStatus };
    }

    const chromeAvailable = await ChromeNativeAdapter.probe();
    return { mode: 'playwright-managed', chromeAvailable, extensionRelay: relayStatus };
  }

  private async cleanup() {
    try {
      if (this.context) {
        await this.context.close();
      }
    } catch (e) {
      // Ignore close errors
    }
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}

// Singleton instance
export const browserManager = new BrowserManager();
