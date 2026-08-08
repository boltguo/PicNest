import { Button, Modal, Table } from "@heroui/react";
import prettyBytes from "pretty-bytes";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { absoluteUrl, fileUrl, type FileInfo } from "../lib/api";
import { formatDateTime } from "../lib/utils";

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

  const rows = file
    ? [
        { id: "name", label: t("file.name"), value: file.name },
        { id: "size", label: t("file.size"), value: prettyBytes(file.size) },
        {
          id: "dimensions",
          label: t("file.dimensions"),
          value: size ? `${size.w} × ${size.h}` : "—",
        },
        { id: "type", label: t("file.type"), value: file.mime },
        {
          id: "uploaded",
          label: t("file.uploaded"),
          value: formatDateTime(file.uploaded),
        },
        {
          id: "path",
          label: t("file.path"),
          value: file.folder === "" ? file.name : `${file.folder}/${file.name}`,
        },
        {
          id: "link",
          label: t("file.publicLink"),
          value: absoluteUrl(fileUrl(file.key)),
        },
      ]
    : [];

  return (
    <Modal.Backdrop
      isOpen={file !== null}
      onOpenChange={(open) => !open && onClose()}
      variant="blur"
    >
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-150">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t("file.details")}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {file && (
              // Secondary: the dialog is already a white surface, so a table
              // that paints its own would stack panel on panel.
              <Table variant="secondary">
                <Table.ScrollContainer>
                  <Table.Content aria-label={t("file.details")}>
                    <Table.Header>
                      <Table.Column isRowHeader className="w-28">
                        {t("file.property")}
                      </Table.Column>
                      {/* Takes the leftover width so the label column keeps its
                          fixed size and never wraps mid-word. */}
                      <Table.Column className="w-full">
                        {t("file.value")}
                      </Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {rows.map((row) => (
                        <Table.Row key={row.id}>
                          <Table.Cell className="text-muted whitespace-nowrap">
                            {row.label}
                          </Table.Cell>
                          {/* max-w-0 is what lets a long path or URL wrap inside
                              an auto-layout table cell instead of widening it. */}
                          <Table.Cell className="max-w-0 break-all">
                            {row.value}
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
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
