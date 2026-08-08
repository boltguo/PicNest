import { timingSafeEqual } from "hono/utils/buffer";
import { SHARE_PBKDF2_ITERATIONS } from "../config";

/**
 * Share password storage.
 *
 * A plain SHA-256 is the wrong primitive here twice over: it is fast enough
 * to guess through a leaked table, and being unsalted and deterministic it
 * doubles as a bearer credential — anyone holding the digest could replay it
 * without ever knowing the password. PBKDF2 with a per-share salt fixes both.
 *
 * Encoded as `pbkdf2-sha256$<iterations>$<salt>$<hash>`, base64 for the two
 * binary parts. The iteration count travels with the record so raising
 * `SHARE_PBKDF2_ITERATIONS` later does not invalidate existing shares.
 */

const SCHEME = "pbkdf2-sha256";
const SALT_BYTES = 16;
const KEY_BITS = 256;

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (text: string) =>
  Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    KEY_BITS
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, SHARE_PBKDF2_ITERATIONS);
  return [SCHEME, SHARE_PBKDF2_ITERATIONS, encode(salt), encode(hash)].join("$");
}

/** False for anything that does not parse, so a corrupt row denies access. */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== SCHEME || !salt || !hash) return false;

  const rounds = Number(iterations);
  if (!Number.isInteger(rounds) || rounds < 1) return false;

  const derived = await derive(password, decode(salt), rounds);
  return timingSafeEqual(encode(derived), hash);
}
