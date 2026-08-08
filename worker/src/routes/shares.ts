import { zValidator } from "@hono/zod-validator";
import { desc, eq, lt, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { getCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  MAX_SHARE_HOURS,
  MAX_SHARE_PASSWORD_LENGTH,
  SHARE_TOKEN_LENGTH,
  SHARE_UNLOCK_TTL_SECONDS,
} from "../config";
import { createDb, files, shares } from "../db";
import { requireAuth } from "../lib/auth";
import { LOCALE_COOKIE, pickLocale } from "../lib/locale";
import { hashPassword, verifyPassword } from "../lib/password";
import { serveObject } from "../lib/r2";
import { errorPage, passwordPage, type ErrorKind } from "../templates/pages";
import type { AppEnv } from "../types";

type ShareContext = Context<AppEnv>;

/**
 * Proof that this browser entered the right password, scoped by `Path` to the
 * one share it unlocked. Signed with `JWT_SECRET`, so it cannot be minted or
 * edited client-side, and short-lived by design.
 */
const UNLOCK_COOKIE = "picnest-share";

/**
 * Static assets get their headers from `web/public/_headers`, which does not
 * apply to anything the Worker renders itself — these pages need their own.
 * `default-src 'none'` with no script source at all is possible now that the
 * password form is plain HTML.
 */
const PAGE_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; " +
    "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

const localeFor = (c: ShareContext) =>
  pickLocale(getCookie(c, LOCALE_COOKIE), c.req.header("Accept-Language"));

const failure = async (
  c: ShareContext,
  kind: ErrorKind,
  status: 404 | 410 | 429
) => c.html(errorPage(localeFor(c), kind), status, PAGE_HEADERS);

/** Load a share and its file, or the page explaining why it cannot be opened. */
async function loadShare(c: ShareContext, token: string) {
  const db = createDb(c.env.DB);
  const row = await db
    .select({
      id: shares.id,
      passwordHash: shares.passwordHash,
      expiresAt: shares.expiresAt,
      key: files.key,
      name: files.name,
    })
    .from(shares)
    .innerJoin(files, eq(shares.fileId, files.id))
    .where(eq(shares.token, token))
    .get();

  if (!row) {
    return { ok: false as const, response: await failure(c, "notFound", 404) };
  }
  if (row.expiresAt !== null && Date.now() > row.expiresAt) {
    await db.delete(shares).where(eq(shares.id, row.id));
    return { ok: false as const, response: await failure(c, "expired", 410) };
  }
  return { ok: true as const, row, db };
}

async function isUnlocked(c: ShareContext, token: string): Promise<boolean> {
  const value = await getSignedCookie(c, c.env.JWT_SECRET, UNLOCK_COOKIE);
  if (!value) return false;
  const [cookieToken, expires] = value.split(".");
  return cookieToken === token && Number(expires) > Date.now();
}

async function grantUnlock(c: ShareContext, token: string): Promise<void> {
  const expires = Date.now() + SHARE_UNLOCK_TTL_SECONDS * 1000;
  await setSignedCookie(
    c,
    UNLOCK_COOKIE,
    `${token}.${expires}`,
    c.env.JWT_SECRET,
    {
      path: `/s/${token}`,
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      maxAge: SHARE_UNLOCK_TTL_SECONDS,
    }
  );
}

export const shareRoutes = new Hono<AppEnv>()

  /** Create a share link with optional expiry (hours) and password. */
  .post(
    "/api/share",
    requireAuth,
    zValidator(
      "json",
      z.object({
        id: z.number().int().positive(),
        hours: z.number().positive().max(MAX_SHARE_HOURS).nullish(),
        password: z
          .string()
          .min(1)
          .max(MAX_SHARE_PASSWORD_LENGTH)
          .nullish(),
      })
    ),
    async (c) => {
      const { id, hours, password } = c.req.valid("json");
      const db = createDb(c.env.DB);

      const file = await db
        .select({ id: files.id })
        .from(files)
        .where(eq(files.id, id))
        .get();
      if (!file) return c.json({ error: "file not found" }, 404);

      const token = nanoid(SHARE_TOKEN_LENGTH);
      const expiresAt = hours ? Date.now() + hours * 3600_000 : null;
      await db.insert(shares).values({
        token,
        fileId: file.id,
        expiresAt,
        passwordHash: password ? await hashPassword(password) : null,
        createdAt: Date.now(),
      });
      return c.json({ url: `/s/${token}`, exp: expiresAt });
    }
  )

  /** List all shares with their target files (management UI). */
  .get("/api/shares", requireAuth, async (c) => {
    const db = createDb(c.env.DB);
    // An expired link is already dead; it was just waiting for someone to
    // open it before the row went away. Clear them here so the management
    // table only ever lists links that still work.
    await db.delete(shares).where(lt(shares.expiresAt, Date.now()));

    const rows = await db
      .select({
        token: shares.token,
        name: files.name,
        expiresAt: shares.expiresAt,
        hasPassword: sql<number>`${shares.passwordHash} IS NOT NULL`,
        visits: shares.visits,
        createdAt: shares.createdAt,
      })
      .from(shares)
      .innerJoin(files, eq(shares.fileId, files.id))
      .orderBy(desc(shares.createdAt));
    return c.json({
      shares: rows.map((r) => ({ ...r, hasPassword: Boolean(r.hasPassword) })),
    });
  })

  /** Revoke a share link. */
  .delete(
    "/api/share",
    requireAuth,
    zValidator("query", z.object({ token: z.string().min(1) })),
    async (c) => {
      const db = createDb(c.env.DB);
      await db.delete(shares).where(eq(shares.token, c.req.valid("query").token));
      return c.json({ ok: true });
    }
  )

  /** Visit a share: expiry, then the unlock cookie for password-protected ones. */
  .get("/s/:token", async (c) => {
    const token = c.req.param("token");
    const loaded = await loadShare(c, token);
    if (!loaded.ok) return loaded.response;
    const { row, db } = loaded;

    if (row.passwordHash !== null && !(await isUnlocked(c, token))) {
      const wrong = c.req.query("e") === "1";
      return c.html(
        passwordPage(localeFor(c), token, wrong),
        wrong ? 403 : 401,
        PAGE_HEADERS
      );
    }

    c.executionCtx.waitUntil(
      db
        .update(shares)
        .set({ visits: sql`${shares.visits} + 1` })
        .where(eq(shares.id, row.id))
    );
    // The row is already loaded here, so prefer D1's name over the object's
    // customMetadata copy — a rename since upload is reflected immediately.
    return serveObject(c.env.BUCKET, row.key, { fileName: row.name });
  })

  /**
   * Unlock: the password arrives in a POST body, is checked against a salted
   * PBKDF2 hash, and buys a short-lived signed cookie. Nothing derived from
   * the password is ever put in the URL, so browser history, Worker request
   * logs and Referer headers stay free of anything that grants access.
   */
  .post("/s/:token", async (c) => {
    const token = c.req.param("token");

    // Before touching the database or the KDF: a share password is short and
    // typed by a human, so unthrottled guessing is the realistic attack.
    const { success } = await c.env.SHARE_LIMITER.limit({
      key: `${c.req.header("CF-Connecting-IP") ?? "local"}:${token}`,
    });
    if (!success) return failure(c, "throttled", 429);

    const loaded = await loadShare(c, token);
    if (!loaded.ok) return loaded.response;
    const { row } = loaded;
    if (row.passwordHash === null) return c.redirect(`/s/${token}`, 303);

    const body = await c.req.parseBody();
    const password = typeof body.password === "string" ? body.password : "";
    const ok =
      password.length > 0 &&
      password.length <= MAX_SHARE_PASSWORD_LENGTH &&
      (await verifyPassword(password, row.passwordHash));
    if (!ok) return c.redirect(`/s/${token}?e=1`, 303);

    await grantUnlock(c, token);
    return c.redirect(`/s/${token}`, 303);
  });
