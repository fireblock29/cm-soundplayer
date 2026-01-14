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
  volume: $('#volume')
};

let tracks = [];
let activeTrack = null;

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
  stopping: false
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
    } else {
      els.progress.disabled = true;
      els.progress.value = '0';
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
  } catch {
    setStatus('Impossible de démarrer la lecture.');
  }
});

els.volume.addEventListener('input', () => {
  const v = Number(els.volume.value);
  if (engine.gain) engine.gain.gain.value = v;
});

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

async function init() {
  setStatus('Chargement…');

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
