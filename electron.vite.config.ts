import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'parser/worker': resolve('src/main/parser/worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          source: resolve('src/preload/source.ts'),
          associate: resolve('src/preload/associate.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  }
});
