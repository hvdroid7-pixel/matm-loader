(() => {
  console.log('[PonyLoader] Loader started');

  // Keep this list ordered: scripts load sequentially in the same order.
  const modScripts = [
    '/src/client/playerscript.js',
    '/src/client/radar.js'
  ];

  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;

      script.onload = () => {
        console.log(`[PonyLoader] Loaded: ${src}`);
        resolve(src);
      };

      script.onerror = () => {
        reject(new Error(`[PonyLoader] Failed to load: ${src}`));
      };

      document.head.appendChild(script);
    });

  const loadAllScripts = async () => {
    try {
      for (const scriptPath of modScripts) {
        await loadScript(scriptPath);
      }
      console.log('[PonyLoader] All scripts finished loading');
    } catch (error) {
      console.error(error.message);
    }
  };

  loadAllScripts();
})();
