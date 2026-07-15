import { URL, fileURLToPath } from 'node:url';
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
  const qaBuildInputs =
    process.env.PARITY_INCLUDE_QA_FIXTURES === '1'
      ? {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          'tests/fixtures/trace-waterfall': fileURLToPath(
            new URL('./tests/fixtures/trace-waterfall.html', import.meta.url),
          ),
        }
      : undefined;
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
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    test: {
      exclude: [...configDefaults.exclude, '**/.claude/**', '**/tests/e2e/**'],
      // The NodeSlide interaction suites intentionally exercise complete jsdom
      // journeys. Keep their assertions strict while allowing parallel CI load
      // to finish without the 5 s Vitest default becoming a flaky failure.
      testTimeout: 15_000,
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
        input: qaBuildInputs,
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
