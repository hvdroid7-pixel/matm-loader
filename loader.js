(() => {
  console.log('[PonyLoader] Loader started');

  // Scripts del mod
  const modScripts = [
    'https://matm-loader.onrender.com/src/client/playerscript.js',
    'https://matm-loader.onrender.com/src/client/radar.js'
  ];

  const loadScript = async (url) => {
    try {
      console.log(`[PonyLoader] Fetching: ${url}`);

      const response = await fetch(url);
      const code = await response.text();

      // Ejecuta el código del script
      eval(code);

      console.log(`[PonyLoader] Executed: ${url}`);
    } catch (err) {
      console.error(`[PonyLoader] Failed: ${url}`, err);
    }
  };

  const loadAllScripts = async () => {
    for (const script of modScripts) {
      await loadScript(script);
    }
    console.log('[PonyLoader] All scripts finished loading');
  };

  loadAllScripts();
})();
