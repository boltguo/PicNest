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
  /** R2's own upload time, so a rebuilt index keeps the original ordering. */
  uploaded: number;
}

/**
 * Recover the display name and folder an object was uploaded with.
 * Object keys are content hashes and carry no such information, so the
 * customMetadata written at upload time is the only source — falling back
 * to the key itself keeps objects added out of band (or by an older,
 * path-keyed version of this app) importable.
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
   * Rebuild the D1 index from the R2 bucket (R2 is the source of truth):
   * inserts rows for objects missing from D1, removes rows whose object is
   * gone. Run after out-of-band bucket edits or to recover a lost database.
   */
  .post("/api/reconcile", requireAuth, async (c) => {
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

    const indexed = await db
      .select({ id: files.id, key: files.key })
      .from(files);
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
      added: missing.length,
      removed: orphaned.length,
      total: objects.size,
    });
  });
