import { inArray, type SQL } from "drizzle-orm";
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
    errorText(error)
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
  desiredName: string
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

/** Split into batches; D1 and R2 both cap how much one call may carry. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Keep well under D1's bound-parameter limit per statement. */
const D1_BATCH = 50;

/** R2 bulk delete accepts up to 1000 keys per call. */
const R2_DELETE_BATCH = 1000;

/**
 * Delete every row matching `where`, then drop the R2 objects that no
 * surviving row still references.
 *
 * The refcount pass is the part that matters: objects are content-addressed,
 * so the same image filed in two folders is one object with two rows.
 * Deleting the object outright would blank the copy the user kept.
 */
export async function deleteFileRows(
  db: Db,
  bucket: R2Bucket,
  where: SQL | undefined
): Promise<number> {
  const doomed = await db
    .select({ id: files.id, key: files.key })
    .from(files)
    .where(where);
  if (doomed.length === 0) return 0;

  for (const batch of chunk(doomed, D1_BATCH)) {
    await db.delete(files).where(
      inArray(
        files.id,
        batch.map((r) => r.id)
      )
    );
  }

  const keys = [...new Set(doomed.map((r) => r.key))];
  const orphaned: string[] = [];
  for (const batch of chunk(keys, D1_BATCH)) {
    const alive = await db
      .select({ key: files.key })
      .from(files)
      .where(inArray(files.key, batch));
    const stillUsed = new Set(alive.map((r) => r.key));
    orphaned.push(...batch.filter((k) => !stillUsed.has(k)));
  }

  for (const batch of chunk(orphaned, R2_DELETE_BATCH)) {
    await bucket.delete(batch);
  }
  return doomed.length;
}
