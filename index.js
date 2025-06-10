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
  
  if (!pageNumber || !searchText || (replaceText === undefined)) {
    return res.status(400).json({ 
      error: 'Missing parameters',
      required: {
        pageNumber: 'Page number to modify',
        searchText: 'Text to search for',
        replaceText: 'Text to replace with (use empty string to remove)'
      }
    });
  }
  
  const inputPath = req.file.path;
  const outputPath = `${inputPath}_modified.pdf`;
  
  exec(`qpdf "${inputPath}" "${outputPath}"`, (error, stdout, stderr) => {
    if (error) {
      console.error('QPDF Error:', error);
      return res.status(500).json({ error: error.message, details: stderr });
    }
    
    res.download(outputPath, `modified_${req.file.originalname || 'document.pdf'}`, (err) => {
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

// Simple and reliable PDF redaction
app.post('/redact-areas', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  // Get redaction areas from request
  let locations;
  try {
    console.log('Received locations data:', req.body.locations);
    
    // Handle both string and object inputs
    if (typeof req.body.locations === 'string') {
      locations = JSON.parse(req.body.locations);
    } else if (typeof req.body.locations === 'object') {
      locations = req.body.locations;
    } else {
      throw new Error('Invalid locations format');
    }

    // If locations is a single object (not an array), wrap it in an array
    if (locations && !Array.isArray(locations)) {
      locations = [locations];
    }

    console.log('Parsed locations:', locations);
    
  } catch (error) {
    console.error('Locations parsing error:', error);
    return res.status(400).json({ 
      error: 'Invalid locations format',
      details: 'The locations parameter must be a valid JSON array or object with redaction areas',
      received: req.body.locations
    });
  }
  
  if (!Array.isArray(locations) || locations.length === 0) {
    return res.status(400).json({ error: 'No redaction areas provided' });
  }

  // Get the quality parameter (limit to maximum 600 DPI to prevent memory issues)
  let quality = req.body.quality ? parseInt(req.body.quality) : 600;
  if (quality > 600) {
    console.log(`Requested quality ${quality} DPI is too high, limiting to 600 DPI`);
    quality = 600;
  }
  
  try {
    const inputPath = req.file.path;
    const tempDir = path.dirname(inputPath);
    const timestamp = Date.now();
    const outputPath = `${tempDir}/redacted_${timestamp}.pdf`;
    const imageDir = `${tempDir}/images_${timestamp}`;
    
    // Create directory for temporary files
    fs.mkdirSync(imageDir, { recursive: true });
    
    console.log(`Converting PDF to images (${quality} DPI)...`);
    try {
      // Convert PDF to images with high quality and antialiasing
      execSync(`gs -dSAFER -dBATCH -dNOPAUSE -sDEVICE=png16m -r${quality} -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -sOutputFile="${imageDir}/page-%03d.png" "${inputPath}"`);
      
      const imageFiles = fs.readdirSync(imageDir).filter(file => file.startsWith('page-') && file.endsWith('.png'));
      console.log(`Generated ${imageFiles.length} page images`);
      
      // Group redaction areas by page
      const pageGroups = {};
      locations.forEach(loc => {
        const page = loc.page || 0;
        if (!pageGroups[page]) {
          pageGroups[page] = [];
        }
        pageGroups[page].push(loc);
      });
      
      // Process each page
      for (const pageNum in pageGroups) {
        const pageIndex = parseInt(pageNum);
        const paddedPage = String(pageIndex + 1).padStart(3, '0');
        const imagePath = `${imageDir}/page-${paddedPage}.png`;
        
        if (!fs.existsSync(imagePath)) {
          console.error(`Image not found: ${imagePath}`);
          continue;
        }
        
        console.log(`Processing page ${pageIndex + 1}`);
        
        // Create ImageMagick command with memory limits
        let redactCmd = `convert -limit memory 1024MB -limit map 2048MB "${imagePath}" `;
        
        // Add redaction rectangles
        pageGroups[pageNum].forEach(loc => {
          redactCmd += `-fill black -draw "rectangle ${loc.x0},${loc.y0} ${loc.x1},${loc.y1}" `;
        });
        
        redactCmd += `"${imagePath}"`;
        
        // Execute redaction
        execSync(redactCmd);
      }
      
      // Convert images back to PDF
      console.log('Creating final PDF...');
      const redactedPdf = `${tempDir}/redacted_combined_${timestamp}.pdf`;
      
      // Process pages one by one
      const pdfDir = `${tempDir}/pdf_pages_${timestamp}`;
      fs.mkdirSync(pdfDir, { recursive: true });
      
      for (let i = 0; i < imageFiles.length; i++) {
        const imagePath = `${imageDir}/${imageFiles[i]}`;
        const pdfPath = `${pdfDir}/page-${i+1}.pdf`;
        
        execSync(`convert -limit memory 1024MB -limit map 2048MB -density ${quality} -quality 100 "${imagePath}" "${pdfPath}"`);
      }
      
      // Combine PDFs
      execSync(`pdftk ${pdfDir}/page-*.pdf cat output "${redactedPdf}"`);
      
      // Final cleanup
      execSync(`qpdf --remove-restrictions --linearize "${redactedPdf}" "${outputPath}"`);
      
    } catch (error) {
      console.error('Processing error:', error);
      throw new Error(`PDF processing failed: ${error.message}`);
    }
    
    // Return the redacted PDF
    res.download(outputPath, `redacted_${path.basename(req.file.originalname || 'document.pdf')}`, (err) => {
      if (err) {
        console.error('Download error:', err);
      }
      
      // Clean up
      setTimeout(() => {
        try {
          fs.unlinkSync(inputPath);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          if (fs.existsSync(imageDir)) {
            fs.rmSync(imageDir, { recursive: true, force: true });
          }
          if (fs.existsSync(`${tempDir}/pdf_pages_${timestamp}`)) {
            fs.rmSync(`${tempDir}/pdf_pages_${timestamp}`, { recursive: true, force: true });
          }
        } catch (e) {
          console.error('Cleanup error:', e);
        }
      }, 1000);
    });
    
  } catch (error) {
    console.error('Redaction error:', error);
    return res.status(500).json({ 
      error: 'Redaction failed', 
      details: error.message,
      stack: error.stack
    });
  }
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
        description: 'Perform LLM-proof redaction on specific areas in a PDF',
        parameters: {
          file: 'PDF file (multipart/form-data)',
          locations: 'JSON array or object with redaction areas: {page, x0, y0, x1, y1}',
          quality: 'Optional: DPI quality (default: 600, max: 600)'
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
  console.log('- POST /redact-areas - LLM-proof redaction for PDFs');
});
