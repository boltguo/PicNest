import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { createDb, files, findings, jobs, tombstones } from "../db";
import { requireAuth } from "../lib/auth";
import { importFinding } from "../lib/maintenance";
import type { AppEnv } from "../types";

export const systemRoutes = new Hono<AppEnv>()
  .get("/api/stats", requireAuth, async (c) => {
    const stats = await c.env.DB.prepare(
      `SELECT
      (SELECT count(*) FROM files) AS count,
      (SELECT coalesce(sum(size), 0) FROM (SELECT min(size) AS size FROM files GROUP BY key)) AS totalSize`,
    ).first();
    return c.json(stats);
  })
  .get("/api/jobs", requireAuth, async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db
      .select()
      .from(jobs)
      .orderBy(
        sql`CASE WHEN ${jobs.status} = 'done' THEN 1 ELSE 0 END`,
        desc(jobs.createdAt),
      )
      .limit(30);
    const cleanup = await db
      .select({ count: sql<number>`count(*)` })
      .from(tombstones)
      .where(eq(tombstones.pending, 1))
      .get();
    return c.json({ jobs: rows, cleanupPending: cleanup?.count ?? 0 });
  })
  .post("/api/jobs/:id/retry", requireAuth, async (c) => {
    const result = await createDb(c.env.DB)
      .update(jobs)
      .set({ status: "running", error: null, updatedAt: Date.now() })
      .where(and(eq(jobs.id, c.req.param("id")), eq(jobs.status, "error")))
      .returning()
      .get();
    return result
      ? c.json(result)
      : c.json({ error: "job not found or not failed" }, 404);
  })
  .post("/api/repair", requireAuth, async (c) => {
    const db = createDb(c.env.DB);
    const active = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.kind, "repair"), sql`${jobs.status} <> 'done'`))
      .get();
    if (active) return c.json(active, 202);
    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(files)
      .get();
    const job = {
      id: crypto.randomUUID(),
      kind: "repair" as const,
      total: total?.count ?? 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const row = await db.insert(jobs).values(job).returning().get();
    return c.json(row, 202);
  })
  .get(
    "/api/repair/:id",
    requireAuth,
    zValidator(
      "query",
      z.object({ after: z.coerce.number().int().nonnegative().default(0) }),
    ),
    async (c) => {
      const rows = await createDb(c.env.DB)
        .select()
        .from(findings)
        .where(
          and(
            eq(findings.jobId, c.req.param("id")),
            gt(findings.id, c.req.valid("query").after),
          ),
        )
        .orderBy(findings.id)
        .limit(51);
      return c.json({
        findings: rows.slice(0, 50),
        next: rows.length > 50 ? rows[49].id : null,
      });
    },
  )
  .post(
    "/api/repair/import",
    requireAuth,
    zValidator("json", z.object({ id: z.number().int().positive() })),
    async (c) => {
      await importFinding(c.env, c.req.valid("json").id);
      return c.json({ ok: true });
    },
  );
