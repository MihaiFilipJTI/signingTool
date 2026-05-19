require('dotenv').config();

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');

const { passport, ensureAuthenticated } = require('./auth');
const { uploadBuffer } = require('./blob');
const { runPipeline, getBuildStatus, streamArtifactZip } = require('./ado');
const unzipper = require('unzipper');

const app = express();
const PORT = process.env.PORT || 3000;

// 2 GB upload cap (IPAs / xcarchives can be large)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

app.use(express.static(path.join(__dirname, '..', 'public')));

// Auth routes
app.get('/auth/login', passport.authenticate('azuread-openidconnect', { failureRedirect: '/' }));
app.post(
  '/auth/callback',
  passport.authenticate('azuread-openidconnect', { failureRedirect: '/' }),
  (req, res) => {
    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(returnTo);
  }
);
app.get('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/');
  });
});

// Home / upload page
app.get('/', ensureAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/api/me', ensureAuthenticated, (req, res) => {
  res.json({ name: req.user.name, email: req.user.email });
});

// Upload endpoint
app.post('/api/upload', ensureAuthenticated, upload.single('artifact'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const name = req.file.originalname.toLowerCase();
    if (!name.endsWith('.ipa') && !name.endsWith('.xcarchive.zip') && !name.endsWith('.zip')) {
      return res.status(400).json({
        error: 'Unsupported file type. Upload .ipa or .xcarchive.zip',
      });
    }

    const versionAction = req.body.versionAction || 'none';
    const manualVersion = req.body.manualVersion || '';

    if (versionAction === 'manual' && !manualVersion) {
      return res.status(400).json({ error: 'manualVersion is required when versionAction is "manual"' });
    }

    const { blobName, blobUrl } = await uploadBuffer({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const run = await runPipeline({
      blobUrl,
      blobName,
      versionAction,
      manualVersion,
      requestedBy: req.user.email || req.user.name,
    });

    res.json({ ok: true, blobName, blobUrl, run });
  } catch (err) {
    console.error('Upload failed:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Pipeline status polling
app.get('/api/runs/:id/status', ensureAuthenticated, async (req, res) => {
  try {
    const status = await getBuildStatus(req.params.id);
    res.json(status);
  } catch (err) {
    console.error('Status check failed:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Download the signed IPA from the build artifact (streams the .ipa, not the zip)
app.get('/api/runs/:id/download', ensureAuthenticated, async (req, res) => {
  try {
    const buildId = req.params.id;
    const status = await getBuildStatus(buildId);
    if (status.status !== 'completed' || status.result !== 'succeeded') {
      return res.status(409).json({ error: `Build not ready (status=${status.status}, result=${status.result})` });
    }

    const zipStream = await streamArtifactZip(buildId, 'signed-ipa');
    let sent = false;

    zipStream
      .pipe(unzipper.Parse())
      .on('entry', (entry) => {
        if (!sent && entry.type === 'File' && entry.path.toLowerCase().endsWith('.ipa')) {
          sent = true;
          const fileName = entry.path.split('/').pop();
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
          entry.pipe(res);
        } else {
          entry.autodrain();
        }
      })
      .on('close', () => {
        if (!sent) res.status(404).json({ error: 'No .ipa found in artifact' });
      })
      .on('error', (err) => {
        console.error('Zip parse error:', err.message);
        if (!sent) res.status(500).json({ error: err.message });
      });
  } catch (err) {
    console.error('Download failed:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Signing upload portal listening on port ${PORT}`);
});
