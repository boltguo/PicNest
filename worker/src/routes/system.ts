import { inArray } from "drizzle-orm";
import { Hono } from "hono";
import { CONTENT_KEY_RE } from "../config";
import { createDb, files } from "../db";
import { requireAuth } from "../lib/auth";
import { chunk, insertFileRow, isKeyTaken } from "../lib/files";
import { ensureFolders, folderSchema, sanitizeFileName } from "../lib/paths";
import type { AppEnv } from "../types";

/** Keep well under D1's bound-parameter limit per statement. */
const D1_BATCH = 50;

/**
 * Objects imported per call. Each one costs a folder insert, at least one
 * name lookup and the row insert, against 50 D1 queries per invocation on the
 * free plan — so an unbounded loop over a bucket that drifted badly would fail
 * partway through and look like corruption. The work is idempotent; the
 * response says how much is left so the caller can just run it again.
 */
const IMPORT_LIMIT = 10;

interface ObjectMeta {
  size: number;
  mime: string;
  name: string;
  folder: string;
  /** R2's own upload time, so an imported row keeps the original ordering. */
  uploaded: number;
}

/**
 * Recover a display name and folder for an object that has no row. A content
 * key is a hash and an extension — it carries neither — so the customMetadata
 * written at upload time is the only source. Without it the object still
 * imports, into the root and under its own key.
 */
function metaFor(key: string, custom: Record<string, string> | undefined) {
  const folder = custom?.folder ?? "";
  return {
    name: sanitizeFileName(custom?.name ?? key),
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
   *
   * Imports are batched to stay inside one invocation's query budget; call it
   * again while the response still reports `remaining`.
   */
  .post("/api/repair", requireAuth, async (c) => {
    const db = createDb(c.env.DB);

    // Rows first, then objects. The whole pass turns on which snapshot is
    // older: a row is only safe to drop if the bucket was listed *after* it
    // was read, otherwise an upload that finishes mid-scan looks exactly like
    // a row whose object is gone — and deleting it cascades away that file's
    // share links, which no later repair can put back.
    const indexed = await db.select({ id: files.id, key: files.key }).from(files);
    const indexedKeys = new Set(indexed.map((r) => r.key));

    const objects = new Map<string, ObjectMeta>();
    let cursor: string | undefined;
    do {
      const res = await c.env.BUCKET.list({
        cursor,
        include: ["httpMetadata", "customMetadata"],
      });
      for (const o of res.objects) {
        // Only PicNest's own content-addressed keys. Anything else in the
        // bucket — a backup written by hand, a future internal export — would
        // become a card that `/f/` then refuses to serve, since the public
        // route matches the same pattern. A broken row is worse than no row.
        if (!CONTENT_KEY_RE.test(o.key)) continue;
        objects.set(o.key, {
          size: o.size,
          mime: o.httpMetadata?.contentType ?? "application/octet-stream",
          uploaded: o.uploaded.getTime(),
          ...metaFor(o.key, o.customMetadata),
        });
      }
      cursor = res.truncated ? res.cursor : undefined;
    } while (cursor);

    // One object may legitimately back several rows (the same image filed in
    // two folders), so an object counts as indexed if *any* row points at it.
    const missing = [...objects.entries()].filter(
      ([key]) => !indexedKeys.has(key)
    );
    const batch = missing.slice(0, IMPORT_LIMIT);
    for (const [, meta] of batch) await ensureFolders(db, meta.folder);
    let imported = 0;
    for (const [key, meta] of batch) {
      try {
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
        imported++;
      } catch (error) {
        // The other side of reading rows first: an ordinary upload indexed
        // this object after the snapshot, so it is not an orphan at all and
        // the unique index says so. Nothing to import, nothing wrong.
        if (!isKeyTaken(error)) throw error;
      }
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
      imported,
      removed: orphaned.length,
      objects: objects.size,
      /** Objects still waiting for a row. Run repair again to take the next batch. */
      remaining: missing.length - batch.length,
    });
  });
