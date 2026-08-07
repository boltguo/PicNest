import { Card, ProgressBar } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { UploadTask } from "../hooks/useUploads";

/** Floating upload queue pinned to the bottom-right; never affects page layout. */
export function UploadProgressList({ tasks }: { tasks: UploadTask[] }) {
  const { t } = useTranslation();
  if (tasks.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 flex w-[min(320px,calc(100vw-2rem))] flex-col gap-2 max-sm:right-3 max-sm:bottom-3"
    >
      {tasks.map((task) => (
        <Card
          key={task.id}
          className="flex-row items-center gap-3 p-3 text-[13px] shadow-lg"
        >
          <span className="max-w-[45%] truncate">{task.name}</span>
          <ProgressBar
            aria-label={task.name}
            value={task.progress}
            size="sm"
            color={task.status === "error" ? "danger" : "default"}
            className="flex-1"
          >
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
          <span className="text-muted w-10 text-right text-xs tabular-nums">
            {task.status === "done"
              ? t("upload.done")
              : task.status === "error"
                ? t("upload.error")
                : `${task.progress}%`}
          </span>
        </Card>
      ))}
    </div>
  );
}
