// Zips the built extension in dist/ into leetlink-<version>.zip, ready to
// upload to the Chrome Web Store (and other Chromium extension stores).
// Run `npm run package`, which builds first.

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { createZip } from './zip.mjs';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');

async function listFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else files.push(path);
  }
  return files;
}

const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
const files = (await listFiles(dist)).sort();
const entries = await Promise.all(
  files.map(async (path) => ({ name: relative(dist, path).split(sep).join('/'), data: await readFile(path) })),
);

const out = resolve(root, `leetlink-${manifest.version}.zip`);
await writeFile(out, createZip(entries));
const { size } = await stat(out);
console.log(`Packaged ${entries.length} files into ${relative(root, out)} (${(size / 1024).toFixed(1)} KB)`);
