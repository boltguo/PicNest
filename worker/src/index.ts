import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authRoutes } from "./routes/auth";
import { fileRoutes } from "./routes/files";
import { folderRoutes } from "./routes/folders";
import { shareRoutes } from "./routes/shares";
import { systemRoutes } from "./routes/system";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>()
  .route("/", authRoutes)
  .route("/", fileRoutes)
  .route("/", folderRoutes)
  .route("/", shareRoutes)
  .route("/", systemRoutes);

/** Unmatched API paths return JSON 404; everything else falls back to the SPA. */
app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "not found" }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  // Middleware (e.g. jwt) signals 401/403 via HTTPException — keep the status.
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export default app;
