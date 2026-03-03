import express from 'express';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import http from 'http';

const app = express();
app.use(express.json());

const AUDIO_DIR = process.env.AUDIO_DIR || '/home/lucas/Téléchargements/CM';
const PORT = Number(process.env.PORT || 5179);

const KEYPOINTS_FILE = path.join(process.cwd(), 'keypoints.json');

// Store connected clients
const clients = {
  main: null,
  remotes: new Set()
};

function broadcastState() {
  const remotes = Array.from(clients.remotes);
  remotes.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ type: 'requestState' }));
    }
  });
}

function forwardToMain(message) {
  if (clients.main && clients.main.readyState === 1) {
    clients.main.send(JSON.stringify(message));
  }
}

function forwardToRemotes(message, excludeClient = null) {
  clients.remotes.forEach(client => {
    if (client !== excludeClient && client.readyState === 1) {
      client.send(JSON.stringify(message));
    }
  });
}

function loadKeypoints() {
  try {
    const data = fs.readFileSync(KEYPOINTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function saveKeypoints(keypoints) {
  fs.writeFileSync(KEYPOINTS_FILE, JSON.stringify(keypoints, null, 2), 'utf8');
}

app.get('/api/keypoints/:file', (req, res) => {
  const file = req.params.file;
  if (!isSafeFileName(file)) {
    res.status(400).json({ error: 'Invalid file' });
    return;
  }
  const keypoints = loadKeypoints();
  res.json(keypoints[file] || []);
});

app.post('/api/keypoints/:file', (req, res) => {
  const file = req.params.file;
  if (!isSafeFileName(file)) {
    res.status(400).json({ error: 'Invalid file' });
    return;
  }
  const { time, name, color } = req.body;
  if (typeof time !== 'number' || !name || typeof name !== 'string') {
    res.status(400).json({ error: 'Missing time or name' });
    return;
  }

  const keypoints = loadKeypoints();
  if (!keypoints[file]) keypoints[file] = [];

  const existingIndex = keypoints[file].findIndex(kp => kp.time === time);
  if (existingIndex >= 0) {
    keypoints[file][existingIndex] = { time, name, color: color || '#F26A8D' };
  } else {
    keypoints[file].push({ time, name, color: color || '#F26A8D' });
  }

  keypoints[file].sort((a, b) => a.time - b.time);
  saveKeypoints(keypoints);
  res.json(keypoints[file]);
});

app.delete('/api/keypoints/:file/:time', (req, res) => {
  const file = req.params.file;
  const time = Number(req.params.time);
  if (!isSafeFileName(file) || Number.isNaN(time)) {
    res.status(400).json({ error: 'Invalid params' });
    return;
  }

  const keypoints = loadKeypoints();
  if (!keypoints[file]) {
    res.json([]);
    return;
  }

  keypoints[file] = keypoints[file].filter(kp => kp.time !== time);
  if (keypoints[file].length === 0) delete keypoints[file];
  saveKeypoints(keypoints);
  res.json(keypoints[file] || []);
});

function isSafeFileName(fileName) {
  if (!fileName) return false;
  if (fileName.includes('..')) return false;
  if (fileName.includes('/') || fileName.includes('\\')) return false;
  return true;
}

function listTracks() {
  const entries = fs.readdirSync(AUDIO_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.wav'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'fr'));
}

app.get('/api/tracks', (req, res) => {
  let files;
  try {
    files = listTracks();
  } catch (e) {
    res.status(500).json({
      error: 'Failed to read AUDIO_DIR',
      audioDir: AUDIO_DIR,
      details: String(e?.message || e)
    });
    return;
  }

  res.json({
    audioDir: AUDIO_DIR,
    tracks: files.map((file) => ({
      file,
      title: file.replace(/\.mp3$/i, ''),
      url: `/audio/${encodeURIComponent(file)}`
    }))
  });
});

app.get('/audio/:file', (req, res) => {
  const file = req.params.file;
  if (!isSafeFileName(file)) {
    res.status(400).send('Invalid file');
    return;
  }

  const abs = path.join(AUDIO_DIR, file);
  const resolvedBase = path.resolve(AUDIO_DIR);
  const resolvedFile = path.resolve(abs);

  if (!resolvedFile.startsWith(resolvedBase + path.sep)) {
    res.status(403).send('Forbidden');
    return;
  }

  fs.stat(resolvedFile, (err, stat) => {
    if (err || !stat.isFile()) {
      res.status(404).send('Not found');
      return;
    }

    const fileSize = stat.size;
    const range = req.headers.range;

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (!range) {
      res.status(200);
      res.setHeader('Content-Length', fileSize);
      fs.createReadStream(resolvedFile).pipe(res);
      return;
    }

    const match = /^bytes=(\d+)-(\d+)?$/.exec(range);
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : Math.min(start + 1024 * 1024 - 1, fileSize - 1);

    if (Number.isNaN(start) || Number.isNaN(end) || start >= fileSize || end >= fileSize || end < start) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', end - start + 1);

    fs.createReadStream(resolvedFile, { start, end }).pipe(res);
  });
});

app.use('/', express.static(path.join(process.cwd(), 'public'), {
  extensions: ['html']
}));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Serve remote.html explicitly
app.get('/remote', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'remote.html'));
});

// Create HTTP server and attach WebSocket server
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  // Determine client type from URL query
  const url = new URL(req.url, `http://${req.headers.host}`);
  const clientType = url.searchParams.get('type') || 'remote';

  // Store last activity for connection health
  ws._lastActivity = Date.now();

  // eslint-disable-next-line no-console
  console.log(`[ws] Client connected: type=${clientType}`);

  // Setup heartbeat for this connection
  const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    const lastSeen = now - ws._lastActivity;

    // If no activity for 30 seconds, send ping
    if (lastSeen > 30000 && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }

    // If no activity for 60 seconds, close connection
    if (lastSeen > 60000) {
      ws.terminate();
    }
  }, 10000);

  if (clientType === 'main') {
    clients.main = ws;
    // When main connects, request current state from it to broadcast to remotes
    ws.send(JSON.stringify({ type: 'requestState' }));
  } else {
    clients.remotes.add(ws);
    // Request current state from main player
    if (clients.main && clients.main.readyState === 1) {
      clients.main.send(JSON.stringify({ type: 'requestState' }));
    } else {
      // No main player connected yet, send empty state
      ws.send(JSON.stringify({ type: 'state', data: {
        playing: false,
        title: null,
        currentTime: 0,
        duration: 0,
        volume: 1,
        keypoints: []
      }}));
    }
  }

  ws.on('message', (data) => {
    try {
      ws._lastActivity = Date.now();
      const message = JSON.parse(data);

      // Handle ping/pong
      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (message.type === 'pong') {
        return;
      }

      // eslint-disable-next-line no-console
      console.log(`[ws] Received from ${clientType}:`, message.type);

      if (clientType === 'main') {
        // Messages from main player go to all remotes
        if (message.type === 'state' || message.type === 'trackChanged') {
          forwardToRemotes(message);
        }
      } else {
        // Messages from remotes go to main player
        // eslint-disable-next-line no-console
        console.log(`[ws] Forwarding to main. Main connected:`, !!clients.main, 'Main open:', clients.main?.readyState === 1);
        forwardToMain(message);
      }
    } catch (e) {
      // Ignore invalid messages
      // eslint-disable-next-line no-console
      console.log('[ws] Invalid message:', e.message);
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeatInterval);
    // eslint-disable-next-line no-console
    console.log(`[ws] Client disconnected: type=${clientType}`);
    if (clientType === 'main') {
      clients.main = null;
    } else {
      clients.remotes.delete(ws);
    }
  });

  ws.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.log(`[ws] Error from ${clientType}:`, err.message);
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[cm-sound-player] http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[cm-sound-player] Remote control: http://localhost:${PORT}/remote`);
  // eslint-disable-next-line no-console
  console.log(`[cm-sound-player] AUDIO_DIR=${AUDIO_DIR}`);
});
