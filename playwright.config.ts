import { defineConfig, devices } from '@playwright/test';

/**
 * runs against a dev server this config starts itself
 *
 * Its own port and its own distDir, so `npm run e2e` never knocks down the
 * dev server you already have open on 3000
 */

const PORT = Number(process.env.E2E_PORT || 3100);
// E2E_BASE=https://henehoe.app runs against the live site instead, which is
// how the render baselines are made, see e2e/render.spec.ts
const LIVE = process.env.E2E_BASE;
const baseURL = LIVE || `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',

  // every closet panel is mounted at once, so the first paint pulls all 13
  // index files off disk. generous, but only the first assertion waits
  timeout: 90_000,
  expect: { timeout: 15_000 },

  // baselines sit beside the character they're of, with no per-OS suffix
  snapshotPathTemplate: '{testDir}/characters/{arg}{ext}',

  use: {
    baseURL,
    trace: 'on-first-retry',
    // the item grid is a fixed height scroller, so a short viewport would
    // change how many rows a page reveals
    viewport: { width: 1440, height: 900 },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: LIVE ? undefined : {
    command: `npx next dev -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    // a cold compile of the stage is slow, and this waits on the first request
    timeout: 180_000,
    env: { NEXT_DIST_DIR: '.next-e2e' },
    stdout: 'pipe',
  },
});
