import { defineConfig } from "drizzle-kit";

/** Generates SQL migrations into ./migrations, applied via `wrangler d1 migrations apply`. */
export default defineConfig({
  dialect: "sqlite",
  schema: "./worker/src/db/schema.ts",
  out: "./migrations",
});
