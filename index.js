const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const { PDFDocument, rgb } = require('pdf-lib');

const app = express();

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer configuration for file uploads
typeof multer;
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/app/uploads/'),
  filename:    (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Health check endpoint
app.get('/', (req, res) => res.send('PDF Overlay API is running'));

// Common overlay handler
async function overlayHandler(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  if (!req.body.locations) {
    return res.status(400).json({ error: 'Missing locations parameter' });
  }

  let locations;
  try {
    locations = typeof req.body.locations === 'string'
      ? JSON.parse(req.body.locations)
      : req.body.locations;
    if (!Array.isArray(locations)) {
      locations = locations.locations || [locations];
    }
  } catch (err) {
    return res.status(400).json({ error: 'Invalid locations JSON', details: err.message });
  }

  const inputPath  = req.file.path;
  const outputPath = `${inputPath}_overlayed.pdf`;

  try {
    const bytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(bytes);

    locations.forEach(loc => {
      const pageIndex = Number(loc.page) || 0;
      const page = pdfDoc.getPages()[pageIndex];
      const { height } = page.getSize();

      const x0 = Number(loc.x0);
      const x1 = Number(loc.x1);
      const y0 = height - Number(loc.y1);
      const y1 = height - Number(loc.y0);

      const rectX = Math.min(x0, x1);
      const rectY = Math.min(y0, y1);
      const rectW = Math.abs(x1 - x0);
      const rectH = Math.abs(y1 - y0);

      page.drawRectangle({ x: rectX, y: rectY, width: rectW, height: rectH, color: rgb(0,0,0), opacity: 1.0 });
    });

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);

    res.download(outputPath, err => {
      setTimeout(() => {
        [inputPath, outputPath].forEach(f => { try { fs.unlinkSync(f); } catch {} });
      }, 1000);
    });

  } catch (err) {
    console.error('Overlay failed:', err);
    res.status(500).json({ error: 'Overlay failed', details: err.message });
  }
}

// Register endpoints (old + new)
app.post('/overlay-black', upload.single('file'), overlayHandler);
app.post('/remove-content', upload.single('file'), overlayHandler);

// Start server
const PORT = process.env.PORT || 1999;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
