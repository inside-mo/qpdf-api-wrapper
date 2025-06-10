const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');

const app = express(); = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();

// --- Startup diagnostics ---
try {
  const qpdfPath = execSync('which qpdf').toString().trim();
  const qpdfVersion = execSync('qpdf --version').toString().trim();
  console.log('[startup] qpdf binary :', qpdfPath);
  console.log('[startup] qpdf version:', qpdfVersion);
  console.log('[startup] qpdf help excerpt:', execSync('qpdf --help').toString().split('\n').slice(0, 10).join('\n'));
} catch (e) {
  console.error('[startup] QPDF diagnostics failed:', e.message);
}
console.log('[startup] PATH :', process.env.PATH);
// ------------------------------

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/app/uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// CORS & Logging middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Accept');
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health check
app.get('/', (req, res) => res.send('QPDF API is running'));

// Remove specific content
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

  const inputFile = req.file.path;
  const outputFile = `${inputFile}_redacted.pdf`;
  const jobJsonFile = `${inputFile}_job.json`;

  // Build job JSON
  const job = {
    qpdf: {
      "input-file": inputFile,
      "output-file": outputFile,
      "overwrite": true
    },
    steps: []
  };

  // Normalize content step
  job.steps.push({
    "normalize-content": {
      "compress-streams": true,
      "decode-level": "specialized"
    }
  });

  // Prepare redaction rectangles grouped by page
  const redactByPage = {};
  for (const loc of locations) {
    const page = (Number(loc.page) || 0) + 1;
    const H = Number(loc.page_height);
    const x0 = Number(loc.x0), x1 = Number(loc.x1);
    const y0 = H - Number(loc.y1), y1 = H - Number(loc.y0);
    const rect = [
      Math.min(x0, x1),
      Math.min(y0, y1),
      Math.max(x0, x1),
      Math.max(y0, y1)
    ];
    redactByPage[page] = redactByPage[page] || [];
    redactByPage[page].push(rect);
  }

  // Modify-content step
  const allRects = [];
  Object.entries(redactByPage).forEach(([page, rects]) => {
    rects.forEach(r => allRects.push([Number(page), ...r]));
  });
  job.steps.push({
    "modify-content": {
      "redact": allRects
    }
  });

  // Linearize step
  job.steps.push({ "linearize": {} });

  // Write job JSON
  fs.writeFileSync(jobJsonFile, JSON.stringify(job, null, 2));
  console.log('Job JSON written to', jobJsonFile, '\n', job);

  try {
    console.log('Running QPDF job…');
    execSync(`qpdf --job-json-file="${jobJsonFile}"`, { stdio: 'pipe' });
    console.log('QPDF job complete, output:', outputFile);

    res.download(outputFile, () => {
      setTimeout(() => {
        [inputFile, outputFile, jobJsonFile].forEach(f => {
          try { fs.unlinkSync(f); } catch {}
        });
      }, 1000);
    });
  } catch (err) {
    console.error('QPDF job failed:', err.stderr?.toString() || err.message);
    return res.status(500).json({ error: 'Content removal failed', details: err.stderr?.toString() || err.message });
  }
});

// Start server
const PORT = process.env.PORT || 1999;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
