import { and, eq, sql, type AnyColumn } from "drizzle-orm";
import { z } from "zod";
import {
  MAX_FOLDER_DEPTH,
  NAME_COLLISION_ATTEMPTS,
  RANDOM_NAME_ATTEMPTS,
  RESERVED_PREFIX,
} from "../config";
import { files, folders, type Db } from "../db";
import type { ImageFormat } from "./image";

// Control characters plus path separators are never allowed in a key segment.
const ILLEGAL_CHARS = /[\u0000-\u001f\u007f\/\\]/u;

/**
 * Make a client-supplied file name safe to use as an R2 key segment.
 * Falls back to "file" if nothing survives.
 */
export function sanitizeFileName(raw: string): string {
  const cleaned = raw.replace(new RegExp(ILLEGAL_CHARS, "g"), "").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "file";
  return cleaned.slice(0, 200);
}

const isValidSegment = (s: string) =>
  s.length > 0 &&
  s !== "." &&
  s !== ".." &&
  !ILLEGAL_CHARS.test(s) &&
  s.trim() === s;

/**
 * Folder path: slash-separated segments, no leading/trailing slash,
 * empty string = root. The reserved `_` top-level prefix is rejected.
 */
export const folderSchema = z
  .string()
  .max(512)
  .refine(
    (p) =>
      p === "" ||
      (!p.startsWith(RESERVED_PREFIX) &&
        p.split("/").length <= MAX_FOLDER_DEPTH &&
        p.split("/").every(isValidSegment)),
    "invalid folder path"
  );

/** Non-empty variant for folder creation/deletion. */
export const folderPathSchema = folderSchema.refine(
  (p) => p !== "",
  "invalid folder path"
);

/** `wallpapers/mac` -> ["wallpapers", "wallpapers/mac"] */
function ancestorPaths(path: string): string[] {
  const segments = path.split("/");
  return segments.map((_, i) => segments.slice(0, i + 1).join("/"));
}

/** Insert the folder and all its ancestors, ignoring rows that already exist. */
export async function ensureFolders(db: Db, path: string): Promise<void> {
  if (path === "") return;
  await db
    .insert(folders)
    .values(ancestorPaths(path).map((p) => ({ path: p })))
    .onConflictDoNothing();
}

/**
 * Content-addressed object key: the full SHA-256 hex digest plus the
 * extension the format sniffer assigned. Both halves are derived from the
 * bytes alone, so `photo.jpg`, `photo.jpeg` and an extensionless copy of the
 * same image all land on one key — which is what makes dedup work and
 * `immutable` caching provably safe. The full digest also removes any need
 * to check a truncated prefix for collisions before reusing an object.
 */
export const contentKey = (hash: string, format: ImageFormat) =>
  hash + format.extension;

/** Six hex characters — enough that three tries practically never all miss. */
const randomSuffix = () =>
  [...crypto.getRandomValues(new Uint8Array(3))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/**
 * Resolve a collision-free display name inside `folder` by appending
 * `-2`, `-3`, ... before the extension. Names no longer affect storage,
 * but two identically named cards in one folder are confusing.
 *
 * Every attempt is a D1 query against a 50-per-invocation budget on the free
 * plan, so the sequential run is short and then gives up on tidy numbering:
 * a folder that already holds five `photo-N.png` is not worth another forty
 * round trips to discover that the answer is `photo-47.png`.
 */
export async function resolveUniqueName(
  db: Db,
  folder: string,
  name: string
): Promise<string> {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";

  const isFree = async (candidate: string) =>
    !(await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.folder, folder), eq(files.name, candidate)))
      .get());

  for (let i = 1; i <= NAME_COLLISION_ATTEMPTS; i++) {
    const candidate = i === 1 ? name : `${stem}-${i}${ext}`;
    if (await isFree(candidate)) return candidate;
  }
  for (let i = 0; i < RANDOM_NAME_ATTEMPTS; i++) {
    const candidate = `${stem}-${randomSuffix()}${ext}`;
    if (await isFree(candidate)) return candidate;
  }
  throw new Error("could not resolve a unique name");
}

/**
 * Matches every path strictly under `parent` — the subtree, not `parent`
 * itself.
 *
 * Deliberately not `LIKE 'parent/%'`, which was wrong three separate ways:
 *
 *  - SQLite's LIKE ignores ASCII case, so `Photos` and `photos` matched each
 *    other. Recursive delete is built on this predicate, which made deleting
 *    one folder capable of taking an unrelated one's files with it.
 *  - D1 caps a LIKE pattern at 50 bytes while a folder path may be 512
 *    characters. At three UTF-8 bytes per CJK character the cap arrives around
 *    sixteen characters of Chinese path, and past it SQLite raises instead of
 *    matching nothing — so listing a folder returned a 500, not an empty card.
 *  - The pattern had to escape `%` and `_` out of the user's folder names.
 *
 * A prefix comparison has none of those. `substr`/`length` are evaluated by
 * SQLite, which counts characters; the old code passed JavaScript's `.length`
 * into `substr` and the two disagree outside the BMP (`📷` is one character
 * but two UTF-16 units), which silently mis-sliced emoji folder names.
 * `COLLATE BINARY` is the default for these operands and is stated anyway,
 * because case-insensitivity is exactly the bug being fixed.
 */
export function descendantOf(column: AnyColumn, parent: string) {
  const prefix = `${parent}/`;
  return sql`substr(${column}, 1, length(${prefix})) = ${prefix} COLLATE BINARY`;
}

/**
 * The part of a descendant path that comes after `parent/`, as SQL. Same
 * character-vs-UTF-16 reasoning as above: SQLite measures the prefix.
 */
export function relativeTo(column: AnyColumn, parent: string) {
  if (parent === "") return sql`${column}`;
  return sql`substr(${column}, length(${`${parent}/`}) + 1)`;
}
