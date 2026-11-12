import { toast } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { makeThumbnail } from "../lib/thumbnail";

export interface UploadTask {
  id: string;
  name: string;
  progress: number;
  size: number;
  status:
    | "queued"
    | "uploading"
    | "processing"
    | "done"
    | "error"
    | "cancelled";
}
const CONCURRENCY = 3;
export function useUploads() {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const sources = useRef(new Map<string, { file: File; folder: string }>());
  const controllers = useRef(new Map<string, AbortController>());
  const pending = useRef<string[]>([]);
  const running = useRef(0);
  const mounted = useRef(true);
  const dirty = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patch = useCallback((id: string, changes: Partial<UploadTask>) => {
    if (mounted.current)
      setTasks((prev) =>
        prev.map((task) => (task.id === id ? { ...task, ...changes } : task)),
      );
  }, []);
  const flush = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    void queryClient.invalidateQueries({ queryKey: ["files"] });
    void queryClient.invalidateQueries({ queryKey: ["stats"] });
    void queryClient.invalidateQueries({ queryKey: ["folders"] });
  }, [queryClient]);
  const changed = useCallback(() => {
    dirty.current = true;
    // At most one refresh per two seconds, plus a final refresh when the queue drains.
    if (!refreshTimer.current) refreshTimer.current = setTimeout(flush, 2000);
  }, [flush]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controllers.current.forEach((controller) => controller.abort());
      pending.current = [];
      sources.current.clear();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);
  const pump = useCallback(() => {
    const next = () => {
      while (
        mounted.current &&
        running.current < CONCURRENCY &&
        pending.current.length
      ) {
        const id = pending.current.shift()!;
        const source = sources.current.get(id);
        if (!source) continue;
        const controller = new AbortController();
        controllers.current.set(id, controller);
        running.current++;
        patch(id, { status: "uploading", progress: 0 });
        void (async () => {
          try {
            const result = await api.upload(
              source.file,
              source.folder,
              (progress) => patch(id, { progress }),
              controller.signal,
            );
            changed();
            patch(id, { status: "processing", progress: 100 });
            // Thumbnail failure does not turn a successfully stored original into a failed upload.
            try {
              const thumb = await makeThumbnail(source.file);
              if (!controller.signal.aborted)
                await api.thumbnail(
                  result.id,
                  thumb.blob,
                  thumb.width,
                  thumb.height,
                  controller.signal,
                );
            } catch {
              /* The maintenance dialog can fill missing thumbnails later. */
            }
            changed();
            patch(id, { status: "done", progress: 100 });
            sources.current.delete(id);
          } catch (error) {
            // A lost response or cancellation can happen after the server commits.
            changed();
            const cancelled =
              axios.isCancel(error) || controller.signal.aborted;
            patch(id, { status: cancelled ? "cancelled" : "error" });
            if (!cancelled) {
              const status = axios.isAxiosError(error)
                ? error.response?.status
                : undefined;
              toast.danger(
                t(
                  status === 413
                    ? "upload.tooLargeToast"
                    : status === 415
                      ? "upload.wrongTypeToast"
                      : "upload.failedToast",
                  { name: source.file.name },
                ),
              );
            } else sources.current.delete(id);
          } finally {
            controllers.current.delete(id);
            running.current--;
            next();
            if (!running.current && !pending.current.length) flush();
          }
        })();
      }
    };
    next();
  }, [changed, flush, patch, t]);
  const start = useCallback(
    (files: File[], folder: string) => {
      const added = files.map((file) => {
        const id = crypto.randomUUID();
        sources.current.set(id, { file, folder });
        pending.current.push(id);
        return {
          id,
          name: file.name,
          size: file.size,
          progress: 0,
          status: "queued" as const,
        };
      });
      setTasks((prev) => [...prev, ...added]);
      pump();
    },
    [pump],
  );
  const retry = useCallback(
    (id: string) => {
      if (
        !sources.current.has(id) ||
        controllers.current.has(id) ||
        pending.current.includes(id)
      )
        return;
      pending.current.push(id);
      patch(id, { status: "queued", progress: 0 });
      pump();
    },
    [patch, pump],
  );
  const cancel = useCallback(
    (id: string) => {
      pending.current = pending.current.filter((key) => key !== id);
      controllers.current.get(id)?.abort();
      sources.current.delete(id);
      patch(id, { status: "cancelled" });
    },
    [patch],
  );
  const dismiss = useCallback((id: string) => {
    sources.current.delete(id);
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }, []);
  return { tasks, start, retry, cancel, dismiss };
}
