const express = require('express');
const multer = require('multer');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ----- Startup QPDF diagnostics -----
try {
  const qpdfPath = execSync('which qpdf').toString().trim();
  const qpdfVersion = execSync('qpdf --version').toString().trim();
  console.log(`QPDF detected at: ${qpdfPath}`);
  console.log(`QPDF version: ${qpdfVersion}`);
} catch (e) {
  console.error('Failed to detect qpdf:', e);
}
console.log(`Node process PATH: ${process.env.PATH}`);
// ------------------------------------

const app = express();

// Setup multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, '/app/uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Health check endpoint
app.get('/', (req, res) => {
  res.send('QPDF API is running');
});

// Quick QPDF debug endpoint
app.get('/debug-qpdf', (req, res) => {
  try {
    const qpdfPath = execSync('which qpdf').toString().trim();
    const qpdfVersion = execSync('qpdf --version').toString().trim();
    res.json({
      path: qpdfPath,
      version: qpdfVersion,
      env: process.env.PATH
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// Get QPDF version
app.get('/version', (req, res) => {
  exec('qpdf --version', (error, stdout, stderr) => {
    if (error) {
      console.error('Error getting QPDF version:', error);
      return res.status(500).json({ error: error.message });
    }
    res.json({ version: stdout.trim() });
  });
});

// Remove metadata
app.post('/remove-metadata', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  console.log('Removing metadata from:', req.file.originalname);
  const inputPath = req.file.path;
  const outputPath = `${inputPath}_cleaned.pdf`;

  exec(`qpdf --remove-page-labels --remove-restrictions --linearize ${inputPath} ${outputPath}`, (error, stdout, stderr) => {
    if (error) {
      console.error('QPDF Error:', error);
      return res.status(500).json({ error: error.message, details: stderr });
    }

    console.log('Successfully removed metadata');
    res.download(outputPath, `cleaned_${req.file.originalname}`, (err) => {
      if (err) {
        console.error('Download error:', err);
      }

      setTimeout(() => {
        try {
          fs.unlinkSync(inputPath);
          fs.unlinkSync(outputPath);
        } catch (e) {
          console.error('Cleanup error:', e);
        }
      }, 1000);
    });
  });
});

// Remove specific content with coordinate conversion and bounds checks
app.post('/remove-content', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  let locations;
  try {
    console.log('Received locations data:', req.body.locations);

    // Parse the locations data
    if (typeof req.body.locations === 'string') {
      locations = JSON.parse(req.body.locations);
    } else {
      locations = req.body.locations;
    }

    // Handle both direct array and wrapped object formats
    if (!Array.isArray(locations)) {
      if (locations.locations) {
        locations = locations.locations;
      } else {
        locations = [locations];
      }
    }

    console.log('Parsed locations:', JSON.stringify(locations, null, 2));
  } catch (error) {
    console.error('Locations parsing error:', error);
    return res.status(400).json({
      error: 'Invalid locations format',
      details: error.message,
      received: req.body.locations
    });
  }

  const inputPath = req.file.path;
  const outputPath = `${inputPath}_modified.pdf`;

  try {
    // First normalize the PDF to clean up any structural issues
    console.log('Normalizing PDF structure...');
    const normalizedPath = `${inputPath}_normalized.pdf`;
    execSync(`qpdf --normalize-content=y --compress-streams=y --decode-level=specialized "${inputPath}" "${normalizedPath}"`);

    // Now process the content removal
    console.log('Processing content removal...');
    const workingPath = `${inputPath}_working.pdf`;
    fs.copyFileSync(normalizedPath, workingPath);

    // Process each location
    for (const loc of locations) {
      try {
        const pageHeight = Number(loc.page_height);
        const pageWidth = Number(loc.page_width);
        const x0 = Number(loc.x0);
        const x1 = Number(loc.x1);
        // Invert the y axis: PDF (0,0) is bottom-left, pdfplumber (0,0) is top-left
        const y0_pdf = pageHeight - Number(loc.y1);
        const y1_pdf = pageHeight - Number(loc.y0);
        const pageNum = (Number(loc.page) || 0) + 1;

        // Ensure valid numbers and bounds
        const minX = Math.max(0, Math.min(x0, x1));
        const maxX = Math.min(pageWidth, Math.max(x0, x1));
        const minY = Math.max(0, Math.min(y0_pdf, y1_pdf));
        const maxY = Math.min(pageHeight, Math.max(y0_pdf, y1_pdf));

        console.log(`Redacting "${loc.text}" on page ${pageNum}: x0=${minX}, y0=${minY}, x1=${maxX}, y1=${maxY}, pageWidth=${pageWidth}, pageHeight=${pageHeight}`);

        if (maxX > minX && maxY > minY) {
          const pageCmd = `qpdf --modify-content "${workingPath}" --redact ${pageNum},${minX},${minY},${maxX},${maxY} --replace-input`;
          try {
            const cmdOutput = execSync(pageCmd, {stdio: 'pipe'});
            console.log(`Processed page ${pageNum}`);
          } catch (cmdErr) {
            console.error(`QPDF redaction error for "${loc.text}" on page ${pageNum}:`, cmdErr.stderr ? cmdErr.stderr.toString() : cmdErr);
          }
        } else {
          console.warn(`Skipping invalid rectangle for "${loc.text}" on page ${pageNum}: minX=${minX}, minY=${minY}, maxX=${maxX}, maxY=${maxY}`);
        }
      } catch (pageError) {
        console.error(`Error processing redaction for text "${loc.text}" on page ${loc.page + 1}:`, pageError);
      }
    }

    // Final cleanup and optimization
    console.log('Finalizing PDF...');
    execSync(`qpdf --linearize --compress-streams=y "${workingPath}" "${outputPath}"`);

    console.log('Content removal complete');
    res.download(outputPath, `modified_${path.basename(req.file.originalname)}`, (err) => {
      if (err) {
        console.error('Download error:', err);
      }

      // Clean up temporary files
      setTimeout(() => {
        try {
          fs.unlinkSync(inputPath);
          fs.unlinkSync(normalizedPath);
          fs.unlinkSync(workingPath);
          fs.unlinkSync(outputPath);
        } catch (e) {
          console.error('Cleanup error:', e);
        }
      }, 1000);
    });

  } catch (error) {
    console.error('Processing error:', error);
    return res.status(500).json({
      error: 'Content removal failed',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Check PDF structure
app.get('/check', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const inputPath = req.file.path;

  exec(`qpdf --check "${inputPath}"`, (error, stdout, stderr) => {
    const result = {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      status: error ? 'invalid' : 'valid'
    };

    if (error && error.code !== 2) { // qpdf uses exit code 2 for warnings
      result.error = error.message;
    }

    res.json(result);

    fs.unlink(inputPath, (err) => {
      if (err) console.error('Cleanup error:', err);
    });
  });
});

// List supported commands
app.get('/commands', (req, res) => {
  res.json({
    endpoints: [
      {
        path: '/version',
        method: 'GET',
        description: 'Get QPDF version information'
      },
      {
        path: '/remove-metadata',
        method: 'POST',
        description: 'Remove all metadata from PDF',
        parameters: {
          file: 'PDF file (multipart/form-data)'
        }
      },
      {
        path: '/remove-content',
        method: 'POST',
        description: 'Remove specific content from PDF',
        parameters: {
          file: 'PDF file (multipart/form-data)',
          locations: 'JSON array of areas: [{page, text, x0, y0, x1, y1, page_height, page_width}]'
        }
      },
      {
        path: '/check',
        method: 'POST',
        description: 'Check PDF structure and validity',
        parameters: {
          file: 'PDF file (multipart/form-data)'
        }
      }
    ]
  });
});

// Start server
const PORT = process.env.PORT || 1999;
app.listen(PORT, () => {
  console.log(`QPDF API running on port ${PORT}`);
  console.log('Available endpoints:');
  console.log('- GET /version - Get QPDF version');
  console.log('- GET /commands - List available commands');
  console.log('- POST /remove-metadata - Remove all metadata');
  console.log('- POST /remove-content - Remove specific content');
  console.log('- POST /check - Check PDF validity');
  console.log('- GET /debug-qpdf - Check qpdf path/version at runtime');
});
