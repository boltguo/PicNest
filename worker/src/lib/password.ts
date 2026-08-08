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
const KEY_BYTES = KEY_BITS / 8;

/**
 * Bounds on the iteration count read back out of a record. The lower one keeps
 * a tampered row from downgrading the work factor to nothing; the upper one
 * keeps it from asking for a derivation that burns the CPU budget and takes
 * the request down with it.
 */
const MIN_ITERATIONS = 1_000;
const MAX_ITERATIONS = 1_000_000;

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

/**
 * False for anything that does not parse, so a corrupt row denies access
 * rather than throwing. Every field is checked before it reaches WebCrypto:
 * `atob` raises on malformed base64, and an unbounded iteration count read
 * from the record would be a way to make one request spin.
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4) return false;
  const [scheme, iterations, salt, hash] = parts;
  if (scheme !== SCHEME) return false;

  const rounds = Number(iterations);
  if (
    !Number.isInteger(rounds) ||
    rounds < MIN_ITERATIONS ||
    rounds > MAX_ITERATIONS
  ) {
    return false;
  }

  let saltBytes: Uint8Array;
  let hashBytes: Uint8Array;
  try {
    saltBytes = decode(salt);
    hashBytes = decode(hash);
  } catch {
    return false;
  }
  if (saltBytes.length !== SALT_BYTES || hashBytes.length !== KEY_BYTES) {
    return false;
  }

  const derived = await derive(password, saltBytes, rounds);
  // Both sides re-encoded here, so a record written with non-canonical base64
  // still compares on the bytes it decodes to.
  return timingSafeEqual(encode(derived), encode(hashBytes));
}
