import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sign } from "hono/jwt";
import type { Bindings } from "../worker/src/types";
let bundle: Promise<string> | undefined;
function compiled() {
  return (bundle ??= (async () => {
    const path = join(
      await mkdtemp(join(tmpdir(), "picnest-test-")),
      "worker.mjs",
    );
    await build({
      entryPoints: ["worker/src/index.ts"],
      bundle: true,
      outfile: path,
      format: "esm",
      platform: "neutral",
      conditions: ["workerd", "worker", "browser"],
      mainFields: ["browser", "module", "main"],
      target: "es2022",
      external: ["cloudflare:workers"],
    });
    return path;
  })());
}
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7xoAAAAASUVORK5CYII=",
  "base64",
);
export const keyFor = (i: number) => i.toString(16).padStart(64, "0") + ".png";
export async function fixture(
  seedLegacy?: (db: D1Database) => Promise<void>,
  persistent = false,
) {
  const secret = "picnest-test-only-signing-key-not-for-production";
  const scriptPath = await compiled();
  const persist = persistent
    ? await mkdtemp(join(tmpdir(), "picnest-state-"))
    : undefined;
  const options = {
    modules: true,
    scriptPath,
    modulesRoot: dirname(scriptPath),
    compatibilityDate: "2026-07-30",
    d1Databases: ["DB"],
    r2Buckets: ["BUCKET"],
    durableObjects: {
      LIBRARY: { className: "LibraryCoordinator", useSQLite: true },
    },
    bindings: { ADMIN_PASSWORD: "test-password", JWT_SECRET: secret },
    ratelimits: {
      LOGIN_LIMITER: {
        namespace_id: "1001",
        simple: { limit: 1000, period: 60 },
      },
      SHARE_LIMITER: {
        namespace_id: "1002",
        simple: { limit: 1000, period: 60 },
      },
    },
    ...(persist
      ? {
          d1Persist: join(persist, "d1"),
          r2Persist: join(persist, "r2"),
          durableObjectsPersist: join(persist, "do"),
        }
      : {}),
  };
  let mf = new Miniflare(options);
  try {
    const db = await mf.getD1Database("DB");
    for (const file of (await readdir("migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(`migrations/${file}`, "utf8");
      for (const statement of sql
        .split(";")
        .map((s) => s.replace(/--> statement-breakpoint/g, "").trim())
        .filter(Boolean))
        await db.prepare(statement).run();
      if (file.startsWith("0000") && seedLegacy)
        await seedLegacy(db as unknown as D1Database);
    }
    const token = await sign(
      {
        sub: "admin",
        iss: "picnest",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      secret,
      "HS256",
    );
    const env = {
      DB: db,
      BUCKET: await mf.getR2Bucket("BUCKET"),
    } as unknown as Bindings;
    const request = (path: string, options: RequestInit = {}) =>
      mf.dispatchFetch(`https://picnest.test${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...options.headers },
      });
    const json = async (path: string, options: RequestInit = {}) => {
      const response = await request(path, options);
      const data = (await response.json()) as any;
      if (!response.ok)
        throw new Error(`${response.status}: ${JSON.stringify(data)}`);
      return data;
    };
    const post = (path: string, data: unknown) =>
      json(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    const upload = (folder = "", name = "image.png", body = PNG) =>
      json(
        `/api/upload?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(name)}`,
        { method: "PUT", body },
      );
    return {
      get mf() {
        return mf;
      },
      env,
      get db() {
        return env.DB;
      },
      request,
      json,
      post,
      upload,
      restart: async () => {
        if (!persist) throw new Error("restart needs a persistent fixture");
        await mf.dispose();
        mf = new Miniflare(options);
        env.DB = (await mf.getD1Database("DB")) as unknown as D1Database;
        env.BUCKET = (await mf.getR2Bucket("BUCKET")) as unknown as R2Bucket;
      },
      dispose: async () => {
        await mf.dispose();
        if (persist) await rm(persist, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await mf.dispose();
    if (persist) await rm(persist, { recursive: true, force: true });
    throw error;
  }
}
export async function eventually(check: () => Promise<boolean>) {
  const end = Date.now() + 10000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("condition did not settle");
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
