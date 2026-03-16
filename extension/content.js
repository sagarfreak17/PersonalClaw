/**
 * PersonalClaw Browser Relay — Content Script
 *
 * Injected into every page. Handles DOM interaction commands from the
 * background service worker: click, type, scrape, scroll, evaluate,
 * get_elements, highlight, select.
 */

(() => {
  // Prevent double-injection
  if (window.__personalClawRelay) return;
  window.__personalClawRelay = true;

  // ─── Visual Indicator ───────────────────────────────────────────
  const indicator = document.createElement('div');
  indicator.id = 'personalclaw-indicator';
  indicator.style.cssText = `
    position: fixed; bottom: 8px; right: 8px; z-index: 2147483647;
    padding: 4px 10px; border-radius: 12px;
    background: rgba(76, 175, 80, 0.9); color: white;
    font: 11px/1.4 -apple-system, sans-serif;
    pointer-events: none; opacity: 0.7;
    transition: opacity 0.3s;
  `;
  indicator.textContent = 'PersonalClaw Relay';
  document.body?.appendChild(indicator);

  // Auto-hide after 3 seconds
  setTimeout(() => { indicator.style.opacity = '0'; }, 3000);

  // ─── Command Handler ────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const { command, params } = msg;
    if (!command) return;

    (async () => {
      try {
        let result;
        switch (command) {
          case 'click':
            result = await handleClick(params);
            break;
          case 'type':
            result = await handleType(params);
            break;
          case 'scrape':
            result = handleScrape(params);
            break;
          case 'scroll':
            result = handleScroll(params);
            break;
          case 'evaluate':
            result = await handleEvaluate(params);
            break;
          case 'get_elements':
            result = handleGetElements(params);
            break;
          case 'highlight':
            result = handleHighlight(params);
            break;
          case 'select':
            result = await handleSelect(params);
            break;
          default:
            result = { error: `Unknown content command: ${command}` };
        }
        sendResponse(result);
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();

    return true; // Keep channel open for async response
  });

  // ─── Click ──────────────────────────────────────────────────────
  async function handleClick({ target, index }) {
    const el = findElement(target, index);
    if (!el) return { error: `Element not found: "${target}"` };

    flashHighlight(el);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await sleep(200);

    el.click();
    return { clicked: true, tag: el.tagName, text: el.textContent?.substring(0, 80) };
  }

  // ─── Type ───────────────────────────────────────────────────────
  async function handleType({ target, text, clear, index }) {
    const el = findElement(target, index);
    if (!el) return { error: `Input not found: "${target}"` };

    flashHighlight(el);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus();

    if (clear !== false) {
      // Clear existing value
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Type character by character for realistic input
    for (const char of text) {
      el.value += char;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
      await sleep(20 + Math.random() * 30);
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { typed: true, field: el.name || el.id || el.placeholder || el.tagName, length: text.length };
  }

  // ─── Scrape ─────────────────────────────────────────────────────
  function handleScrape({ maxLength }) {
    const limit = maxLength || 15000;

    // Clone body and strip non-content elements
    const clone = document.body.cloneNode(true);
    const remove = clone.querySelectorAll(
      'script, style, nav, footer, iframe, svg, noscript, [aria-hidden="true"], .ad, .advertisement'
    );
    remove.forEach(el => el.remove());

    // Add line breaks before block elements
    const blocks = clone.querySelectorAll('div, p, h1, h2, h3, h4, h5, h6, tr, li, td, th, section, article, main, blockquote, pre');
    blocks.forEach(el => {
      const nl = document.createTextNode('\n');
      el.parentNode?.insertBefore(nl, el);
    });

    const text = clone.innerText
      .replace(/\n\s*\n/g, '\n')
      .replace(/\t+/g, ' ')
      .trim()
      .substring(0, limit);

    // Extract links
    const links = [...document.querySelectorAll('a[href]')]
      .slice(0, 50)
      .map(a => ({ text: a.textContent?.trim().substring(0, 60), href: a.href }))
      .filter(l => l.text && l.href);

    // Extract forms
    const forms = [...document.querySelectorAll('input, textarea, select')]
      .slice(0, 30)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        name: el.name || '',
        id: el.id || '',
        placeholder: el.placeholder || '',
        value: el.type === 'password' ? '***' : (el.value || '').substring(0, 50),
      }));

    return {
      title: document.title,
      url: window.location.href,
      text,
      links,
      forms,
      meta: {
        description: document.querySelector('meta[name="description"]')?.content || '',
        viewport: `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`,
      },
    };
  }

  // ─── Scroll ─────────────────────────────────────────────────────
  function handleScroll({ direction, amount }) {
    const px = amount || 500;
    const map = {
      down: [0, px],
      up: [0, -px],
      left: [-px, 0],
      right: [px, 0],
      top: null,
      bottom: null,
    };

    if (direction === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (direction === 'bottom') {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } else {
      const [x, y] = map[direction] || [0, px];
      window.scrollBy({ left: x, top: y, behavior: 'smooth' });
    }

    return {
      scrolled: direction,
      position: { x: window.scrollX, y: window.scrollY },
      max: { x: document.body.scrollWidth, y: document.body.scrollHeight },
    };
  }

  // ─── Evaluate ───────────────────────────────────────────────────
  async function handleEvaluate({ code }) {
    if (!code) return { error: 'code is required' };
    const fn = new Function(code);
    const result = await fn();
    return { result: typeof result === 'object' ? JSON.stringify(result) : String(result ?? 'undefined') };
  }

  // ─── Get Interactive Elements ───────────────────────────────────
  function handleGetElements({ selector, limit }) {
    const max = limit || 50;
    const sel = selector || 'a, button, input, textarea, select, [role="button"], [onclick], [tabindex]';
    const elements = [...document.querySelectorAll(sel)].slice(0, max);

    return {
      elements: elements.map((el, i) => ({
        index: i,
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        role: el.getAttribute('role') || '',
        text: (el.textContent || '').trim().substring(0, 80),
        name: el.name || '',
        id: el.id || '',
        placeholder: el.placeholder || '',
        href: el.href || '',
        visible: isVisible(el),
        rect: getRect(el),
      })),
    };
  }

  // ─── Highlight Element ──────────────────────────────────────────
  function handleHighlight({ target, index, color }) {
    const el = findElement(target, index);
    if (!el) return { error: `Element not found: "${target}"` };
    flashHighlight(el, color || '#FF5722');
    return { highlighted: true, tag: el.tagName };
  }

  // ─── Select (dropdown) ─────────────────────────────────────────
  async function handleSelect({ target, value, index }) {
    const el = findElement(target, index);
    if (!el || el.tagName !== 'SELECT') return { error: `Select element not found: "${target}"` };

    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { selected: value, name: el.name || el.id };
  }

  // ─── Element Finder ─────────────────────────────────────────────
  function findElement(target, index) {
    if (typeof index === 'number') {
      const sel = 'a, button, input, textarea, select, [role="button"], [onclick], [tabindex]';
      const all = [...document.querySelectorAll(sel)];
      return all[index] || null;
    }

    if (!target) return null;

    // 1. Try CSS selector
    try {
      const el = document.querySelector(target);
      if (el) return el;
    } catch {}

    // 2. Try text matching — search visible text
    const all = document.querySelectorAll('*');
    const lowerTarget = target.toLowerCase();

    // Exact text match on interactive elements first
    for (const el of all) {
      const text = (el.textContent || '').trim().toLowerCase();
      const isInteractive = el.matches('a, button, input, select, textarea, [role="button"], [onclick]');
      if (isInteractive && text === lowerTarget) return el;
    }

    // Partial text match on interactive elements
    for (const el of all) {
      const text = (el.textContent || '').trim().toLowerCase();
      const isInteractive = el.matches('a, button, input, select, textarea, [role="button"], [onclick]');
      if (isInteractive && text.includes(lowerTarget) && text.length < 200) return el;
    }

    // 3. Try by placeholder, name, id, aria-label
    const byAttr =
      document.querySelector(`[placeholder*="${target}" i]`) ||
      document.querySelector(`[name="${target}"]`) ||
      document.querySelector(`#${CSS.escape(target)}`) ||
      document.querySelector(`[aria-label*="${target}" i]`) ||
      document.querySelector(`[title*="${target}" i]`);
    if (byAttr) return byAttr;

    // 4. Broad text match on any element
    for (const el of all) {
      const text = (el.textContent || '').trim().toLowerCase();
      if (text.includes(lowerTarget) && text.length < 200 && isVisible(el)) return el;
    }

    return null;
  }

  // ─── Helpers ────────────────────────────────────────────────────
  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getRect(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }

  function flashHighlight(el, color = '#4CAF50') {
    const prev = el.style.outline;
    el.style.outline = `3px solid ${color}`;
    el.style.outlineOffset = '2px';
    setTimeout(() => {
      el.style.outline = prev;
      el.style.outlineOffset = '';
    }, 1500);
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
})();
