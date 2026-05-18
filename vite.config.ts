import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import fs from 'fs';

function copyStaticFiles() {
  return {
    name: 'copy-static-files',
    writeBundle() {
      fs.copyFileSync('manifest.json', 'dist/manifest.json');
      for (const icon of ['icon-128.png', 'claude_icon.svg']) {
        if (fs.existsSync(icon)) fs.copyFileSync(icon, `dist/${icon}`);
      }
      // accessibility-tree.js runs in MAIN world — copy the original compiled file
      fs.copyFileSync('assets/accessibility-tree.js-DxrE0N5Q.js', 'dist/accessibility-tree.js');
      if (fs.existsSync('sounds')) {
        fs.mkdirSync('dist/sounds', { recursive: true });
        for (const f of fs.readdirSync('sounds')) {
          fs.copyFileSync(`sounds/${f}`, `dist/sounds/${f}`);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyStaticFiles()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        options: resolve(__dirname, 'options.html'),
        background: resolve(__dirname, 'src/background.ts'),
        content: resolve(__dirname, 'src/content.ts'),
        'visual-indicator': resolve(__dirname, 'src/visual-indicator.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          ['background', 'content', 'visual-indicator'].includes(chunk.name)
            ? '[name].js'
            : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
