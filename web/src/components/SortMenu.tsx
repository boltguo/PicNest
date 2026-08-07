import { Button, Dropdown } from "@heroui/react";
import { ArrowDownUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SORT_KEYS, usePrefsStore, type SortKey } from "../store/prefs";

export function SortMenu() {
  const { t } = useTranslation();
  const sort = usePrefsStore((s) => s.sort);
  const setSort = usePrefsStore((s) => s.setSort);

  return (
    <Dropdown>
      <Button size="sm" variant="tertiary" className="shrink-0">
        <ArrowDownUp className="size-3.5" aria-hidden />
        {t(`sort.${sort}`)}
      </Button>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu
          selectionMode="single"
          selectedKeys={[sort]}
          disallowEmptySelection
          onSelectionChange={(keys) =>
            setSort([...(keys as Set<string>)][0] as SortKey)
          }
        >
          {SORT_KEYS.map((key) => (
            <Dropdown.Item key={key} id={key}>
              <Dropdown.ItemIndicator />
              {t(`sort.${key}`)}
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
