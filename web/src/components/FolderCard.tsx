import { Button } from "@heroui/react";
import { Trash2 } from "lucide-react";
import { useId, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { fileUrl, type FolderInfo } from "../lib/api";

/**
 * Item geometry from the frosted-folder reference design, left to right.
 * Percentages are relative to the folder stage; x offsets are relative to
 * the item's own width (applied on top of the centering translateX(-50%)).
 */
const SLOTS = [
  { top: "5%", width: "34%", ratio: "4 / 5", z: 3, closedX: "-35.294%", openX: "-82.353%", closedRotate: "-3deg", openRotate: "-5.5deg", delay: "80ms" },
  { top: "9%", width: "44%", ratio: "4 / 3", z: 4, closedX: "-13.636%", openX: "-31.818%", closedRotate: "-1.5deg", openRotate: "-2.75deg", delay: "40ms" },
  { top: "4%", width: "37%", ratio: "1 / 1", z: 5, closedX: "0%", openX: "0%", closedRotate: "0deg", openRotate: "0deg", delay: "0ms" },
  { top: "10%", width: "42%", ratio: "3 / 2", z: 4, closedX: "14.286%", openX: "33.333%", closedRotate: "1.5deg", openRotate: "2.75deg", delay: "40ms" },
  { top: "6%", width: "32%", ratio: "3 / 4", z: 3, closedX: "37.5%", openX: "87.5%", closedRotate: "3deg", openRotate: "5.5deg", delay: "80ms" },
] as const;

/**
 * Which slots to fill for a given preview count. Picks spread outward so a
 * few photos fan across the folder instead of stacking in the middle.
 */
const SLOT_PICKS: Record<number, number[]> = {
  1: [2],
  2: [1, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
};

const FOLDER_PATH =
  "M0 26A26 26 0 0 1 26 0h128a26 26 0 0 1 26 26 34 34 0 0 0 34 34h156a30 30 0 0 1 30 30v220a30 30 0 0 1-30 30H30a30 30 0 0 1-30-30Z";

interface FolderCardProps {
  folder: FolderInfo;
  onOpen: (folder: FolderInfo) => void;
  onDelete: (folder: FolderInfo) => void;
}

export function FolderCard({ folder, onOpen, onDelete }: FolderCardProps) {
  const { t } = useTranslation();
  const gradientId = useId();

  const previews = folder.previews.slice(0, SLOTS.length);
  const picks = SLOT_PICKS[previews.length] ?? [];

  return (
    <div className="group relative">
      <button
        type="button"
        className="folder"
        onClick={() => onOpen(folder)}
        aria-label={`${folder.name}, ${t("folder.items", { count: folder.count })}`}
      >
        <div className="folder-stage">
          <svg className="folder-back" viewBox="0 0 400 340" aria-hidden="true">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f4f4f4" />
                <stop offset="1" stopColor="#e2e2e2" />
              </linearGradient>
            </defs>
            <path d={FOLDER_PATH} fill={`url(#${gradientId})`} />
            <path d={FOLDER_PATH} fill="none" stroke="white" strokeOpacity="0.8" />
          </svg>

          <div className="folder-contents" aria-hidden="true">
            {picks.map((slotIndex, i) => {
              const slot = SLOTS[slotIndex];
              return (
                <div
                  key={previews[i]}
                  className="folder-item"
                  style={
                    {
                      "--top": slot.top,
                      "--width": slot.width,
                      "--ratio": slot.ratio,
                      "--z": slot.z,
                      "--closed-x": slot.closedX,
                      "--open-x": slot.openX,
                      "--closed-rotate": slot.closedRotate,
                      "--open-rotate": slot.openRotate,
                      "--delay": slot.delay,
                    } as CSSProperties
                  }
                >
                  <div className="folder-frame">
                    <figure className="folder-photo">
                      <img src={fileUrl(previews[i])} alt="" loading="lazy" />
                    </figure>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="folder-flap">
            <div className="folder-label">
              <div className="min-w-0">
                <p className="folder-title">{folder.name}</p>
                <p className="folder-meta">
                  {t("folder.items", { count: folder.count })}
                </p>
              </div>
            </div>
          </div>
        </div>
      </button>

      {/* Sits on the stable bottom edge of the flap (its rotation hinges on
          the bottom), clear of the photos that pop out of the top. */}
      <Button
        isIconOnly
        size="sm"
        variant="danger-soft"
        aria-label={t("folder.deleteTitle")}
        onPress={() => onDelete(folder)}
        className="absolute right-3 bottom-3 z-20 rounded-full opacity-0 shadow-sm transition group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
      >
        <Trash2 className="size-3.25" />
      </Button>
    </div>
  );
}
