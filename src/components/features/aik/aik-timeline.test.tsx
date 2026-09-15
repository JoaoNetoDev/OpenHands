import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "test-utils";
import { AikTimeline } from "#/components/features/aik/aik-timeline";
import type { AikTimelineEntry } from "#/types/aik";

const buildEntry = (
  overrides: Partial<AikTimelineEntry> = {},
): AikTimelineEntry => ({
  id: "entry-1",
  at: "2026-09-15T10:00:00.000Z",
  kind: "comment",
  ...overrides,
});

describe("AikTimeline", () => {
  it("shows an empty state when there are no entries", () => {
    renderWithProviders(<AikTimeline entries={[]} />);

    expect(screen.getByTestId("aik-timeline-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("aik-timeline")).not.toBeInTheDocument();
  });

  it("orders entries by `at` ascending regardless of input order", () => {
    const entries: AikTimelineEntry[] = [
      buildEntry({
        id: "later",
        at: "2026-09-15T12:00:00.000Z",
        text: "later",
      }),
      buildEntry({
        id: "earlier",
        at: "2026-09-15T08:00:00.000Z",
        text: "earlier",
      }),
      buildEntry({
        id: "middle",
        at: "2026-09-15T10:00:00.000Z",
        text: "middle",
      }),
    ];
    renderWithProviders(<AikTimeline entries={entries} />);

    const list = screen.getByTestId("aik-timeline");
    const ids = Array.from(list.children).map((li) =>
      li.getAttribute("data-testid"),
    );
    expect(ids).toEqual([
      "aik-timeline-entry-earlier",
      "aik-timeline-entry-middle",
      "aik-timeline-entry-later",
    ]);
  });

  it("renders a distinct label for each kind", () => {
    const kinds: AikTimelineEntry["kind"][] = [
      "comment",
      "status_change",
      "run_started",
      "run_stopped",
      "review_feedback",
    ];
    const entries = kinds.map((kind, index) =>
      buildEntry({
        id: `entry-${index}`,
        kind,
        at: `2026-09-15T0${index}:00:00.000Z`,
      }),
    );
    renderWithProviders(<AikTimeline entries={entries} />);

    const labels = entries.map(
      (entry) =>
        screen.getByTestId(`aik-timeline-entry-kind-${entry.id}`).textContent,
    );
    expect(new Set(labels).size).toBe(kinds.length);
  });

  it("renders text with embedded HTML as literal text, never executed (CA-36)", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const entries: AikTimelineEntry[] = [
      buildEntry({ id: "hostile", text: hostile }),
    ];
    renderWithProviders(<AikTimeline entries={entries} />);

    const node = screen.getByTestId("aik-timeline-entry-text-hostile");
    expect(node.textContent).toBe(hostile);
    expect(node.querySelector("img")).toBeNull();
  });
});
