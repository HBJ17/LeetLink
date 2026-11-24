// Builds each extension entry point as a standalone IIFE bundle.
// Content scripts cannot be ES modules, so every entry is bundled on its own.
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

const entries = {
  background: 'src/background/index.ts',
  content: 'src/content/index.ts',
  hook: 'src/content/hook.ts',
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

// Extension pages (options and popup) are plain HTML entries and can
// use ES modules, so they share one build.
const pages = {
  options: 'src/options/index.html',
  popup: 'src/popup/index.html',
};

await build({
  root: resolve(root, 'src'),
  base: './',
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: false,
    target: 'chrome111',
    minify: false,
    sourcemap: watch ? 'inline' : false,
    watch: watch ? {} : null,
    rollupOptions: {
      input: Object.fromEntries(Object.entries(pages).map(([name, page]) => [name, resolve(root, page)])),
    },
  },
});

await mkdir(outDir, { recursive: true });
await copyFile(resolve(root, 'manifest.json'), resolve(outDir, 'manifest.json'));
console.log(watch ? 'Watching for changes...' : `Built extension into ${outDir}`);
