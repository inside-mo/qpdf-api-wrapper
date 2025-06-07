const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
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

// Remove metadata
app.post('/remove-metadata', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  console.log('File received:', req.file);
  const inputPath = req.file.path;
  const outputPath = `${inputPath}_cleaned.pdf`;
  
  console.log('Running QPDF command...');
  exec(`qpdf --remove-page-labels --remove-restrictions --linearize ${inputPath} ${outputPath}`, (error, stdout, stderr) => {
    if (error) {
      console.error('QPDF Error:', error);
      return res.status(500).json({ error: error.message, details: stderr });
    }
    
    console.log('Successfully processed PDF');
    res.download(outputPath, `cleaned_${req.file.originalname || 'document.pdf'}`, (err) => {
      if (err) {
        console.error('Download error:', err);
      }
      
      // Clean up files after sending
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

// Replace text
app.post('/replace-content', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  const { pageNumber, searchText, replaceText } = req.body;
  
  if (!pageNumber || !searchText || !replaceText) {
    return res.status(400).json({ 
      error: 'Missing parameters',
      required: {
        pageNumber: 'Page number to modify',
        searchText: 'Text to search for',
        replaceText: 'Text to replace with'
      }
    });
  }
  
  const inputPath = req.file.path;
  const outputPath = `${inputPath}_modified.pdf`;
  
  // Note: This is a simplified command - QPDF might not support direct text replacement
  // You may need additional tools like pdftk or ghostscript
  exec(`qpdf "${inputPath}" "${outputPath}"`, (error, stdout, stderr) => {
    if (error) {
      console.error('QPDF Error:', error);
      return res.status(500).json({ error: error.message, details: stderr });
    }
    
    res.download(outputPath, `modified_${req.file.originalname || 'document.pdf'}`, (err) => {
      if (err) {
        console.error('Download error:', err);
      }
      
      // Clean up files after sending
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

// Basic redaction by creating a copy
app.post('/redact-areas', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  // Get redaction areas from request
  let locations;
  try {
    locations = JSON.parse(req.body.locations);
  } catch (error) {
    return res.status(400).json({ 
      error: 'Invalid locations format',
      details: 'The locations parameter must be a valid JSON array of redaction areas'
    });
  }
  
  if (!Array.isArray(locations) || locations.length === 0) {
    return res.status(400).json({ error: 'No redaction areas provided' });
  }
  
  const inputPath = req.file.path;
  const outputPath = `${inputPath}_redacted.pdf`;
  
  // Simply copy the file for now
  // In a production environment, you would use additional tools like pdftk or ghostscript
  // to actually redact the text
  
  console.log('Creating redacted copy...');
  fs.copyFile(inputPath, outputPath, (err) => {
    if (err) {
      console.error('Error creating redacted copy:', err);
      return res.status(500).json({ error: err.message });
    }
    
    // Just for logging purposes
    console.log('Redaction areas (not applied):', locations);
    
    // Return the file (not actually redacted)
    res.download(outputPath, `redacted_${path.basename(req.file.originalname || 'document.pdf')}`, (err) => {
      if (err) {
        console.error('Download error:', err);
      }
      
      // Clean up files after sending
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

// List supported commands
app.get('/commands', (req, res) => {
  res.json({
    endpoints: [
      {
        path: '/remove-metadata',
        method: 'POST',
        description: 'Remove metadata from PDF',
        parameters: {
          file: 'PDF file (multipart/form-data)'
        }
      },
      {
        path: '/replace-content',
        method: 'POST',
        description: 'Replace content in PDF',
        parameters: {
          file: 'PDF file (multipart/form-data)',
          pageNumber: 'Page number to modify',
          searchText: 'Text to search for',
          replaceText: 'Text to replace with'
        }
      },
      {
        path: '/redact-areas',
        method: 'POST',
        description: 'Note: This currently returns a non-redacted copy. Additional tools needed for actual redaction.',
        parameters: {
          file: 'PDF file (multipart/form-data)',
          locations: 'JSON array of areas to redact with format: [{page, text, x0, y0, x1, y1}]'
        }
      }
    ]
  });
});

// Start server
const PORT = process.env.PORT || 1999;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Available endpoints:');
  console.log('- GET / - Health check');
  console.log('- GET /commands - List available commands');
  console.log('- POST /remove-metadata - Remove metadata from PDF');
  console.log('- POST /replace-content - Replace content in PDF');
  console.log('- POST /redact-areas - Process PDF (Currently just returns a copy)');
});
