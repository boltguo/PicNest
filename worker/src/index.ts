import { Hono } from "hono";
import app from "./app";
import { requireAuth } from "./lib/auth";
import type { AppEnv } from "./types";
export { LibraryCoordinator } from "./coordinator";

const gateway = new Hono<AppEnv>();
gateway.all("*", async (c) => {
  if (
    c.req.path.startsWith("/api/") &&
    c.req.path !== "/api/login" &&
    !["GET", "HEAD", "OPTIONS"].includes(c.req.method)
  ) {
    await requireAuth(c, async () => {
      c.res = await c.env.LIBRARY.get(
        c.env.LIBRARY.idFromName("library"),
      ).fetch(c.req.raw);
    });
    return c.res;
  }
  return app.fetch(c.req.raw, c.env, c.executionCtx);
});
export default gateway;
