import { Button, ProgressBar } from "@heroui/react";
import { ChevronDown, ChevronUp, RotateCw, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { UploadTask } from "../hooks/useUploads";
export function UploadProgressList({
  tasks,
  onRetry,
  onDismiss,
  onCancel,
}: {
  tasks: UploadTask[];
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  if (!tasks.length) return null;
  const active = tasks.filter((task) =>
    ["queued", "uploading", "processing"].includes(task.status),
  );
  const failed = tasks.filter((task) => task.status === "error");
  const total = tasks.reduce((sum, task) => sum + task.size, 0);
  const completed = tasks.reduce(
    (sum, task) => sum + (task.size * task.progress) / 100,
    0,
  );
  return (
    <section
      aria-label={t("upload.queue")}
      className="fixed right-4 bottom-4 z-50 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-default bg-surface p-3 shadow-lg"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium" role="status">
          {t("upload.summary", {
            done: tasks.filter((task) => task.status === "done").length,
            total: tasks.length,
          })}
        </span>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={collapsed ? t("upload.expand") : t("upload.collapse")}
          aria-expanded={!collapsed}
          onPress={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </Button>
      </div>
      <ProgressBar
        aria-label={t("upload.totalProgress")}
        value={total ? (completed / total) * 100 : 0}
        size="sm"
      >
        <ProgressBar.Track>
          <ProgressBar.Fill />
        </ProgressBar.Track>
      </ProgressBar>
      {!collapsed && (
        <>
          <div className="mt-3 max-h-[40svh] space-y-2 overflow-y-auto overscroll-contain">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate" title={task.name}>
                  {task.name}
                </span>
                <span className="text-muted shrink-0">
                  {task.status === "uploading"
                    ? `${task.progress}%`
                    : t(`upload.${task.status}`)}
                </span>
                {task.status === "error" && (
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    aria-label={t("upload.retry")}
                    onPress={() => onRetry(task.id)}
                  >
                    <RotateCw className="size-3.5" />
                  </Button>
                )}
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label={
                    active.includes(task)
                      ? t("common.cancel")
                      : t("upload.dismiss")
                  }
                  onPress={() =>
                    active.includes(task)
                      ? onCancel(task.id)
                      : onDismiss(task.id)
                  }
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
          {active.length > 0 && (
            <p className="mt-2 text-muted text-xs">{t("upload.cancelHint")}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {failed.length > 0 && (
              <Button
                size="sm"
                variant="tertiary"
                onPress={() => failed.forEach((task) => onRetry(task.id))}
              >
                {t("upload.retryAll")}
              </Button>
            )}
            {active.length > 0 && (
              <Button
                size="sm"
                variant="tertiary"
                onPress={() => active.forEach((task) => onCancel(task.id))}
              >
                {t("upload.cancelAll")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onPress={() =>
                tasks
                  .filter((task) => ["done", "cancelled"].includes(task.status))
                  .forEach((task) => onDismiss(task.id))
              }
            >
              {t("upload.clear")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
