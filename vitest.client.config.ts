import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: '@deepseek-ai/dsh-client-ui-renderer/client', replacement: r('./tests/shims/renderer.ts') },
      { find: '@deepseek-ai/dsh-client-ui-primitives', replacement: r('./tests/fakes/primitives.tsx') },
      { find: '@deepseek-ai/dsh-client-store', replacement: r('./tests/fakes/store.ts') },
      { find: '@deepseek-ai/dsh-client-locale/client', replacement: r('./tests/shims/locale.ts') },
    ],
  },
  test: {
    include: ['tests/browser-plugin.client.spec.ts'],
    environment: 'jsdom',
    setupFiles: ['./tests/setup-module-loader.ts'],
    css: { modules: { classNameStrategy: 'stable' } },
    server: { deps: { inline: [/@deepseek-ai\//, /dsh-/] } },
  },
})
