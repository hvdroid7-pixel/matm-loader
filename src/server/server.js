const path = require('path');
const express = require('express');

const app = express();
const PORT = 3000;

const rootDir = path.resolve(__dirname, '..', '..');
const clientDir = path.join(rootDir, 'src', 'client');

// Serve client mod scripts directly from /src/client/*
app.use('/src/client', express.static(clientDir));

// Serve project root static assets like index.html and loader.js
app.use(express.static(rootDir));

// Default route for the loader website
app.get('/', (_req, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[PonyLoader] Server running on http://localhost:${PORT}`);
});
