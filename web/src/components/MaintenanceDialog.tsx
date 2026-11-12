import { Button, Modal, toast } from "@heroui/react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, fileUrl } from "../lib/api";
import { makeThumbnail } from "../lib/thumbnail";
export function MaintenanceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [backfill, setBackfill] = useState<{
    running: boolean;
    done: number;
    failed: number;
  }>({ running: false, done: 0, failed: 0 });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: api.jobs,
    enabled: open,
    refetchInterval: open ? 2000 : false,
  });
  const results = useInfiniteQuery({
    queryKey: ["findings", selected],
    queryFn: ({ pageParam }) => api.findings(selected!, pageParam),
    enabled: open && !!selected,
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
    refetchInterval:
      open &&
      jobs.data?.jobs.some(
        (job) => job.id === selected && job.status === "running",
      )
        ? 2000
        : false,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["jobs"] });
    void client.invalidateQueries({ queryKey: ["findings"] });
    void client.invalidateQueries({ queryKey: ["files"] });
    void client.invalidateQueries({ queryKey: ["stats"] });
  };
  const scan = useMutation({
    mutationFn: api.scan,
    onSuccess: (job) => {
      setSelected(job.id);
      refresh();
    },
    onError: () => toast.danger(t("maintenance.failed")),
  });
  const retry = useMutation({
    mutationFn: api.retryJob,
    onSuccess: refresh,
    onError: () => toast.danger(t("maintenance.failed")),
  });
  const restore = useMutation({
    mutationFn: api.importFinding,
    onSuccess: refresh,
    onError: () => toast.danger(t("maintenance.failed")),
  });
  const generate = async () => {
    const abort = new AbortController();
    controller.current = abort;
    setBackfill({ running: true, done: 0, failed: 0 });
    let cursor = 0;
    try {
      while (!abort.signal.aborted) {
        const page = await api.pendingThumbnails(cursor, abort.signal);
        for (const file of page.files) {
          if (abort.signal.aborted) break;
          try {
            const response = await fetch(fileUrl(file.key), {
              signal: abort.signal,
            });
            if (!response.ok) throw new Error("Image unavailable");
            const thumb = await makeThumbnail(await response.blob());
            if (abort.signal.aborted) break;
            await api.thumbnail(
              file.id,
              thumb.blob,
              thumb.width,
              thumb.height,
              abort.signal,
            );
            setBackfill((value) => ({ ...value, done: value.done + 1 }));
          } catch {
            if (!abort.signal.aborted)
              setBackfill((value) => ({ ...value, failed: value.failed + 1 }));
          }
        }
        if (page.next === null) break;
        cursor = page.next;
      }
    } catch {
      if (!abort.signal.aborted) toast.danger(t("maintenance.failed"));
    } finally {
      setBackfill((value) => ({ ...value, running: false }));
      refresh();
    }
  };
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange} variant="blur">
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-180">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t("maintenance.title")}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="flex flex-col gap-5">
              <p className="text-muted text-sm">
                {t("maintenance.description")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onPress={() => scan.mutate()}
                  isPending={scan.isPending}
                >
                  {t("maintenance.scan")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={backfill.running}
                  onPress={() => void generate()}
                >
                  {t("maintenance.thumbnails")}
                </Button>
                {backfill.running && (
                  <Button
                    size="sm"
                    variant="tertiary"
                    onPress={() => controller.current?.abort()}
                  >
                    {t("common.cancel")}
                  </Button>
                )}
              </div>
              {(backfill.running ||
                backfill.done > 0 ||
                backfill.failed > 0) && (
                <p className="text-muted text-sm" role="status">
                  {t("maintenance.thumbnailProgress", backfill)}
                </p>
              )}
              {!!jobs.data?.cleanupPending && (
                <p className="text-sm" role="status">
                  {t("maintenance.cleanup", {
                    count: jobs.data.cleanupPending,
                  })}
                </p>
              )}
              {jobs.isError && (
                <Button onPress={() => void jobs.refetch()}>
                  {t("common.retry")}
                </Button>
              )}
              <div className="max-h-60 space-y-2 overflow-y-auto">
                {jobs.data?.jobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center gap-2 rounded-lg border border-default p-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate">
                        {job.kind === "repair"
                          ? t("maintenance.scan")
                          : job.path}
                      </p>
                      <p className="text-muted text-xs">
                        {t(`maintenance.${job.status}`)} ·{" "}
                        {job.kind === "delete-folder"
                          ? `${job.processed}/${job.total}`
                          : t("maintenance.scanned", { count: job.processed })}
                      </p>
                      {job.status === "error" && (
                        <p className="text-danger text-xs">
                          {t("maintenance.retryHint")}
                        </p>
                      )}
                    </div>
                    {job.kind === "repair" && (
                      <Button
                        size="sm"
                        variant="tertiary"
                        onPress={() => setSelected(job.id)}
                      >
                        {t("maintenance.results")}
                      </Button>
                    )}
                    {job.status === "error" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        isPending={retry.isPending}
                        onPress={() => retry.mutate(job.id)}
                      >
                        {t("common.retry")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {selected && (
                <section
                  aria-label={t("maintenance.results")}
                  className="space-y-2"
                >
                  <h3 className="text-sm font-semibold">
                    {t("maintenance.results")}
                  </h3>
                  {results.isLoading && <p>{t("common.loading")}</p>}
                  {results.isError && (
                    <Button size="sm" onPress={() => void results.refetch()}>
                      {t("common.retry")}
                    </Button>
                  )}
                  {results.data?.pages.every(
                    (page) => !page.findings.length,
                  ) && (
                    <p className="text-muted text-sm">
                      {t("maintenance.noFindings")}
                    </p>
                  )}
                  <div className="max-h-60 space-y-2 overflow-y-auto">
                    {results.data?.pages
                      .flatMap((page) => page.findings)
                      .map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <p
                              className="truncate"
                              title={`${item.folder}/${item.name}`}
                            >
                              {item.name}
                            </p>
                            <p className="text-muted text-xs">
                              {t(`maintenance.${item.kind}`)}
                            </p>
                          </div>
                          {item.kind === "unindexed" && (
                            <Button
                              size="sm"
                              variant="secondary"
                              isDisabled={!!item.resolved || restore.isPending}
                              onPress={() => restore.mutate(item.id)}
                            >
                              {item.resolved
                                ? t("maintenance.imported")
                                : t("maintenance.import")}
                            </Button>
                          )}
                        </div>
                      ))}
                  </div>
                  {results.hasNextPage && (
                    <Button
                      size="sm"
                      isPending={results.isFetchingNextPage}
                      onPress={() => void results.fetchNextPage()}
                    >
                      {t("file.loadMore")}
                    </Button>
                  )}
                </section>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              {t("common.close")}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
