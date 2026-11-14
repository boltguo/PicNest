import { and, eq, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { CONTENT_KEY_RE } from "../config";
import { createDb, files, folders, jobs, findings, tombstones } from "../db";
import type { Bindings } from "../types";
import {
  descendantOf,
  ensureFolders,
  folderSchema,
  sanitizeFileName,
} from "./paths";
import { insertFileRow } from "./files";
import { formatForKey, withImageExtension } from "./image";

export const DELETE_BATCH = 25;
export const SCAN_BATCH = 10;
export const thumbnailKey = (key: string) => `_thumb/${key}.webp`;
export const subtree = (path: string) =>
  or(eq(files.folder, path), descendantOf(files.folder, path))!;

export async function assertFolderWritable(env: Bindings, folder: string) {
  const active = await createDb(env.DB)
    .select({ path: jobs.path })
    .from(jobs)
    .where(and(eq(jobs.kind, "delete-folder"), sql`${jobs.status} <> 'done'`));
  if (
    active.some((j) => folder === j.path || folder.startsWith(`${j.path}/`))
  ) {
    throw new HTTPException(409, { message: "folder deletion in progress" });
  }
}

/** Atomically remove metadata and record intentions for retryable R2 cleanup. */
export async function deleteRows(
  env: Bindings,
  rows: { id: number; key: string }[],
  progress?: D1PreparedStatement,
) {
  if (!rows.length) return;
  if (rows.length > DELETE_BATCH) throw new Error("delete batch too large");
  const keys = [...new Set(rows.map((r) => r.key))];
  const statements = [
    env.DB.prepare(
      `DELETE FROM files WHERE id IN (${rows.map(() => "?").join(",")})`,
    ).bind(...rows.map((r) => r.id)),
  ];
  for (const key of keys)
    statements.push(
      env.DB.prepare(
        `INSERT INTO object_tombstones (key, pending, created_at)
    SELECT ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM files WHERE key = ?)
    ON CONFLICT(key) DO UPDATE SET pending = 1, created_at = excluded.created_at`,
      ).bind(key, Date.now(), key),
    );
  if (progress) statements.push(progress);
  await env.DB.batch(statements);
}

/** Runs in the same writer as uploads; tombstones survive restarts and R2 errors. */
export async function cleanObjects(env: Bindings): Promise<boolean> {
  const db = createDb(env.DB);
  const pending = await db
    .select()
    .from(tombstones)
    .where(eq(tombstones.pending, 1))
    .limit(SCAN_BATCH);
  if (!pending.length) return false;
  for (const row of pending) {
    const alive = await db
      .select({ id: files.id })
      .from(files)
      .where(eq(files.key, row.key))
      .get();
    if (alive) {
      await db.delete(tombstones).where(eq(tombstones.key, row.key));
      continue;
    }
    await env.BUCKET.delete([row.key, thumbnailKey(row.key)]);
    await db
      .update(tombstones)
      .set({ pending: 0 })
      .where(eq(tombstones.key, row.key));
  }
  return true;
}

export async function stepJob(env: Bindings): Promise<boolean> {
  const db = createDb(env.DB);
  const job = await db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "running"))
    .orderBy(jobs.createdAt)
    .get();
  if (!job) return false;
  try {
    if (job.kind === "delete-folder") {
      const rows = await db
        .select({ id: files.id, key: files.key })
        .from(files)
        .where(subtree(job.path))
        .orderBy(files.id)
        .limit(DELETE_BATCH);
      if (rows.length) {
        await deleteRows(
          env,
          rows,
          env.DB.prepare(
            "UPDATE jobs SET processed = processed + ?, updated_at = ? WHERE id = ?",
          ).bind(rows.length, Date.now(), job.id),
        );
      } else {
        await db.batch([
          db
            .delete(folders)
            .where(
              or(
                eq(folders.path, job.path),
                descendantOf(folders.path, job.path),
              ),
            ),
          db
            .update(jobs)
            .set({ status: "done", updatedAt: Date.now() })
            .where(eq(jobs.id, job.id)),
        ]);
      }
    } else if (job.phase === "files") {
      const rows = await db
        .select()
        .from(files)
        .where(sql`${files.id} > ${Number(job.cursor)}`)
        .orderBy(files.id)
        .limit(SCAN_BATCH);
      for (const row of rows) {
        const exists = await env.BUCKET.head(row.key);
        await db
          .update(files)
          .set({ missing: exists ? 0 : 1 })
          .where(eq(files.id, row.id));
        if (!exists)
          await db
            .insert(findings)
            .values({
              jobId: job.id,
              key: row.key,
              kind: "missing",
              name: row.name,
              folder: row.folder,
            })
            .onConflictDoNothing();
      }
      await db
        .update(jobs)
        .set({
          cursor: rows.length ? String(rows[rows.length - 1].id) : "",
          phase: rows.length ? "files" : "objects",
          processed: job.processed + rows.length,
          updatedAt: Date.now(),
        })
        .where(eq(jobs.id, job.id));
    } else {
      const page = await env.BUCKET.list({
        cursor: job.cursor || undefined,
        limit: SCAN_BATCH,
        include: ["customMetadata"],
      });
      for (const object of page.objects) {
        if (!CONTENT_KEY_RE.test(object.key)) continue;
        const indexed = await db
          .select({ id: files.id })
          .from(files)
          .where(eq(files.key, object.key))
          .get();
        const deleted = await db
          .select({ key: tombstones.key })
          .from(tombstones)
          .where(eq(tombstones.key, object.key))
          .get();
        if (indexed || deleted) continue;
        await db
          .insert(findings)
          .values({
            jobId: job.id,
            key: object.key,
            kind: "unindexed",
            name: sanitizeFileName(object.customMetadata?.name ?? object.key),
            folder: folderSchema.safeParse(object.customMetadata?.folder ?? "")
              .success
              ? (object.customMetadata?.folder ?? "")
              : "",
          })
          .onConflictDoNothing();
      }
      await db
        .update(jobs)
        .set({
          cursor: page.truncated ? page.cursor : "",
          status: page.truncated ? "running" : "done",
          processed: job.processed + page.objects.length,
          updatedAt: Date.now(),
        })
        .where(eq(jobs.id, job.id));
    }
  } catch (error) {
    console.error("Maintenance job failed", job.id, error);
    await db
      .update(jobs)
      .set({
        status: "error",
        error: "Operation failed. Retry to continue from the saved position.",
        updatedAt: Date.now(),
      })
      .where(eq(jobs.id, job.id));
  }
  return true;
}

export async function importFinding(env: Bindings, id: number) {
  const db = createDb(env.DB);
  const finding = await db
    .select()
    .from(findings)
    .where(eq(findings.id, id))
    .get();
  if (!finding || finding.kind !== "unindexed" || finding.resolved) return;
  await assertFolderWritable(env, finding.folder);
  const deleted = await db
    .select()
    .from(tombstones)
    .where(eq(tombstones.key, finding.key))
    .get();
  if (deleted)
    throw new HTTPException(409, {
      message: "object was intentionally deleted",
    });
  const existing = await db
    .select()
    .from(files)
    .where(eq(files.key, finding.key))
    .get();
  if (!existing) {
    const object = await env.BUCKET.head(finding.key);
    const format = formatForKey(finding.key);
    if (!object || !format)
      throw new HTTPException(409, { message: "object no longer exists" });
    await ensureFolders(db, finding.folder);
    await insertFileRow(
      db,
      {
        key: finding.key,
        folder: finding.folder,
        size: object.size,
        mime: format.mime,
        hash: finding.key.split(".")[0],
        createdAt: object.uploaded.getTime(),
      },
      withImageExtension(finding.name, format),
    );
  }
  await db.update(findings).set({ resolved: 1 }).where(eq(findings.id, id));
}
