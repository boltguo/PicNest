import { cn } from "@heroui/react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Usually a single Button — the one thing that would fill the space. */
  action?: ReactNode;
  className?: string;
}

/**
 * The single shape every "nothing here" moment takes: a soft icon disc, a
 * title, and a line naming what would fill the space. Deliberately borderless
 * — an empty state framed in a card reads as a thing on the page rather than
 * as the page having nothing to show.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-6 py-12 text-center",
        className
      )}
    >
      <div className="bg-default text-muted grid size-12 place-items-center rounded-2xl">
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="mt-4 text-sm font-medium">{title}</p>
      {description && (
        <p className="text-muted mt-1 max-w-xs text-[13px] leading-5">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
