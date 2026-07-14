import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';
import {
  frontendRuntimeSourceManifest,
  resolveRuntimeSourceSha,
} from './scripts/runtime-source.mjs';

export default defineConfig(() => {
  const sourceSha = resolveRuntimeSourceSha();
  const runtimeSource = frontendRuntimeSourceManifest({ sourceSha });
  return {
    plugins: [
      react(),
      {
        name: 'parity-runtime-source',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'runtime-source.json',
            source: `${JSON.stringify(runtimeSource, null, 2)}\n`,
          });
        },
      },
    ],
    test: {
      exclude: [...configDefaults.exclude, '**/.claude/**', '**/tests/e2e/**'],
    },
    css: {
      postcss: {
        plugins: [tailwindcss()],
      },
    },
    server: {
      port: 5180,
      strictPort: true,
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@monaco-editor') || id.includes('monaco-editor')) return 'editor';
            if (id.includes('react') || id.includes('react-dom')) return 'react';
            if (id.includes('convex')) return 'convex';
            if (id.includes('lucide-react')) return 'icons';
            if (id.includes('jszip')) return 'zip';
            return 'vendor';
          },
        },
      },
    },
  };
});
