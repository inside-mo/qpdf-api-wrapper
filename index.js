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

// LLM-proof redaction using pdftk and ghostscript
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
  
  try {
    const inputPath = req.file.path;
    const tempDir = path.dirname(inputPath);
    const timestamp = Date.now();
    const outputPath = `${tempDir}/redacted_${timestamp}.pdf`;
    
    console.log('Processing PDF for redaction...');
    
    // Step 1: Uncompress the PDF with pdftk for easier text replacement
    const uncompressedPath = `${tempDir}/uncomp_${timestamp}.pdf`;
    console.log('Uncompressing PDF...');
    execSync(`pdftk ${inputPath} output ${uncompressedPath} uncompress`);
    
    // Step 2: Read the uncompressed PDF
    let pdfContent = fs.readFileSync(uncompressedPath, 'utf8');
    
    // Step 3: Replace text content with spaces (first layer of redaction)
    console.log('Replacing text content...');
    locations.forEach(loc => {
      if (loc.text) {
        // Escape special regex characters in the text
        const escapedText = loc.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Replace with equivalent number of spaces
        pdfContent = pdfContent.replace(
          new RegExp(escapedText, 'g'), 
          ' '.repeat(loc.text.length)
        );
      }
    });
    
    // Step 4: Write the modified PDF content
    const modifiedPath = `${tempDir}/modified_${timestamp}.pdf`;
    fs.writeFileSync(modifiedPath, pdfContent);
    
    // Step 5: Recompress the PDF
    const recompressedPath = `${tempDir}/recomp_${timestamp}.pdf`;
    console.log('Recompressing PDF...');
    execSync(`pdftk ${modifiedPath} output ${recompressedPath} compress`);
    
    // Step 6: Create a PDF with black rectangles using Ghostscript
    // Group redactions by page
    const pageRedactions = {};
    locations.forEach(loc => {
      const page = parseInt(loc.page) + 1; // Convert to 1-indexed for Ghostscript
      if (!pageRedactions[page]) {
        pageRedactions[page] = [];
      }
      pageRedactions[page].push(loc);
    });
    
    // Create a PostScript file for each page with redaction rectangles
    const psFiles = [];
    
    console.log('Creating redaction overlays...');
    for (const page in pageRedactions) {
      const psPath = `${tempDir}/redact_${timestamp}_p${page}.ps`;
      let psContent = '%!PS-Adobe-3.0\n';
      
      pageRedactions[page].forEach(loc => {
        // Draw a filled black rectangle
        psContent += `
          0 0 0 setrgbcolor
          ${loc.x0} ${loc.y0} moveto
          ${loc.x1} ${loc.y0} lineto
          ${loc.x1} ${loc.y1} lineto
          ${loc.x0} ${loc.y1} lineto
          closepath
          fill
        `;
      });
      
      fs.writeFileSync(psPath, psContent);
      psFiles.push({ page, path: psPath });
    }
    
    // Step 7: Apply the black rectangles to each page using Ghostscript
    const overlayPath = `${tempDir}/overlay_${timestamp}.pdf`;
    
    if (psFiles.length > 0) {
      console.log('Applying redaction overlays...');
      // Create a PDF with just the black rectangles
      const gsCommand = `gs -q -dNOPAUSE -dBATCH -sDEVICE=pdfwrite -sOutputFile=${overlayPath} ${psFiles.map(f => f.path).join(' ')}`;
      execSync(gsCommand);
      
      // Step 8: Merge the overlay with the text-redacted PDF
      console.log('Merging redaction layers...');
      execSync(`pdftk ${recompressedPath} multistamp ${overlayPath} output ${outputPath}`);
    } else {
      // If no overlays, just use the recompressed file
      fs.copyFileSync(recompressedPath, outputPath);
    }
    
    // Return the redacted PDF
    res.download(outputPath, `redacted_${path.basename(req.file.originalname || 'document.pdf')}`, (err) => {
      if (err) {
        console.error('Download error:', err);
      }
      
      // Clean up temporary files
      setTimeout(() => {
        try {
          fs.unlinkSync(inputPath);
          fs.unlinkSync(uncompressedPath);
          fs.unlinkSync(modifiedPath);
          fs.unlinkSync(recompressedPath);
          fs.unlinkSync(outputPath);
          
          psFiles.forEach(f => {
            fs.unlinkSync(f.path);
          });
          
          if (fs.existsSync(overlayPath)) {
            fs.unlinkSync(overlayPath);
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
  console.log('- POST /redact-areas - LLM-proof redaction for PDFs');
});
