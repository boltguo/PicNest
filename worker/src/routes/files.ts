import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { ACCEPTED_MIME, MAX_UPLOAD_BYTES } from "../config";
import { createDb, files, folders, type Db } from "../db";
import { requireAuth } from "../lib/auth";
import { deleteFileRows, insertFileRow } from "../lib/files";
import { sha256Hex } from "../lib/hash";
import {
  contentKey,
  ensureFolders,
  folderSchema,
  resolveUniqueName,
  sanitizeFileName,
  subtreePattern,
} from "../lib/paths";
import { serveObject } from "../lib/r2";
import type { AppEnv } from "../types";

/** How many recent images peek out of a folder card. */
const FOLDER_PREVIEW_LIMIT = 5;

/** True if `path` sits directly inside `parent` ("" = root). */
const isDirectChild = (path: string, parent: string) =>
  parent === ""
    ? !path.includes("/")
    : path.startsWith(`${parent}/`) &&
      !path.slice(parent.length + 1).includes("/");

/** Recent image keys plus total file count for one folder subtree. */
async function folderMeta(db: Db, path: string) {
  const pattern = subtreePattern(path);
  const inSubtree = or(
    eq(files.folder, path),
    sql`${files.folder} LIKE ${pattern} ESCAPE '\\'`
  );
  const [previews, stats] = await Promise.all([
    db
      .select({ key: files.key })
      .from(files)
      .where(inSubtree)
      .orderBy(desc(files.createdAt), desc(files.id))
      .limit(FOLDER_PREVIEW_LIMIT),
    db
      .select({ count: sql<number>`count(*)` })
      .from(files)
      .where(inSubtree)
      .get(),
  ]);
  return {
    previews: previews.map((p) => p.key),
    count: stats?.count ?? 0,
  };
}

export const fileRoutes = new Hono<AppEnv>()

  /** Contents of one folder plus global storage stats. */
  .get(
    "/api/list",
    requireAuth,
    zValidator("query", z.object({ folder: folderSchema.default("") })),
    async (c) => {
      const { folder } = c.req.valid("query");
      const db = createDb(c.env.DB);

      const [rows, allFolders, stats] = await Promise.all([
        db
          .select()
          .from(files)
          .where(eq(files.folder, folder))
          .orderBy(desc(files.createdAt), desc(files.id)),
        // Folder count stays small in a personal library; filtering the
        // direct children in JS avoids LIKE-escape gymnastics in SQL.
        db.select().from(folders).orderBy(folders.path),
        db
          .select({
            // Rows, not objects: two rows sharing one deduplicated object
            // are two files to the user, but only bill for storage once.
            count: sql<number>`count(*)`,
            totalSize: sql<number>`coalesce(sum(${files.size}), 0)`,
          })
          .from(files)
          .get(),
      ]);

      const children = await Promise.all(
        allFolders
          .filter((f) => isDirectChild(f.path, folder))
          .map(async (f) => ({
            path: f.path,
            name: f.path.split("/").pop() ?? f.path,
            ...(await folderMeta(db, f.path)),
          }))
      );

      return c.json({
        folder,
        folders: children,
        files: rows.map((r) => ({
          // `key` addresses the bytes and may repeat; `id` addresses the file.
          id: r.id,
          key: r.key,
          folder: r.folder,
          name: r.name,
          size: r.size,
          mime: r.mime,
          uploaded: r.createdAt,
        })),
        count: stats?.count ?? 0,
        totalSize: stats?.totalSize ?? 0,
      });
    }
  )

  /** Upload: raw bytes as body; name and target folder via query. */
  .put(
    "/api/upload",
    requireAuth,
    zValidator(
      "query",
      z.object({
        name: z.string().min(1),
        folder: folderSchema.default(""),
      })
    ),
    async (c) => {
      const { name: rawName, folder } = c.req.valid("query");
      const db = createDb(c.env.DB);

      const mime = c.req.header("Content-Type") ?? "";
      if (!ACCEPTED_MIME.test(mime)) {
        return c.json({ error: "unsupported media type" }, 415);
      }
      // Reject on the declared length first so an oversized body is never
      // buffered; the real length is checked again once it has been read.
      if (Number(c.req.header("Content-Length")) > MAX_UPLOAD_BYTES) {
        return c.json({ error: "payload too large" }, 413);
      }

      const body = await c.req.arrayBuffer();
      if (body.byteLength === 0) return c.json({ error: "empty body" }, 400);
      if (body.byteLength > MAX_UPLOAD_BYTES) {
        return c.json({ error: "payload too large" }, 413);
      }

      const displayName = sanitizeFileName(rawName);
      const hash = await sha256Hex(body);
      const key = contentKey(hash, displayName);

      // Same bytes already sitting in this folder: nothing to store, nothing
      // to add. Re-dropping a file the user already has is a no-op, not a copy.
      const duplicate = await db
        .select({ id: files.id, name: files.name })
        .from(files)
        .where(and(eq(files.key, key), eq(files.folder, folder)))
        .get();
      if (duplicate) {
        return c.json({
          id: duplicate.id,
          key,
          name: duplicate.name,
          url: `/f/${key}`,
          deduplicated: true,
        });
      }

      await ensureFolders(db, folder);

      // The object may already exist from an upload into another folder.
      // Skipping the PUT saves both the storage and the Class A operation.
      const stored = await db
        .select({ id: files.id })
        .from(files)
        .where(eq(files.key, key))
        .get();
      if (!stored) {
        // R2 first (source of truth), then the D1 index; a failure in between
        // leaves an unindexed object that reconcile picks up later — which is
        // exactly why the name and folder ride along as customMetadata.
        await c.env.BUCKET.put(key, body, {
          httpMetadata: { contentType: mime },
          customMetadata: { name: displayName, folder },
        });
      }

      const { id, name } = await insertFileRow(
        db,
        {
          key,
          folder,
          size: body.byteLength,
          mime,
          hash,
          createdAt: Date.now(),
        },
        displayName
      );

      return c.json({ id, key, name, url: `/f/${key}` });
    }
  )

  /** Move and/or rename. Pure metadata: the object is never touched. */
  .patch(
    "/api/file",
    requireAuth,
    zValidator(
      "json",
      z
        .object({
          id: z.number().int().positive(),
          folder: folderSchema.optional(),
          name: z.string().min(1).optional(),
        })
        .refine(
          (v) => v.folder !== undefined || v.name !== undefined,
          "nothing to change"
        )
    ),
    async (c) => {
      const { id, folder, name } = c.req.valid("json");
      const db = createDb(c.env.DB);

      const row = await db
        .select({ folder: files.folder, name: files.name })
        .from(files)
        .where(eq(files.id, id))
        .get();
      if (!row) return c.json({ error: "not found" }, 404);

      const targetFolder = folder ?? row.folder;
      const desiredName = name ? sanitizeFileName(name) : row.name;
      if (targetFolder === row.folder && desiredName === row.name) {
        return c.json({ id, folder: row.folder, name: row.name });
      }

      await ensureFolders(db, targetFolder);
      // A name already used in the destination gets the usual `-2` suffix
      // rather than failing the move outright.
      const finalName = await resolveUniqueName(db, targetFolder, desiredName);

      await db
        .update(files)
        .set({ folder: targetFolder, name: finalName })
        .where(eq(files.id, id));

      return c.json({ id, folder: targetFolder, name: finalName });
    }
  )

  /** Delete a single file. */
  .delete(
    "/api/file",
    requireAuth,
    zValidator("query", z.object({ id: z.coerce.number().int().positive() })),
    async (c) => {
      const { id } = c.req.valid("query");
      const db = createDb(c.env.DB);

      // Cascades to shares via the foreign key; drops the object only when
      // no other folder still references the same content.
      const deleted = await deleteFileRows(db, c.env.BUCKET, eq(files.id, id));
      if (deleted === 0) return c.json({ error: "not found" }, 404);
      return c.json({ ok: true });
    }
  )

  /** Public direct link. */
  .get("/f/*", (c) => {
    let key: string;
    try {
      key = decodeURIComponent(c.req.path.slice("/f/".length));
    } catch {
      return c.notFound();
    }
    return serveObject(c.env.BUCKET, key, { immutable: true });
  });
