const express = require('express');
const multer = require('multer');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();

// File upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, '/app/uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req, res) => res.send('QPDF API is running'));

// Remove content (redaction) endpoint
app.post('/remove-content', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let locations;
  try {
    if (typeof req.body.locations === 'string') {
      locations = JSON.parse(req.body.locations);
    } else {
      locations = req.body.locations;
    }
    if (!Array.isArray(locations)) {
      if (locations.locations) locations = locations.locations;
      else locations = [locations];
    }
  } catch (error) {
    return res.status(400).json({ error: 'Invalid locations format', details: error.message });
  }

  // Group rectangles by page
  const redactionsByPage = {};
  for (const loc of locations) {
    const page = (Number(loc.page) || 0) + 1; // 1-based
    if (!redactionsByPage[page]) redactionsByPage[page] = [];
    // Invert y as above
    const pageHeight = Number(loc.page_height);
    const x0 = Number(loc.x0);
    const x1 = Number(loc.x1);
    const y0_pdf = pageHeight - Number(loc.y1);
    const y1_pdf = pageHeight - Number(loc.y0);
    // QPDF expects [x0, y0, x1, y1]
    const rect = [
      Math.min(x0, x1),
      Math.min(y0_pdf, y1_pdf),
      Math.max(x0, x1),
      Math.max(y0_pdf, y1_pdf)
    ];
    redactionsByPage[page].push(rect);
  }

  // Construct QPDF redactions JSON
  const redactJson = {
    redact: Object.entries(redactionsByPage).map(([page, rectangles]) => ({
      page: Number(page),
      rectangles
    }))
  };

  // Write JSON and process with qpdf
  const inputPath = req.file.path;
  const redactionsPath = inputPath + '_redact.json';
  const outputPath = inputPath + '_modified.pdf';
  fs.writeFileSync(redactionsPath, JSON.stringify(redactJson, null, 2));

  try {
    // Actually redact
    execSync(`qpdf --redact=${redactionsPath} "${inputPath}" "${outputPath}"`);
    res.download(outputPath, `modified_${path.basename(req.file.originalname)}`, (err) => {
      setTimeout(() => {
        try {
          fs.unlinkSync(inputPath);
          fs.unlinkSync(outputPath);
          fs.unlinkSync(redactionsPath);
        } catch {}
      }, 1000);
    });
  } catch (err) {
    res.status(500).json({ error: 'QPDF redaction failed', details: err.message });
    try {
      fs.unlinkSync(inputPath);
      fs.unlinkSync(redactionsPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch {}
  }
});

// Start server
const PORT = process.env.PORT || 1999;
app.listen(PORT, () => {
  console.log(`QPDF API running on port ${PORT}`);
});
