import React from "react";
import { cn } from "#/utils/utils";
import {
  dropdownInstantColorClassName,
  dropdownMenuRowGapClassName,
  dropdownMenuRowIconWrapperClassName,
} from "#/utils/dropdown-classes";

interface DropdownItemProps<T> {
  item: T;
  index: number;
  isSelected: boolean;
  getItemProps: <Options>(options: any & Options) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  getDisplayText: (item: T) => string;
  /**
   * Optional muted second line under the display text, used when the display
   * text alone does not identify the item (e.g. two folders with the same
   * name, disambiguated by their directory).
   */
  getSecondaryText?: (item: T) => string | null;
  getItemKey: (item: T) => string;
  isProviderDropdown?: boolean;
  renderIcon?: (item: T) => React.ReactNode;
  itemClassName?: string;
  /**
   * Overrides the option's accessible name. Used to fold a group label into the
   * announced name (e.g. "Projects, alpha") when the visual group header is
   * presentational and therefore invisible to assistive tech.
   */
  ariaLabel?: string;
}

export function DropdownItem<T>({
  item,
  index,
  isSelected,
  getItemProps,
  getDisplayText,
  getSecondaryText,
  getItemKey,
  isProviderDropdown = false,
  renderIcon,
  itemClassName,
  ariaLabel,
}: DropdownItemProps<T>) {
  const secondaryText = getSecondaryText?.(item) ?? null;
  const itemProps = getItemProps({
    index,
    item,
    ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
    className: cn(
      isProviderDropdown
        ? "group px-2 py-0 cursor-pointer text-xs rounded-md mx-0 my-0 h-6 flex items-center"
        : "group px-2 py-2 cursor-pointer text-sm rounded-md mx-0 my-0.5",
      "text-white focus:outline-none font-normal",
      dropdownInstantColorClassName,
      {
        "bg-interactive-selected text-white": isSelected,
        "hover:bg-interactive-hover": !isSelected,
      },
      itemClassName,
    ),
  });

  return (
    <li key={getItemKey(item)} {...itemProps}>
      <div className={cn("flex items-center", dropdownMenuRowGapClassName)}>
        {renderIcon ? (
          <span className={dropdownMenuRowIconWrapperClassName}>
            {renderIcon(item)}
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-normal">{getDisplayText(item)}</span>
          {secondaryText ? (
            <span className="truncate text-xs leading-4 text-[var(--oh-muted)]">
              {secondaryText}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
