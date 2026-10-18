import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Dev only: points the page at a running `nabi serve` (written to ~/.nabi/daemon.json),
 * so http://127.0.0.1:5173/ shows live data without copying a token link. The daemon
 * injects the same tag into the pages it serves itself. Read on every page load, so
 * starting the daemon after Vite only needs a reload.
 */
function daemonDiscovery(): Plugin {
  return {
    name: 'nabi-daemon-discovery',
    apply: 'serve',
    transformIndexHtml() {
      if (process.env.NABI_NO_DISCOVERY) return [];
      try {
        const { port, token, pid } = JSON.parse(
          readFileSync(
            join(
              process.env.NABI_HOME ?? join(homedir(), '.nabi'),
              'daemon.json',
            ),
            'utf8',
          ),
        );
        process.kill(pid, 0); // Throws when the daemon has gone.
        if (!/^\d{1,5}$/.test(String(port)) || !/^[0-9a-f]+$/.test(token))
          return [];
        return [
          {
            tag: 'meta',
            attrs: { name: 'nabi-daemon', content: `${port}:${token}` },
            injectTo: 'head',
          },
        ];
      } catch {
        return [];
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), daemonDiscovery()],
  // The same versioned assets are served in development and copied into the build.
  // Never serve assets/src, which includes large editable source files.
  publicDir: fileURLToPath(new URL('../../assets/dist', import.meta.url)),
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
