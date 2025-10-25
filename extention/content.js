
// content.js – (Fixed Version) Core audio engine.

let audioCtx, source, gainNode, analyser;
let bassEQ, midEQ, trebleEQ, qualityFilter;
let pannerNode, convolverNode, lfo, lfoGain;
let guiContainer = null, visualizerRAF = null;
let isGraphBuilt = false;
let currentVideoElement = null; // Track the current video element

const DEFAULT_STATE = {
    bass: 0, mids: 0, treble: 0,
    audioQualityOn: false, audioQualityPreset: 'hd',
    dimensionalAudioOn: false, dimensionalPreset: '2d',
    visualizerOn: true, enabled: true
};
let state = { ...DEFAULT_STATE };

// --- Core Logic ---
function setEnabledState(shouldBeEnabled) {
    chrome.storage.local.set({ enabled: shouldBeEnabled }, () => {
        window.location.reload();
    });
}

function initialize() {
    chrome.storage.local.get(DEFAULT_STATE, (loadedState) => {
        state = loadedState;
        if (state.enabled) {
            waitForVideo();
        }
    });
}

function waitForVideo() {
    const video = document.querySelector('video');
    
    // Check if we found a video and if it's different from the current one
    if (video && video !== currentVideoElement) {
        // Clean up previous audio graph if it exists
        if (isGraphBuilt) {
            cleanupAudioGraph();
        }
        ensureAudioGraph(video);
    } else if (!video) {
        setTimeout(waitForVideo, 500);
    }
}

// --- Cleanup Function ---
function cleanupAudioGraph() {
    try {
        // Cancel visualizer animation
        if (visualizerRAF) {
            cancelAnimationFrame(visualizerRAF);
            visualizerRAF = null;
        }
        
        // Disconnect all nodes
        if (source) source.disconnect();
        if (bassEQ) bassEQ.disconnect();
        if (midEQ) midEQ.disconnect();
        if (trebleEQ) trebleEQ.disconnect();
        if (qualityFilter) qualityFilter.disconnect();
        if (pannerNode) pannerNode.disconnect();
        if (convolverNode) convolverNode.disconnect();
        if (gainNode) gainNode.disconnect();
        if (analyser) analyser.disconnect();
        if (lfo) {
            lfo.stop();
            lfo.disconnect();
        }
        if (lfoGain) lfoGain.disconnect();
        
        // Close audio context
        if (audioCtx && audioCtx.state !== 'closed') {
            audioCtx.close();
        }
        
        // Reset variables
        audioCtx = null;
        source = null;
        gainNode = null;
        analyser = null;
        bassEQ = null;
        midEQ = null;
        trebleEQ = null;
        qualityFilter = null;
        pannerNode = null;
        convolverNode = null;
        lfo = null;
        lfoGain = null;
        currentVideoElement = null;
        isGraphBuilt = false;
    } catch (e) {
        console.error("YT Audio Tool: Error during cleanup.", e);
    }
}

// --- Audio Graph Management ---
async function ensureAudioGraph(video) {
    if (isGraphBuilt && currentVideoElement === video) return;
    
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Important: Check if this video element already has a source
        // If it does, we can't create another one
        try {
            source = audioCtx.createMediaElementSource(video);
            currentVideoElement = video;
            video.muted = true;
        } catch (e) {
            // If we get an error, it means the video already has a source
            // Just skip this attempt and wait for the next navigation
            console.log("YT Audio Tool: Video element already has a source, skipping...");
            if (audioCtx) audioCtx.close();
            return;
        }
        
        await setupAudioNodes();
        updateAudioSettings();
        createGUI();
        isGraphBuilt = true;
    } catch (e) {
        console.error("YT Audio Tool: Failed to build audio graph.", e);
        cleanupAudioGraph();
    }
}

async function setupAudioNodes() {
    gainNode = audioCtx.createGain();
    analyser = audioCtx.createAnalyser();
    qualityFilter = audioCtx.createBiquadFilter(); qualityFilter.type = 'lowpass';
    bassEQ = audioCtx.createBiquadFilter(); bassEQ.type = 'lowshelf'; bassEQ.frequency.value = 250;
    midEQ = audioCtx.createBiquadFilter(); midEQ.type = 'peaking'; midEQ.frequency.value = 1000; midEQ.Q.value = 1;
    trebleEQ = audioCtx.createBiquadFilter(); trebleEQ.type = 'highshelf'; trebleEQ.frequency.value = 4000;
    pannerNode = audioCtx.createStereoPanner();
    convolverNode = audioCtx.createConvolver();
    lfo = audioCtx.createOscillator(); lfoGain = audioCtx.createGain();
    lfo.frequency.value = 0.25; lfoGain.gain.value = 1.0;
    lfo.connect(lfoGain).connect(pannerNode.pan);
    lfo.start();
}

function reconnectGraph() {
    if (!source || !audioCtx) return;
    
    try {
        source.disconnect();
        let currentNode = source.connect(qualityFilter)
            .connect(bassEQ).connect(midEQ).connect(trebleEQ);
        if (state.dimensionalAudioOn) {
            const preset = state.dimensionalPreset;
            if (preset === '3d') currentNode = currentNode.connect(pannerNode);
            if (preset === '5d') currentNode = currentNode.connect(convolverNode);
            if (preset === '8d') currentNode = currentNode.connect(pannerNode).connect(convolverNode);
        }
        currentNode.connect(gainNode).connect(analyser).connect(audioCtx.destination);
    } catch (e) {
        console.error("YT Audio Tool: Error reconnecting graph.", e);
    }
}

function updateAudioSettings() {
    if (!audioCtx) return;
    const qualityPresets = { 'hd': 22000, '480p': 12000, '360p': 9000, '240p': 6000, '180p': 4000 };
    qualityFilter.frequency.setValueAtTime(
        state.audioQualityOn ? qualityPresets[state.audioQualityPreset] : 22000,
        audioCtx.currentTime
    );
    bassEQ.gain.value = state.bass;
    midEQ.gain.value = state.mids;
    trebleEQ.gain.value = state.treble;
    if (state.dimensionalAudioOn && (state.dimensionalPreset === '5d' || state.dimensionalPreset === '8d')) {
        const duration = 3.5, decay = 3.0, rate = audioCtx.sampleRate, length = rate * duration;
        const impulse = audioCtx.createBuffer(2, length, rate);
        for (let i = 0; i < 2; i++) {
            const chan = impulse.getChannelData(i);
            for (let j = 0; j < length; j++) {
                chan[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, decay);
            }
        }
        convolverNode.buffer = impulse;
    }
    reconnectGraph();
}

// --- On-Page GUI & Visualizer ---
function createGUI() {
    if (document.getElementById('yt-audio-gui')) return;
    guiContainer = document.createElement('div');
    guiContainer.id = 'yt-audio-gui';
    document.body.appendChild(guiContainer);
    updateGUI();
}

function updateGUI() {
    if (!guiContainer) return;
    guiContainer.innerHTML = `<div class="container visualizer-container">
        <canvas id="visualizerCanvas"></canvas>
    </div>`;
    toggleVisualizer();
}

function toggleVisualizer() {
    if (!guiContainer) return;
    const canvas = guiContainer.querySelector('#visualizerCanvas');
    if (state.visualizerOn) {
        guiContainer.style.display = 'block';
        if (!visualizerRAF) drawVisualizer();
    } else {
        guiContainer.style.display = 'none';
        if (visualizerRAF) cancelAnimationFrame(visualizerRAF);
        visualizerRAF = null;
    }
}

function drawVisualizer() {
    if (!state.visualizerOn || !analyser || !guiContainer) {
        visualizerRAF = null; return;
    }
    const canvas = guiContainer.querySelector('#visualizerCanvas');
    if (!canvas) return;
    const canvasCtx = canvas.getContext('2d');
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    canvasCtx.fillStyle = '#021309';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    const barWidth = (canvas.width / dataArray.length) * 2.5;
    let x = 0;
    for (let i = 0; i < dataArray.length; i++) {
        const barHeight = dataArray[i];
        canvasCtx.fillStyle = 'rgb(0, ' + (barHeight + 100) + ', 102)';
        canvasCtx.fillRect(x, canvas.height - barHeight / 2, barWidth, barHeight / 2);
        x += barWidth + 1;
    }
    visualizerRAF = requestAnimationFrame(drawVisualizer);
}

// --- Event Listeners ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'setEnabled') {
        setEnabledState(msg.value);
    }
    sendResponse({ status: "ok" });
    return true;
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && state.enabled) {
        let needsAudioUpdate = false;
        for (let key in changes) {
            if (state[key] !== undefined && state[key] !== changes[key].newValue) {
                state[key] = changes[key].newValue;
                if (key !== 'visualizerOn') needsAudioUpdate = true;
                if (key === 'visualizerOn') toggleVisualizer();
            }
        }
        if (needsAudioUpdate) {
            updateAudioSettings();
        }
    }
});

document.addEventListener('yt-navigate-finish', () => {
    if (isGraphBuilt) {
        cleanupAudioGraph();
    }
    setTimeout(initialize, 500);
});

// Cleanup when page unloads
window.addEventListener('beforeunload', () => {
    if (isGraphBuilt) {
        cleanupAudioGraph();
    }
});

initialize();
