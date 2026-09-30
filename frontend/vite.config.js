import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Lets shared modules be imported by one stable path from any depth, rather
  // than counting ../ hops differently in components/, pages/ and pages/owner/.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  // M20 — Vitest shares this config rather than carrying its own, so tests
  // resolve modules exactly the way the real build does. A separate test config
  // is a second place for aliases and plugins to drift out of sync.
  test: {
    environment: 'jsdom',
    globals: true, // describe/it/expect without importing them, matching the backend suite's style
    setupFiles: './src/test/setup.js',
    // Only our own tests. Without this, Vitest would also walk node_modules and
    // try to run dependencies' own test files.
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true, // every spy/mock is reset between tests, so one test cannot leak into the next
  },
});
