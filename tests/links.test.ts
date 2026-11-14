import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLink } from "../web/src/lib/links";
import { decodeCursor, encodeCursor } from "../worker/src/lib/pagination";
test("copy formats escape filenames instead of producing executable HTML", () => {
  assert.equal(
    formatLink("https://image.test/f/a", "x", "url"),
    "https://image.test/f/a",
  );
  assert.equal(
    formatLink("https://image.test/f/a", 'a" <img>', "html"),
    '<img src="https://image.test/f/a" alt="a&quot; &lt;img&gt;" />',
  );
  assert.equal(
    formatLink("https://image.test/f/a", "x]\\[", "markdown"),
    "![x\\]\\\\\\[](<https://image.test/f/a>)",
  );
});
test("cursors round-trip unicode and reject invalid values", () => {
  const cursor = {
    folder: "照片/📷",
    sort: "nameAsc" as const,
    value: "猫.png",
    id: 42,
  };
  assert.deepEqual(
    decodeCursor(encodeCursor(cursor), cursor.folder, cursor.sort),
    cursor,
  );
  assert.equal(decodeCursor("bad", "", "newest"), null);
  assert.equal(decodeCursor(encodeCursor(cursor), "other", cursor.sort), null);
});
