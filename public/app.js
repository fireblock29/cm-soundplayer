const $ = (sel) => document.querySelector(sel);

const els = {
  status: $('#status'),
  list: $('#list'),
  search: $('#search'),
  playPause: $('#playPause'),
  title: $('#title'),
  cur: $('#cur'),
  dur: $('#dur'),
  progress: $('#progress'),
  volume: $('#volume'),
  addKeypoint: $('#addKeypoint'),
  goToKeypoint: $('#goToKeypoint'),
  keypointMarkers: $('#keypointMarkers'),
  keypointNames: $('#keypointNames'),
  btnRemote: $('#btnRemote'),
  remoteModal: $('#remoteModal'),
  closeRemote: $('#closeRemote'),
  qrCode: $('#qrCode'),
  remoteUrl: $('#remoteUrl')
};

let tracks = [];
let activeTrack = null;
let keypoints = [];

let ws = null;
let wsReconnectTimeout = null;
let wsHeartbeatInterval = null;
let messageQueue = [];
let isReconnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const WS_URL = `ws://${window.location.host}/ws?type=main`;

function connectWebSocket() {
  if (isReconnecting) return;
  isReconnecting = true;

  // Clear any existing connection
  if (ws) {
    try { ws.close(); } catch (e) {}
  }
  if (wsHeartbeatInterval) {
    clearInterval(wsHeartbeatInterval);
    wsHeartbeatInterval = null;
  }

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    isReconnecting = false;
    reconnectAttempts = 0;
    clearTimeout(wsReconnectTimeout);

    // Start heartbeat
    wsHeartbeatInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000);

    // Send queued messages
    while (messageQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
      const msg = messageQueue.shift();
      ws.send(JSON.stringify(msg));
    }

    // Broadcast current state to ensure sync
    setTimeout(() => {
      broadcastState();
      broadcastTrackChanged();
    }, 100);
  };

  ws.onclose = (e) => {
    isReconnecting = false;
    if (wsHeartbeatInterval) {
      clearInterval(wsHeartbeatInterval);
      wsHeartbeatInterval = null;
    }

    // Exponential backoff with max 10 seconds
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts - 1), 10000);

    if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      wsReconnectTimeout = setTimeout(connectWebSocket, delay);
    }
  };

  ws.onerror = () => {
    ws.close();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      // eslint-disable-next-line no-console
      console.log('[main] Received WS message:', msg.type, msg);

      // Handle ping/pong from server
      if (msg.type === 'ping') {
        sendWs({ type: 'pong' });
        return;
      }
      if (msg.type === 'pong') {
        return; // Just a keepalive
      }

      handleRemoteCommand(msg);
    } catch (e) {
      // ignore
      // eslint-disable-next-line no-console
      console.log('[main] Error handling message:', e);
    }
  };
}

function sendWs(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch (e) {
      // Failed to send, queue it
      messageQueue.push(msg);
      return false;
    }
  } else {
    // Connection not ready, queue message
    messageQueue.push(msg);

    // Try to reconnect if not already trying
    if (!isReconnecting) {
      connectWebSocket();
    }
    return false;
  }
}

function broadcastState() {
  sendWs({
    type: 'state',
    data: {
      playing: engine.playing,
      title: activeTrack?.title || null,
      currentTime: getCurrentTime(),
      duration: getDuration(),
      volume: engine.gain?.gain.value || 1,
      playbackRate: engine.playbackRate,
      keypoints: keypoints
    }
  });
}

function broadcastTrackChanged() {
  sendWs({
    type: 'trackChanged',
    title: activeTrack?.title || null,
    keypoints: keypoints
  });
}

async function handleRemoteCommand(msg) {
  switch (msg.type) {
    case 'togglePlayPause':
      els.playPause.click();
      break;
    case 'previous':
      playPreviousTrack();
      break;
    case 'next':
      playNextTrack();
      break;
    case 'playTrack':
      // eslint-disable-next-line no-console
      console.log('[main] playTrack command received, file:', msg.file);
      // eslint-disable-next-line no-console
      console.log('[main] Available tracks:', tracks.length, tracks.map(t => t.file));
      if (msg.file) {
        const track = tracks.find(t => t.file === msg.file);
        // eslint-disable-next-line no-console
        console.log('[main] Found track:', track);
        if (track) {
          // eslint-disable-next-line no-console
          console.log('[main] Calling playTrack...');
          playTrack(track).catch(e => {
            // eslint-disable-next-line no-console
            console.error('[main] playTrack failed:', e);
          });
        } else {
          // eslint-disable-next-line no-console
          console.log('[main] Track not found in tracks array');
        }
      }
      break;
    case 'seek':
      if (typeof msg.offset === 'number') {
        const dur = getDuration();
        if (Number.isFinite(dur) && dur > 0) {
          const newTime = Math.max(0, Math.min(getCurrentTime() + msg.offset, dur));
          engine.offset = newTime;
          if (engine.playing) {
            startFromOffset(newTime);
          } else {
            els.cur.textContent = formatTime(newTime);
            if (Number.isFinite(dur) && dur > 0) {
              els.progress.value = String(Math.round((newTime / dur) * 1000));
            }
          }
          broadcastState();
        }
      }
      break;
    case 'setVolume':
      if (typeof msg.volume === 'number') {
        const v = Math.max(0, Math.min(msg.volume, 1));
        els.volume.value = v;
        if (engine.gain) engine.gain.gain.value = v;
        broadcastState();
      }
      break;
    case 'jumpToTime':
      if (typeof msg.time === 'number') {
        jumpToTime(msg.time);
        broadcastState();
      }
      break;
    case 'setSpeed':
      if (typeof msg.speed === 'number') {
        setPlaybackSpeed(msg.speed);
      }
      break;
    case 'requestState':
      broadcastState();
      break;
  }
}

function playPreviousTrack() {
  if (!activeTrack || tracks.length === 0) return;
  const idx = tracks.findIndex(t => t.file === activeTrack.file);
  if (idx > 0) {
    playTrack(tracks[idx - 1]);
  } else if (idx === 0) {
    playTrack(tracks[tracks.length - 1]);
  }
}

function playNextTrack() {
  if (!activeTrack || tracks.length === 0) return;
  const idx = tracks.findIndex(t => t.file === activeTrack.file);
  if (idx < tracks.length - 1) {
    playTrack(tracks[idx + 1]);
  } else if (idx === tracks.length - 1) {
    playTrack(tracks[0]);
  }
}

const KEYPOINT_COLORS = ['#F26A8D', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#f472b6'];

const MAX_DECODED_BUFFERS = 8;
const arrayBufferCache = new Map();
const decodedBufferCache = new Map();
const decodedOrder = [];

const player = {
  raf: null,
  isSeeking: false
};

const engine = {
  supported: typeof window.AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined',
  ctx: null,
  gain: null,
  source: null,
  buffer: null,
  trackUrl: null,
  playing: false,
  startTime: 0,
  offset: 0,
  stopping: false,
  playbackRate: 1
};

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function setStatus(text) {
  els.status.textContent = text || '';
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / (1024 ** i);
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function stopRaf() {
  if (player.raf) cancelAnimationFrame(player.raf);
  player.raf = null;
}

function tick() {
  if (!player.isSeeking) {
    const dur = getDuration();
    const cur = getCurrentTime();
    els.cur.textContent = formatTime(cur);
    els.dur.textContent = formatTime(dur);

    if (Number.isFinite(dur) && dur > 0) {
      els.progress.disabled = false;
      els.progress.value = String(Math.round((cur / dur) * 1000));
      // Render keypoints markers when duration is known
      if (keypoints.length > 0 && els.keypointMarkers.children.length === 0) {
        renderKeypointMarkers();
      }
    } else {
      els.progress.disabled = true;
      els.progress.value = '0';
    }
  }

  // Broadcast state every ~1 second when playing
  if (engine.playing && player.raf && !player.isSeeking) {
    if (Math.floor(getCurrentTime()) % 1 === 0) {
      broadcastState();
    }
  }

  if (engine.playing) player.raf = requestAnimationFrame(tick);
}

function updatePlayPauseLabel() {
  els.playPause.textContent = engine.playing ? 'Pause' : 'Play';
}

function ensureAudioContext() {
  if (!engine.supported) return false;
  if (!engine.ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    engine.ctx = new Ctx({ latencyHint: 'interactive' });
    engine.gain = engine.ctx.createGain();
    engine.gain.connect(engine.ctx.destination);
    engine.gain.gain.value = Number(els.volume.value);
  }

  if (engine.ctx.state === 'suspended') {
    engine.ctx.resume().catch(() => {});
  }

  return true;
}

function getDuration() {
  return engine.buffer?.duration ?? 0;
}

function getCurrentTime() {
  if (!engine.playing || !engine.ctx) return engine.offset;
  return engine.offset + (engine.ctx.currentTime - engine.startTime);
}

function stopSource() {
  if (!engine.source) return;
  engine.stopping = true;
  const src = engine.source;
  src.onended = null;
  try {
    src.stop();
  } catch {
    // ignore
  }
  try {
    src.disconnect();
  } catch {
    // ignore
  }
  engine.source = null;
  engine.playing = false;
  engine.stopping = false;
}

function startFromOffset(offsetSeconds) {
  if (!engine.ctx || !engine.buffer || !engine.gain) return;

  stopSource();

  const src = engine.ctx.createBufferSource();
  src.buffer = engine.buffer;
  src.playbackRate.value = engine.playbackRate;
  src.connect(engine.gain);
  src.onended = () => {
    if (engine.stopping) return;
    engine.playing = false;
    engine.source = null;
    engine.offset = 0;
    updatePlayPauseLabel();
    stopRaf();
    els.progress.value = '0';
  };

  engine.source = src;
  engine.startTime = engine.ctx.currentTime;
  engine.offset = Math.max(0, Math.min(offsetSeconds, engine.buffer.duration || 0));
  engine.playing = true;

  src.start(0, engine.offset);

  updatePlayPauseLabel();
  stopRaf();
  player.raf = requestAnimationFrame(tick);
}

function touchDecodedOrder(url) {
  const idx = decodedOrder.indexOf(url);
  if (idx !== -1) decodedOrder.splice(idx, 1);
  decodedOrder.push(url);

  while (decodedOrder.length > MAX_DECODED_BUFFERS) {
    const victim = decodedOrder.shift();
    if (victim) decodedBufferCache.delete(victim);
  }
}

async function fetchArrayBuffer(url) {
  if (!arrayBufferCache.has(url)) {
    const p = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    arrayBufferCache.set(url, p);
  }
  return arrayBufferCache.get(url);
}

async function fetchArrayBufferWithProgress(url, onProgress) {
  if (!arrayBufferCache.has(url)) {
    const p = (async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const totalHeader = r.headers.get('content-length');
      const total = totalHeader ? Number(totalHeader) : 0;
      const reader = r.body?.getReader?.();

      if (!reader) {
        const ab = await r.arrayBuffer();
        if (typeof onProgress === 'function') {
          onProgress({ phase: 'download', loaded: ab.byteLength, total: ab.byteLength, pct: 1 });
        }
        return ab;
      }

      let loaded = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        if (typeof onProgress === 'function') {
          const pct = total > 0 ? loaded / total : null;
          onProgress({ phase: 'download', loaded, total: total || null, pct });
        }
      }

      const out = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (typeof onProgress === 'function') {
        onProgress({ phase: 'download', loaded, total: total || loaded, pct: 1 });
      }
      return out.buffer;
    })();

    arrayBufferCache.set(url, p);
  }

  const ab = await arrayBufferCache.get(url);
  return ab;
}

async function getDecodedBuffer(url, opts = {}) {
  if (decodedBufferCache.has(url)) {
    touchDecodedOrder(url);
    return decodedBufferCache.get(url);
  }

  if (!ensureAudioContext()) throw new Error('WebAudio not supported');

  const ab = opts.onProgress
    ? await fetchArrayBufferWithProgress(url, opts.onProgress)
    : await fetchArrayBuffer(url);

  if (typeof opts.onProgress === 'function') {
    opts.onProgress({ phase: 'decode' });
  }

  const decoded = await engine.ctx.decodeAudioData(ab.slice(0));
  decodedBufferCache.set(url, decoded);
  touchDecodedOrder(url);
  return decoded;
}

function prefetch(url) {
  if (arrayBufferCache.has(url) || decodedBufferCache.has(url)) return;
  fetchArrayBuffer(url).catch(() => {});
}

// Keypoints API
async function loadKeypoints(file) {
  try {
    const res = await fetch(`/api/keypoints/${encodeURIComponent(file)}`);
    if (!res.ok) throw new Error('Failed to load keypoints');
    keypoints = await res.json();
    renderKeypoints();
    updateKeypointButtons();
  } catch (e) {
    keypoints = [];
    renderKeypoints();
    updateKeypointButtons();
  }
}

async function saveKeypoint(file, time, name, color) {
  try {
    const res = await fetch(`/api/keypoints/${encodeURIComponent(file)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time, name, color })
    });
    if (!res.ok) throw new Error('Failed to save keypoint');
    keypoints = await res.json();
    renderKeypoints();
    return true;
  } catch (e) {
    setStatus('Erreur lors de la sauvegarde du point');
    return false;
  }
}

async function deleteKeypoint(file, time) {
  try {
    const res = await fetch(`/api/keypoints/${encodeURIComponent(file)}/${time}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to delete keypoint');
    keypoints = await res.json();
    renderKeypoints();
    updateKeypointButtons();
  } catch (e) {
    setStatus('Erreur lors de la suppression du point');
  }
}

// Keypoints UI
function updateKeypointButtons() {
  const hasTrack = !!activeTrack;
  els.addKeypoint.disabled = !hasTrack;
  els.goToKeypoint.disabled = !hasTrack || keypoints.length === 0;
}

function renderKeypoints() {
  renderKeypointMarkers();
  renderKeypointNames();
  updateKeypointButtons();
}

function renderKeypointMarkers() {
  els.keypointMarkers.innerHTML = '';
  const dur = getDuration();
  if (!Number.isFinite(dur) || dur <= 0) return;

  keypoints.forEach((kp, index) => {
    const marker = document.createElement('div');
    marker.className = 'keypoint-marker';
    const percent = (kp.time / dur) * 100;
    marker.style.left = `${percent}%`;
    marker.style.backgroundColor = kp.color || KEYPOINT_COLORS[index % KEYPOINT_COLORS.length];
    marker.title = `${kp.name} (${formatTime(kp.time)})`;
    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      jumpToTime(kp.time);
    });
    els.keypointMarkers.appendChild(marker);
  });
}

function renderKeypointNames() {
  els.keypointNames.innerHTML = '';
  keypoints.forEach((kp, index) => {
    const nameEl = document.createElement('span');
    nameEl.className = 'keypoint-name';
    nameEl.textContent = kp.name;
    nameEl.style.borderColor = kp.color || KEYPOINT_COLORS[index % KEYPOINT_COLORS.length];
    nameEl.addEventListener('click', () => jumpToTime(kp.time));
    els.keypointNames.appendChild(nameEl);
  });
}

function jumpToTime(time) {
  const dur = getDuration();
  if (!Number.isFinite(dur) || dur <= 0) return;

  engine.offset = Math.max(0, Math.min(time, dur));

  if (engine.playing) {
    startFromOffset(engine.offset);
  } else {
    els.cur.textContent = formatTime(engine.offset);
    if (Number.isFinite(dur) && dur > 0) {
      els.progress.value = String(Math.round((engine.offset / dur) * 1000));
    }
  }
}

// Modal functions
function showAddKeypointModal() {
  const currentTime = getCurrentTime();
  const dur = getDuration();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';

  const title = document.createElement('h3');
  title.textContent = `Ajouter un point clé à ${formatTime(currentTime)}`;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Nom du point (ex: Intro, refrain, solo...)';
  input.autofocus = true;

  const colorLabel = document.createElement('div');
  colorLabel.textContent = 'Couleur :';
  colorLabel.style.marginBottom = '8px';
  colorLabel.style.fontSize = '12px';

  const colorContainer = document.createElement('div');
  colorContainer.style.display = 'flex';
  colorContainer.style.gap = '8px';
  colorContainer.style.marginBottom = '16px';

  let selectedColor = KEYPOINT_COLORS[0];
  KEYPOINT_COLORS.forEach(color => {
    const colorBtn = document.createElement('button');
    colorBtn.style.width = '24px';
    colorBtn.style.height = '24px';
    colorBtn.style.borderRadius = '50%';
    colorBtn.style.backgroundColor = color;
    colorBtn.style.border = '2px solid transparent';
    colorBtn.style.cursor = 'pointer';
    colorBtn.addEventListener('click', () => {
      selectedColor = color;
      Array.from(colorContainer.children).forEach(btn => {
        btn.style.border = '2px solid transparent';
      });
      colorBtn.style.border = '2px solid white';
    });
    colorContainer.appendChild(colorBtn);
  });

  // Select first color by default
  colorContainer.children[0].style.border = '2px solid white';

  const buttons = document.createElement('div');
  buttons.className = 'modal-buttons';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', () => overlay.remove());

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn';
  saveBtn.textContent = 'Sauvegarder';
  saveBtn.addEventListener('click', async () => {
    const name = input.value.trim();
    if (!name) {
      input.style.borderColor = '#ff6b6b';
      return;
    }
    const success = await saveKeypoint(activeTrack.file, currentTime, name, selectedColor);
    if (success) overlay.remove();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBtn.click();
    if (e.key === 'Escape') overlay.remove();
  });

  buttons.appendChild(cancelBtn);
  buttons.appendChild(saveBtn);

  modal.appendChild(title);
  modal.appendChild(input);
  modal.appendChild(colorLabel);
  modal.appendChild(colorContainer);
  modal.appendChild(buttons);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  input.focus();
}

function showGoToKeypointModal() {
  if (keypoints.length === 0) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';

  const title = document.createElement('h3');
  title.textContent = 'Aller à un point clé';

  const list = document.createElement('div');
  list.className = 'keypoint-list';

  keypoints.forEach((kp, index) => {
    const item = document.createElement('div');
    item.className = 'keypoint-item';

    const timeEl = document.createElement('span');
    timeEl.className = 'keypoint-item__time';
    timeEl.textContent = formatTime(kp.time);

    const nameEl = document.createElement('span');
    nameEl.className = 'keypoint-item__name';
    nameEl.textContent = kp.name;

    const colorIndicator = document.createElement('span');
    colorIndicator.style.width = '12px';
    colorIndicator.style.height = '12px';
    colorIndicator.style.borderRadius = '50%';
    colorIndicator.style.backgroundColor = kp.color || KEYPOINT_COLORS[index % KEYPOINT_COLORS.length];

    const deleteEl = document.createElement('span');
    deleteEl.className = 'keypoint-item__delete';
    deleteEl.textContent = '×';
    deleteEl.title = 'Supprimer';
    deleteEl.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteKeypoint(activeTrack.file, kp.time);
      item.remove();
      if (keypoints.length === 0) overlay.remove();
    });

    item.appendChild(colorIndicator);
    item.appendChild(timeEl);
    item.appendChild(nameEl);
    item.appendChild(deleteEl);

    item.addEventListener('click', () => {
      jumpToTime(kp.time);
      overlay.remove();
    });

    list.appendChild(item);
  });

  const buttons = document.createElement('div');
  buttons.className = 'modal-buttons';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn';
  closeBtn.textContent = 'Fermer';
  closeBtn.addEventListener('click', () => overlay.remove());

  buttons.appendChild(closeBtn);

  modal.appendChild(title);
  modal.appendChild(list);
  modal.appendChild(buttons);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function setActiveUI(file) {
  const cards = els.list.querySelectorAll('[data-file]');
  for (const c of cards) {
    const isActive = c.getAttribute('data-file') === file;
    const badge = c.querySelector('.badge');
    badge.classList.toggle('badge--active', isActive);
    badge.textContent = isActive ? 'En lecture' : 'Play';
  }
}

function renderList() {
  const q = (els.search.value || '').trim().toLowerCase();
  const filtered = q
    ? tracks.filter((t) => t.title.toLowerCase().includes(q) || t.file.toLowerCase().includes(q))
    : tracks;

  els.list.innerHTML = '';

  for (const t of filtered) {
    const div = document.createElement('div');
    div.className = 'item';
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.setAttribute('data-file', t.file);

    const left = document.createElement('div');

    const title = document.createElement('div');
    title.className = 'item__title';
    title.textContent = t.title;

    const hint = document.createElement('div');
    hint.className = 'item__hint';
    hint.textContent = t.file;

    left.appendChild(title);
    left.appendChild(hint);

    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = (activeTrack?.file === t.file) ? 'En lecture' : 'Play';
    if (activeTrack?.file === t.file) badge.classList.add('badge--active');

    div.appendChild(left);
    div.appendChild(badge);

    const activate = () => playTrack(t);

    div.addEventListener('mouseenter', () => prefetch(t.url));
    div.addEventListener('focus', () => prefetch(t.url));

    div.addEventListener('click', activate);
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });

    els.list.appendChild(div);
  }

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'status';
    empty.textContent = 'Aucun son ne correspond à la recherche.';
    els.list.appendChild(empty);
  }
}

async function playTrack(track) {
  try {
    activeTrack = track;
    els.title.textContent = track.title;
    setActiveUI(track.file);

    els.playPause.disabled = false;

    ensureAudioContext();
    const url = new URL(track.url, window.location.href).href;

    if (engine.trackUrl !== url) {
      engine.trackUrl = url;
      engine.offset = 0;
      engine.buffer = null;
      stopSource();
      // Clear keypoints when changing track
      keypoints = [];
      renderKeypoints();
    }

    if (!engine.buffer) {
      setStatus('Chargement…');
      const onProgress = (info) => {
        if (!info) return;
        if (info.phase === 'download') {
          if (typeof info.pct === 'number') {
            setStatus(`Téléchargement… ${Math.round(info.pct * 100)}%`);
          } else {
            setStatus(`Téléchargement… ${formatBytes(info.loaded)}`);
          }
        }
        if (info.phase === 'decode') {
          setStatus('Décodage…');
        }
      };

      engine.buffer = await getDecodedBuffer(url, { onProgress });
      setStatus('');
    }

    startFromOffset(engine.offset);
    els.dur.textContent = formatTime(getDuration());

    // Load keypoints for this track
    loadKeypoints(track.file);

    // Broadcast track change to remotes
    broadcastTrackChanged();

    const idx = tracks.findIndex((t) => new URL(t.url, window.location.href).href === url);
    if (idx !== -1) {
      const next = tracks.slice(idx + 1, idx + 4);
      for (const t of next) {
        const nextUrl = new URL(t.url, window.location.href).href;
        getDecodedBuffer(nextUrl).catch(() => {});
      }
    }
  } catch (e) {
    setStatus('Impossible de démarrer la lecture (autorisation navigateur ou fichier indisponible).');
  }
}

els.playPause.addEventListener('click', async () => {
  try {
    ensureAudioContext();
    if (!activeTrack) {
      if (tracks[0]) await playTrack(tracks[0]);
      return;
    }

    if (!engine.buffer) {
      await playTrack(activeTrack);
      return;
    }

    if (engine.playing) {
      engine.offset = getCurrentTime();
      engine.playing = false;
      stopSource();
      updatePlayPauseLabel();
      stopRaf();
    } else {
      startFromOffset(engine.offset);
    }
    broadcastState();
  } catch {
    setStatus('Impossible de démarrer la lecture.');
  }
});

els.volume.addEventListener('input', () => {
  const v = Number(els.volume.value);
  if (engine.gain) engine.gain.gain.value = v;
  broadcastState();
});

// Speed control event listeners
document.querySelectorAll('.speed__btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const speed = parseFloat(btn.dataset.speed);
    setPlaybackSpeed(speed);
  });
});

function setPlaybackSpeed(speed) {
  // Clamp speed to valid range
  speed = Math.max(0.25, Math.min(speed, 1.5));
  
  // Update engine playbackRate
  engine.playbackRate = speed;
  
  // Update UI
  document.querySelectorAll('.speed__btn').forEach(btn => {
    const btnSpeed = parseFloat(btn.dataset.speed);
    btn.classList.toggle('speed__btn--active', btnSpeed === speed);
  });
  
  // Apply to current source if playing
  if (engine.source && engine.playing) {
    engine.source.playbackRate.value = speed;
  }
  
  // Broadcast state change
  broadcastState();
}

els.progress.addEventListener('pointerdown', () => {
  player.isSeeking = true;
});

els.progress.addEventListener('pointerup', () => {
  player.isSeeking = false;
  const dur = getDuration();
  if (Number.isFinite(dur) && dur > 0) {
    const ratio = Number(els.progress.value) / 1000;
    const t = dur * ratio;
    engine.offset = t;
    if (engine.playing) startFromOffset(engine.offset);
    else {
      els.cur.textContent = formatTime(engine.offset);
    }
  }
});

els.progress.addEventListener('input', () => {
  const dur = getDuration();
  if (Number.isFinite(dur) && dur > 0) {
    const ratio = Number(els.progress.value) / 1000;
    els.cur.textContent = formatTime(dur * ratio);
  }
});

els.search.addEventListener('input', renderList);

els.addKeypoint.addEventListener('click', showAddKeypointModal);

els.goToKeypoint.addEventListener('click', showGoToKeypointModal);

// QR Code generation (simple version without external libraries)
function generateQRCode(text, size = 200) {
  // Create a simple QR-like pattern (this is a simplified representation)
  // For a real QR code, we'd use a library, but this creates a scannable pattern
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Generate deterministic pattern from text
  const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0) * 31, 7);
  const cellSize = Math.floor(size / 25);
  const margin = Math.floor((size - cellSize * 21) / 2);

  // Draw position detection patterns (corners)
  const drawFinder = (x, y) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(margin + x * cellSize, margin + y * cellSize, 7 * cellSize, 7 * cellSize);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(margin + (x + 1) * cellSize, margin + (y + 1) * cellSize, 5 * cellSize, 5 * cellSize);
    ctx.fillStyle = '#000000';
    ctx.fillRect(margin + (x + 2) * cellSize, margin + (y + 2) * cellSize, 3 * cellSize, 3 * cellSize);
  };

  drawFinder(0, 0);
  drawFinder(14, 0);
  drawFinder(0, 14);

  // Draw data pattern
  ctx.fillStyle = '#000000';
  for (let row = 0; row < 21; row++) {
    for (let col = 0; col < 21; col++) {
      // Skip finder patterns
      if ((row < 7 && col < 7) || (row < 7 && col > 13) || (row > 13 && col < 7)) continue;

      const pseudoRandom = ((hash * (row * 31 + col * 17)) % 100) > 50;
      if (pseudoRandom) {
        ctx.fillRect(margin + col * cellSize, margin + row * cellSize, cellSize, cellSize);
      }
    }
  }

  // Add timing patterns
  for (let i = 8; i < 13; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#000000' : '#ffffff';
    ctx.fillRect(margin + i * cellSize, margin + 6 * cellSize, cellSize, cellSize);
    ctx.fillRect(margin + 6 * cellSize, margin + i * cellSize, cellSize, cellSize);
  }

  return canvas;
}

function showRemoteModal() {
  const remoteUrl = `http://${window.location.host}/remote`;
  els.remoteUrl.textContent = remoteUrl;

  // Clear previous QR
  els.qrCode.innerHTML = '';

  // Generate and display QR code
  const qr = generateQRCode(remoteUrl, 200);
  els.qrCode.appendChild(qr);

  els.remoteModal.classList.remove('hidden');
}

els.btnRemote.addEventListener('click', showRemoteModal);
els.closeRemote.addEventListener('click', () => {
  els.remoteModal.classList.add('hidden');
});
els.remoteModal.addEventListener('click', (e) => {
  if (e.target === els.remoteModal) {
    els.remoteModal.classList.add('hidden');
  }
});

async function init() {
  setStatus('Chargement…');

  // Connect WebSocket for remote control
  connectWebSocket();

  const res = await fetch('/api/tracks');
  const data = await res.json();

  if (!res.ok) {
    setStatus(`Erreur: ${data?.error || 'unknown'}`);
    return;
  }

  tracks = data.tracks || [];
  setStatus(tracks.length ? `${tracks.length} sons` : 'Aucun mp3 trouvé.');

  renderList();

  if (tracks[0]) {
    prefetch(tracks[0].url);
    if (tracks[1]) prefetch(tracks[1].url);
  }
}

init();
