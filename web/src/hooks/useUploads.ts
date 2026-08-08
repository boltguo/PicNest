import { toast } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";

export interface UploadTask {
  id: string;
  name: string;
  progress: number;
  status: "queued" | "uploading" | "done" | "error";
}

/**
 * Uploads in flight at once. The Worker buffers each body whole to hash it and
 * an isolate has 128 MB, so dropping forty phone photos in and letting the
 * browser open forty connections put real pressure on the other side. Three at
 * a time also keeps any one file's progress bar moving at a readable pace.
 */
const CONCURRENCY = 3;

/** Why the worker turned an upload down, so the toast can say something useful. */
function rejectionKey(error: unknown): string {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  if (status === 413) return "upload.tooLargeToast";
  if (status === 415) return "upload.wrongTypeToast";
  return "upload.failedToast";
}

/**
 * Upload queue: per-file progress, bounded concurrency, refreshes on success.
 *
 * A failed task stays on screen with the file it was carrying still held, so
 * `retry` can put the same bytes back on the queue — a dropped connection
 * halfway through a folder of photos should not mean finding and re-dragging
 * the ones that did not make it.
 */
export function useUploads() {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const pending = useRef<(() => Promise<void>)[]>([]);
  const running = useRef(0);
  /** The bytes behind each task, kept only so a failure can be retried. */
  const sources = useRef(new Map<string, { file: File; folder: string }>());

  const patch = useCallback((id: string, changes: Partial<UploadTask>) => {
    setTasks((prev) =>
      prev.map((task) => (task.id === id ? { ...task, ...changes } : task))
    );
  }, []);

  const dismiss = useCallback((id: string) => {
    sources.current.delete(id);
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }, []);

  const pump = useCallback(() => {
    const next = () => {
      while (running.current < CONCURRENCY && pending.current.length > 0) {
        const job = pending.current.shift()!;
        running.current += 1;
        void job().finally(() => {
          running.current -= 1;
          next();
        });
      }
    };
    next();
  }, []);

  const enqueue = useCallback(
    (id: string, file: File, folder: string) => {
      sources.current.set(id, { file, folder });
      pending.current.push(() => {
        patch(id, { status: "uploading", progress: 0 });
        return api
          .upload(file, folder, (progress) => patch(id, { progress }))
          .then(() => {
            patch(id, { status: "done", progress: 100 });
            void queryClient.invalidateQueries({ queryKey: ["files"] });
            setTimeout(() => dismiss(id), 1200);
          })
          .catch((error: unknown) => {
            // The card stays until it is retried or dismissed: a toast that
            // has already faded is no way to find out what did not upload.
            patch(id, { status: "error" });
            toast.danger(t(rejectionKey(error), { name: file.name }));
          });
      });
      pump();
    },
    [dismiss, patch, pump, queryClient, t]
  );

  const start = useCallback(
    (files: File[], folder: string) => {
      for (const file of files) {
        const id = crypto.randomUUID();
        setTasks((prev) => [
          ...prev,
          { id, name: file.name, progress: 0, status: "queued" },
        ]);
        enqueue(id, file, folder);
      }
    },
    [enqueue]
  );

  /** Re-queue a failed task into the folder it was originally aimed at. */
  const retry = useCallback(
    (id: string) => {
      const source = sources.current.get(id);
      if (!source) return;
      patch(id, { status: "queued", progress: 0 });
      enqueue(id, source.file, source.folder);
    },
    [enqueue, patch]
  );

  return { tasks, start, retry, dismiss };
}
