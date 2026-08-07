import { Button, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Languages, Link2, LogOut } from "lucide-react";
import prettyBytes from "pretty-bytes";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { Breadcrumb } from "../components/Breadcrumb";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FileCard } from "../components/FileCard";
import { FileDetailsDialog } from "../components/FileDetailsDialog";
import { FolderCard } from "../components/FolderCard";
import { Lightbox } from "../components/Lightbox";
import { Logo } from "../components/Logo";
import { MoveDialog } from "../components/MoveDialog";
import { NewFolderDialog } from "../components/NewFolderDialog";
import { ShareDialog } from "../components/ShareDialog";
import { SharesDialog } from "../components/SharesDialog";
import { SortMenu } from "../components/SortMenu";
import { UploadDropzone } from "../components/UploadDropzone";
import { UploadProgressList } from "../components/UploadProgressList";
import { useUploads } from "../hooks/useUploads";
import {
  absoluteUrl,
  api,
  fileUrl,
  type FileInfo,
  type FolderInfo,
} from "../lib/api";
import { useAuthStore } from "../store/auth";
import { usePrefsStore, type SortKey } from "../store/prefs";

/** Comparators for the toolbar sort menu. */
const COMPARATORS: Record<SortKey, (a: FileInfo, b: FileInfo) => number> = {
  newest: (a, b) => b.uploaded - a.uploaded,
  oldest: (a, b) => a.uploaded - b.uploaded,
  nameAsc: (a, b) => a.name.localeCompare(b.name),
  nameDesc: (a, b) => b.name.localeCompare(a.name),
  largest: (a, b) => b.size - a.size,
  smallest: (a, b) => a.size - b.size,
};

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const logout = useAuthStore((s) => s.logout);
  const queryClient = useQueryClient();

  // The current folder lives in the URL, so navigation and refresh both work.
  const [searchParams, setSearchParams] = useSearchParams();
  const folder = searchParams.get("folder") ?? "";
  const navigateToFolder = (path: string) =>
    setSearchParams(path === "" ? {} : { folder: path });

  const { tasks, start } = useUploads();

  const [preview, setPreview] = useState<FileInfo | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileInfo | null>(null);
  const [pendingFolderDelete, setPendingFolderDelete] =
    useState<FolderInfo | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [sharing, setSharing] = useState<FileInfo | null>(null);
  const [moving, setMoving] = useState<FileInfo | null>(null);
  const [details, setDetails] = useState<FileInfo | null>(null);
  const [sharesOpen, setSharesOpen] = useState(false);
  const sort = usePrefsStore((s) => s.sort);

  const { data, isLoading } = useQuery({
    queryKey: ["files", folder],
    queryFn: () => api.list(folder),
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["files"] }),
      queryClient.invalidateQueries({ queryKey: ["folders"] }),
    ]);

  const removeMutation = useMutation({
    mutationFn: api.remove,
    onSuccess: () => {
      toast.success(t("file.deleted"));
      void invalidate();
    },
    onError: () => toast.danger(t("file.deleteFailed")),
  });

  const removeFolderMutation = useMutation({
    mutationFn: api.removeFolder,
    onSuccess: () => {
      toast.success(t("folder.deleted"));
      void invalidate();
    },
    onError: () => toast.danger(t("folder.deleteFailed")),
  });

  const createFolder = async (name: string) => {
    await api.createFolder(folder === "" ? name : `${folder}/${name}`);
    await invalidate();
  };

  const copyLink = (file: FileInfo) => {
    navigator.clipboard
      .writeText(absoluteUrl(fileUrl(file.key)))
      .then(() => toast.success(t("file.linkCopied")))
      .catch(() => toast.danger(t("file.linkCopyFailed")));
  };

  const toggleLanguage = () =>
    void i18n.changeLanguage(i18n.language.startsWith("zh") ? "en" : "zh");

  const isEmpty =
    data && data.folders.length === 0 && data.files.length === 0 && !isLoading;

  // Folders stay alphabetical — they are navigation, not content.
  const sortedFiles = data ? [...data.files].sort(COMPARATORS[sort]) : [];

  return (
    // One flex column owns the vertical rhythm; sections carry no margins.
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 pb-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo className="size-9" />
          <div>
            <h1 className="text-lg font-semibold">{t("app.name")}</h1>
            <p className="text-muted mt-0.5 text-xs">
              {data
                ? t("header.stats", {
                    count: data.count,
                    size: prettyBytes(data.totalSize),
                  })
                : t("common.loading")}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="tertiary" onPress={() => setSharesOpen(true)}>
            <Link2 className="size-3.5" aria-hidden />
            {t("share.manage")}
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            aria-label={t("header.language")}
            onPress={toggleLanguage}
          >
            <Languages className="size-3.5" aria-hidden />
            {i18n.language.startsWith("zh") ? "EN" : "中"}
          </Button>
          <Button size="sm" variant="tertiary" onPress={logout}>
            <LogOut className="size-3.5" aria-hidden />
            {t("header.logout")}
          </Button>
        </div>
      </header>

      <UploadDropzone onFiles={(files) => start(files, folder)} />
      <UploadProgressList tasks={tasks} />

      <div className="flex items-center justify-between gap-3">
        <Breadcrumb folder={folder} onNavigate={navigateToFolder} />
        <div className="flex shrink-0 items-center gap-2">
          <SortMenu />
          <Button size="sm" variant="primary" onPress={() => setNewFolderOpen(true)}>
            <FolderPlus className="size-3.5" aria-hidden />
            {t("folder.new")}
          </Button>
        </div>
      </div>

      {data && data.folders.length > 0 && (
        // Extra top space: photos pop out above the card on hover.
        <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-6 gap-y-10 max-sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] max-sm:gap-x-4">
          {data.folders.map((f) => (
            <FolderCard
              key={f.path}
              folder={f}
              onOpen={(target) => navigateToFolder(target.path)}
              onDelete={setPendingFolderDelete}
            />
          ))}
        </div>
      )}

      {isEmpty && (
        <p className="text-muted py-8 text-center text-[13px]">
          {folder === "" ? t("file.empty") : t("file.emptyFolder")}
        </p>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-5 max-sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] max-sm:gap-3.5">
        {sortedFiles.map((file) => (
          <FileCard
            key={file.id}
            file={file}
            onPreview={setPreview}
            onCopyLink={copyLink}
            onShare={setSharing}
            onMove={setMoving}
            onDetails={setDetails}
            onDelete={setPendingDelete}
          />
        ))}
      </div>

      <Lightbox file={preview} onClose={() => setPreview(null)} />

      <FileDetailsDialog file={details} onClose={() => setDetails(null)} />

      <MoveDialog
        file={moving}
        onClose={() => setMoving(null)}
        onMoved={() => void invalidate()}
      />

      <ShareDialog
        file={sharing}
        onClose={() => setSharing(null)}
        onCreated={() => void queryClient.invalidateQueries({ queryKey: ["shares"] })}
      />

      <SharesDialog open={sharesOpen} onOpenChange={setSharesOpen} />

      <NewFolderDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        onCreate={createFolder}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={t("file.deleteTitle")}
        description={t("file.deleteDescription", {
          name: pendingDelete?.name ?? "",
        })}
        confirmLabel={t("common.delete")}
        onConfirm={() => {
          if (pendingDelete) removeMutation.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
      />

      <ConfirmDialog
        open={pendingFolderDelete !== null}
        onOpenChange={(open) => !open && setPendingFolderDelete(null)}
        title={t("folder.deleteTitle")}
        description={t("folder.deleteDescription", {
          name: pendingFolderDelete?.name ?? "",
        })}
        confirmLabel={t("common.delete")}
        onConfirm={() => {
          if (pendingFolderDelete)
            removeFolderMutation.mutate(pendingFolderDelete.path);
          setPendingFolderDelete(null);
        }}
      />
    </div>
  );
}
