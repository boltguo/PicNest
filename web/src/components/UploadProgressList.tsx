import { Button, Card, ProgressBar } from "@heroui/react";
import { RotateCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UploadTask } from "../hooks/useUploads";

interface UploadProgressListProps {
  tasks: UploadTask[];
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}

/** Floating upload queue pinned to the bottom-right; never affects page layout. */
export function UploadProgressList({
  tasks,
  onRetry,
  onDismiss,
}: UploadProgressListProps) {
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
          {/* A failed row trades its progress bar — which has nothing left to
              report — for the two things that can still be done about it. */}
          {task.status === "error" ? (
            <>
              <span className="min-w-0 flex-1 truncate" title={task.name}>
                {task.name}
              </span>
              <span className="text-danger shrink-0 text-xs">
                {t("upload.error")}
              </span>
              <span className="flex shrink-0 gap-0.5">
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label={t("upload.retry")}
                  onPress={() => onRetry(task.id)}
                >
                  <RotateCw className="size-3.5" />
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label={t("upload.dismiss")}
                  onPress={() => onDismiss(task.id)}
                >
                  <X className="size-3.5" />
                </Button>
              </span>
            </>
          ) : (
            <>
              <span className="max-w-[45%] truncate">{task.name}</span>
              <ProgressBar
                aria-label={task.name}
                value={task.progress}
                size="sm"
                className="flex-1"
              >
                <ProgressBar.Track>
                  <ProgressBar.Fill />
                </ProgressBar.Track>
              </ProgressBar>
              <span className="text-muted w-10 shrink-0 text-right text-xs tabular-nums">
                {task.status === "done"
                  ? t("upload.done")
                  : task.status === "queued"
                    ? t("upload.queued")
                    : `${task.progress}%`}
              </span>
            </>
          )}
        </Card>
      ))}
    </div>
  );
}
