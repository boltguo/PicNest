import { Surface, cn, toast } from "@heroui/react";
import { ImagePlus } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { useTranslation } from "react-i18next";
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "../lib/api";

export function UploadDropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { t } = useTranslation();
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    // Same allow-list and ceiling the Worker enforces, so a file it would
    // turn down is named right here instead of after a 32 MB round trip.
    accept: ACCEPTED_IMAGE_TYPES,
    maxSize: MAX_UPLOAD_BYTES,
    onDrop: (accepted, rejected) => {
      for (const { file, errors } of rejected) {
        const tooLarge = errors.some((e) => e.code === "file-too-large");
        toast.danger(
          t(tooLarge ? "upload.tooLargeToast" : "upload.wrongTypeToast", {
            name: file.name,
          })
        );
      }
      if (accepted.length > 0) onFiles(accepted);
    },
  });

  return (
    <Surface
      {...getRootProps()}
      className={cn(
        "cursor-pointer rounded-3xl border-2 border-dashed px-6 py-8 text-center transition-colors",
        isDragActive && "border-accent"
      )}
    >
      <input {...getInputProps()} />
      <ImagePlus className="text-muted mx-auto size-5" aria-hidden />
      <p className="mt-2 text-sm font-medium">{t("dropzone.title")}</p>
      <p className="text-muted mt-1 text-xs">{t("dropzone.hint")}</p>
    </Surface>
  );
}
