// index.js
const express    = require('express');
const multer     = require('multer');
const { execSync } = require('child_process');
const fs         = require('fs');
const path       = require('path');

const app = express();

// --- Startup diagnostics ---
try {
  const bin = execSync('which qpdf').toString().trim();
  const ver = execSync('qpdf --version').toString().trim();
  console.log('[startup] qpdf binary:', bin);
  console.log('[startup] qpdf version:', ver);

  // Show if modify-content is recognized
  console.log('[startup] qpdf modify-content topic:');
  console.log(execSync('qpdf --help=topic modify-content').toString());
} catch (e) {
  console.error('[startup] QPDF diagnostics failed:', e.message);
}
console.log('[startup] PATH:', process.env.PATH);
// ------------------------------------

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/app/uploads/'),
  filename:    (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// CORS & Logging
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers','Content-Type,Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Health check
app.get('/', (req, res) => res.send('QPDF API is running'));

// remove-content endpoint
app.post('/remove-content', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // Parse locations
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

  const input    = req.file.path;
  const working  = `${input}_working.pdf`;
  const output   = `${input}_modified.pdf`;

  try {
    // 1) Normalize
    console.log('Normalizing PDF…');
    execSync(`qpdf --normalize-content=y --compress-streams=y \
               --decode-level=specialized "${input}" "${working}"`);

    // 2) Redact each rectangle
    for (const loc of locations) {
      const page  = (Number(loc.page) || 0) + 1;
      const H     = Number(loc.page_height);
      const x0    = Number(loc.x0),  x1 = Number(loc.x1);
      const y0pdf = H - Number(loc.y1), y1pdf = H - Number(loc.y0);
      const minX = Math.min(x0,x1), maxX = Math.max(x0,x1);
      const minY = Math.min(y0pdf,y1pdf), maxY = Math.max(y0pdf,y1pdf);

      const cmd = `qpdf --modify-content "${working}" \
                     --redact ${page},${minX},${minY},${maxX},${maxY} \
                     --replace-input`;
      console.log('Executing:', cmd);
      execSync(cmd, { stdio: 'pipe' });
    }

    // 3) Final linearize
    console.log('Final linearize…');
    execSync(`qpdf --linearize --compress-streams=y "${working}" "${output}"`);

    // Send back
    res.download(output, () => {
      // Cleanup after short delay
      setTimeout(() => {
        [input, working, output].forEach(f => {
          try { fs.unlinkSync(f); } catch {} 
        });
      }, 1000);
    });

  } catch (err) {
    console.error('Redaction failed:', err.message);
    return res.status(500).json({ error: 'Redaction failed', details: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 1999;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
