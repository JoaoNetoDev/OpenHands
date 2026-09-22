import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { BtwMessages } from "#/components/features/chat/btw-messages";
import { I18nKey } from "#/i18n/declaration";
import { useBtwStore } from "#/stores/btw-store";

const CONV = "conv-1";
const entriesFor = (c: string) =>
  useBtwStore.getState().entriesByConversation[c] ?? [];

describe("<BtwMessages />", () => {
  beforeEach(() => {
    useBtwStore.setState({ entriesByConversation: {} });
  });

  it("renders spinner and no Got it button while pending", () => {
    useBtwStore.getState().addPending(CONV, "why?");
    render(<BtwMessages conversationId={CONV} />);
    expect(screen.getByText("why?")).toBeInTheDocument();
    expect(screen.getByTestId("btw-spinner")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: I18nKey.CHAT_INTERFACE$BTW_GOT_IT,
      }),
    ).toBeNull();
  });

  it("renders the response and a Got it button that dismisses on click", async () => {
    const id = useBtwStore.getState().addPending(CONV, "why?");
    useBtwStore.getState().resolve(CONV, id, "because");
    const user = userEvent.setup();
    render(<BtwMessages conversationId={CONV} />);
    expect(screen.getByText(/because/i)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: I18nKey.CHAT_INTERFACE$BTW_GOT_IT,
      }),
    );
    expect(entriesFor(CONV)).toEqual([]);
  });

  it("does not render entries from other conversations", () => {
    useBtwStore.getState().addPending("other-conv", "not mine");
    const { container } = render(<BtwMessages conversationId={CONV} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders BTW prefix and pending details through translation keys", async () => {
    useBtwStore.getState().addPending(CONV, "why?");
    const user = userEvent.setup();
    render(<BtwMessages conversationId={CONV} />);
    expect(
      screen.getByText(I18nKey.CHAT_INTERFACE$BTW_PREFIX),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /expand/i }));
    expect(
      screen.getByText(I18nKey.CHAT_INTERFACE$BTW_WAITING_FOR_ANSWER),
    ).toBeInTheDocument();
  });

  it("does not render the pending-state translation key once the entry has resolved", () => {
    const id = useBtwStore.getState().addPending(CONV, "why?");
    useBtwStore.getState().resolve(CONV, id, "because");
    render(<BtwMessages conversationId={CONV} />);
    expect(
      screen.queryByText(I18nKey.CHAT_INTERFACE$BTW_WAITING_FOR_ANSWER),
    ).toBeNull();
  });

  it("caps its own height and scrolls internally so long responses don't push the textarea off-screen", () => {
    // Regression for "Perguntas em 'btw' não exibem scroll e escondem o
    // textarea": the container used to grow unbounded, and since it sits in a
    // `shrink-0` parent in chat-interface.tsx right above the
    // `InteractiveChatBox` composer, a long /btw response (markdown table,
    // code block, etc.) pushed the textarea below the visible viewport with
    // no internal scrollbar. The component must now size itself independently
    // and scroll its content.
    const id = useBtwStore.getState().addPending(CONV, "list the inserts?");
    useBtwStore
      .getState()
      .resolve(
        CONV,
        id,
        "1. Backfill direto em `admin_light_utilities`\n2. Migração multi-tenant",
      );
    render(<BtwMessages conversationId={CONV} />);
    const container = screen.getByTestId("btw-messages");
    expect(container).toHaveClass("overflow-y-auto");
    expect(container.className).toMatch(/max-h-/);
  });
});
