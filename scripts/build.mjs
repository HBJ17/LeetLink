// Builds each extension entry point as a standalone IIFE bundle.
// Content scripts cannot be ES modules, so every entry is bundled on its own.

import { resolve } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

const entries = {
  background: 'src/background/index.ts',
};

let first = true;
for (const [name, entry] of Object.entries(entries)) {
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: first,
      target: 'chrome111',
      minify: false,
      sourcemap: watch ? 'inline' : false,
      watch: watch ? {} : null,
      lib: {
        entry: resolve(root, entry),
        formats: ['iife'],
        name: `LeetLink_${name}`,
        fileName: () => `${name}.js`,
      },
    },
  });
  first = false;
}

console.log(watch ? 'Watching for changes...' : `Built extension into ${outDir}`);
