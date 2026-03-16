/**
 * PersonalClaw Relay — Popup Script
 * Shows connection status and allows host configuration.
 */

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const hostDisplay = document.getElementById('hostDisplay');
const hostInput = document.getElementById('hostInput');
const connectBtn = document.getElementById('connectBtn');
const reconnectBtn = document.getElementById('reconnectBtn');

function updateUI(status) {
  if (status.connected) {
    statusDot.className = 'status-dot connected';
    statusText.textContent = 'Connected';
  } else {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'Disconnected';
  }
  hostDisplay.textContent = status.host || '—';
  hostInput.value = status.host || 'ws://127.0.0.1:3000/relay';
}

// Load current status
chrome.runtime.sendMessage({ type: 'get_status' }, (response) => {
  if (response) updateUI(response);
});

// Connect with new host
connectBtn.addEventListener('click', () => {
  const host = hostInput.value.trim();
  if (!host) return;
  chrome.runtime.sendMessage({ type: 'set_host', host }, () => {
    // Refresh status after a brief delay
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'get_status' }, (response) => {
        if (response) updateUI(response);
      });
    }, 1000);
  });
});

// Reconnect
reconnectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'reconnect' }, () => {
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'get_status' }, (response) => {
        if (response) updateUI(response);
      });
    }, 1000);
  });
});
