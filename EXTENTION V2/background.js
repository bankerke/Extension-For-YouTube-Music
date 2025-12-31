// background.js

// Installation handler
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('YouTube Audio Tool installed');
        
        // Set default settings
        chrome.storage.local.set({
            bass: 0,
            mids: 0,
            treble: 0,
            audioQualityOn: false,
            audioQualityPreset: 'hd',
            dimensionalAudioOn: false,
            dimensionalPreset: '2d',
            visualizerOn: true,
            enabled: true
        });
    } else if (details.reason === 'update') {
        console.log('YouTube Audio Tool updated to version', chrome.runtime.getManifest().version);
    }
});

// Handle messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getState') {
        chrome.storage.local.get(null, (state) => {
            sendResponse({ state });
        });
        return true;
    }
    
    if (message.action === 'saveState') {
        chrome.storage.local.set(message.state, () => {
            sendResponse({ success: true });
        });
        return true;
    }
    
    return false;
});

// Listen for tab updates to inject content script
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url?.includes('youtube.com')) {
        chrome.storage.local.get(['enabled'], (result) => {
            if (result.enabled) {
                console.log('YouTube Audio Tool: Tab updated, extension enabled');
            }
        });
    }
});