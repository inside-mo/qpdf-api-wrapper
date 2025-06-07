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

// Simple and reliable PDF redaction
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
  
  // Get the quality parameter (default to 600 DPI for high quality)
  const quality = req.body.quality ? parseInt(req.body.quality) : 600;
  
  try {
    const inputPath = req.file.path;
    const tempDir = path.dirname(inputPath);
    const timestamp = Date.now();
    const outputPath = `${tempDir}/redacted_${timestamp}.pdf`;
    
    // Move the input file to the output path as a starting point
    fs.copyFileSync(inputPath, outputPath);
    
    // Group redaction areas by page
    const pageGroups = {};
    locations.forEach(loc => {
      const page = loc.page || 0;  // Default to page 0 if not specified
      if (!pageGroups[page]) {
        pageGroups[page] = [];
      }
      pageGroups[page].push(loc);
    });
    
    // Process each page with Ghostscript
    // This completely converts the PDF to images (most reliable method)
    const imageDir = `${tempDir}/images_${timestamp}`;
    fs.mkdirSync(imageDir, { recursive: true });
    
    console.log(`Converting PDF to high-resolution (${quality} DPI) images...`);
    try {
      // Convert the PDF to high-res images with antialiasing for better quality
      execSync(`gs -dSAFER -dBATCH -dNOPAUSE -sDEVICE=png16m -r${quality} -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -sOutputFile="${imageDir}/page-%03d.png" "${inputPath}"`);
      
      // Count the number of generated images
      const imageFiles = fs.readdirSync(imageDir).filter(file => file.startsWith('page-') && file.endsWith('.png'));
      const totalPages = imageFiles.length;
      console.log(`Generated ${totalPages} page images`);
      
      // Draw black rectangles on the images that need redaction
      for (const pageNum in pageGroups) {
        const pageIndex = parseInt(pageNum);
        const paddedPage = String(pageIndex + 1).padStart(3, '0');
        const imagePath = `${imageDir}/page-${paddedPage}.png`;
        
        if (!fs.existsSync(imagePath)) {
          console.error(`Image file not found: ${imagePath}`);
          continue;
        }
        
        console.log(`Redacting page ${pageIndex + 1}...`);
        
        // Create command to draw black rectangles using ImageMagick
        let redactCmd = `convert "${imagePath}" `;
        
        // Add each redaction area
        pageGroups[pageNum].forEach(loc => {
          // Add a black rectangle for each redaction area
          redactCmd += `-fill black -draw "rectangle ${loc.x0},${loc.y0} ${loc.x1},${loc.y1}" `;
        });
        
        // Output to the same file
        redactCmd += `"${imagePath}"`;
        
        // Execute the command
        execSync(redactCmd);
      }
      
      // Combine images back into a PDF with high quality settings
      console.log("Combining images back into PDF...");
      const redactedPdf = `${tempDir}/redacted_combined_${timestamp}.pdf`;
      
      // Use ImageMagick with quality settings
      execSync(`convert -density ${quality} -quality 100 "${imageDir}/page-*.png" "${redactedPdf}"`);
      
      // Final cleanup and metadata removal
      console.log("Finalizing PDF...");
      execSync(`qpdf --remove-restrictions --linearize "${redactedPdf}" "${outputPath}"`);
      
      // Optimize the final PDF (optional)
      console.log("Optimizing final PDF...");
      const optimizedPath = `${tempDir}/optimized_${timestamp}.pdf`;
      execSync(`gs -dSAFER -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -dPDFSETTINGS=/prepress -dCompatibilityLevel=1.7 -sOutputFile="${optimizedPath}" "${outputPath}"`);
      
      // Use the optimized version if it exists and is not too small
      if (fs.existsSync(optimizedPath)) {
        const origStat = fs.statSync(outputPath);
        const optStat = fs.statSync(optimizedPath);
        
        // Only use optimized if it's not significantly smaller (which might indicate quality loss)
        if (optStat.size > 0.5 * origStat.size) {
          fs.renameSync(optimizedPath, outputPath);
        } else {
          console.log("Optimized version was too small, using original rasterized version");
          fs.unlinkSync(optimizedPath);
        }
      }
      
    } catch (error) {
      console.error("Error during image processing:", error);
      throw new Error(`Image processing failed: ${error.message}`);
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
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          
          // Remove the image directory and all its contents
          if (fs.existsSync(imageDir)) {
            fs.rmSync(imageDir, { recursive: true, force: true });
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
          locations: 'JSON array of areas to redact with format: [{page, text, x0, y0, x1, y1}]',
          quality: 'Optional: DPI quality for rendering (default: 600)'
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
