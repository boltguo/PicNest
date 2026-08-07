import { toast } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";

export interface UploadTask {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "done" | "error";
}

/** Why the worker turned an upload down, so the toast can say something useful. */
function rejectionKey(error: unknown): string {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  if (status === 413) return "upload.tooLargeToast";
  if (status === 415) return "upload.wrongTypeToast";
  return "upload.failedToast";
}

/** Concurrent upload queue: per-file progress, refreshes the list on success. */
export function useUploads() {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const patch = (id: string, changes: Partial<UploadTask>) =>
    setTasks((prev) =>
      prev.map((task) => (task.id === id ? { ...task, ...changes } : task))
    );

  const start = useCallback(
    (files: File[], folder: string) => {
      for (const file of files) {
        const id = crypto.randomUUID();
        setTasks((prev) => [
          ...prev,
          { id, name: file.name, progress: 0, status: "uploading" },
        ]);

        api
          .upload(file, folder, (progress) => patch(id, { progress }))
          .then(() => {
            patch(id, { status: "done", progress: 100 });
            void queryClient.invalidateQueries({ queryKey: ["files"] });
            setTimeout(
              () => setTasks((prev) => prev.filter((task) => task.id !== id)),
              1200
            );
          })
          .catch((error: unknown) => {
            patch(id, { status: "error" });
            toast.danger(t(rejectionKey(error), { name: file.name }));
          });
      }
    },
    [queryClient, t]
  );

  return { tasks, start };
}
