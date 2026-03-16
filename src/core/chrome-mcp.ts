import { chromium, Browser, Page } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import * as http from 'http';

export type NativeChromeMode = 'chrome-mcp' | 'cdp' | 'disconnected';

/**
 * ChromeNativeAdapter — connects PersonalClaw to the user's already-running Chrome session.
 *
 * Two connection modes (auto-selected, best wins):
 *
 *   1. chrome-mcp (Chrome 146+)
 *      Chrome's built-in DevTools MCP server via SSE transport.
 *      Requires: chrome://inspect/#remote-debugging → enable "Listen on localhost:<port>".
 *      Exposes Chrome's own MCP tools directly to the brain.
 *
 *   2. cdp (any Chrome with remote debugging)
 *      Playwright connectOverCDP — full Playwright API on the real session.
 *      Requires: Chrome launched with --remote-debugging-port=<port>.
 *      All existing browser skill actions work transparently.
 *
 * Prerequisites for either mode:
 *   - Launch Chrome: chrome.exe --remote-debugging-port=9222 --user-data-dir=<some-dir>
 *   - OR: open chrome://inspect/#remote-debugging and enable listening on localhost:9222
 */
export class ChromeNativeAdapter {
  private mode: NativeChromeMode = 'disconnected';
  private port = 9222;

  // Chrome MCP mode
  private mcpClient: Client | null = null;
  private mcpTools: any[] = [];

  // CDP mode
  private cdpBrowser: Browser | null = null;

  // ─── Public API ────────────────────────────────────────────────────

  getMode(): NativeChromeMode {
    return this.mode;
  }

  isConnected(): boolean {
    return this.mode !== 'disconnected';
  }

  getPort(): number {
    return this.port;
  }

  /**
   * Connect to the user's running Chrome. Tries Chrome MCP first, then CDP.
   */
  async connect(port = 9222): Promise<{ success: boolean; mode: NativeChromeMode; message: string }> {
    await this.disconnect();
    this.port = port;

    // 1. Try Chrome 146+ native MCP server via SSE
    const mcpOk = await this._tryChromeMCP(port);
    if (mcpOk) {
      this.mode = 'chrome-mcp';
      return {
        success: true,
        mode: 'chrome-mcp',
        message: `Connected via Chrome native MCP (port ${port}). ${this.mcpTools.length} Chrome tools available. All browser skill actions now operate on your real Chrome session.`,
      };
    }

    // 2. Fall back to CDP — works with any Chrome that has remote debugging enabled
    const cdpOk = await this._tryChromeCDP(port);
    if (cdpOk) {
      this.mode = 'cdp';
      const page = await this.getActivePage();
      const pageInfo = page ? ` Current tab: ${page.url()}` : '';
      return {
        success: true,
        mode: 'cdp',
        message: `Connected via CDP to your real Chrome (port ${port}).${pageInfo} All browser skill actions now operate on your real Chrome session.`,
      };
    }

    return {
      success: false,
      mode: 'disconnected',
      message:
        `Could not connect to Chrome on port ${port}.\n\n` +
        `To enable:\n` +
        `  • Launch Chrome with: --remote-debugging-port=${port}\n` +
        `  • OR open chrome://inspect/#remote-debugging and enable "Discover network targets" on localhost:${port}\n` +
        `  • Chrome 146+: also enables native MCP server automatically`,
    };
  }

  /**
   * Disconnect and revert to Playwright-managed mode.
   */
  async disconnect(): Promise<void> {
    const wasConnected = this.mode !== 'disconnected';

    try { await this.mcpClient?.close(); } catch { /* ignore */ }
    try { if (this.cdpBrowser) await this.cdpBrowser.close(); } catch { /* ignore */ }

    this.mcpClient = null;
    this.mcpTools = [];
    this.cdpBrowser = null;
    this.mode = 'disconnected';

    if (wasConnected) {
      console.log('[ChromeNative] Disconnected. Reverted to Playwright.');
    }
  }

  /**
   * Get the currently active page from real Chrome (CDP mode only).
   * Returns null when in chrome-mcp mode or disconnected.
   */
  async getActivePage(): Promise<Page | null> {
    if (this.mode !== 'cdp' || !this.cdpBrowser) return null;
    try {
      const contexts = this.cdpBrowser.contexts();
      const pages = contexts.flatMap(c => c.pages());
      return pages[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * Call a Chrome native MCP tool by name (chrome-mcp mode only).
   */
  async callMCPTool(name: string, args: any): Promise<any> {
    if (!this.mcpClient) throw new Error('Chrome native MCP is not connected.');
    const result = await this.mcpClient.callTool({ name, arguments: args });
    return result.content || result;
  }

  /**
   * List available Chrome MCP tool names (chrome-mcp mode only).
   */
  getMCPToolNames(): string[] {
    return this.mcpTools.map(t => t.name);
  }

  /**
   * Get Chrome MCP tool definitions in Gemini function-declaration format.
   * Tools are prefixed with "chrome_" to avoid name collisions.
   */
  getGeminiToolDefs(): any[] {
    return this.mcpTools.map(tool => ({
      functionDeclarations: [{
        name: `chrome_${tool.name}`,
        description: `[Chrome Native] ${tool.description ?? tool.name}`,
        parameters: this._sanitizeSchema(tool.inputSchema),
      }],
    }));
  }

  /**
   * Returns true if the given Gemini tool name belongs to Chrome native MCP.
   */
  isChromeMCPTool(name: string): boolean {
    return (
      this.mode === 'chrome-mcp' &&
      name.startsWith('chrome_') &&
      this.mcpTools.some(t => `chrome_${t.name}` === name)
    );
  }

  /**
   * Execute a chrome_ prefixed tool call (strips prefix, calls Chrome MCP).
   */
  async executeChromeTool(prefixedName: string, args: any): Promise<any> {
    const originalName = prefixedName.replace(/^chrome_/, '');
    return this.callMCPTool(originalName, args);
  }

  // ─── Static Helpers ────────────────────────────────────────────────

  /**
   * Probe Chrome without connecting — returns availability + tab count + version string.
   */
  static async probe(port = 9222): Promise<{ available: boolean; tabs: number; version: string }> {
    return new Promise(resolve => {
      const req = http.get(`http://localhost:${port}/json/version`, res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try {
            const ver = JSON.parse(raw);
            http.get(`http://localhost:${port}/json`, res2 => {
              let tabs = '';
              res2.on('data', c => tabs += c);
              res2.on('end', () => {
                try {
                  resolve({ available: true, tabs: JSON.parse(tabs).length, version: ver.Browser ?? '' });
                } catch {
                  resolve({ available: true, tabs: 0, version: ver.Browser ?? '' });
                }
              });
            }).on('error', () => resolve({ available: true, tabs: 0, version: ver.Browser ?? '' }));
          } catch {
            resolve({ available: false, tabs: 0, version: '' });
          }
        });
      });
      req.on('error', () => resolve({ available: false, tabs: 0, version: '' }));
      req.setTimeout(2000, () => { req.destroy(); resolve({ available: false, tabs: 0, version: '' }); });
    });
  }

  // ─── Private Connection Attempts ───────────────────────────────────

  private async _tryChromeMCP(port: number): Promise<boolean> {
    try {
      const transport = new SSEClientTransport(new URL(`http://localhost:${port}`));
      const client = new Client({ name: 'PersonalClaw', version: '10.0.0' }, { capabilities: {} });

      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);

      const { tools } = await client.listTools();
      this.mcpClient = client;
      this.mcpTools = tools;
      console.log(`[ChromeNative] Chrome MCP connected (port ${port}). Tools: ${tools.map(t => t.name).join(', ')}`);
      return true;
    } catch {
      return false;
    }
  }

  private async _tryChromeCDP(port: number): Promise<boolean> {
    try {
      const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
      this.cdpBrowser = browser;
      console.log(`[ChromeNative] CDP connected (port ${port})`);
      return true;
    } catch {
      return false;
    }
  }

  private _sanitizeSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;
    const res: any = Array.isArray(schema) ? [] : {};
    for (const key in schema) {
      if (key === '$schema' || key === 'additionalProperties') continue;
      const val = schema[key];
      res[key] = typeof val === 'object' && val !== null ? this._sanitizeSchema(val) : val;
    }
    if (res.properties && !res.type) res.type = 'object';
    return res;
  }
}

export const chromeNativeAdapter = new ChromeNativeAdapter();
