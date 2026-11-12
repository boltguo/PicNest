import { files, type Db } from "../db";
import { resolveUniqueName } from "./paths";

/** Retries for the insert race below; a real conflict resolves on try two. */
const NAME_RACE_RETRIES = 5;

/**
 * D1 reports a constraint violation only in the error text, and drizzle wraps
 * the original, so both levels are searched.
 */
function errorText(error: unknown): string {
  if (!(error instanceof Error)) return "";
  const cause = error.cause instanceof Error ? error.cause.message : "";
  return `${error.message} ${cause}`;
}

/** Two files given the same display name in one folder. Retryable. */
export const isNameTaken = (error: unknown) =>
  /UNIQUE constraint failed: files\.folder, files\.name/i.test(
    errorText(error),
  );

/** The same image already filed in this folder. Not retryable — it is a dedup. */
export const isKeyTaken = (error: unknown) =>
  /UNIQUE constraint failed: files\.folder, files\.key/i.test(errorText(error));

/**
 * Insert a file row, re-resolving the display name if a concurrent upload
 * claimed it first. The dropzone uploads in parallel, so two files named
 * `IMG_001.jpg` genuinely do race here; the unique index is the arbiter and
 * this loop is what turns a lost race into `IMG_001-2.jpg` instead of a 500.
 *
 * Only that one conflict is retried. A dropped database or a schema mistake
 * used to be swallowed by five identical retries and then surface as the same
 * error anyway, five round trips later.
 */
export async function insertFileRow(
  db: Db,
  row: Omit<typeof files.$inferInsert, "name">,
  desiredName: string,
): Promise<{ id: number; name: string }> {
  for (let attempt = 0; ; attempt++) {
    const name = await resolveUniqueName(db, row.folder ?? "", desiredName);
    try {
      const inserted = await db
        .insert(files)
        .values({ ...row, name })
        .returning({ id: files.id })
        .get();
      return { id: inserted.id, name };
    } catch (error) {
      if (attempt >= NAME_RACE_RETRIES || !isNameTaken(error)) throw error;
    }
  }
}
