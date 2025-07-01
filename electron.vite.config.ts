import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'apps/main-electron/src/main.ts'),
        external: ['electron'],
      },
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'apps/main-electron/src/preload.ts'),
        external: ['electron'],
      },
    }
  },
  renderer: {
    root: resolve(__dirname, 'apps/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'apps/renderer/index.html')
      }
    }
  }
}); 