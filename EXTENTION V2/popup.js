// popup.js - Compact hacker style, preset/creative, dim buttons (2..12), EQ slider sync
document.addEventListener('DOMContentLoaded', () => {
  const DEFAULT = {
    bass: 0, mids: 0, treble: 0,
    audioQualityOn: false, audioQualityPreset: 'hd',
    dimensionalAudioOn: false, dimensionalPreset: '2',
    enabled: true, presetMode: 'off', audioToolAttachStatus: 'unknown'
  };

  const els = {
    enabled: document.getElementById('extensionEnabled'),
    main: document.getElementById('main-controls'),
    status: document.getElementById('status-message'),
    bassSlider: document.getElementById('bassSlider'),
    midSlider: document.getElementById('midSlider'),
    trebleSlider: document.getElementById('trebleSlider'),
    bassVal: document.getElementById('bassVal'),
    midVal: document.getElementById('midVal'),
    trebleVal: document.getElementById('trebleVal'),
    dimButtons: document.getElementById('dim-buttons'),
    dimEnabled: document.getElementById('dimEnabled')
  };

  // generate dim buttons 2..12 vertically
  for (let i = 2; i <= 12; i++) {
    const btn = document.createElement('button');
    btn.className = 'dim-btn';
    btn.dataset.dim = String(i);
    btn.textContent = `${i}D`;
    btn.addEventListener('click', () => {
      chrome.storage.local.set({ dimensionalAudioOn: true, dimensionalPreset: String(i) });
      els.dimEnabled.checked = true;
      // highlight
      document.querySelectorAll('.dim-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
    els.dimButtons.appendChild(btn);
  }

  function save(k, v) { const o = {}; o[k] = v; chrome.storage.local.set(o); }

  function setEQUI(b, m, t) {
    els.bassSlider.value = b; els.midSlider.value = m; els.trebleSlider.value = t;
    els.bassVal.textContent = `${b} dB`; els.midVal.textContent = `${m} dB`; els.trebleVal.textContent = `${t} dB`;
  }

  // load stored state
  chrome.storage.local.get(DEFAULT, (s) => {
    const state = { ...DEFAULT, ...s };
    els.enabled.checked = !!state.enabled;
    els.main.style.display = state.enabled ? 'block' : 'none';
    setEQUI(state.bass || 0, state.mids || 0, state.treble || 0);
    els.dimEnabled.checked = !!state.dimensionalAudioOn;
    // highlight dim button
    document.querySelectorAll('.dim-btn').forEach(b => { b.classList.toggle('active', b.dataset.dim === String(state.dimensionalPreset)); });
    // highlight presets/creative
    document.querySelectorAll('.preset-btn, .creative-btn').forEach(btn => { btn.classList.toggle('active', btn.dataset.preset === state.presetMode); });

    // attach-fail status
    if (state.audioToolAttachStatus === 'attach_failed') {
      els.main.style.display = 'none';
      els.status.style.display = 'block';
      els.status.textContent = 'Could not attach to media on this page. Try reloading and play the media.';
    } else {
      els.status.style.display = 'none';
    }
  });

  // Enable toggle reloads the active tab
  els.enabled.addEventListener('change', () => {
    save('enabled', !!els.enabled.checked);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        try { chrome.tabs.reload(tabs[0].id); } catch (e) {}
      }
    });
    els.main.style.display = els.enabled.checked ? 'block' : 'none';
  });

  // Preset vertical buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.preset;
      save('presetMode', p);
      const map = { music: { bass: 3, mids: 0, treble: 2 }, game: { bass: 1, mids: 1, treble: 3 }, movie: { bass: 4, mids: 0, treble: -1 } };
      const eq = map[p] || { bass: 0, mids: 0, treble: 0 };
      save('bass', eq.bass); save('mids', eq.mids); save('treble', eq.treble);
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.creative-btn').forEach(b => b.classList.remove('active'));
    });
  });

  // Creative buttons
  document.querySelectorAll('.creative-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.preset;
      save('presetMode', p);
      const map = { pop: { bass: 2, mids: 1, treble: 3 }, jazz: { bass: 1, mids: 2, treble: 1 }, rock: { bass: 4, mids: 1, treble: 2 }, melody: { bass: 0, mids: 3, treble: 2 } };
      const eq = map[p] || { bass: 0, mids: 0, treble: 0 };
      save('bass', eq.bass); save('mids', eq.mids); save('treble', eq.treble);
      document.querySelectorAll('.creative-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    });
  });

  // Dimensional toggle
  els.dimEnabled.addEventListener('change', () => {
    save('dimensionalAudioOn', !!els.dimEnabled.checked);
    if (!els.dimEnabled.checked) save('dimensionalPreset', '2');
  });

  // EQ sliders update storage immediately
  els.bassSlider.addEventListener('input', (e) => { const v = parseInt(e.target.value, 10); els.bassVal.textContent = `${v} dB`; save('bass', v); });
  els.midSlider.addEventListener('input', (e) => { const v = parseInt(e.target.value, 10); els.midVal.textContent = `${v} dB`; save('mids', v); });
  els.trebleSlider.addEventListener('input', (e) => { const v = parseInt(e.target.value, 10); els.trebleVal.textContent = `${v} dB`; save('treble', v); });

  // reflect storage changes (live)
  chrome.storage.onChanged.addListener((changes, ns) => {
    if (ns !== 'local') return;
    chrome.storage.local.get(DEFAULT, (s) => {
      const st = { ...DEFAULT, ...s };
      setEQUI(st.bass || 0, st.mids || 0, st.treble || 0);
      els.dimEnabled.checked = !!st.dimensionalAudioOn;
      document.querySelectorAll('.dim-btn').forEach(b => { b.classList.toggle('active', b.dataset.dim === String(st.dimensionalPreset)); });
      if (st.audioToolAttachStatus === 'attach_failed') { els.main.style.display = 'none'; els.status.style.display = 'block'; els.status.textContent = 'Attach failed. Reload and play media.'; } else { els.status.style.display = 'none'; }
      document.querySelectorAll('.preset-btn, .creative-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.preset === st.presetMode));
    });
  });

});