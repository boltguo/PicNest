import { toast } from "@heroui/react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "../lib/api";

/**
 * Upload whatever image is on the clipboard, Cmd/Ctrl+V anywhere on the page.
 *
 * This is the shortest path from a screenshot to a link, and it costs nothing
 * on the server: the pasted blob is a `File` like any other and goes through
 * the same queue the dropzone feeds.
 */

/** Focus is in something the user is typing into — leave their paste alone. */
function isEditing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

/** `2026-08-08-11-48-33` in the user's own timezone, not UTC. */
function stamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("-");
}

/**
 * Browsers hand every pasted screenshot over as `image.png`, so a day of
 * pasting would be `image.png`, `image-2.png`, `image-3.png`. A timestamp
 * makes the grid readable. A name the user actually chose is kept.
 */
function nameFor(file: File): string {
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file.name;
  const extension = ACCEPTED_IMAGE_TYPES[file.type]?.[0] ?? ".png";
  return `pasted-${stamp()}${extension}`;
}

export function usePasteUpload(onFiles: (files: File[]) => void) {
  const { t } = useTranslation();

  // The caller passes an inline closure over the current folder, so keep the
  // listener registered once and read the latest one through a ref. Updated in
  // a layout effect rather than a passive one: the closure names the folder a
  // paste uploads into, and it should be current the moment the new folder is
  // on screen, not one scheduling hop later.
  const latest = useRef(onFiles);
  useLayoutEffect(() => {
    latest.current = onFiles;
  });

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isEditing(event.target)) return;
      // A dialog is open: the paste belongs to whatever it is showing, and
      // uploading into the folder behind it would come out of nowhere.
      if (document.querySelector('[role="dialog"]')) return;

      const images = [...(event.clipboardData?.files ?? [])].filter((f) =>
        f.type.startsWith("image/")
      );
      if (images.length === 0) return;
      event.preventDefault();

      const accepted: File[] = [];
      for (const file of images) {
        if (!(file.type in ACCEPTED_IMAGE_TYPES)) {
          // Pasted blobs have no name worth showing, so the type is what
          // tells the user why nothing happened.
          toast.danger(t("upload.unsupportedToast", { type: file.type }));
        } else if (file.size > MAX_UPLOAD_BYTES) {
          toast.danger(t("upload.tooLargeToast", { name: nameFor(file) }));
        } else {
          accepted.push(new File([file], nameFor(file), { type: file.type }));
        }
      }
      if (accepted.length > 0) latest.current(accepted);
    };

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [t]);
}
