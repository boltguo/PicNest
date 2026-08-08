/**
 * Server-side image format detection.
 *
 * `Content-Type` is chosen by the client and costs nothing to forge, so it
 * decides nothing here: the leading bytes of the upload do. Whatever the
 * signature says is what gets stored, served and used to build the object
 * key — the request header and the user's file extension are both ignored.
 *
 * The allow-list is deliberately short. SVG in particular is absent: it is an
 * executable XML document rather than a picture, and an image host has no
 * reason to take one.
 */

export interface ImageFormat {
  /** Canonical MIME type, stored on the object and the row. */
  mime: string;
  /** Canonical extension including the dot, e.g. `.jpg`. */
  extension: string;
  /** Extensions already correct for this format, so names are left alone. */
  aliases: string[];
}

const JPEG: ImageFormat = {
  mime: "image/jpeg",
  extension: ".jpg",
  aliases: [".jpg", ".jpeg"],
};
const PNG: ImageFormat = {
  mime: "image/png",
  extension: ".png",
  aliases: [".png"],
};
const GIF: ImageFormat = {
  mime: "image/gif",
  extension: ".gif",
  aliases: [".gif"],
};
const WEBP: ImageFormat = {
  mime: "image/webp",
  extension: ".webp",
  aliases: [".webp"],
};
const AVIF: ImageFormat = {
  mime: "image/avif",
  extension: ".avif",
  aliases: [".avif"],
};

/** Shortest header any of the checks below needs (RIFF/WEBP and ftyp). */
const MIN_HEADER_BYTES = 12;

const startsWith = (head: Uint8Array, signature: number[]) =>
  signature.every((byte, i) => head[i] === byte);

const ascii = (head: Uint8Array, at: number, text: string) =>
  [...text].every((ch, i) => head[at + i] === ch.charCodeAt(0));

/**
 * ISO-BMFF `ftyp` box: major brand at offset 8, compatible brands from 16 on.
 * Plenty of encoders write `mif1` as the major brand and only list `avif`
 * among the compatible ones, so both places have to be looked at.
 */
function isAvif(head: Uint8Array): boolean {
  if (!ascii(head, 4, "ftyp")) return false;
  const boxSize =
    ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0;
  const end = Math.min(boxSize, head.length);
  for (let at = 8; at + 4 <= end; at += 4) {
    if (at === 12) continue; // minor version, not a brand
    if (ascii(head, at, "avif") || ascii(head, at, "avis")) return true;
  }
  return false;
}

/** The format `body` actually is, or null if it is not an accepted image. */
export function detectImage(body: ArrayBuffer): ImageFormat | null {
  if (body.byteLength < MIN_HEADER_BYTES) return null;
  const head = new Uint8Array(body, 0, Math.min(body.byteLength, 32));

  if (startsWith(head, [0xff, 0xd8, 0xff])) return JPEG;
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return PNG;
  }
  if (ascii(head, 0, "GIF87a") || ascii(head, 0, "GIF89a")) return GIF;
  if (ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP")) return WEBP;
  if (isAvif(head)) return AVIF;
  return null;
}

const FORMATS = [JPEG, PNG, GIF, WEBP, AVIF];

/** Every extension any accepted format answers to. */
const IMAGE_EXTENSIONS = FORMATS.flatMap((f) => f.aliases);

/**
 * The format an object key names. Keys are minted from `detectImage`, so this
 * recovers the sniffed format later — during a rename, say — without holding
 * the bytes again.
 */
export function formatForKey(key: string): ImageFormat | null {
  const dot = key.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = key.slice(dot).toLowerCase();
  return FORMATS.find((f) => f.aliases.includes(ext)) ?? null;
}

/**
 * Give the display name an extension that matches what the file turned out to
 * be. The name is only presentation, but it is also what a browser saves the
 * download as — `holiday.html` for a file the sniffer says is a PNG would be
 * an odd thing to write to someone's disk.
 *
 * A wrong *image* extension is corrected in place (`photo.jpeg` on PNG bytes
 * becomes `photo.png`); anything else keeps its name and gains the right
 * extension, so nothing is quietly stripped off a name the user chose.
 */
export function withImageExtension(name: string, format: ImageFormat): string {
  const lower = name.toLowerCase();
  if (format.aliases.some((ext) => lower.endsWith(ext))) return name;

  const wrong = IMAGE_EXTENSIONS.find((ext) => lower.endsWith(ext));
  const stem = wrong ? name.slice(0, -wrong.length) : name;
  return stem + format.extension;
}
