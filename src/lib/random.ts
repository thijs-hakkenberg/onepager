// Unbiased CSPRNG draw from `alphabet`: bytes at or above the largest multiple of
// the alphabet size are discarded rather than folded, so no character is favoured.
export function randomFrom(alphabet: string, size: number): string {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError(`size must be positive, got ${size}`);
  const ceiling = Math.floor(256 / alphabet.length) * alphabet.length;
  let out = "";
  while (out.length < size) {
    const bytes = crypto.getRandomValues(new Uint8Array(size + (size >> 2) + 1));
    for (const b of bytes) {
      if (b < ceiling) out += alphabet[b % alphabet.length];
      if (out.length === size) break;
    }
  }
  return out;
}

export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}
