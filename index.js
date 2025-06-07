const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const app = express();

const upload = multer({ dest: '/app/uploads/' });

// Remove metadata
app.post('/remove-metadata', upload.single('file'), (req, res) => {
  const inputPath = req.file.path;
  const outputPath = `${inputPath}_cleaned.pdf`;
  exec(`qpdf --remove-page-labels --remove-restrictions --linearize --replace-input ${inputPath} ${outputPath}`, (error, stdout, stderr) => {
    if (error) return res.status(500).json({ error: error.message });
    res.download(outputPath);
  });
});

// Replace text (requires specific page numbers and exact text)
app.post('/replace-content', upload.single('file'), (req, res) => {
  const { pageNumber, searchText, replaceText } = req.body;
  const inputPath = req.file.path;
  const outputPath = `${inputPath}_modified.pdf`;
  exec(`qpdf --modify-content "${inputPath}" --replace "${searchText}" "${replaceText}" --pages ${pageNumber} -- "${outputPath}"`, (error, stdout, stderr) => {
    if (error) return res.status(500).json({ error: error.message });
    res.download(outputPath);
  });
});

app.listen(1999, () => {
  console.log('Server running on port 1999');
});
