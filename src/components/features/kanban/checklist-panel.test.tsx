import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { ChecklistPanel } from "#/components/features/kanban/checklist-panel";
import type { KanbanChecklistItem } from "#/types/kanban";

describe("ChecklistPanel", () => {
  it("adds a new item when typing text and pressing Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<ChecklistPanel items={[]} onChange={onChange} />);

    const input = screen.getByTestId("checklist-add-input");
    await user.type(input, "Buy milk{Enter}");

    expect(onChange).toHaveBeenCalledTimes(1);
    const added = onChange.mock.calls[0][0] as KanbanChecklistItem[];
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ text: "Buy milk", done: false });
    expect(typeof added[0].id).toBe("string");
    expect(added[0].id.length).toBeGreaterThan(0);
  });

  it("does not add an empty item when pressing Enter with blank input", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<ChecklistPanel items={[]} onChange={onChange} />);

    const input = screen.getByTestId("checklist-add-input");
    await user.type(input, "   {Enter}");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("toggles an item's done state when its checkbox is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const items: KanbanChecklistItem[] = [
      { id: "item-1", text: "Buy milk", done: false },
    ];
    renderWithProviders(<ChecklistPanel items={items} onChange={onChange} />);

    await user.click(screen.getByTestId("checklist-item-checkbox-item-1"));

    expect(onChange).toHaveBeenCalledWith([
      { id: "item-1", text: "Buy milk", done: true },
    ]);
  });

  it("removes an item when its remove button is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const items: KanbanChecklistItem[] = [
      { id: "item-1", text: "Buy milk", done: false },
      { id: "item-2", text: "Walk the dog", done: true },
    ];
    renderWithProviders(<ChecklistPanel items={items} onChange={onChange} />);

    await user.click(screen.getByTestId("checklist-item-remove-item-1"));

    expect(onChange).toHaveBeenCalledWith([
      { id: "item-2", text: "Walk the dog", done: true },
    ]);
  });

  it("shows the empty state when there are no items", () => {
    const onChange = vi.fn();
    renderWithProviders(<ChecklistPanel items={[]} onChange={onChange} />);

    expect(screen.getByTestId("checklist-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("checklist-items")).not.toBeInTheDocument();
  });
});
