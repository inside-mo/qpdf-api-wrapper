// index.js
const express     = require('express');
const multer      = require('multer');
const { execSync } = require('child_process');
const fs          = require('fs');
const path        = require('path');

const app = express();

// --- Startup diagnostics ---
try {
  const bin = execSync('which qpdf').toString().trim();
  const ver = execSync('qpdf --version').toString().trim();
  console.log('[startup] qpdf binary:', bin);
  console.log('[startup] qpdf version:', ver);
  console.log('[startup] PATH:', process.env.PATH);
} catch (e) {
  console.error('[startup] QPDF diagnostics failed:', e.message);
}
// ------------------------------------

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/app/uploads/'),
  filename:    (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Simple logger + CORS
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers','Content-Type,Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health check
app.get('/', (req, res) => res.send('QPDF API is running'));

// POST /remove-content
// Expects multipart form-data: file=@.pdf, locations=[{…},…]
app.post('/remove-content', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // 1) Parse locations JSON
  let locations;
  try {
    locations = typeof req.body.locations === 'string'
      ? JSON.parse(req.body.locations)
      : req.body.locations;
    if (!Array.isArray(locations)) {
      locations = locations.locations || [locations];
    }
  } catch (e) {
    return res.status(400).json({
      error: 'Invalid locations format',
      details: e.message
    });
  }

  const inputPath     = req.file.path;
  const normalized    = `${inputPath}_normalized.pdf`;
  const jobJsonPath   = `${inputPath}_job.json`;
  const outputPath    = `${inputPath}_modified.pdf`;

  try {
    // 2) Normalize PDF
    console.log('Normalizing PDF…');
    execSync(`qpdf --normalize-content=y --compress-streams=y \
               --decode-level=specialized "${inputPath}" "${normalized}"`);

    // 3) Build QPDFJob JSON structure
    //    Refer to https://qpdf.readthedocs.io/en/stable/qpdfjob.html
    //    We send a single job that applies multiple redactions
    const redactByPage = {};
    for (const loc of locations) {
      const pageNum = (Number(loc.page) || 0) + 1;
      const H       = Number(loc.page_height);
      const x0      = Number(loc.x0),    x1 = Number(loc.x1);
      const y0_pdf  = H - Number(loc.y1), y1_pdf = H - Number(loc.y0);
      const rect = [
        Math.min(x0, x1),
        Math.min(y0_pdf, y1_pdf),
        Math.max(x0, x1),
        Math.max(y0_pdf, y1_pdf)
      ];
      if (!redactByPage[pageNum]) redactByPage[pageNum] = [];
      redactByPage[pageNum].push(rect);
    }

    // Assemble the QPDFJob
    const qpdfJob = {
      qpdf: {},
      steps: []
    };
    for (const [pageStr, rects] of Object.entries(redactByPage)) {
      qpdfJob.steps.push({
        type: 'redact',
        description: `Redact page ${pageStr}`,
        page: Number(pageStr),
        rectangles: rects
      });
    }

    fs.writeFileSync(jobJsonPath, JSON.stringify(qpdfJob, null, 2));
    console.log('Wrote QPDFJob JSON:', jobJsonPath);

    // 4) Invoke QPDF with the JSON job
    const jobCmd = `qpdf --job-json-file="${jobJsonPath}" --replace-input "${normalized}"`;
    console.log('Running QPDFJob:', jobCmd);
    execSync(jobCmd, { stdio: 'pipe' });

    // The JSON job writes back to `${normalized}`, so rename to outputPath
    fs.renameSync(normalized, outputPath);

    // 5) Send the redacted PDF
    res.download(outputPath, err => {
      // Clean up
      setTimeout(() => {
        [ inputPath, normalized, jobJsonPath, outputPath ].forEach(f => {
          try { fs.unlinkSync(f); } catch {}
        });
      }, 1000);
    });
  } catch (err) {
    console.error('Redaction failed:', err.message);
    return res.status(500).json({
      error: 'Content removal failed',
      details: err.message
    });
  }
});

// Start server
const PORT = process.env.PORT || 1999;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
