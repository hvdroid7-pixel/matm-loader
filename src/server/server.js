const path = require('path');
const express = require('express');

const app = express();

// Puerto para Render o local
const PORT = process.env.PORT || 3000;

// raíz del proyecto
const rootDir = process.cwd();

// carpeta donde están los scripts del mod
const clientDir = path.join(rootDir, 'src', 'client');

// Servir scripts del mod
app.use('/src/client', express.static(clientDir));

// Servir archivos del sitio (index.html, loader.js)
app.use(express.static(rootDir));

// Ruta principal
app.get('/', (_req, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[PonyLoader] Server running on port ${PORT}`);
});
