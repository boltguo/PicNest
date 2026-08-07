import {
  Button,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextField,
  toast,
} from "@heroui/react";
import { useMutation } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { absoluteUrl, api, type FileInfo } from "../lib/api";

/** Expiry choices, in hours. `null` means the link never expires. */
const EXPIRY_OPTIONS = [
  { id: "never", hours: null },
  { id: "1h", hours: 1 },
  { id: "24h", hours: 24 },
  { id: "7d", hours: 24 * 7 },
  { id: "30d", hours: 24 * 30 },
] as const;

type ExpiryId = (typeof EXPIRY_OPTIONS)[number]["id"];

interface ShareDialogProps {
  file: FileInfo | null;
  onClose: () => void;
  onCreated: () => void;
}

export function ShareDialog({ file, onClose, onCreated }: ShareDialogProps) {
  const { t } = useTranslation();
  const [expiry, setExpiry] = useState<ExpiryId>("never");
  const [password, setPassword] = useState("");
  const [url, setUrl] = useState<string | null>(null);

  // Reset back to the form whenever a different file is shared.
  useEffect(() => {
    if (file) {
      setExpiry("never");
      setPassword("");
      setUrl(null);
    }
  }, [file]);

  const create = useMutation({
    mutationFn: () =>
      api.createShare(file!.id, {
        hours: EXPIRY_OPTIONS.find((o) => o.id === expiry)!.hours,
        password: password.trim() || null,
      }),
    onSuccess: ({ url: path }) => {
      setUrl(absoluteUrl(path));
      onCreated();
    },
    onError: () => toast.danger(t("share.createFailed")),
  });

  const copy = () => {
    navigator.clipboard
      .writeText(url!)
      .then(() => toast.success(t("share.copied")))
      .catch(() => toast.danger(t("file.linkCopyFailed")));
  };

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
            <Modal.Heading>{t("share.title")}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {url === null ? (
              <div className="flex flex-col gap-4">
                <Select
                  selectedKey={expiry}
                  onSelectionChange={(key) => setExpiry(key as ExpiryId)}
                  fullWidth
                >
                  <Label>{t("share.expiry")}</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {EXPIRY_OPTIONS.map((option) => (
                        <ListBox.Item key={option.id} id={option.id}>
                          {t(`share.expiryOption.${option.id}`)}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <TextField
                  type="password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="off"
                  fullWidth
                >
                  <Label>{t("share.password")}</Label>
                  <Input placeholder={t("share.passwordOptional")} />
                </TextField>
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <TextField value={url} isReadOnly fullWidth className="flex-1">
                  <Label>{t("share.link")}</Label>
                  <Input onFocus={(e) => e.currentTarget.select()} />
                </TextField>
                <Button
                  isIconOnly
                  variant="secondary"
                  aria-label={t("share.copy")}
                  onPress={copy}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            {url === null ? (
              <>
                <Button slot="close" variant="tertiary">
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="primary"
                  isPending={create.isPending}
                  onPress={() => create.mutate()}
                >
                  {t("share.create")}
                </Button>
              </>
            ) : (
              <Button slot="close" variant="primary">
                {t("common.done")}
              </Button>
            )}
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
