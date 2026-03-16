/**
 * PersonalClaw Extension Relay — WebSocket server for browser extension communication.
 *
 * The relay bridges the Chrome extension and the PersonalClaw brain/skills.
 * Attaches to the main HTTP server at path /relay (same port as the main server).
 * Extension connects via WebSocket to ws://127.0.0.1:3000/relay.
 *
 *   Brain/Skill → Relay.executeCommand() → WebSocket → Extension → DOM result
 *   Extension → WebSocket → Relay → tab updates, command results
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HTTPServer } from 'http';
import { eventBus, Events } from './events.js';

export interface RelayTab {
  id: number;
  url: string;
  title: string;
  active: boolean;
  windowId: number;
}

interface PendingCommand {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ExtensionRelay {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private tabs: RelayTab[] = [];
  private pending: Map<string, PendingCommand> = new Map();
  private commandId = 0;
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  get currentTabs(): RelayTab[] {
    return this.tabs;
  }

  /**
   * Attach the relay WebSocket to an existing HTTP server at path /relay.
   */
  attach(server: HTTPServer): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({ server, path: '/relay' });
    console.log('[Relay] WebSocket relay attached at /relay');

    this.wss.on('connection', (ws) => {
      console.log('[Relay] Extension connected');
      this._connected = true;
      this.client = ws;

      eventBus.dispatch('relay:extension_connected', {}, 'relay');

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (e) {
          console.error('[Relay] Failed to parse extension message:', e);
        }
      });

      ws.on('close', () => {
        console.log('[Relay] Extension disconnected');
        this._connected = false;
        this.client = null;
        this.tabs = [];

        // Reject all pending commands
        for (const [id, cmd] of this.pending) {
          cmd.reject(new Error('Extension disconnected'));
          clearTimeout(cmd.timer);
        }
        this.pending.clear();

        eventBus.dispatch('relay:extension_disconnected', {}, 'relay');
      });

      ws.on('error', (err) => {
        console.error('[Relay] WebSocket error:', err.message);
      });
    });

    this.wss.on('error', (err) => {
      console.error('[Relay] Server error:', err.message);
    });
  }

  /**
   * Stop the relay server.
   */
  stop(): void {
    if (this.client) {
      try { this.client.close(); } catch {}
      this.client = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this._connected = false;
    this.tabs = [];
    console.log('[Relay] Server stopped');
  }

  /**
   * Send a command to the extension and wait for the result.
   */
  async executeCommand(command: string, params: any = {}, timeoutMs = 30000): Promise<any> {
    if (!this.client || this.client.readyState !== WebSocket.OPEN) {
      throw new Error('Extension not connected. Install and enable the PersonalClaw Relay extension in Chrome.');
    }

    const id = `cmd_${++this.commandId}_${Date.now()}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Command "${command}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      this.client!.send(JSON.stringify({ id, command, params }));
    });
  }

  // ─── Convenience Methods ────────────────────────────────────────

  async listTabs(): Promise<RelayTab[]> {
    const result = await this.executeCommand('list_tabs');
    return result || this.tabs;
  }

  async navigate(url: string, tabId?: number): Promise<any> {
    return this.executeCommand('navigate', { url, tabId });
  }

  async click(target: string, tabId?: number): Promise<any> {
    return this.executeCommand('click', { target, tabId });
  }

  async type(target: string, text: string, tabId?: number): Promise<any> {
    return this.executeCommand('type', { target, text, tabId });
  }

  async scrape(tabId?: number, maxLength?: number): Promise<any> {
    return this.executeCommand('scrape', { tabId, maxLength });
  }

  async screenshot(tabId?: number): Promise<any> {
    return this.executeCommand('screenshot', { tabId });
  }

  async switchTab(tabId: number): Promise<any> {
    return this.executeCommand('switch_tab', { tabId });
  }

  async openTab(url?: string): Promise<any> {
    return this.executeCommand('open_tab', { url });
  }

  async closeTab(tabId: number): Promise<any> {
    return this.executeCommand('close_tab', { tabId });
  }

  async evaluate(code: string, tabId?: number): Promise<any> {
    return this.executeCommand('evaluate', { code, tabId });
  }

  async scroll(direction: string, amount?: number, tabId?: number): Promise<any> {
    return this.executeCommand('scroll', { direction, amount, tabId });
  }

  async getElements(selector?: string, tabId?: number): Promise<any> {
    return this.executeCommand('get_elements', { selector, tabId });
  }

  async highlight(target: string, color?: string, tabId?: number): Promise<any> {
    return this.executeCommand('highlight', { target, color, tabId });
  }

  /**
   * Get relay status info.
   */
  getStatus(): { connected: boolean; tabs: number; tabList: RelayTab[] } {
    return {
      connected: this._connected,
      tabs: this.tabs.length,
      tabList: this.tabs,
    };
  }

  // ─── Internal Message Handler ───────────────────────────────────

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'tabs_update':
        this.tabs = msg.tabs || [];
        eventBus.dispatch('relay:tabs_update', { count: this.tabs.length }, 'relay');
        break;

      case 'command_result': {
        const pending = this.pending.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(msg.id);
          if (msg.success) {
            pending.resolve(msg.data);
          } else {
            pending.reject(new Error(msg.data?.error || 'Command failed'));
          }
        }
        break;
      }

      case 'heartbeat':
        // Extension is alive
        break;

      default:
        console.log('[Relay] Unknown message type:', msg.type);
    }
  }
}

// Singleton
export const extensionRelay = new ExtensionRelay();
