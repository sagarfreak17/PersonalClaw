let socket = null;
let heartbeatInterval = null;

function connect() {
    socket = new WebSocket('ws://127.0.0.1:3001');

    socket.onopen = () => {
        console.log('Connected to PersonalClaw Relay Server');
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'PONG' }));
            }
        }, 20000);
    };

    socket.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'PONG') return;
        
        console.log('Received command:', data);

        if (data.type === 'LIST_TABS') {
            const tabs = await chrome.tabs.query({});
            socket.send(JSON.stringify({ 
                id: data.id, 
                result: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active })) 
            }));
            return;
        }

        if (data.type === 'EXECUTE_ON_PAGE') {
            try {
                let targetTabId = data.tabId;
                if (!targetTabId) {
                    const tabs = await chrome.tabs.query({ active: true });
                    const bestTab = tabs.find(t => !t.url.includes('localhost:5173')) || tabs[0];
                    targetTabId = bestTab?.id;
                }

                if (!targetTabId) {
                    socket.send(JSON.stringify({ id: data.id, result: { error: 'No suitable tab found' } }));
                    return;
                }

                chrome.scripting.executeScript({
                    target: { tabId: targetTabId },
                    func: (codeStr) => {
                        try {
                            return eval(codeStr);
                        } catch (e) {
                            return { error: e.message };
                        }
                    },
                    args: [data.code]
                }, (results) => {
                   if (chrome.runtime.lastError) {
                        socket.send(JSON.stringify({ id: data.id, result: { error: chrome.runtime.lastError.message } }));
                   } else {
                        const result = results[0]?.result;
                        socket.send(JSON.stringify({ id: data.id, result }));
                   }
                });
            } catch (err) {
                socket.send(JSON.stringify({ id: data.id, result: { error: err.message } }));
            }
            return;
        }

        if (data.type === 'HUMAN_ACTION') {
            try {
                let targetTabId = data.tabId;
                if (!targetTabId) {
                    const tabs = await chrome.tabs.query({ active: true });
                    const bestTab = tabs.find(t => !t.url.includes('localhost:5173')) || tabs[0];
                    targetTabId = bestTab?.id;
                }

                if (!targetTabId) {
                    socket.send(JSON.stringify({ id: data.id, result: { error: 'No suitable tab found' } }));
                    return;
                }

                // Parse the code as an action object for the content script
                let messageBody = { type: 'HUMAN_ACTION' };
                try {
                    const actionData = typeof data.code === 'string' ? JSON.parse(data.code) : data.code;
                    messageBody = { ...messageBody, ...actionData };
                } catch (e) {
                    socket.send(JSON.stringify({ id: data.id, result: { error: 'Invalid JSON for human_action: ' + e.message } }));
                    return;
                }

                chrome.tabs.sendMessage(targetTabId, messageBody, (response) => {
                    if (chrome.runtime.lastError) {
                        socket.send(JSON.stringify({ id: data.id, result: { error: chrome.runtime.lastError.message } }));
                    } else {
                        socket.send(JSON.stringify({ id: data.id, result: response }));
                    }
                });
            } catch (err) {
                socket.send(JSON.stringify({ id: data.id, result: { error: err.message } }));
            }
            return;
        }
    };

    socket.onclose = () => {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        setTimeout(connect, 5000);
    };
}

connect();
