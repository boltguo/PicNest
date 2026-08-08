import {
  Button,
  FieldError,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextField,
  toast,
} from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type FileInfo } from "../lib/api";

/**
 * Sentinel id for the root folder, whose real path is the empty string —
 * Select needs a non-empty key. "/" can never collide with one: folderSchema
 * rejects empty segments, so no real path is a bare slash.
 */
const ROOT = "/";

interface MoveDialogProps {
  file: FileInfo | null;
  onClose: () => void;
  onMoved: (folder: string) => void;
}

/**
 * Where a file gets a new home: destination folder and display name in one
 * dialog, because `PATCH /api/file` changes both in one metadata write and
 * the stored object is untouched either way.
 */
export function MoveDialog({ file, onClose, onMoved }: MoveDialogProps) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<string>(ROOT);
  const [name, setName] = useState("");

  // Only fetched while the dialog is open; the tree rarely changes.
  const { data: folders } = useQuery({
    queryKey: ["folders"],
    queryFn: api.folders,
    enabled: file !== null,
  });

  useEffect(() => {
    if (file) {
      setTarget(file.folder === "" ? ROOT : file.folder);
      setName(file.name);
    }
  }, [file]);

  const targetFolder = target === ROOT ? "" : target;
  const trimmed = name.trim();
  // Separators would read as a path; the Worker strips them anyway, and
  // silently saving something other than what was typed is worse than saying so.
  const nameInvalid = trimmed === "" || /[/\\]/.test(trimmed);
  const unchanged =
    (file?.folder ?? "") === targetFolder && trimmed === (file?.name ?? "");

  const move = useMutation({
    mutationFn: () =>
      api.move(file!.id, { folder: targetFolder, name: trimmed }),
    onSuccess: ({ folder }) => {
      toast.success(t("move.saved"));
      onMoved(folder);
      onClose();
    },
    onError: () => toast.danger(t("move.failed")),
  });

  const options = [ROOT, ...(folders ?? [])];

  return (
    <Modal.Backdrop
      isOpen={file !== null}
      onOpenChange={(open) => !open && onClose()}
      variant="blur"
    >
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-100">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t("move.title")}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="flex flex-col gap-4">
              <TextField
                value={name}
                onChange={setName}
                isInvalid={name !== "" && nameInvalid}
                fullWidth
              >
                <Label>{t("move.name")}</Label>
                <Input />
                <FieldError>{t("move.nameInvalid")}</FieldError>
              </TextField>
              <Select
                selectedKey={target}
                onSelectionChange={(key) => setTarget(key as string)}
                fullWidth
              >
                <Label>{t("move.destination")}</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {options.map((path) => (
                      <ListBox.Item key={path} id={path}>
                        {path === ROOT ? t("breadcrumb.home") : path}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              {folders?.length === 0 && (
                <p className="text-muted text-[13px]">{t("move.noFolders")}</p>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              isDisabled={unchanged || nameInvalid}
              isPending={move.isPending}
              onPress={() => move.mutate()}
            >
              {t("move.confirm")}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
