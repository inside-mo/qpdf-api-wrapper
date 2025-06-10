const express = require('express');
const multer = require('multer');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Initialize express app
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
  
  exec(`qpdf --remove-page-labels --remove-restrictions --linearize --remove-all-page-piece-dictionaries --qdf ${inputPath} ${outputPath}`, (error, stdout, stderr) => {
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

// Remove specific content
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
    execSync(`qpdf --replace-input --normalize-content --compress-streams=y --decode-level=specialized "${inputPath}" "${normalizedPath}"`);
    
    // Now process the content removal
    console.log('Processing content removal...');
    const workingPath = `${inputPath}_working.pdf`;
    fs.copyFileSync(normalizedPath, workingPath);
    
    // Process each location
    for (const loc of locations) {
      console.log(`Processing removal for text: "${loc.text}" on page ${loc.page + 1}`);
      
      // Extract the target page
      const pagePath = `${inputPath}_p${loc.page}.pdf`;
      execSync(`qpdf --pages "${workingPath}" ${loc.page + 1} -- "${pagePath}"`);
      
      // Remove content from the page
      const modifiedPagePath = `${pagePath}_modified.pdf`;
      execSync(`qpdf --replace-input --modify-content "${pagePath}" --filtered-stream-data=replace "${modifiedPagePath}"`);
      
      // Merge back with the rest of the document
      const tempPath = `${workingPath}_temp.pdf`;
      if (loc.page === 0) {
        execSync(`qpdf "${modifiedPagePath}" --pages . 1 "${workingPath}" 2-z -- "${tempPath}"`);
      } else {
        execSync(`qpdf "${workingPath}" --pages . 1-${loc.page} "${modifiedPagePath}" ${loc.page + 1} . ${loc.page + 2}-z -- "${tempPath}"`);
      }
      
      // Update working copy
      fs.copyFileSync(tempPath, workingPath);
      
      // Clean up temporary files
      fs.unlinkSync

// Check PDF structure
app.post('/check-structure', upload.single('file'), (req, res) => {
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
          locations: 'JSON array of areas: [{page, x0, y0, x1, y1}]'
        }
      },
      {
        path: '/check-structure',
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
  console.log('- POST /check-structure - Check PDF validity');
});
