import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { NAME_COLLISION_ATTEMPTS, RESERVED_PREFIX } from "../config";
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
      (!p.startsWith(RESERVED_PREFIX) && p.split("/").every(isValidSegment)),
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

/**
 * Resolve a collision-free display name inside `folder` by appending
 * `-2`, `-3`, ... before the extension. Names no longer affect storage,
 * but two identically named cards in one folder are confusing.
 */
export async function resolveUniqueName(
  db: Db,
  folder: string,
  name: string
): Promise<string> {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";

  for (let i = 1; i <= NAME_COLLISION_ATTEMPTS; i++) {
    const candidate = i === 1 ? name : `${stem}-${i}${ext}`;
    const existing = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.folder, folder), eq(files.name, candidate)))
      .get();
    if (!existing) return candidate;
  }
  throw new Error("could not resolve a unique name");
}

/** SQL LIKE pattern matching everything under a folder (escapes % and _). */
export const subtreePattern = (path: string) =>
  `${path.replace(/[%_]/g, (ch) => `\\${ch}`)}/%`;
