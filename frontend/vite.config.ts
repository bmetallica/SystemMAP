import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    // ─── Proxy zum Backend mit erhöhtem Timeout ────────────────────
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 120_000,      // 2 Min Proxy-Timeout (statt ~30s default)
        proxyTimeout: 120_000, // Backend-Antwort Timeout
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.warn('⚠️ Proxy-Fehler:', err.message);
            // res kann ServerResponse ODER Socket sein (bei WS-Upgrade)
            try {
              if (res && 'writeHead' in res && typeof res.writeHead === 'function' && !res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Backend nicht erreichbar – bitte warten…' }));
              }
            } catch { /* ignore – connection already closed */ }
          });
        },
      },
    },
    // ─── HMR Reconnect bei instabiler Verbindung ──────────────────
    hmr: {
      overlay: false,       // Keine Fullscreen-Fehlermeldung bei HMR-Verlust
      timeout: 30_000,      // 30s HMR-Timeout (Standard-nah, verhindert hängende Connections)
    },
  },
});
