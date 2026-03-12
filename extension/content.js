(() => {
    console.log('PersonalClaw Content Script Injected - ' + new Date().toISOString());

    // UI Indicator
    const indicator = document.createElement('div');
    indicator.id = 'personalclaw-relay-ui';
    indicator.style.cssText = 'position:fixed;top:10px;right:10px;z-index:999999;background:#1a1a1a;color:#fff;padding:10px;border:2px solid #555;border-radius:5px;font-family:sans-serif;box-shadow:0 4px 6px rgba(0,0,0,0.3);';
    indicator.innerHTML = '<div style="color:#a855f7;font-weight:bold;">PersonalClaw</div>' +
                          '<div style="color:#f97316;font-size:0.8em;">Relay Mode Active</div>';
    document.body.appendChild(indicator);

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log('Received Action:', request);
        if (request.type === 'HUMAN_ACTION') {
            handleAction(request).then(res => {
                console.log('Action Result:', res);
                sendResponse(res);
            });
            return true;
        }
    });

    async function handleAction(data) {
        try {
            const { action, selector, text, delay = 50 } = data;
            
            // Find element by CSS selector or common text
            let element = document.querySelector(selector);
            
            if (!element && (action === 'click' || action === 'type')) {
                const buttons = Array.from(document.querySelectorAll('button, a, label, span, div'));
                element = buttons.find(el => el.textContent.trim().toLowerCase() === selector.toLowerCase());
            }

            if (!element) return { error: `Element not found: ${selector}` };

            element.scrollIntoView({ block: 'center', behavior: 'smooth' });
            
            // Visual highlight for the element
            const originalBorder = element.style.border;
            element.style.border = '2px solid red';
            setTimeout(() => element.style.border = originalBorder, 1000);

            if (action === 'click') {
                element.click();
                return { success: true, message: `Clicked ${selector}` };
            }

            if (action === 'type') {
                element.focus();
                if (element.value !== undefined) element.value = '';
                for (const char of text) {
                    const opts = { key: char, keyCode: char.charCodeAt(0), bubbles: true };
                    element.dispatchEvent(new KeyboardEvent('keydown', opts));
                    element.dispatchEvent(new KeyboardEvent('keypress', opts));
                    if (element.value !== undefined) {
                        element.value += char;
                    } else if (element.isContentEditable) {
                        element.innerText += char;
                    }
                    element.dispatchEvent(new InputEvent('input', { data: char, bubbles: true }));
                    element.dispatchEvent(new KeyboardEvent('keyup', opts));
                    await new Promise(r => setTimeout(r, delay));
                }
                element.dispatchEvent(new Event('change', { bubbles: true }));
                return { success: true, message: `Typed into ${selector}` };
            }

            return { error: 'Unknown action' };
        } catch (err) {
            return { error: err.message };
        }
    }
})();
