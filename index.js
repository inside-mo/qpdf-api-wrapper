// index.js
const express = require('express');
const multer  = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- Startup diagnostics ---
try {
  const qpdfPath    = execSync('which qpdf').toString().trim();
  const qpdfVersion = execSync('qpdf --version').toString().trim();
  console.log('[startup] QPDF binary:    ', qpdfPath);
  console.log('[startup] QPDF version:   ', qpdfVersion);
} catch (e) {
  console.error('[startup] QPDF not found or failed:', e.message);
}
console.log('[startup] PATH:', process.env.PATH);
// ------------------------------

const app = express();

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/app/uploads/'),
  filename:    (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin',  '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers','Content-Type,Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Health
app.get('/', (req, res) => res.send('QPDF API is running'));

// === Remove specific content ===
app.post('/remove-content', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let locations;
  try {
    locations = typeof req.body.locations === 'string'
      ? JSON.parse(req.body.locations)
      : req.body.locations;
    if (!Array.isArray(locations)) {
      locations = locations.locations || [locations];
    }
  } catch (err) {
    return res.status(400).json({ error: 'Invalid locations format', details: err.message });
  }

  const inputPath  = req.file.path;
  const workingPath = `${inputPath}_working.pdf`;

  try {
    // 1) Normalize
    console.log('Normalizing input PDF…');
    execSync(`qpdf --normalize-content=y --compress-streams=y --decode-level=specialized \
               "${inputPath}" "${workingPath}"`);

    // 2) Redact each location
    for (const loc of locations) {
      const page     = (Number(loc.page)||0) + 1;
      const h        = Number(loc.page_height);
      const x0       = Number(loc.x0), x1 = Number(loc.x1);
      const y0_pdf   = h - Number(loc.y1), y1_pdf = h - Number(loc.y0);
      const minX = Math.min(x0,x1), maxX = Math.max(x0,x1);
      const minY = Math.min(y0_pdf,y1_pdf), maxY = Math.max(y0_pdf,y1_pdf);

      console.log(`→ Redact page ${page}, rect [${minX},${minY},${maxX},${maxY}]`);
      const cmd = `qpdf --modify-content "${workingPath}" \
                   --redact ${page},${minX},${minY},${maxX},${maxY} \
                   --replace-input`;
      console.log('  Command:', cmd);
      execSync(cmd, { stdio: 'pipe' });
    }

    // 3) Linearize & finish
    const outputPath = `${inputPath}_modified.pdf`;
    console.log('Final linearize…');
    execSync(`qpdf --linearize --compress-streams=y "${workingPath}" "${outputPath}"`);

    console.log('Download back to client…');
    res.download(outputPath, err => {
      setTimeout(() => {
        [ inputPath, workingPath, outputPath ].forEach(f => {
          try { fs.unlinkSync(f); } catch {}
        });
      }, 1000);
    });

  } catch (error) {
    console.error('Redaction failed:', error);
    return res.status(500).json({ error: 'Redaction failed', details: error.message });
  }
});

// Start
const PORT = process.env.PORT || 1999;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
