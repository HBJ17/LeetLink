// Reads archives back with standard web APIs (DataView, DecompressionStream),
// so the test needs no Node type definitions.

import { describe, expect, it } from 'vitest';
import { crc32, createZip } from '../scripts/zip.mjs';

const encoder = new TextEncoder();

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads every entry back from a ZIP archive through its central directory. */
async function readZip(zip: Uint8Array): Promise<{ name: string; data: Uint8Array; crc: number }[]> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.byteLength - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let position = view.getUint32(end + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(position, true)).toBe(0x02014b50);
    const crc = view.getUint32(position + 16, true);
    const compressedSize = view.getUint32(position + 20, true);
    const nameLength = view.getUint16(position + 28, true);
    const localOffset = view.getUint32(position + 42, true);
    const name = new TextDecoder().decode(zip.subarray(position + 46, position + 46 + nameLength));

    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true);
    const data = await inflateRaw(zip.subarray(dataStart, dataStart + compressedSize));
    entries.push({ name, data, crc });
    position += 46 + nameLength;
  }
  return entries;
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('createZip', () => {
  it('round-trips files, including nested paths and binary data', async () => {
    const files = [
      { name: 'manifest.json', data: encoder.encode('{"name":"LeetLink"}') },
      { name: 'icons/icon16.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 1, 2]) },
      { name: 'popup/index.html', data: encoder.encode('<!doctype html>'.repeat(200)) },
    ];
    const entries = await readZip(createZip(files));
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    entries.forEach((entry, i) => {
      expect(Array.from(entry.data)).toEqual(Array.from(files[i]!.data));
      expect(entry.crc).toBe(crc32(files[i]!.data));
    });
  });

  it('writes an empty archive', async () => {
    expect(await readZip(createZip([]))).toEqual([]);
  });
});
