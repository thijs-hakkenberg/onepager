import { randomFrom, sha256Hex } from "../lib/random";

// Plugin tokens: `op_<12 base62>_<32 base62>`. Only sha256(secret) is persisted.
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const PREFIX = "op";

export const hashSecret = (secret: string) => sha256Hex(secret);

export async function mintToken() {
  const tokenId = randomFrom(BASE62, 12);
  const secret = randomFrom(BASE62, 32);
  return { tokenId, full: `${PREFIX}_${tokenId}_${secret}`, secretHash: await hashSecret(secret) };
}

export function parseBearer(header: string | null | undefined): { tokenId: string; secret: string } | null {
  if (!header) return null;
  const match = /^\s*bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) return null;
  const parts = match[1].split("_");
  if (parts.length !== 3 || parts[0] !== PREFIX || !parts[1] || !parts[2]) return null;
  return { tokenId: parts[1], secret: parts[2] };
}
