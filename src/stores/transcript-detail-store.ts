import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Controls how much detail the transcript shows by default — whether
 * thinking blocks and grouped action/observation runs start expanded or
 * collapsed — plus a one-shot "expand all / collapse all" action that
 * forces every currently-mounted collapsible section to snap open or shut.
 *
 * `expandByDefault` is persisted so the preference survives reloads.
 * `resetSignal`/`resetValue` are NOT persisted — they're a transient pulse
 * that collapsible components watch via `useEffect` to sync their local
 * expanded state on demand (see `collapsible-thinking.tsx`, `event-group.tsx`).
 */
interface TranscriptDetailState {
  expandByDefault: boolean;
  resetSignal: number;
  resetValue: boolean;
}

interface TranscriptDetailActions {
  setExpandByDefault: (value: boolean) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

type TranscriptDetailStore = TranscriptDetailState & TranscriptDetailActions;

export const useTranscriptDetailStore = create<TranscriptDetailStore>()(
  persist(
    (set) => ({
      expandByDefault: true,
      resetSignal: 0,
      resetValue: true,

      setExpandByDefault: (value) => set(() => ({ expandByDefault: value })),
      expandAll: () =>
        set((state) => ({
          resetSignal: state.resetSignal + 1,
          resetValue: true,
        })),
      collapseAll: () =>
        set((state) => ({
          resetSignal: state.resetSignal + 1,
          resetValue: false,
        })),
    }),
    {
      name: "transcript-detail-preferences",
      storage: createJSONStorage(() => localStorage),
      partialize: (state): TranscriptDetailState => ({
        expandByDefault: state.expandByDefault,
        resetSignal: 0,
        resetValue: state.resetValue,
      }),
    },
  ),
);
