// content.js - Dimensional audio: 360° rotating bass + voice per-branch (2D..12D)
// - Splits each branch into low (bass) and high (voice) bands.
// - Bass uses PannerNode (3D) and is moved around the listener in a circular path (360°).
// - Voice (mids/high) uses StereoPanner with a complementary movement.
// - Uses requestAnimationFrame loop to update positions (only when context is running).
// - Keeps EQ + presets + safe attach/cleanup behavior from earlier implementation.
//
// Replace the previous content.js with this file. No other files need changing.
//
// Notes:
// - For best results use stereo output (headphones recommended).
// - If a site prevents creating MediaElementAudioSourceNode this script will set `audioToolAttachStatus` in storage -> popup shows friendly message.
// - Adjust `BASS_CUTOFF_HZ` to change split frequency between bass and voice.

let audioCtx = null;
let source = null;

// Primary nodes used by the chain
let nodes = {
  qualityFilter: null,
  bassEQ: null,
  midEQ: null,
  trebleEQ: null,
  compressor: null,
  masterGain: null,
  analyser: null,
  convolver: null,
  reverbWetGain: null
};

// Dimensional state and animation
let dim = {
  enabled: false,
  count: 0,
  branches: [], // each branch: { inGain, lowFilter, highFilter, bassPanner, voicePanner, lowOut, highOut, outGain, constantStarted }
  animationRAF: null,
  animationStartTime: 0
};

let isGraphBuilt = false;
let currentMedia = null;
let mediaObservers = [];
let pageInterval = null;
let isProcessing = false;

const DEFAULT_STATE = {
  bass: 0,
  mids: 0,
  treble: 0,
  audioQualityOn: false,
  audioQualityPreset: 'hd',
  dimensionalAudioOn: false,
  dimensionalPreset: '2',
  enabled: true,
  presetMode: 'off',
  audioToolAttachStatus: 'unknown'
};
let state = { ...DEFAULT_STATE };

// Presets
const PRESETS = {
  off: { eq: { bass: 0, mids: 0, treble: 0 }, compressor: null, gainDb: 0 },
  music: { eq: { bass: 3, mids: 0, treble: 2 }, compressor: { threshold: -20, knee: 5, ratio: 2.5, attack: 0.02, release: 0.25 }, gainDb: 1.2 },
  game: { eq: { bass: 1, mids: 1, treble: 3 }, compressor: { threshold: -12, knee: 4, ratio: 3.0, attack: 0.01, release: 0.15 }, gainDb: 1 },
  movie: { eq: { bass: 4, mids: 0, treble: -1 }, compressor: { threshold: -24, knee: 6, ratio: 2.0, attack: 0.03, release: 0.3 }, gainDb: 1.5 },
  pop: { eq: { bass: 2, mids: 1, treble: 3 }, compressor: { threshold: -18, knee: 4, ratio: 2.6, attack: 0.02, release: 0.22 }, gainDb: 1.2 },
  jazz: { eq: { bass: 1, mids: 2, treble: 1 }, compressor: { threshold: -22, knee: 5, ratio: 2.2, attack: 0.03, release: 0.28 }, gainDb: 1 },
  rock: { eq: { bass: 4, mids: 1, treble: 2 }, compressor: { threshold: -16, knee: 6, ratio: 3.5, attack: 0.015, release: 0.2 }, gainDb: 1.4 },
  melody: { eq: { bass: 0, mids: 3, treble: 2 }, compressor: { threshold: -20, knee: 5, ratio: 2.0, attack: 0.03, release: 0.25 }, gainDb: 1 }
};

const BASS_CUTOFF_HZ = 250; // split frequency: <= this treated as bass

// safe storage setter
function safeSetStorage(obj) {
  try { chrome.storage.local.set(obj); } catch (e) { /* ignore */ }
}

// --- Initialization ---
function initialize() {
  chrome.storage.local.get(DEFAULT_STATE, (loaded) => {
    state = { ...DEFAULT_STATE, ...loaded };
    if (state.enabled) {
      setupPageObservers();
      waitForMedia();
    }
  });
}

// --- Page Observers ---
function setupPageObservers() {
  if (pageInterval) return;
  let lastHref = location.href;
  pageInterval = setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      if (isGraphBuilt) cleanupAudioGraph();
      if (state.enabled) setTimeout(waitForMedia, 300);
    }
  }, 600);

  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n && n.querySelector) {
          const found = (n.tagName && n.tagName.toLowerCase() === 'video') ? n : n.querySelector('video, audio');
          if (found) { waitForMedia(); return; }
        }
      }
    }
  });
  try { mo.observe(document.documentElement || document.body, { childList: true, subtree: true }); mediaObservers.push({ observer: mo }); } catch (e) {}
}

// --- Media detection / attach ---
function waitForMedia() {
  if (isProcessing) return;
  const media = document.querySelector('video, audio');
  if (!media) return;
  if (media.dataset && media.dataset.audioToolAttached) return;

  if (!media.paused || media.currentTime > 0) {
    setTimeout(() => attachOnGesture(media), 30);
    return;
  }
  attachOnGesture(media);
}

function attachOnGesture(media) {
  if (!media) return;
  if (media.dataset && media.dataset.audioToolAttached) return;

  const onPlay = () => {
    if (media.dataset) media.dataset.audioToolAttached = '1';
    setupAudioForMedia(media);
  };

  if (!media.paused || media.currentTime > 0) {
    if (media.dataset) media.dataset.audioToolAttached = '1';
    setupAudioForMedia(media);
    return;
  }

  try {
    media.addEventListener('play', onPlay, { once: true });
    mediaObservers.push({ el: media, listener: onPlay });
  } catch (e) {}
}

// --- Setup Audio Graph ---
async function setupAudioForMedia(mediaEl) {
  if (isProcessing || isGraphBuilt) return;
  isProcessing = true;

  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    try {
      source = audioCtx.createMediaElementSource(mediaEl);
    } catch (e) {
      source = null;
      try {
        const capture = mediaEl.captureStream || mediaEl.mozCaptureStream;
        if (capture) {
          const stream = capture.call(mediaEl);
          source = audioCtx.createMediaStreamSource(stream);
        }
      } catch (_) { source = null; }
    }

    if (!source) {
      safeSetStorage({ audioToolAttachStatus: 'attach_failed' });
      isProcessing = false;
      return;
    }

    safeSetStorage({ audioToolAttachStatus: 'attached' });
    currentMedia = mediaEl;

    createNodes();
    connectGraph();

    isGraphBuilt = true;
    isProcessing = false;

    // apply existing settings (EQ/preset/dimensional)
    reapplyAudioSettings();

    // observe src attr to reinit on navigation within the player
    try {
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'src') {
            setTimeout(() => {
              if (isGraphBuilt) cleanupAudioGraph();
              waitForMedia();
            }, 150);
            break;
          }
        }
      });
      obs.observe(mediaEl, { attributes: true });
      mediaObservers.push({ observer: obs });
    } catch (e) {}

    // start animation loop if needed
    if (audioCtx.state === 'running') startDimAnimation();
    else {
      try { audioCtx.onstatechange = () => { if (audioCtx.state === 'running') startDimAnimation(); }; } catch (e) {}
    }

  } catch (e) {
    cleanupAudioGraph();
    isProcessing = false;
  }
}

// --- Node creation ---
function createNodes() {
  if (!audioCtx) return;
  const a = audioCtx;
  nodes.qualityFilter = a.createBiquadFilter(); nodes.qualityFilter.type = 'lowpass'; nodes.qualityFilter.frequency.value = 22000; nodes.qualityFilter.Q.value = 1;
  nodes.bassEQ = a.createBiquadFilter(); nodes.bassEQ.type = 'lowshelf'; nodes.bassEQ.frequency.value = 200; nodes.bassEQ.gain.value = state.bass || 0;
  nodes.midEQ = a.createBiquadFilter(); nodes.midEQ.type = 'peaking'; nodes.midEQ.frequency.value = 1000; nodes.midEQ.gain.value = state.mids || 0; nodes.midEQ.Q.value = 1;
  nodes.trebleEQ = a.createBiquadFilter(); nodes.trebleEQ.type = 'highshelf'; nodes.trebleEQ.frequency.value = 3000; nodes.trebleEQ.gain.value = state.treble || 0;

  try { nodes.compressor = a.createDynamicsCompressor(); } catch (e) { nodes.compressor = null; }
  nodes.masterGain = a.createGain(); nodes.masterGain.gain.value = 1.0;
  nodes.analyser = a.createAnalyser(); nodes.analyser.fftSize = 256;

  // convolver + wet routing
  nodes.convolver = a.createConvolver();
  nodes.reverbWetGain = a.createGain(); nodes.reverbWetGain.gain.value = 0.0;
  try { generateReverb(1.6); } catch (e) {}
  try { nodes.convolver.connect(nodes.reverbWetGain); nodes.reverbWetGain.connect(nodes.masterGain); } catch (e) {}
}

// --- Connect / Reconnect Graph ---
function connectGraph() {
  if (!source || !audioCtx) return;
  safeDisconnect([source, nodes.qualityFilter, nodes.bassEQ, nodes.midEQ, nodes.trebleEQ, nodes.compressor, nodes.masterGain, nodes.analyser]);

  cleanupDimBranches(true);

  try {
    let last = source;
    last.connect(nodes.qualityFilter); last = nodes.qualityFilter;
    last.connect(nodes.bassEQ); last = nodes.bassEQ;
    last.connect(nodes.midEQ); last = nodes.midEQ;
    last.connect(nodes.trebleEQ); last = nodes.trebleEQ;

    if (nodes.compressor) { last.connect(nodes.compressor); last = nodes.compressor; }

    if (state.dimensionalAudioOn) {
      const desired = parseInt(state.dimensionalPreset || '2', 10);
      const clamped = isNaN(desired) ? 2 : Math.max(2, Math.min(12, desired));
      setupDimBranches(clamped);

      // split processed output 'last' into each branch inGain
      for (const br of dim.branches) {
        try { last.connect(br.inGain); } catch (e) {}
      }
      // master gain -> analyser -> destination
      nodes.masterGain.connect(nodes.analyser); nodes.analyser.connect(audioCtx.destination);
    } else {
      last.connect(nodes.masterGain);
      nodes.masterGain.connect(nodes.analyser);
      nodes.analyser.connect(audioCtx.destination);
    }
  } catch (e) {
    // ignore
  }
}

// --- Reverb generation ---
function generateReverb(duration = 1.6) {
  if (!audioCtx || !nodes.convolver) return;
  const rate = audioCtx.sampleRate;
  const length = Math.floor(rate * duration);
  const impulse = audioCtx.createBuffer(2, length, rate);
  const decay = 2.2;
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  try { nodes.convolver.buffer = impulse; } catch (e) {}
}

// --- Setup dimensional branches with bass/voice separation ---
function setupDimBranches(n) {
  cleanupDimBranches(true);
  const count = Math.max(2, Math.min(12, Math.floor(n)));
  dim.count = count;
  dim.enabled = true;
  dim.branches = [];

  const a = audioCtx;
  // spatial arrangement: evenly around circle
  const radiusBase = 1.2; // base radius for bass panners (meters)
  for (let i = 0; i < count; i++) {
    try {
      const inGain = a.createGain(); inGain.gain.value = 1.0;

      // split filters for bass and voice
      const lowFilter = a.createBiquadFilter(); lowFilter.type = 'lowpass'; lowFilter.frequency.value = BASS_CUTOFF_HZ;
      const highFilter = a.createBiquadFilter(); highFilter.type = 'highpass'; highFilter.frequency.value = BASS_CUTOFF_HZ;

      // bass: 3D panner (rotates full 360°)
      const bassPanner = a.createPanner();
      try {
        bassPanner.panningModel = 'HRTF';
        bassPanner.distanceModel = 'inverse';
        bassPanner.refDistance = 1;
        bassPanner.maxDistance = 20;
        bassPanner.rolloffFactor = 1;
      } catch (e) {}

      // voice: stereo panner for clear left-right imaging (modulated)
      const voicePanner = a.createStereoPanner();

      // out gains
      const lowOut = a.createGain(); lowOut.gain.value = 1.0 / count;
      const highOut = a.createGain(); highOut.gain.value = 1.0 / count;
      const outGain = a.createGain(); outGain.gain.value = 1.0; // we sum lowOut+highOut into masterGain via connecting both

      // reverb send (from low or high out) -> convolver -> reverbWetGain -> master
      const reverbSend = a.createGain(); reverbSend.gain.value = 0.0;

      // routing:
      // inGain -> lowFilter -> bassPanner -> lowOut -> masterGain
      // inGain -> highFilter -> voicePanner -> highOut -> masterGain
      // out also connects to reverbSend -> convolver
      try { inGain.connect(lowFilter); lowFilter.connect(bassPanner); bassPanner.connect(lowOut); lowOut.connect(nodes.masterGain); lowOut.connect(reverbSend); reverbSend.connect(nodes.convolver); } catch (e) {}
      try { inGain.connect(highFilter); highFilter.connect(voicePanner); voicePanner.connect(highOut); highOut.connect(nodes.masterGain); highOut.connect(reverbSend); } catch (e) {}

      // branch motion parameters
      // base angle evenly spaced around 360 degrees
      const baseAngle = (i / count) * 2 * Math.PI;
      // rotation speeds: bass rotates slower, voice slightly faster / complementary
      const bassSpeed = 0.12 + (i % 3) * 0.01; // cycles per second approx
      const voiceSpeed = 0.2 + (i % 4) * 0.015;

      // store branch
      dim.branches.push({
        inGain, lowFilter, highFilter, bassPanner, voicePanner, lowOut, highOut, outGain, reverbSend,
        baseAngle, bassSpeed, voiceSpeed, radius: radiusBase, started: false
      });

      // if context running, start constant sources / etc. (no constant needed now; we animate positions)
    } catch (e) {
      // skip branch
    }
  }

  // determine reverb wet level based on count to add depth gently
  try {
    const wet = Math.min(0.36, 0.04 + (count - 2) * 0.035);
    nodes.reverbWetGain.gain.value = wet;
  } catch (e) {}
}

// --- Animation: update per-branch positions to produce 360° rotation ---
// We update PannerNode positions (x,z) for bass; voice pan via StereoPanner
function updateDimPositions() {
  if (!audioCtx || !dim.enabled || !dim.branches || dim.branches.length === 0) {
    dim.animationRAF = null;
    return;
  }

  const t = audioCtx.currentTime || (performance.now() / 1000);
  const elapsed = t - (dim.animationStartTime || t);

  for (let i = 0; i < dim.branches.length; i++) {
    const br = dim.branches[i];
    if (!br) continue;

    const angleBass = br.baseAngle + (br.bassSpeed * 2 * Math.PI * elapsed);
    const angleVoice = br.baseAngle + (br.voiceSpeed * 2 * Math.PI * elapsed * -1); // opposite direction for contrast

    // bass 3D position on circle (x,z). y kept small positive for listener height
    const radius = br.radius;
    const x = Math.cos(angleBass) * radius;
    const z = Math.sin(angleBass) * radius;
    const y = 0.0;

    try {
      // modern API: positionX/positionY/positionZ AudioParams; fallback to setPosition
      if (br.bassPanner.positionX) {
        br.bassPanner.positionX.setValueAtTime(x, t);
        br.bassPanner.positionY.setValueAtTime(y, t);
        br.bassPanner.positionZ.setValueAtTime(z, t);
      } else if (typeof br.bassPanner.setPosition === 'function') {
        try { br.bassPanner.setPosition(x, y, z); } catch (e) {}
      }
    } catch (e) {}

    // voice stereo pan: derive pan from angleVoice (map to -1..1 via cos)
    const pan = Math.cos(angleVoice);
    try {
      br.voicePanner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), t);
    } catch (e) {}
  }

  // queue next frame if still enabled and audioCtx running
  if (audioCtx && audioCtx.state === 'running' && dim.enabled && dim.branches.length > 0) {
    dim.animationRAF = requestAnimationFrame(updateDimPositions);
  } else {
    dim.animationRAF = null;
  }
}

function startDimAnimation() {
  if (!dim.enabled || !audioCtx) return;
  if (!dim.animationStartTime) dim.animationStartTime = audioCtx.currentTime || (performance.now() / 1000);
  if (!dim.animationRAF) {
    dim.animationRAF = requestAnimationFrame(updateDimPositions);
  }
}

// stop and cleanup branches
function cleanupDimBranches(stopOsc = true) {
  if (!dim.branches || !dim.branches.length) return;
  for (const br of dim.branches) {
    try { if (br.inGain) br.inGain.disconnect(); } catch (e) {}
    try { if (br.lowFilter) br.lowFilter.disconnect(); } catch (e) {}
    try { if (br.highFilter) br.highFilter.disconnect(); } catch (e) {}
    try { if (br.bassPanner) br.bassPanner.disconnect(); } catch (e) {}
    try { if (br.voicePanner) br.voicePanner.disconnect(); } catch (e) {}
    try { if (br.lowOut) br.lowOut.disconnect(); } catch (e) {}
    try { if (br.highOut) br.highOut.disconnect(); } catch (e) {}
    try { if (br.reverbSend) br.reverbSend.disconnect(); } catch (e) {}
  }
  dim.branches = [];
  dim.count = 0;
  dim.enabled = false;
  if (dim.animationRAF) {
    cancelAnimationFrame(dim.animationRAF);
    dim.animationRAF = null;
  }
  dim.animationStartTime = 0;
}

// --- Apply EQ / Quality / Dimensional settings ---
function reapplyAudioSettings() {
  if (!audioCtx || !isGraphBuilt) return;
  const now = audioCtx.currentTime || 0;

  try { if (nodes.bassEQ) nodes.bassEQ.gain.setValueAtTime(Number(state.bass) || 0, now); } catch (e) {}
  try { if (nodes.midEQ) nodes.midEQ.gain.setValueAtTime(Number(state.mids) || 0, now); } catch (e) {}
  try { if (nodes.trebleEQ) nodes.trebleEQ.gain.setValueAtTime(Number(state.treble) || 0, now); } catch (e) {}

  const qualityPresets = { hd: 22000, '480p': 11000, '360p': 8000, '240p': 5000, '180p': 3000 };
  const targetFreq = state.audioQualityOn ? (qualityPresets[state.audioQualityPreset] || 22000) : 22000;
  try { if (nodes.qualityFilter) nodes.qualityFilter.frequency.setValueAtTime(targetFreq, now); } catch (e) {}

  try {
    const preset = PRESETS[state.presetMode] || PRESETS.off;
    if (nodes.compressor && preset && preset.compressor) {
      nodes.compressor.threshold.value = preset.compressor.threshold;
      nodes.compressor.knee.value = preset.compressor.knee;
      nodes.compressor.ratio.value = preset.compressor.ratio;
      nodes.compressor.attack.value = preset.compressor.attack;
      nodes.compressor.release.value = preset.compressor.release;
    }
    const presetGain = (PRESETS[state.presetMode] && PRESETS[state.presetMode].gainDb) || 0;
    nodes.masterGain.gain.value = Math.pow(10, presetGain / 20);
  } catch (e) {}

  // handle dimensional enabling/disabling or changed count
  if (state.dimensionalAudioOn) {
    const desired = parseInt(state.dimensionalPreset || '2', 10);
    const clamped = isNaN(desired) ? 2 : Math.max(2, Math.min(12, desired));
    if (!dim.enabled || dim.count !== clamped) {
      connectGraph(); // rebuild branches
      startDimAnimation();
    } else {
      // update reverb wet
      try {
        const wet = Math.min(0.36, 0.04 + (clamped - 2) * 0.035);
        nodes.reverbWetGain.gain.value = wet;
      } catch (e) {}
    }
  } else {
    // ensure clean normal chain
    connectGraph();
  }
}

// --- Helpers: safe disconnect and cleanup graph ---
function safeDisconnect(list) {
  for (const n of list) {
    try { if (n && typeof n.disconnect === 'function') n.disconnect(); } catch (e) {}
  }
}

function cleanupAudioGraph() {
  try {
    cleanupDimBranches(true);
    safeDisconnect([source, nodes.qualityFilter, nodes.bassEQ, nodes.midEQ, nodes.trebleEQ, nodes.compressor, nodes.masterGain, nodes.analyser, nodes.convolver, nodes.reverbWetGain]);
    if (currentMedia && currentMedia.dataset && currentMedia.dataset.audioToolAttached) {
      try { delete currentMedia.dataset.audioToolAttached; } catch (e) {}
    }
    for (const it of mediaObservers) {
      try { if (it.observer && typeof it.observer.disconnect === 'function') it.observer.disconnect(); } catch (e) {}
      try { if (it.el && it.listener) it.el.removeEventListener('play', it.listener); } catch (e) {}
    }
    mediaObservers = [];
    if (pageInterval) { try { clearInterval(pageInterval); } catch (e) {} pageInterval = null; }
    try { if (audioCtx && audioCtx.state !== 'closed') audioCtx.close(); } catch (e) {}
  } catch (e) {}
  audioCtx = null;
  source = null;
  nodes = { qualityFilter: null, bassEQ: null, midEQ: null, trebleEQ: null, compressor: null, masterGain: null, analyser: null, convolver: null, reverbWetGain: null };
  dim = { enabled: false, count: 0, branches: [], animationRAF: null, animationStartTime: 0 };
  isGraphBuilt = false;
  currentMedia = null;
  isProcessing = false;
}

// --- Storage listener ---
chrome.storage.onChanged.addListener((changes, ns) => {
  if (ns !== 'local') return;
  let needReapply = false;
  for (const k in changes) {
    state[k] = changes[k].newValue;
    if (k === 'enabled') {
      if (!state.enabled && isGraphBuilt) cleanupAudioGraph();
      if (state.enabled) waitForMedia();
    } else {
      needReapply = true;
    }
  }
  if (needReapply && isGraphBuilt) reapplyAudioSettings();
});

// legacy runtime message handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'setEnabled') safeSetStorage({ enabled: !!msg.value });
  sendResponse({ status: 'ok' }); return true;
});

window.addEventListener('beforeunload', () => { if (isGraphBuilt) cleanupAudioGraph(); });

// Start
initialize();