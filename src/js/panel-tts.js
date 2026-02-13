// panel-tts.js — Text-to-speech system with chunked playback and highlighting

// ── TTS Waveform Visualization ──
function _ttsStartWaveform(audio) {
  if (!_ttsAudioCtx) _ttsAudioCtx = new AudioContext();
  const src = _ttsAudioCtx.createMediaElementSource(audio);
  _ttsAnalyser = _ttsAudioCtx.createAnalyser();
  _ttsAnalyser.fftSize = 64;
  src.connect(_ttsAnalyser);
  _ttsAnalyser.connect(_ttsAudioCtx.destination);
  const buf = new Uint8Array(_ttsAnalyser.frequencyBinCount);
  function tick() {
    _ttsRafId = requestAnimationFrame(tick);
    if (!_ttsAnalyser) return;
    _ttsAnalyser.getByteFrequencyData(buf);
    const pill = document.querySelector('.pill-island[data-island-id="tts"]');
    if (!pill) return;
    const bars = pill.querySelectorAll('.island-waveform-bar');
    // Sample 7 bars from frequency data
    const count = bars.length;
    const step = Math.floor(buf.length / count);
    for (let i = 0; i < count; i++) {
      const v = buf[i * step] / 255;
      bars[i].style.height = Math.max(2, v * 14) + 'px';
    }
  }
  tick();
}

function _ttsStopWaveform() {
  if (_ttsRafId) { cancelAnimationFrame(_ttsRafId); _ttsRafId = null; }
  _ttsAnalyser = null;
  // Don't close AudioContext — reuse it (creating new ones is expensive)
}

// ── TTS Frame Helpers ──
function _ttsGetFrame() {
  if (typeof _getCurrentWindow !== 'function') return null;
  const win = _getCurrentWindow();
  if (!win) return null;
  // Use the tab where TTS was started, not the currently active tab
  const targetId = _ttsTabId != null ? _ttsTabId : win.activeTab;
  const tab = win.tabs.find(function(t) { return t.id === targetId; });
  return tab && tab.el ? tab.el : null;
}

function _ttsExecInFrame(frame, script) {
  if (!frame) return;
  if (frame.tagName === 'WEBVIEW' && frame.executeJavaScript) {
    frame.executeJavaScript(script).catch(function() {});
  } else if (frame.tagName === 'IFRAME') {
    try { frame.contentWindow.eval(script); } catch(e) {}
  }
}

// ── TTS Text Processing ──
function _ttsSplitSentences(text) {
  // Normalize Unicode hyphens and rejoin line-break splits (e.g. "habili-tation" → "habilitation")
  text = text.replace(/[\u00AD\u2010\u2011\u2012\u2013\u2014\uFE63\uFF0D]/g, '-');
  text = text.replace(/(\w)-\s*\n\s*(\w)/g, function(_, a, b) { return a + b; });
  const _hpSet = new Set(['self','semi','non','pre','post','multi','cross','high','low','long','short','well','co','re','anti','inter','intra','over','under','sub','super','meta','pseudo','quasi','ultra','micro','macro','mid','full','half','all','ever','ill','much','old','new','open','out','two','three','four','five','six','seven','eight','nine','ten','fine','large','small','hard','soft','real','near','far','deep','wide','fast','slow']);
  text = text.replace(/([a-zA-Z]+)-([a-zA-Z]{2,})/g, function(match, before, after) {
    if (_hpSet.has(before.toLowerCase())) return match;
    if (/^[A-Z]/.test(after)) return match;
    return before + after;
  });
  // First split on newlines to preserve line structure
  const lines = text.split(/\n+/).map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
  const result = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // Split line on sentence-ending punctuation
    const parts = line.match(/[^.!?:)]+[.!?:)]+[\s]*/g);
    if (parts && parts.length > 0) {
      const joined = parts.join('');
      if (joined.length < line.length) {
        const leftover = line.substring(joined.length).trim();
        if (leftover) parts.push(leftover);
      }
      for (let pi = 0; pi < parts.length; pi++) {
        const s = parts[pi].trim();
        if (s) result.push(s);
      }
    } else {
      // No punctuation — treat the whole line as one sentence
      result.push(line);
    }
  }
  return result.length > 0 ? result : [text];
}

function _ttsHighlightChunk(chunkText) {
  if (localStorage.getItem('ttsHighlight') === 'false') return;
  const frame = _ttsGetFrame();
  if (!frame || !chunkText) return;
  // Escape for embedding in JS string
  const escaped = chunkText.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
  const script = `(function() {
    // Clear previous TTS highlights
    document.querySelectorAll('mark.aether-tts-highlight').forEach(function(m) {
      var p = m.parentNode;
      if (!p) return;
      p.replaceChild(document.createTextNode(m.textContent), m);
    });
    document.body.normalize();

    // Build a flat list of text nodes
    var skip = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','IFRAME']);
    var textNodes = [];
    function walk(el) {
      if (skip.has(el.tagName)) return;
      for (var i = 0; i < el.childNodes.length; i++) {
        var c = el.childNodes[i];
        if (c.nodeType === 3) textNodes.push(c);
        else if (c.nodeType === 1) walk(c);
      }
    }
    walk(document.body || document.documentElement);

    // Concatenate all text to find the chunk's position
    var full = '';
    var map = []; // { node, start, end }
    for (var i = 0; i < textNodes.length; i++) {
      var s = full.length;
      full += textNodes[i].textContent;
      map.push({ node: textNodes[i], start: s, end: full.length });
    }

    // Normalize: collapse whitespace AND remove hyphens at word breaks
    // (TTS preprocessing rejoins hyphens, so we must do the same to match)
    var chunk = '${escaped}';
    var chunkNorm = chunk.replace(/\\s+/g, ' ').trim();

    // Build normalized fullNorm with position map back to original indices
    var fullNorm = '';
    var normToOrig = [];
    var prevWasSpace = false;
    for (var k = 0; k < full.length; k++) {
      var ch = full[k];
      if (/\\s/.test(ch)) {
        if (!prevWasSpace) {
          fullNorm += ' ';
          normToOrig.push(k);
          prevWasSpace = true;
        }
      } else if (ch === '-' && k > 0 && /\\w/.test(full[k - 1])) {
        // Check if this is a line-break or compound hyphen to skip
        var peek = k + 1;
        while (peek < full.length && /\\s/.test(full[peek])) peek++;
        if (peek < full.length && /\\w/.test(full[peek])) {
          // Skip hyphen + any following whitespace (rejoins like TTS preprocessing)
          k = peek - 1;
          prevWasSpace = false;
          continue;
        }
        fullNorm += ch;
        normToOrig.push(k);
        prevWasSpace = false;
      } else {
        fullNorm += ch;
        normToOrig.push(k);
        prevWasSpace = false;
      }
    }

    // Try to find the chunk — use first 80 chars for matching
    var searchStr = chunkNorm.substring(0, 80);
    var normIdx = fullNorm.indexOf(searchStr);
    // Fallback: try without hyphen removal (for pages where preprocessing didn't change text)
    if (normIdx === -1) {
      fullNorm = full.replace(/\\s+/g, ' ');
      normToOrig = null;
      normIdx = fullNorm.indexOf(searchStr);
    }
    if (normIdx === -1) return;

    // Map normalized positions back to original
    var origIdx, origEnd;
    if (normToOrig) {
      origIdx = normToOrig[normIdx] || 0;
      var endNormIdx = Math.min(normIdx + chunkNorm.length, normToOrig.length);
      origEnd = endNormIdx < normToOrig.length ? normToOrig[endNormIdx] : full.length;
    } else {
      // Fallback: whitespace-only normalization mapping
      origIdx = 0; var nc = 0;
      for (var ki = 0; ki < full.length && nc < normIdx; ki++) {
        if (/\\s/.test(full[ki])) {
          while (ki + 1 < full.length && /\\s/.test(full[ki + 1])) ki++;
        }
        nc++; origIdx = ki + 1;
      }
      var endNI = normIdx + chunkNorm.length;
      origEnd = origIdx; var nc2 = nc;
      for (var k2 = origIdx; k2 < full.length && nc2 < endNI; k2++) {
        if (/\\s/.test(full[k2])) {
          while (k2 + 1 < full.length && /\\s/.test(full[k2 + 1])) k2++;
        }
        nc2++; origEnd = k2 + 1;
      }
    }

    // Wrap matching text nodes in highlight marks
    var first = null;
    for (var j = 0; j < map.length; j++) {
      var m = map[j];
      if (m.end <= origIdx || m.start >= origEnd) continue;
      var nStart = Math.max(0, origIdx - m.start);
      var nEnd = Math.min(m.node.textContent.length, origEnd - m.start);
      var txt = m.node.textContent;
      var before = txt.substring(0, nStart);
      var mid = txt.substring(nStart, nEnd);
      var after = txt.substring(nEnd);
      var mark = document.createElement('mark');
      mark.className = 'aether-tts-highlight';
      mark.style.cssText = 'background:rgba(100,149,237,0.25);border-radius:3px;color:inherit;padding:1px 0;';
      mark.textContent = mid;
      var parent = m.node.parentNode;
      if (before) parent.insertBefore(document.createTextNode(before), m.node);
      parent.insertBefore(mark, m.node);
      if (after) parent.insertBefore(document.createTextNode(after), m.node);
      parent.removeChild(m.node);
      if (!first) first = mark;
    }
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  })()`;
  _ttsExecInFrame(frame, script);
}

function _ttsClearHighlights() {
  const frame = _ttsGetFrame();
  if (!frame) return;
  const script = `(function() {
    document.querySelectorAll('mark.aether-tts-highlight').forEach(function(m) {
      var p = m.parentNode;
      if (!p) return;
      p.replaceChild(document.createTextNode(m.textContent), m);
    });
    document.body.normalize();
  })()`;
  _ttsExecInFrame(frame, script);
}

// ── TTS UI Updates ──
function _ttsUpdateBtnIcon() {
  const btn = document.getElementById('pill-readaloud-btn');
  if (!btn) return;
  const speaker = btn.querySelector('.tts-icon-speaker');
  const pause = btn.querySelector('.tts-icon-pause');
  const play = btn.querySelector('.tts-icon-play');
  const stopBtn = document.getElementById('pill-readaloud-stop');
  const isActive = _ttsAudio || _ttsPaused || _ttsChunks.length > 0;
  if (speaker) speaker.style.display = isActive ? 'none' : '';
  if (pause) pause.style.display = (isActive && !_ttsPaused) ? '' : 'none';
  if (play) play.style.display = (isActive && _ttsPaused) ? '' : 'none';
  if (stopBtn) {
    if (isActive) stopBtn.classList.add('tts-has-audio');
    else stopBtn.classList.remove('tts-has-audio');
  }
}

// ── TTS Playback Control ──
function _ttsStopAll() {
  _ttsStopped = true;
  _ttsPaused = false;
  if (_ttsAudio) { _ttsAudio.pause(); _ttsAudio = null; }
  _ttsStopWaveform();
  _ttsQueue.forEach(function(u) { URL.revokeObjectURL(u); });
  _ttsQueue = [];
  _ttsChunks = [];
  _ttsChunkIdx = 0;
  _ttsPlayingChunkIdx = -1;
  _ttsTabId = null;
  _ttsPlayedDurations = [];
  _ttsRemainingDurations = [];
  _ttsClearHighlights();
  _clearAudioUnified('tts');
  _ttsUpdateBtnIcon();
  document.querySelectorAll('.doc-msg-speak-btn.doc-msg-speaking').forEach(function(b) { b.classList.remove('doc-msg-speaking'); });
}

function _ttsPauseResume() {
  if (!_ttsAudio && !_ttsPaused) return;
  if (_ttsPaused) {
    _ttsPaused = false;
    if (_ttsAudio) {
      _ttsAudio.play();
      _ttsStartWaveform(_ttsAudio);
    } else if (_ttsQueue.length > 0) {
      _ttsPlayNext();
    }
    _updateAudioUnified('tts', { label: 'Reading', detail: _ttsTimeDetail() });
  } else {
    _ttsPaused = true;
    if (_ttsAudio) { _ttsAudio.pause(); }
    _ttsStopWaveform();
    _updateAudioUnified('tts', { label: 'Paused', detail: _ttsTimeDetail(), paused: true });
  }
  _ttsUpdateBtnIcon();
}

function _ttsFormatTime(secs) {
  let s = Math.round(secs);
  if (s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

function _ttsTimeDetail() {
  if (!_ttsAudio && !_ttsPaused) return '';
  const audio = _ttsAudio;
  let currentRemaining = 0;
  if (audio && audio.duration && isFinite(audio.duration)) {
    currentRemaining = audio.duration - audio.currentTime;
  }
  let queuedRemaining = 0;
  for (let i = 0; i < _ttsRemainingDurations.length; i++) queuedRemaining += _ttsRemainingDurations[i];
  // Estimate unfetched chunks using avg duration of played chunks, or ~14 chars/sec fallback
  let avgSecsPerChar = 1 / 14;
  if (_ttsPlayedDurations.length > 0) {
    let totalPlayed = 0;
    let totalChars = 0;
    for (let k = 0; k < _ttsPlayedDurations.length; k++) {
      totalPlayed += _ttsPlayedDurations[k];
      if (_ttsChunks[k]) totalChars += _ttsChunks[k].length;
    }
    if (totalChars > 0) avgSecsPerChar = totalPlayed / totalChars;
  }
  let unfetched = 0;
  for (let j = _ttsChunkIdx; j < _ttsChunks.length; j++) unfetched += _ttsChunks[j].length * avgSecsPerChar;
  const total = currentRemaining + queuedRemaining + unfetched;
  return _ttsFormatTime(total) + ' left';
}

function _ttsChunkText(text) {
  // Normalize Unicode hyphens/dashes to ASCII hyphen before processing
  text = text.replace(/[\u00AD\u2010\u2011\u2012\u2013\u2014\uFE63\uFF0D]/g, '-');
  // Rejoin line-break hyphens common in PDFs (e.g. "regular-\nities" → "regularities")
  text = text.replace(/(\w)-\s+(\w)/g, function(_, a, b) { return a + b; });
  // Rejoin inline hyphens from line-break splits (e.g. "habili-tation" → "habilitation")
  const _hyphenPrefixes = new Set(['self','semi','non','pre','post','multi','cross','high','low','long','short','well','co','re','anti','inter','intra','over','under','sub','super','meta','pseudo','quasi','ultra','micro','macro','mid','full','half','all','ever','ill','much','old','new','open','out','two','three','four','five','six','seven','eight','nine','ten','fine','large','small','hard','soft','real','near','far','deep','wide','fast','slow']);
  text = text.replace(/([a-zA-Z]+)-([a-zA-Z]{2,})/g, function(match, before, after) {
    if (_hyphenPrefixes.has(before.toLowerCase())) return match;
    if (/^[A-Z]/.test(after)) return match;
    return before + after;
  });
  // Split on any newline(s) to preserve line structure from <br> etc.
  const maxChunk = 1000;
  const paras = text.split(/\n+/).filter(function(p) { return p.trim().length > 0; });
  const chunks = [];
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i].trim();
    if (p.length <= maxChunk) { chunks.push(p); continue; }
    // Split on sentence boundaries
    const sentences = p.match(/[^.!?]+[.!?]+[\s]*/g) || [p];
    let cur = '';
    for (let j = 0; j < sentences.length; j++) {
      if (cur.length + sentences[j].length > maxChunk && cur.length > 0) {
        chunks.push(cur.trim());
        cur = '';
      }
      cur += sentences[j];
    }
    if (cur.trim()) chunks.push(cur.trim());
  }
  // Merge tiny chunks with next
  const merged = [];
  for (let k = 0; k < chunks.length; k++) {
    if (merged.length > 0 && merged[merged.length - 1].length < 100) {
      merged[merged.length - 1] += '\n' + chunks[k];
    } else {
      merged.push(chunks[k]);
    }
  }
  return merged;
}

async function _ttsFetchChunk(text) {
  const r = await api('/api/tts', {
    method: 'POST',
    body: JSON.stringify({ text: text })
  });
  return await r.blob();
}

function _ttsPlayNext() {
  if (_ttsStopped || _ttsQueue.length === 0) return;
  const url = _ttsQueue.shift();
  // Remove first queued duration since we're now playing it
  if (_ttsRemainingDurations.length > 0) _ttsRemainingDurations.shift();
  const audio = new Audio(url);
  audio.playbackRate = parseFloat(localStorage.getItem('ttsSpeed')) || 1;
  _ttsAudio = audio;
  _ttsUpdateBtnIcon();
  const total = _ttsChunks.length;
  const playing = total - _ttsQueue.length - (_ttsChunkIdx < total ? (total - _ttsChunkIdx) : 0);
  _ttsPlayingChunkIdx = playing - 1;
  _updateAudioUnified('tts', { label: 'Reading ' + playing + '/' + total, detail: _ttsTimeDetail() || 'Reading page aloud' });
  _ttsStartWaveform(audio);
  // Sentence-level highlighting: split chunk into sentences, update on timeupdate
  const chunkText = (_ttsPlayingChunkIdx >= 0 && _ttsPlayingChunkIdx < _ttsChunks.length) ? _ttsChunks[_ttsPlayingChunkIdx] : null;
  const sentences = chunkText ? _ttsSplitSentences(chunkText) : [];
  let lastSentIdx = -1;
  audio.addEventListener('timeupdate', function() {
    if (!sentences.length || !audio.duration || !isFinite(audio.duration)) return;
    const progress = audio.currentTime / audio.duration;
    // Estimate sentence index by character proportion
    let totalChars = 0;
    for (var si = 0; si < sentences.length; si++) totalChars += sentences[si].length;
    const charPos = progress * totalChars;
    let cumulative = 0;
    let sentIdx = 0;
    for (var si = 0; si < sentences.length; si++) {
      cumulative += sentences[si].length;
      if (charPos < cumulative) { sentIdx = si; break; }
      sentIdx = si;
    }
    if (sentIdx !== lastSentIdx) {
      lastSentIdx = sentIdx;
      _ttsHighlightChunk(sentences[sentIdx]);
    }
  });
  // Kick off first sentence highlight immediately
  if (sentences.length) {
    lastSentIdx = 0;
    _ttsHighlightChunk(sentences[0]);
  }
  // Update time detail once duration is known
  audio.addEventListener('loadedmetadata', function() {
    _updateAudioUnified('tts', { label: 'Reading ' + playing + '/' + total, detail: _ttsTimeDetail() });
  });
  audio.onended = function() {
    if (audio.duration && isFinite(audio.duration)) _ttsPlayedDurations.push(audio.duration);
    URL.revokeObjectURL(url);
    _ttsAudio = null;
    _ttsStopWaveform();
    if (_ttsQueue.length > 0) {
      _ttsPlayNext();
    } else if (_ttsChunkIdx >= _ttsChunks.length) {
      // All done
      _ttsPlayingChunkIdx = -1;
      _ttsTabId = null;
      _ttsChunks = [];
      _ttsChunkIdx = 0;
      _ttsClearHighlights();
      _ttsPlayedDurations = [];
      _ttsRemainingDurations = [];
      _clearAudioUnified('tts');
      _ttsUpdateBtnIcon();
    }
    // else: still fetching, will play when ready
  };
  audio.onerror = function() {
    URL.revokeObjectURL(url);
    _ttsAudio = null;
    _ttsStopWaveform();
    _ttsStopAll();
  };
  audio.play();
}

async function _ttsFetchAndQueue() {
  while (_ttsChunkIdx < _ttsChunks.length && !_ttsStopped) {
    const idx = _ttsChunkIdx++;
    const total = _ttsChunks.length;
    if (!_ttsAudio && !_ttsPaused) _updateAudioUnified('tts', { label: 'Generating ' + (idx + 1) + '/' + total, detail: 'Generating speech audio' });
    try {
      const blob = await _ttsFetchChunk(_ttsChunks[idx]);
      if (_ttsStopped) return;
      const url = URL.createObjectURL(blob);
      _ttsQueue.push(url);
      // Estimate duration from blob size (24kHz 16-bit mono WAV ≈ 48000 bytes/sec, minus 44-byte header)
      const estDuration = Math.max(0, (blob.size - 44) / 48000);
      _ttsRemainingDurations.push(estDuration);
      // Start playing as soon as first chunk is ready
      if (!_ttsAudio && !_ttsPaused) _ttsPlayNext();
    } catch (e) {
      if (!_ttsAudio) _ttsStopAll();
      return;
    }
  }
}
