import { Breadcrumbs } from "@heroui/react";
import { House } from "lucide-react";
import { useTranslation } from "react-i18next";

interface BreadcrumbProps {
  /** Current folder path; empty string = root. */
  folder: string;
  onNavigate: (path: string) => void;
}

export function Breadcrumb({ folder, onNavigate }: BreadcrumbProps) {
  const { t } = useTranslation();
  const segments = folder === "" ? [] : folder.split("/");

  return (
    <Breadcrumbs aria-label="Folders" className="min-w-0">
      <Breadcrumbs.Item onPress={() => onNavigate("")}>
        {/* The item's own gap spaces link vs. separator; icon and label live
            inside the link, so they need their own flex row. */}
        <span className="inline-flex items-center gap-1.5">
          <House className="size-3.5 shrink-0" aria-hidden />
          {t("breadcrumb.home")}
        </span>
      </Breadcrumbs.Item>
      {segments.map((segment, i) => {
        const path = segments.slice(0, i + 1).join("/");
        return (
          <Breadcrumbs.Item key={path} onPress={() => onNavigate(path)}>
            <span className="inline-block max-w-40 truncate align-middle">
              {segment}
            </span>
          </Breadcrumbs.Item>
        );
      })}
    </Breadcrumbs>
  );
}
