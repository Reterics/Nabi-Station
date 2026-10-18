import { defineConfig } from '@playwright/test';
import config from './playwright.config';

/**
 * Its own port and never reused: a `pnpm dev` you are running on 5173 (which shows
 * your real daemon's data) must not stand in for the test server.
 */
export default defineConfig({
  ...config,
  use: { ...config.use, baseURL: 'http://127.0.0.1:5174' },
  webServer: {
    command:
      'pnpm --filter @nabi/web exec vite --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    // A daemon you are running yourself must not leak live data into the tests.
    env: { NABI_NO_DISCOVERY: '1' },
  },
});
