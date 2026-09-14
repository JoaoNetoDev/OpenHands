/* eslint-disable i18next/no-literal-string -- test fixture labels, not user-facing production strings */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RichTextInput } from "./rich-text-input";

function getEditor() {
  return screen.getByRole("textbox");
}

describe("RichTextInput", () => {
  it("renders the sanitized default value inside a contentEditable textbox", () => {
    render(
      <RichTextInput
        testId="rich-text"
        label="Contexto"
        defaultValueHtml="<p>oi</p>"
        onChange={vi.fn()}
      />,
    );

    const editor = getEditor();
    expect(editor).toHaveAttribute("contenteditable", "true");
    expect(editor).toHaveAttribute("aria-label", "Contexto");
    expect(editor.innerHTML).toContain("oi");
  });

  it("renders a toolbar with 4 formatting buttons plus a link flow (no window.prompt)", () => {
    const promptSpy = vi.spyOn(window, "prompt");
    render(
      <RichTextInput
        testId="rich-text"
        label="Contexto"
        defaultValueHtml=""
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("rich-text-bold")).toBeInTheDocument();
    expect(screen.getByTestId("rich-text-italic")).toBeInTheDocument();
    expect(screen.getByTestId("rich-text-list")).toBeInTheDocument();
    expect(screen.getByTestId("rich-text-link")).toBeInTheDocument();
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it("sanitizes onInput html before calling onChange", () => {
    const onChange = vi.fn();
    render(
      <RichTextInput
        testId="rich-text"
        label="Contexto"
        defaultValueHtml=""
        onChange={onChange}
      />,
    );

    const editor = getEditor();
    editor.innerHTML =
      '<b>bold</b><script>alert(1)</script><img src="x" onerror="alert(1)" />';
    const inputEvent = new Event("input", { bubbles: true });
    Object.defineProperty(inputEvent, "currentTarget", {
      value: editor,
      enumerable: true,
    });
    editor.dispatchEvent(inputEvent);

    expect(onChange).toHaveBeenCalled();
    const sanitized = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("onerror");
    expect(sanitized).toContain("<b>bold</b>");
  });

  it("sanitizes a paste event with malicious html before it reaches onChange", () => {
    const onChange = vi.fn();
    render(
      <RichTextInput
        testId="rich-text"
        label="Contexto"
        defaultValueHtml=""
        onChange={onChange}
      />,
    );

    const editor = getEditor();
    const maliciousHtml =
      '<b>ok</b><script>alert(1)</script><img src="x" onerror="alert(1)" /><a href="javascript:alert(1)">click</a>';

    const pasteEvent = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as unknown as ClipboardEvent;
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        getData: () => maliciousHtml,
      },
    });
    editor.dispatchEvent(pasteEvent);

    // Simulate the browser inserting the pasted html into the editor, which
    // then triggers the input handler used to sanitize/propagate the value.
    editor.innerHTML = maliciousHtml;
    const inputEvent = new Event("input", { bubbles: true });
    Object.defineProperty(inputEvent, "currentTarget", {
      value: editor,
      enumerable: true,
    });
    editor.dispatchEvent(inputEvent);

    expect(onChange).toHaveBeenCalled();
    const sanitized = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("onerror");
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).toContain("<b>ok</b>");
  });

  it("preserves allowlisted tags (b, i, ul, a href) through sanitization", () => {
    const onChange = vi.fn();
    render(
      <RichTextInput
        testId="rich-text"
        label="Contexto"
        defaultValueHtml=""
        onChange={onChange}
      />,
    );

    const editor = getEditor();
    editor.innerHTML =
      '<b>bold</b><i>italic</i><ul><li>item</li></ul><a href="https://example.com">link</a>';
    const inputEvent = new Event("input", { bubbles: true });
    Object.defineProperty(inputEvent, "currentTarget", {
      value: editor,
      enumerable: true,
    });
    editor.dispatchEvent(inputEvent);

    const sanitized = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(sanitized).toContain("<b>bold</b>");
    expect(sanitized).toContain("<i>italic</i>");
    expect(sanitized).toContain("<ul>");
    expect(sanitized).toContain("<li>item</li>");
    expect(sanitized).toContain('<a href="https://example.com">link</a>');
  });

  it("does not reset the cursor/content while typing when defaultValueHtml is unchanged across re-renders", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextInput
        testId="rich-text"
        label="Contexto"
        defaultValueHtml="<p>inicial</p>"
        onChange={onChange}
      />,
    );

    const editor = getEditor();
    // Simulate user typing beyond the external default value.
    editor.innerHTML = "<p>inicial digitando mais</p>";

    // Re-render with the *same* defaultValueHtml prop (parent re-render,
    // e.g. unrelated state change) should not overwrite what the user typed.
    rerender(
      <RichTextInput
        testId="rich-text"
        label="Contexto"
        defaultValueHtml="<p>inicial</p>"
        onChange={onChange}
      />,
    );

    expect(editor.innerHTML).toContain("inicial digitando mais");
  });

  it("resyncs innerHTML when defaultValueHtml changes from an external source", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextInput
        testId="rich-text"
        label="Contexto"
        defaultValueHtml="<p>um</p>"
        onChange={onChange}
      />,
    );

    const editor = getEditor();
    expect(editor.innerHTML).toContain("um");

    rerender(
      <RichTextInput
        testId="rich-text"
        label="Contexto"
        defaultValueHtml="<p>dois</p>"
        onChange={onChange}
      />,
    );

    expect(editor.innerHTML).toContain("dois");
    expect(editor.innerHTML).not.toContain("um<");
  });

  it("rewrites the real DOM (not just the onChange string) after a malicious paste, so onerror never lives in the live contentEditable node", () => {
    const onChange = vi.fn();
    render(
      <RichTextInput
        testId="rich-text"
        label="Contexto"
        defaultValueHtml=""
        onChange={onChange}
      />,
    );

    const editor = getEditor();
    // Simulate the browser inserting pasted malicious html directly into the
    // live DOM (outside of React's control), then firing the input event.
    editor.innerHTML =
      '<b>ok</b><script>alert(1)</script><img src="x" onerror="alert(1)" />';
    const inputEvent = new Event("input", { bubbles: true });
    Object.defineProperty(inputEvent, "currentTarget", {
      value: editor,
      enumerable: true,
    });
    editor.dispatchEvent(inputEvent);

    // Assert against the actual live DOM node, not just the onChange value.
    expect(editor.innerHTML).not.toContain("<script");
    expect(editor.innerHTML).not.toContain("onerror");
    expect(editor.querySelector("img")).toBeNull();
    expect(editor.innerHTML).toContain("<b>ok</b>");
  });

  it("never creates a javascript: href in the real DOM via the link flow", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RichTextInput
        testId="rich-text"
        label="Contexto"
        defaultValueHtml=""
        onChange={onChange}
      />,
    );

    const editor = getEditor();
    editor.focus();

    await user.click(screen.getByTestId("rich-text-link"));
    const urlInput = screen.getByTestId("rich-text-link-url-input");
    await user.type(urlInput, "javascript:alert(1)");
    await user.click(screen.getByTestId("rich-text-link-confirm"));

    // Assert against the actual live DOM node.
    expect(editor.innerHTML).not.toContain("javascript:");
    const anchor = editor.querySelector("a");
    if (anchor) {
      expect(anchor.getAttribute("href")).not.toMatch(/javascript:/i);
    }
  });

  it("shows an inline URL input for the link flow instead of window.prompt", async () => {
    const user = userEvent.setup();
    render(
      <RichTextInput
        testId="rich-text"
        label="Contexto"
        defaultValueHtml=""
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("rich-text-link"));

    expect(screen.getByTestId("rich-text-link-url-input")).toBeInTheDocument();
  });
});
