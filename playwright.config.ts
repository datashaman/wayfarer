import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:5192',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'PORT=8792 DATABASE_PATH=:memory: node server.mjs --dev',
      url: 'http://127.0.0.1:8792/api/config',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'VITE_SERVER_URL=http://127.0.0.1:8792 VITE_WS_URL=ws://127.0.0.1:8792/ws vite --host 127.0.0.1 --port 5192',
      url: 'http://127.0.0.1:5192',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
