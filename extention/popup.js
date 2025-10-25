// popup.js - (Final Working Version)

document.addEventListener('DOMContentLoaded', () => {
    const DEFAULT_STATE = {
        bass: 0, mids: 0, treble: 0,
        audioQualityOn: false, audioQualityPreset: 'hd',
        dimensionalAudioOn: false, dimensionalPreset: '2d',
        visualizerOn: true, enabled: true
    };

    const controls = {
        enabledSwitch: document.getElementById('extensionEnabled'),
        mainControls: document.getElementById('main-controls'),
        statusMessage: document.getElementById('status-message'),
        bassSlider: document.getElementById('bassSlider'),
        midSlider: document.getElementById('midSlider'),
        trebleSlider: document.getElementById('trebleSlider'),
        qualityEnabled: document.getElementById('qualityEnabled'),
        qualityPresetSelect: document.getElementById('qualityPresetSelect'),
        dimensionalEnabled: document.getElementById('dimensionalEnabled'),
        dimensionalGroup: document.getElementById('dimensional-group'),
        visualizerCheckbox: document.getElementById('visualizerCheckbox'),
        bassVal: document.getElementById('bassVal'),
        midVal: document.getElementById('midVal'),
        trebleVal: document.getElementById('trebleVal'),
    };

    function sendMessage(message) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, message, r => chrome.runtime.lastError);
            }
        });
    }

    function updateUI(state) {
        controls.enabledSwitch.checked = state.enabled;
        controls.mainControls.style.display = state.enabled ? 'block' : 'none';
        controls.bassSlider.value = state.bass;
        controls.midSlider.value = state.mids;
        controls.trebleSlider.value = state.treble;
        controls.bassVal.textContent = `${state.bass} dB`;
        controls.midVal.textContent = `${state.mids} dB`;
        controls.trebleVal.textContent = `${state.treble} dB`;
        controls.qualityEnabled.checked = state.audioQualityOn;
        controls.qualityPresetSelect.disabled = !state.audioQualityOn;
        controls.qualityPresetSelect.value = state.audioQualityPreset;
        controls.dimensionalEnabled.checked = state.dimensionalAudioOn;
        controls.dimensionalGroup.disabled = !state.dimensionalAudioOn;
        const radio = controls.dimensionalGroup.querySelector(`input[value="${state.dimensionalPreset}"]`);
        if (radio) radio.checked = true;
        controls.visualizerCheckbox.checked = state.visualizerOn;
    }
    
    function showStatus(message) {
        controls.mainControls.style.display = 'none';
        controls.statusMessage.textContent = message;
        controls.statusMessage.style.display = 'block';
    }

    function setupEventListeners() {
        controls.enabledSwitch.addEventListener('change', (e) => {
            sendMessage({ action: 'setEnabled', value: e.target.checked });
        });
        
        const sendLiveUpdate = (key, value) => chrome.storage.local.set({ [key]: value });

        controls.bassSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            controls.bassVal.textContent = `${val} dB`; sendLiveUpdate('bass', val);
        });
        controls.midSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            controls.midVal.textContent = `${val} dB`; sendLiveUpdate('mids', val);
        });
        controls.trebleSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            controls.trebleVal.textContent = `${val} dB`; sendLiveUpdate('treble', val);
        });
        controls.qualityEnabled.addEventListener('change', (e) => {
            controls.qualityPresetSelect.disabled = !e.target.checked; sendLiveUpdate('audioQualityOn', e.target.checked);
        });
        controls.qualityPresetSelect.addEventListener('change', (e) => sendLiveUpdate('audioQualityPreset', e.target.value));
        controls.dimensionalEnabled.addEventListener('change', (e) => {
            controls.dimensionalGroup.disabled = !e.target.checked; sendLiveUpdate('dimensionalAudioOn', e.target.checked);
        });
        controls.dimensionalGroup.addEventListener('change', (e) => {
            if (e.target.name === 'dimensional') sendLiveUpdate('dimensionalPreset', e.target.value);
        });
        controls.visualizerCheckbox.addEventListener('change', (e) => sendLiveUpdate('visualizerOn', e.target.checked));
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.url?.startsWith("https://www.youtube.com/")) {
            chrome.storage.local.get(DEFAULT_STATE, (loadedState) => {
                updateUI(loadedState);
                setupEventListeners();
            });
        } else {
            showStatus("This extension only works on youtube.com.");
        }
    });
});