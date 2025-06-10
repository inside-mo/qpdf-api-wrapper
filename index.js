const express = require('express');

// Ensure pdf-lib is installed
let PDFDocument, rgb;
try {
  const pdfLib = require('pdf-lib');
  PDFDocument = pdfLib.PDFDocument;
  rgb = pdfLib.rgb;
} catch (e) {
  console.error('Error: pdf-lib module not found. Please run `npm install pdf-lib`');
  process.exit(1);
}
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const { PDFDocument, rgb } = require('pdf-lib');

const app = express();

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/app/uploads/'),
  filename:    (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Health check endpoint
app.get('/', (req, res) => res.send('PDF Overlay API is running'));

// Overlay black rectangles endpoint
app.post('/overlay-black', upload.single('file'), async (req, res) => {
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
    // Load the existing PDF
    const existingPdfBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    // For each location, draw a black rectangle
    for (const loc of locations) {
      const pageIndex = Number(loc.page) || 0;
      const page = pdfDoc.getPages()[pageIndex];
      const { width, height } = page.getSize();

      // pdf-lib uses bottom-left origin; pdfplumber uses top-left
      const x0 = Number(loc.x0);
      const x1 = Number(loc.x1);
      const y0 = height - Number(loc.y1);
      const y1 = height - Number(loc.y0);

      const rectX = Math.min(x0, x1);
      const rectY = Math.min(y0, y1);
      const rectWidth  = Math.abs(x1 - x0);
      const rectHeight = Math.abs(y1 - y0);

      page.drawRectangle({
        x: rectX,
        y: rectY,
        width: rectWidth,
        height: rectHeight,
        color: rgb(0, 0, 0),
        opacity: 1.0,
      });
    }

    // Serialize the PDF and write to disk
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);

    // Send back the modified PDF
    res.download(outputPath, err => {
      // Cleanup files after response
      setTimeout(() => {
        [inputPath, outputPath].forEach(file => {
          try { fs.unlinkSync(file); } catch {};
        });
      }, 1000);
    });

  } catch (err) {
    console.error('Error overlaying rectangles:', err);
    res.status(500).json({ error: 'Overlay failed', details: err.message });
  }
});

// Start the server
const PORT = process.env.PORT || 1999;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
