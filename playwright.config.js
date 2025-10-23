import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  use: {
    browserName: 'chromium',
    headless: false,
    viewport: { width: 1280, height: 720 },
    screenshot: 'on',
    video: 'off',
    trace: 'on-first-retry',
    launchOptions: {
      slowMo: 500, // slows actions by 500ms so you can watch them happen
    },
  },
});
