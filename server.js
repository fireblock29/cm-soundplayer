import express from 'express';
import fs from 'fs';
import path from 'path';

const app = express();

const AUDIO_DIR = process.env.AUDIO_DIR || '/home/lucas/Téléchargements/CM';
const PORT = Number(process.env.PORT || 5179);

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

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[cm-sound-player] http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[cm-sound-player] AUDIO_DIR=${AUDIO_DIR}`);
});
