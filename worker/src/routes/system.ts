import { inArray } from "drizzle-orm";
import { Hono } from "hono";
import { RESERVED_PREFIX } from "../config";
import { createDb, files } from "../db";
import { requireAuth } from "../lib/auth";
import { chunk, insertFileRow } from "../lib/files";
import { ensureFolders, folderSchema, sanitizeFileName } from "../lib/paths";
import type { AppEnv } from "../types";

/** Keep well under D1's bound-parameter limit per statement. */
const D1_BATCH = 50;

interface ObjectMeta {
  size: number;
  mime: string;
  name: string;
  folder: string;
  /** R2's own upload time, so an imported row keeps the original ordering. */
  uploaded: number;
}

/**
 * Recover a display name and folder for an object that has no row.
 * Object keys are content hashes and carry no such information, so the
 * customMetadata written at upload time is the only source — falling back
 * to the key itself keeps objects added out of band importable.
 */
function metaFor(key: string, custom: Record<string, string> | undefined) {
  const slash = key.lastIndexOf("/");
  const fallbackFolder = slash === -1 ? "" : key.slice(0, slash);
  const fallbackName = slash === -1 ? key : key.slice(slash + 1);
  const folder = custom?.folder ?? fallbackFolder;
  return {
    name: sanitizeFileName(custom?.name ?? fallbackName),
    folder: folderSchema.safeParse(folder).success ? folder : "",
  };
}

export const systemRoutes = new Hono<AppEnv>()

  /**
   * Reconcile the D1 index against the R2 bucket, in both directions:
   * objects with no row are imported, rows whose object is gone are dropped.
   * Run it after editing the bucket out of band, or after an upload failed
   * between the R2 put and the D1 insert.
   *
   * This is a consistency repair, not a backup restore. R2 holds the bytes;
   * D1 holds names, folders and share links, and an object carries only the
   * name and folder it was *first* uploaded with — one set of customMetadata
   * per object, never updated by a later rename or move. So an import gives
   * you your images back under their original names, and cannot give you back
   * renames, moves, the second folder a deduplicated image was filed in, or
   * any share link. Point-in-time recovery of that metadata is D1 Time Travel.
   */
  .post("/api/repair", requireAuth, async (c) => {
    const db = createDb(c.env.DB);

    const objects = new Map<string, ObjectMeta>();
    let cursor: string | undefined;
    do {
      const res = await c.env.BUCKET.list({
        cursor,
        include: ["httpMetadata", "customMetadata"],
      });
      for (const o of res.objects) {
        if (o.key.startsWith(RESERVED_PREFIX)) continue;
        objects.set(o.key, {
          size: o.size,
          mime: o.httpMetadata?.contentType ?? "application/octet-stream",
          uploaded: o.uploaded.getTime(),
          ...metaFor(o.key, o.customMetadata),
        });
      }
      cursor = res.truncated ? res.cursor : undefined;
    } while (cursor);

    const indexed = await db.select({ id: files.id, key: files.key }).from(files);
    const indexedKeys = new Set(indexed.map((r) => r.key));

    // One object may legitimately back several rows (the same image filed in
    // two folders), so an object counts as indexed if *any* row points at it.
    const missing = [...objects.entries()].filter(
      ([key]) => !indexedKeys.has(key)
    );
    for (const [, meta] of missing) await ensureFolders(db, meta.folder);
    for (const [key, meta] of missing) {
      await insertFileRow(
        db,
        {
          key,
          folder: meta.folder,
          size: meta.size,
          mime: meta.mime,
          createdAt: meta.uploaded,
        },
        meta.name
      );
    }

    const orphaned = indexed.filter((r) => !objects.has(r.key));
    for (const rows of chunk(orphaned, D1_BATCH)) {
      await db.delete(files).where(
        inArray(
          files.id,
          rows.map((r) => r.id)
        )
      );
    }

    return c.json({
      imported: missing.length,
      removed: orphaned.length,
      objects: objects.size,
    });
  });
