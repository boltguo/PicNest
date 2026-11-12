import { Button, Dropdown } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { usePrefsStore } from "../store/prefs";
import type { LinkFormat } from "../lib/links";
export function LinkFormatMenu() {
  const { t } = useTranslation();
  const format = usePrefsStore((s) => s.linkFormat);
  const set = usePrefsStore((s) => s.setLinkFormat);
  return (
    <Dropdown>
      <Button size="sm" variant="tertiary" aria-label={t("links.format")}>
        {format === "url" ? "URL" : format === "html" ? "HTML" : "Markdown"}
      </Button>
      <Dropdown.Popover>
        <Dropdown.Menu
          selectionMode="single"
          selectedKeys={[format]}
          disallowEmptySelection
          onSelectionChange={(keys) => set([...keys][0] as LinkFormat)}
        >
          {(["url", "markdown", "html"] as const).map((key) => (
            <Dropdown.Item key={key} id={key}>
              <Dropdown.ItemIndicator />
              {key === "url" ? "URL" : key === "html" ? "HTML" : "Markdown"}
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
