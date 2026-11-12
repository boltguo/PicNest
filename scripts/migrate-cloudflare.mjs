import { spawnSync } from "node:child_process";

// Workers Builds currently runs `pnpm build` followed by `wrangler deploy`.
// Apply pending schema changes after a successful build, before that deploy.
// Local builds and GitHub validation must never touch the remote database.
if (process.env.WORKERS_CI === "1") {
  const result = spawnSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
