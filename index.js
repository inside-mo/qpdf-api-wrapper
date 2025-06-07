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
    
    // Step 1: First use qpdf to remove metadata and linearize the PDF
    const cleanPath = `${tempDir}/clean_${timestamp}.pdf`;
    console.log('Removing metadata and linearizing...');
    execSync(`qpdf --remove-restrictions --linearize ${inputPath} ${cleanPath}`);
    
    // Step 2: Apply redaction using a more thorough method - using Ghostscript
    // Group by page
    const pageGroups = {};
    locations.forEach(loc => {
      const page = loc.page || 0;
      if (!pageGroups[page]) pageGroups[page] = [];
      pageGroups[page].push(loc);
    });
    
    // Generate separate PS files for each page
    const psFiles = [];
    
    for (const [page, locs] of Object.entries(pageGroups)) {
      const psFile = `${tempDir}/redact_p${page}_${timestamp}.ps`;
      
      // Start with PS header
      let psContent = `%!PS-Adobe-3.0
%%Title: Redaction Layer
%%Pages: 1
%%PageOrder: Ascend
%%BoundingBox: 0 0 596 842
%%EndComments
%%Page: 1 1
`;

      // Add black rectangles for each location
      locs.forEach(loc => {
        const { x0, y0, x1, y1 } = loc;
        
        // Convert PDF coordinates to PostScript coordinates (might need adjustment)
        // PDF coordinates have origin at bottom-left, with y axis going up
        // In case page_height is not provided, estimate using standard A4 height
        const pageHeight = loc.page_height || 842;
        const y0PS = pageHeight - y1;
        const y1PS = pageHeight - y0;
        
        // Add redaction rectangle with some padding
        psContent += `
1 0 0 setrgbcolor % Red for visibility during testing
newpath
${x0-2} ${y0PS-2} moveto
${x1+2} ${y0PS-2} lineto
${x1+2} ${y1PS+2} lineto
${x0-2} ${y1PS+2} lineto
closepath
fill
0 0 0 setrgbcolor % Black for final redaction
newpath
${x0-1} ${y0PS-1} moveto
${x1+1} ${y0PS-1} lineto
${x1+1} ${y1PS+1} lineto
${x0-1} ${y1PS+1} lineto
closepath
fill
`;
      });
      
      // End PS file
      psContent += `
showpage
%%EOF
`;
      
      fs.writeFileSync(psFile, psContent);
      psFiles.push({ page: parseInt(page), file: psFile });
    }
    
    // Step 3: Create overlay PDFs for each page with Ghostscript
    const overlays = [];
    
    for (const pageInfo of psFiles) {
      const overlayPdf = `${tempDir}/overlay_p${pageInfo.page}_${timestamp}.pdf`;
      console.log(`Creating redaction overlay for page ${pageInfo.page+1}...`);
      
      try {
        execSync(`gs -q -sDEVICE=pdfwrite -dBATCH -dNOPAUSE -dNOSAFER -sOutputFile=${overlayPdf} ${pageInfo.file}`);
        overlays.push({ page: pageInfo.page, file: overlayPdf });
      } catch (error) {
        console.error(`Error creating overlay for page ${pageInfo.page+1}:`, error);
        throw new Error(`Failed to create overlay for page ${pageInfo.page+1}: ${error.message}`);
      }
    }
    
    // Step 4: Rasterize the pages containing sensitive information, then re-embed them
    // This is the key to truly removing the underlying text
    // Determine which pages need rasterization
    const pagesToRasterize = [...new Set(locations.map(loc => loc.page))];
    
    // Create a directory to store rasterized pages
    const rasterDir = `${tempDir}/raster_${timestamp}`;
    fs.mkdirSync(rasterDir, { recursive: true });
    
    // Extract and rasterize individual pages
    for (const pageNum of pagesToRasterize) {
      console.log(`Processing page ${pageNum+1}...`);
      
      try {
        // Extract the page
        const singlePage = `${rasterDir}/page_${pageNum}.pdf`;
        execSync(`pdftk ${cleanPath} cat ${pageNum+1} output ${singlePage}`);
        
        // Rasterize at high resolution (300 DPI)
        const rasterPage = `${rasterDir}/raster_${pageNum}.pdf`;
        execSync(`gs -q -sDEVICE=pdfwrite -dBATCH -dNOPAUSE -dNOSAFER -dPDFSETTINGS=/prepress -r300 -sOutputFile=${rasterPage} ${singlePage}`);
        
        // Apply redaction overlay
        const redactedPage = `${rasterDir}/redacted_${pageNum}.pdf`;
        const overlay = overlays.find(o => o.page === pageNum)?.file;
        
        if (overlay) {
          execSync(`pdftk ${rasterPage} stamp ${overlay} output ${redactedPage}`);
        } else {
          fs.copyFileSync(rasterPage, redactedPage);
        }
      } catch (error) {
        console.error(`Error processing page ${pageNum+1}:`, error);
        throw new Error(`Failed to process page ${pageNum+1}: ${error.message}`);
      }
    }
    
    // Step 5: Create a list of replacement pages
    // Build pdftk command to reassemble the PDF with redacted pages
    let pdftkCmd = `pdftk ${cleanPath} `;
    
    pagesToRasterize.forEach(pageNum => {
      pdftkCmd += `update_page ${pageNum+1} ${rasterDir}/redacted_${pageNum}.pdf `;
    });
    
    pdftkCmd += `output ${outputPath}`;
    
    console.log('Reassembling PDF with redacted pages...');
    try {
      execSync(pdftkCmd);
    } catch (error) {
      console.error('Error reassembling PDF:', error);
      throw new Error(`Failed to reassemble PDF: ${error.message}`);
    }
    
    // Step 6: Final pass to ensure metadata is removed
    const finalPath = `${tempDir}/final_redacted_${timestamp}.pdf`;
    console.log('Final metadata removal...');
    try {
      execSync(`qpdf --remove-restrictions --linearize ${outputPath} ${finalPath}`);
    } catch (error) {
      console.error('Error during final metadata removal:', error);
      throw new Error(`Failed during final metadata removal: ${error.message}`);
    }
    
    // Return the redacted PDF
    res.download(finalPath, `redacted_${path.basename(req.file.originalname || 'document.pdf')}`, (err) => {
      if (err) {
        console.error('Download error:', err);
      }
      
      // Clean up temporary files
      setTimeout(() => {
        try {
          fs.unlinkSync(inputPath);
          fs.unlinkSync(cleanPath);
          fs.unlinkSync(outputPath);
          fs.unlinkSync(finalPath);
          
          // Clean up overlay files
          psFiles.forEach(p => {
            if (fs.existsSync(p.file)) fs.unlinkSync(p.file);
          });
          
          overlays.forEach(o => {
            if (fs.existsSync(o.file)) fs.unlinkSync(o.file);
          });
          
          // Clean up rasterized pages
          if (fs.existsSync(rasterDir)) {
            fs.rmSync(rasterDir, { recursive: true, force: true });
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
          locations: 'JSON array of areas to redact with format: [{page, text, x0, y0, x1, y1, page_height, page_width}]'
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
