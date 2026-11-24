// Types for the ZIP writer used by the packaging script.

export function crc32(data: Uint8Array): number;

/** Entry data may be any byte array; Node Buffers work too. */
export function createZip(entries: { name: string; data: Uint8Array }[], date?: Date): Uint8Array;
