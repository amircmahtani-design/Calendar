import { defineConfig, devices } from '@playwright/test';

// Runs against the local dev server wired to the Firebase emulators:
//   npx firebase emulators:start --only auth,firestore --project demo-calendar
//   VITE_USE_EMULATOR=1 npx vite --port 5173
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5173', timezoneId: 'Asia/Dubai', locale: 'en-GB', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'iphone', use: { ...devices['iPhone 14'], browserName: 'chromium' } },
  ],
});
