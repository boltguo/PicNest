export const SORT_KEYS = [
  "newest",
  "oldest",
  "nameAsc",
  "nameDesc",
  "largest",
  "smallest",
] as const;
type Sort = (typeof SORT_KEYS)[number];
interface Cursor {
  folder: string;
  sort: Sort;
  value: number | string;
  id: number;
}
export function encodeCursor(value: Cursor): string {
  return btoa(
    String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))),
  );
}
export function decodeCursor(
  encoded: string,
  folder: string,
  sort: Sort,
): Cursor | null {
  try {
    const value = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
      ),
    ) as Cursor;
    if (
      value.folder !== folder ||
      value.sort !== sort ||
      !Number.isSafeInteger(value.id) ||
      value.id <= 0
    )
      return null;
    if (
      sort.startsWith("name")
        ? typeof value.value !== "string"
        : typeof value.value !== "number" || !Number.isFinite(value.value)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
