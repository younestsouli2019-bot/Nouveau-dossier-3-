import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
    exclude: ['node_modules/**', '.trunk/**', 'src/lib/procurement/tracking-fraud-guard.d.ts'],
  },
})
