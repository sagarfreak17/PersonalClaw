/**
 * PersonalClaw Browser Relay — Background Service Worker (MV3)
 *
 * Maintains a WebSocket connection to the PersonalClaw backend relay server.
 * Receives commands (navigate, click, type, scrape, screenshot, etc.) and
 * dispatches them to the active tab via content scripts or Chrome APIs.
 */

// ─── Configuration ──────────────────────────────────────────────────
const DEFAULT_HOST = 'ws://127.0.0.1:3000/relay';
const RECONNECT_DELAY = 5000;
const HEARTBEAT_INTERVAL = 20000;

let ws = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let connected = false;
let relayHost = DEFAULT_HOST;

// ─── Storage: Load saved host (migrate old URLs) ────────────────────
chrome.storage.local.get(['relayHost'], (result) => {
  if (result.relayHost) {
    // Migrate old port-3001 URLs to new path-based URL
    if (result.relayHost.includes(':3001')) {
      relayHost = DEFAULT_HOST;
      chrome.storage.local.set({ relayHost: DEFAULT_HOST });
    } else {
      relayHost = result.relayHost;
    }
  }
  connect();
});

// ─── WebSocket Connection ───────────────────────────────────────────
function connect() {
  cleanup();

  try {
    ws = new WebSocket(relayHost);
  } catch (e) {
    console.error('[Relay] WebSocket creation failed:', e);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[Relay] Connected to PersonalClaw backend');
    connected = true;
    updateBadge('ON', '#4CAF50');

    // Register with backend — send initial tab list
    sendTabList();

    // Start heartbeat
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
      }
    }, HEARTBEAT_INTERVAL);
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      await handleCommand(msg);
    } catch (e) {
      console.error('[Relay] Failed to parse message:', e);
    }
  };

  ws.onclose = () => {
    console.log('[Relay] Disconnected');
    connected = false;
    updateBadge('OFF', '#F44336');
    cleanup();
    scheduleReconnect();
  };

  ws.onerror = (e) => {
    console.error('[Relay] WebSocket error:', e);
  };
}

function cleanup() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    console.log('[Relay] Attempting reconnect...');
    connect();
  }, RECONNECT_DELAY);
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function updateBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// ─── Tab Management ─────────────────────────────────────────────────
async function getTabList() {
  const tabs = await chrome.tabs.query({});
  return tabs.map(t => ({
    id: t.id,
    url: t.url || '',
    title: t.title || '',
    active: t.active,
    windowId: t.windowId,
  }));
}

async function sendTabList() {
  const tabs = await getTabList();
  send({ type: 'tabs_update', tabs });
}

// Listen for tab changes
chrome.tabs.onUpdated.addListener(() => { if (connected) sendTabList(); });
chrome.tabs.onRemoved.addListener(() => { if (connected) sendTabList(); });
chrome.tabs.onActivated.addListener(() => { if (connected) sendTabList(); });

// ─── Command Router ─────────────────────────────────────────────────
async function handleCommand(msg) {
  const { id, command, params } = msg;
  if (!command) return;

  console.log(`[Relay] Command: ${command}`, params);

  try {
    let result;
    switch (command) {
      case 'list_tabs':
        result = await getTabList();
        break;

      case 'navigate':
        result = await cmdNavigate(params);
        break;

      case 'switch_tab':
        result = await cmdSwitchTab(params);
        break;

      case 'open_tab':
        result = await cmdOpenTab(params);
        break;

      case 'close_tab':
        result = await cmdCloseTab(params);
        break;

      case 'click':
      case 'type':
      case 'scrape':
      case 'scroll':
      case 'select':
      case 'evaluate':
      case 'get_elements':
      case 'highlight':
        result = await cmdContentScript(command, params);
        break;

      case 'screenshot':
        result = await cmdScreenshot(params);
        break;

      default:
        result = { error: `Unknown command: ${command}` };
    }

    send({ type: 'command_result', id, success: !result?.error, data: result });
  } catch (e) {
    console.error(`[Relay] Command "${command}" failed:`, e);
    send({ type: 'command_result', id, success: false, data: { error: e.message } });
  }
}

// ─── Command Implementations ────────────────────────────────────────

async function cmdNavigate({ url, tabId }) {
  const target = tabId || (await getActiveTabId());
  if (!target) return { error: 'No active tab' };
  await chrome.tabs.update(target, { url });
  // Wait for load
  await new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === target && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
  });
  const tab = await chrome.tabs.get(target);
  return { title: tab.title, url: tab.url };
}

async function cmdSwitchTab({ tabId }) {
  if (!tabId) return { error: 'tabId required' };
  await chrome.tabs.update(tabId, { active: true });
  const tab = await chrome.tabs.get(tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
  return { title: tab.title, url: tab.url };
}

async function cmdOpenTab({ url }) {
  const tab = await chrome.tabs.create({ url: url || 'about:blank', active: true });
  return { tabId: tab.id, url: tab.url };
}

async function cmdCloseTab({ tabId }) {
  if (!tabId) return { error: 'tabId required' };
  await chrome.tabs.remove(tabId);
  return { closed: true };
}

async function cmdScreenshot({ tabId }) {
  const target = tabId || (await getActiveTabId());
  if (!target) return { error: 'No active tab' };
  const tab = await chrome.tabs.get(target);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return { dataUrl, tabId: target };
}

async function cmdContentScript(command, params) {
  const tabId = params?.tabId || (await getActiveTabId());
  if (!tabId) return { error: 'No active tab' };

  // Inject content script if not already present
  try {
    const response = await chrome.tabs.sendMessage(tabId, { command, params });
    return response;
  } catch {
    // Content script not loaded — inject it
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    // Retry
    const response = await chrome.tabs.sendMessage(tabId, { command, params });
    return response;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id || null;
}

// ─── Message from popup ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'get_status') {
    sendResponse({ connected, host: relayHost });
    return;
  }
  if (msg.type === 'set_host') {
    relayHost = msg.host || DEFAULT_HOST;
    chrome.storage.local.set({ relayHost });
    connect();
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'reconnect') {
    connect();
    sendResponse({ ok: true });
    return;
  }
});
