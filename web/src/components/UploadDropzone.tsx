import { Surface, cn } from "@heroui/react";
import { ImagePlus } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { useTranslation } from "react-i18next";

export function UploadDropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { t } = useTranslation();
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "image/*": [] },
    onDrop: onFiles,
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
