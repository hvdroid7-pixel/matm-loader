const path = require('path');
const express = require('express');

const app = express();

const PORT = process.env.PORT || 3000;

const rootDir = process.cwd();
const clientDir = path.join(rootDir, 'src', 'client');


// ⭐ HABILITAR CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  next();
});


// Servir scripts del mod
app.use('/src/client', express.static(clientDir));

// Servir archivos del sitio
app.use(express.static(rootDir));

app.get('/', (_req, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[PonyLoader] Server running on port ${PORT}`);
});
