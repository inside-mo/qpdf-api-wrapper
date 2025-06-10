// index.js
const express     = require('express');
const multer      = require('multer');
const { execSync }= require('child_process');
const fs          = require('fs');
const path        = require('path');

const app = express();

// --- Startup diagnostics ---
try {
  const bin = execSync('which qpdf').toString().trim();
  const ver = execSync('qpdf --version').toString().trim();
  console.log('[startup] qpdf binary :', bin);
  console.log('[startup] qpdf version:', ver);
  console.log('[startup] qpdf available flags excerpt:\n', execSync('qpdf --help').toString().split('\n').slice(0,10).join('\n'));
} catch (e) {
  console.error('[startup] QPDF diagnostics failed:', e.message);
}
console.log('[startup] PATH:', process.env.PATH);
// ------------------------------

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// File uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/app/uploads/'),
  filename:    (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// CORS + Logging
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin',  '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers','Content-Type,Accept');
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health check
app.get('/', (req, res) => res.send('QPDF API is running'));

// POST /remove-content → redacts specified rectangles via QPDF JSON job
app.post('/remove-content', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // 1) Parse and normalize locations array
  let locations;
  try {
    locations = typeof req.body.locations === 'string'
      ? JSON.parse(req.body.locations)
      : req.body.locations;
    if (!Array.isArray(locations)) {
      locations = locations.locations || [locations];
    }
  } catch (err) {
    return res.status(400).json({
      error: 'Invalid locations format',
      details: err.message
    });
  }

  const inputPath   = req.file.path;
  const normalized  = `${inputPath}_normalized.pdf`;
  const outputPath  = `${inputPath}_redacted.pdf`;
  const jobJsonPath = `${inputPath}_job.json`;

  try {
    // 2) Normalize PDF structure
    console.log('Normalizing PDF…');
    execSync(`qpdf --normalize-content=y --compress-streams=y --decode-level=specialized \
               "${inputPath}" "${normalized}"`, { stdio: 'pipe' });

    // 3) Build QPDFJob JSON
    const specs = locations.map(loc => {
      const page   = (Number(loc.page)||0) + 1;
      const H      = Number(loc.page_height);
      const x0     = Number(loc.x0),    x1 = Number(loc.x1);
      const y0_pdf = H - Number(loc.y1), y1_pdf = H - Number(loc.y0);
      const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
      const minY = Math.min(y0_pdf, y1_pdf), maxY = Math.max(y0_pdf, y1_pdf);
      return `${page},${minX},${minY},${maxX},${maxY}`;
    });

    const job = {
      inputFile:      normalized,
      outputFile:     outputPath,
      modifyContent:  true,
      redact:         specs,
      linearize:      true
    };

    fs.writeFileSync(jobJsonPath, JSON.stringify(job, null, 2));
    console.log('Written QPDF job JSON:', jobJsonPath, '\n', job);

    // 4) Run QPDF job
    console.log('Running qpdf with JSON job…');
    execSync(`qpdf --job-json-file="${jobJsonPath}"`, { stdio: 'pipe' });
    console.log('QPDF job completed, output at:', outputPath);

    // 5) Return the redacted PDF
    res.download(outputPath, err => {
      if (err) console.error('Download error:', err);
      // Cleanup after a short delay
      setTimeout(() => {
        [ inputPath, normalized, outputPath, jobJsonPath ].forEach(f => {
          try { fs.unlinkSync(f); } catch { /* ignore */ }
        });
      }, 2000);
    });

  } catch (err) {
    console.error('Redaction failed:', err.stderr?.toString() || err.message);
    return res.status(500).json({
      error: 'Content removal failed',
      details: err.stderr?.toString() || err.message
    });
  }
});

// Start server
const PORT = process.env.PORT || 1999;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
