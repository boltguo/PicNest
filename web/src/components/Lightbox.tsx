import { Modal } from "@heroui/react";
import { ImageOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fileUrl, type FileInfo } from "../lib/api";

interface LightboxProps {
  file: FileInfo | null;
  onClose: () => void;
}

export function Lightbox({ file, onClose }: LightboxProps) {
  const { t } = useTranslation();
  const [broken, setBroken] = useState(false);

  // A new file gets the benefit of the doubt; only its own onError marks it.
  useEffect(() => setBroken(false), [file]);

  return (
    <Modal.Backdrop
      isOpen={file !== null}
      onOpenChange={(open) => !open && onClose()}
      variant="blur"
    >
      <Modal.Container className="grid place-items-center p-6">
        <Modal.Dialog
          aria-label={file?.name ?? t("lightbox.fallbackTitle")}
          onClick={onClose}
          className="max-w-none border-none bg-transparent p-0 shadow-none"
        >
          {file &&
            (broken ? (
              <div className="text-muted flex cursor-zoom-out flex-col items-center gap-2 self-center px-8 py-16">
                <ImageOff className="size-6" aria-hidden />
                <span className="text-sm">{t("file.unavailable")}</span>
              </div>
            ) : (
              /* `self-center` is load-bearing: the dialog is a flex column, so a
                 stretched image would be forced to the container width and
                 distorted. `object-contain` guards the aspect ratio either way. */
              <img
                src={fileUrl(file.key)}
                alt={file.name}
                onError={() => setBroken(true)}
                className="block max-h-[85svh] w-auto max-w-full cursor-zoom-out self-center rounded-xl object-contain shadow-2xl"
              />
            ))}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
