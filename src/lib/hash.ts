// Git blob hashing. GitHub identifies every file by the SHA-1 of
// `blob <byte length>\0<content>`, so computing it locally tells whether a
// solution is already in the repository without downloading any files.

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Git blob SHA of `content` encoded as UTF-8, exactly as stored. Line endings
 * are not normalized, matching how LeetLink uploads files.
 */
export async function gitBlobSha(content: string): Promise<string> {
  const body = encoder.encode(content);
  const header = encoder.encode(`blob ${body.byteLength}\0`);
  const data = new Uint8Array(header.byteLength + body.byteLength);
  data.set(header, 0);
  data.set(body, header.byteLength);
  return toHex(await crypto.subtle.digest('SHA-1', data));
}
