import { Button, Card, Dropdown } from "@heroui/react";
import {
  Ellipsis,
  Eye,
  FolderInput,
  Info,
  Link2,
  Share2,
  Trash2,
} from "lucide-react";
import prettyBytes from "pretty-bytes";
import { useTranslation } from "react-i18next";
import { fileUrl, type FileInfo } from "../lib/api";
import { formatDate } from "../lib/utils";

interface FileCardProps {
  file: FileInfo;
  onPreview: (file: FileInfo) => void;
  onCopyLink: (file: FileInfo) => void;
  onShare: (file: FileInfo) => void;
  onMove: (file: FileInfo) => void;
  onDetails: (file: FileInfo) => void;
  onDelete: (file: FileInfo) => void;
}

export function FileCard({
  file,
  onPreview,
  onCopyLink,
  onShare,
  onMove,
  onDetails,
  onDelete,
}: FileCardProps) {
  const { t } = useTranslation();

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="bg-default relative aspect-square overflow-hidden">
        {/* Absolute so the intrinsic image height can't stretch the square. */}
        <img
          src={fileUrl(file.key)}
          alt={file.name}
          loading="lazy"
          onClick={() => onPreview(file)}
          className="absolute inset-0 size-full cursor-zoom-in object-cover"
        />
      </div>
      {/* Name only — size and date live in the details dialog, so the row
          stays one line at any card width and nothing covers the artwork. */}
      <div className="flex items-center gap-1 py-1.5 pr-1.5 pl-3">
        <p
          className="min-w-0 flex-1 truncate text-[13px] font-medium"
          title={`${file.name}\n${prettyBytes(file.size)} · ${formatDate(file.uploaded)}`}
        >
          {file.name}
        </p>
        <Dropdown>
          <Button isIconOnly size="sm" variant="ghost" aria-label={t("file.actions")}>
            <Ellipsis className="size-4" />
          </Button>
          <Dropdown.Popover placement="bottom end">
            <Dropdown.Menu>
              <Dropdown.Item onAction={() => onPreview(file)}>
                <Eye className="size-4" aria-hidden />
                {t("file.preview")}
              </Dropdown.Item>
              <Dropdown.Item onAction={() => onCopyLink(file)}>
                <Link2 className="size-4" aria-hidden />
                {t("file.copyLink")}
              </Dropdown.Item>
              <Dropdown.Item onAction={() => onShare(file)}>
                <Share2 className="size-4" aria-hidden />
                {t("share.action")}
              </Dropdown.Item>
              <Dropdown.Item onAction={() => onMove(file)}>
                <FolderInput className="size-4" aria-hidden />
                {t("move.action")}
              </Dropdown.Item>
              <Dropdown.Item onAction={() => onDetails(file)}>
                <Info className="size-4" aria-hidden />
                {t("file.details")}
              </Dropdown.Item>
              <Dropdown.Item variant="danger" onAction={() => onDelete(file)}>
                <Trash2 className="size-4" aria-hidden />
                {t("file.delete")}
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
    </Card>
  );
}
