import { randomFrom } from "../lib/random";

// Eight characters of lowercase base36 — the shape Plugin.Onepager validates client-side.
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const SHAPE = /^[a-z0-9]+$/;

export function generateSlug(size = 8): string {
  return randomFrom(ALPHABET, size);
}

export function isValidSlug(value: unknown, size?: number): boolean {
  if (typeof value !== "string" || !SHAPE.test(value)) return false;
  return size === undefined || value.length === size;
}
