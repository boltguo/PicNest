import { Button, Modal } from "@heroui/react";
import prettyBytes from "pretty-bytes";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { absoluteUrl, fileUrl, type FileInfo } from "../lib/api";
import { formatDateTime } from "../lib/utils";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-foreground min-w-0 break-all">{children}</dd>
    </div>
  );
}

export function FileDetailsDialog({
  file,
  onClose,
}: {
  file: FileInfo | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Intrinsic size is not stored in D1 yet, so read it off the decoded image.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setSize(null);
    if (!file) return;
    const img = new Image();
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = fileUrl(file.key);
    return () => {
      img.onload = null;
    };
  }, [file]);

  return (
    <Modal.Backdrop
      isOpen={file !== null}
      onOpenChange={(open) => !open && onClose()}
      variant="blur"
    >
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-115">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t("file.details")}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {file && (
              <dl className="divide-default divide-y text-sm">
                <Row label={t("file.name")}>{file.name}</Row>
                <Row label={t("file.size")}>{prettyBytes(file.size)}</Row>
                <Row label={t("file.dimensions")}>
                  {size ? `${size.w} × ${size.h}` : "—"}
                </Row>
                <Row label={t("file.type")}>{file.mime}</Row>
                <Row label={t("file.uploaded")}>{formatDateTime(file.uploaded)}</Row>
                <Row label={t("file.path")}>
                  {file.folder === "" ? file.name : `${file.folder}/${file.name}`}
                </Row>
                <Row label={t("file.publicLink")}>{absoluteUrl(fileUrl(file.key))}</Row>
              </dl>
            )}
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
