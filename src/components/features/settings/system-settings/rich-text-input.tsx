import React from "react";
import DOMPurify from "dompurify";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";

const ALLOWED_TAGS = [
  "b",
  "strong",
  "i",
  "em",
  "ul",
  "ol",
  "li",
  "a",
  "br",
  "p",
];
const ALLOWED_ATTR = ["href"];

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}

const ALLOWED_URL_SCHEMES = /^(https?:|\/|#)/i;

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  // Reject any scheme other than http(s) or a relative/hash URL. This blocks
  // javascript:, data:, vbscript:, etc. Anything without an explicit scheme
  // (e.g. "example.com", "/path", "#anchor") is treated as relative/safe.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return ALLOWED_URL_SCHEMES.test(trimmed);
  }
  return true;
}

/**
 * Walks the text nodes of `root` and returns the number of characters from
 * the start of `root` up to `node`/`offset`, used to save/restore the caret
 * position across an innerHTML rewrite.
 */
function getCaretCharacterOffset(root: HTMLElement): number | null {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let charCount = 0;
  let node = walker.nextNode();
  while (node) {
    if (node === range.startContainer) {
      return charCount + range.startOffset;
    }
    charCount += node.textContent?.length ?? 0;
    node = walker.nextNode();
  }
  return null;
}

/**
 * Restores a caret position previously captured by
 * `getCaretCharacterOffset`. If the target offset can't be found (e.g. the
 * sanitizer removed the content the caret was in), the caret falls back to
 * the end of the editor's content — a deliberate, documented trade-off:
 * losing exact caret position in that edge case is preferable to leaving
 * unsanitized HTML in the DOM.
 */
function setCaretCharacterOffset(root: HTMLElement, offset: number): void {
  const selection = window.getSelection?.();
  if (!selection) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode();
  let lastTextNode: Text | null = null;
  while (node) {
    const text = node as Text;
    lastTextNode = text;
    const length = text.textContent?.length ?? 0;
    if (remaining <= length) {
      const range = document.createRange();
      range.setStart(text, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= length;
    node = walker.nextNode();
  }

  // Fall back to the end of the last text node, or the end of root itself.
  const range = document.createRange();
  if (lastTextNode) {
    range.setStart(lastTextNode, lastTextNode.textContent?.length ?? 0);
  } else {
    range.selectNodeContents(root);
  }
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Sanitizes `root`'s current innerHTML and, if sanitization changed it,
 * rewrites the real DOM node with the sanitized value — never leaving
 * unsanitized HTML (e.g. an <img onerror>, a <script>, or a javascript:
 * href pasted or inserted via execCommand) live in the contentEditable DOM,
 * even momentarily. Caret position is preserved on a best-effort basis via
 * a character-offset save/restore; if sanitization removed the exact spot
 * the caret was in, it falls back to the end of the content.
 */
function sanitizeDomInPlace(root: HTMLElement): string {
  const rawHtml = root.innerHTML;
  const sanitizedHtml = sanitize(rawHtml);
  if (sanitizedHtml !== rawHtml) {
    const caretOffset = getCaretCharacterOffset(root);
    // eslint-disable-next-line no-param-reassign
    root.innerHTML = sanitizedHtml;
    if (caretOffset !== null) {
      setCaretCharacterOffset(root, caretOffset);
    }
  }
  return sanitizedHtml;
}

export interface RichTextInputProps {
  testId: string;
  label: string;
  defaultValueHtml: string;
  onChange: (html: string) => void;
}

export function RichTextInput({
  testId,
  label,
  defaultValueHtml,
  onChange,
}: RichTextInputProps) {
  const { t } = useTranslation("openhands");
  const editorRef = React.useRef<HTMLDivElement>(null);
  const lastExternalValueRef = React.useRef<string | null>(null);
  const [isLinkInputOpen, setIsLinkInputOpen] = React.useState(false);
  const [linkUrl, setLinkUrl] = React.useState("");

  // Sets the editor's initial content on mount only. dangerouslySetInnerHTML
  // is never used in the render output — this is the single point where
  // raw-ish html (already sanitized) is written into the DOM, via a ref
  // callback rather than a JSX prop, so React never re-applies it on
  // unrelated re-renders (which would clobber the user's cursor / in-progress
  // typing).
  const setEditorRef = React.useCallback((node: HTMLDivElement | null) => {
    editorRef.current = node;
    if (node && lastExternalValueRef.current === null) {
      lastExternalValueRef.current = defaultValueHtml;
      // eslint-disable-next-line no-param-reassign
      node.innerHTML = sanitize(defaultValueHtml);
    }
  }, []);

  // Only resync innerHTML when defaultValueHtml changes from an external
  // source (e.g. a form reset). This avoids clobbering the user's cursor
  // position / in-progress typing on unrelated re-renders where
  // defaultValueHtml stays the same.
  React.useEffect(() => {
    if (defaultValueHtml === lastExternalValueRef.current) {
      return;
    }
    lastExternalValueRef.current = defaultValueHtml;
    if (editorRef.current) {
      editorRef.current.innerHTML = sanitize(defaultValueHtml);
    }
  }, [defaultValueHtml]);

  const handleInput = (event: React.FormEvent<HTMLDivElement>) => {
    // Rewrite the real DOM node with the sanitized html (not just the
    // string handed to onChange) so that content the browser already
    // inserted outside React's control (e.g. a pasted <img onerror=...>)
    // never survives in the live contentEditable DOM, even momentarily.
    const sanitizedHtml = sanitizeDomInPlace(event.currentTarget);
    onChange(sanitizedHtml);
  };

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    if (editorRef.current) {
      const sanitizedHtml = sanitizeDomInPlace(editorRef.current);
      onChange(sanitizedHtml);
    }
  };

  const handleBold = () => exec("bold");
  const handleItalic = () => exec("italic");
  const handleList = () => exec("insertUnorderedList");

  const handleOpenLinkInput = () => {
    setIsLinkInputOpen(true);
  };

  const handleConfirmLink = () => {
    const trimmedUrl = linkUrl.trim();
    // Reject dangerous schemes (javascript:, data:, vbscript:, ...) before
    // ever calling execCommand("createLink", ...) — this is a first line of
    // defense on top of the DOM rewrite in exec()/sanitizeDomInPlace, which
    // also strips a disallowed href (ALLOWED_ATTR only allows "href", but
    // DOMPurify itself rejects javascript: URLs in href values).
    if (isSafeUrl(trimmedUrl)) {
      exec("createLink", trimmedUrl);
    }
    setIsLinkInputOpen(false);
    setLinkUrl("");
  };

  const handleCancelLink = () => {
    setIsLinkInputOpen(false);
    setLinkUrl("");
  };

  return (
    <div data-testid={testId}>
      <div className="flex items-center gap-1 mb-1">
        <button
          type="button"
          data-testid={`${testId}-bold`}
          aria-label={t(I18nKey.RICH_TEXT_INPUT$BOLD)}
          onClick={handleBold}
        >
          B
        </button>
        <button
          type="button"
          data-testid={`${testId}-italic`}
          aria-label={t(I18nKey.RICH_TEXT_INPUT$ITALIC)}
          onClick={handleItalic}
        >
          I
        </button>
        <button
          type="button"
          data-testid={`${testId}-list`}
          aria-label={t(I18nKey.RICH_TEXT_INPUT$LIST)}
          onClick={handleList}
        >
          •
        </button>
        <button
          type="button"
          data-testid={`${testId}-link`}
          aria-label={t(I18nKey.RICH_TEXT_INPUT$LINK)}
          onClick={handleOpenLinkInput}
        >
          {t(I18nKey.RICH_TEXT_INPUT$LINK)}
        </button>
      </div>
      {isLinkInputOpen && (
        <div className="flex items-center gap-1 mb-1">
          <input
            type="text"
            data-testid={`${testId}-link-url-input`}
            aria-label={t(I18nKey.RICH_TEXT_INPUT$LINK_URL)}
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
          />
          <button
            type="button"
            data-testid={`${testId}-link-confirm`}
            onClick={handleConfirmLink}
          >
            {t(I18nKey.RICH_TEXT_INPUT$LINK_CONFIRM)}
          </button>
          <button
            type="button"
            data-testid={`${testId}-link-cancel`}
            onClick={handleCancelLink}
          >
            {t(I18nKey.RICH_TEXT_INPUT$LINK_CANCEL)}
          </button>
        </div>
      )}
      <div
        ref={setEditorRef}
        contentEditable
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        data-testid={`${testId}-editor`}
        onInput={handleInput}
      />
    </div>
  );
}
