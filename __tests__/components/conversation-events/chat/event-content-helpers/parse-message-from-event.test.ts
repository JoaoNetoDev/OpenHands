import { describe, expect, it } from "vitest";
import { parseMessageFromEvent } from "#/components/conversation-events/chat/event-content-helpers/parse-message-from-event";
import {
  ATTACHMENT_BLOCK_OPEN,
  ATTACHMENT_BLOCK_CLOSE,
} from "#/utils/attachment-prompt";
import type { MessageEvent } from "#/types/agent-server/core";

function makeStringEvent(text: string): MessageEvent {
  return {
    llm_message: { content: text, role: "user" },
  } as unknown as MessageEvent;
}

function makeArrayEvent(blocks: Array<{ type: string; text?: string }>): MessageEvent {
  return {
    llm_message: { content: blocks, role: "user" },
  } as unknown as MessageEvent;
}

describe("parseMessageFromEvent (ATTACH-DELIM-001)", () => {
  it("returns plain text when no augmentation is present", () => {
    const text = "Just a normal user message with no attachments";
    expect(parseMessageFromEvent(makeStringEvent(text))).toBe(text);
  });

  it("strips the augmented attachment block delimited by ATTACHMENT_BLOCK_OPEN", () => {
    const userText = "Extraia deste zip a skill do Airtu";
    const attachmentBlock =
      `${ATTACHMENT_BLOCK_OPEN}` +
      `NOVOS ARQUIVOS ADICIONADOS: ` +
      `/home/openhands/workspace/project/abc/claude-skills-2026-09-15.zip` +
      `${ATTACHMENT_BLOCK_CLOSE}`;
    const full = `${userText}${attachmentBlock}`;
    expect(parseMessageFromEvent(makeStringEvent(full))).toBe(userText);
  });

  it("strips the augmented block regardless of the UI language used to write it", () => {
    // Pre-fix, the parser split on the localized CHAT_INTERFACE$AUGMENTED_PROMPT_FILES_TITLE
    // (e.g. "NEW FILES ADDED" in English, "NOVOS ARQUIVOS ADICIONADOS" in Portuguese).
    // When the UI language changed between sending and re-reading, the split
    // failed and the augmented block leaked into the chat re-display. With the
    // new ASCII marker that is no longer possible — the same parse below
    // would have failed pre-fix because the message was sent under pt-BR.
    const userText = "look at this zip please";
    const attachmentBlock =
      `${ATTACHMENT_BLOCK_OPEN}` +
      "NOVOS ARQUIVOS ADICIONADOS: " +
      "/home/openhands/workspace/project/abc/notes.md" +
      `${ATTACHMENT_BLOCK_CLOSE}`;
    expect(parseMessageFromEvent(makeStringEvent(`${userText}${attachmentBlock}`))).toBe(
      userText,
    );
  });

  it("handles array content (joined text blocks) with the augmented block at the end", () => {
    const userText = "extract from the attachment";
    const event = makeArrayEvent([
      { type: "text", text: userText },
      { type: "image" },
      {
        type: "text",
        text: `${ATTACHMENT_BLOCK_OPEN}NEW FILES ADDED: /path/to/x.zip${ATTACHMENT_BLOCK_CLOSE}`,
      },
    ]);
    // Array content gets joined with "\n" between text blocks, so the
    // re-display keeps the newline that sat between the user's text and
    // the marker block — pre-fix this same text leaked the full
    // augmentation block into the bubble.
    expect(parseMessageFromEvent(event)).toBe(`${userText}\n`);
  });

  it("returns empty string when llm_message is missing", () => {
    expect(parseMessageFromEvent({} as MessageEvent)).toBe("");
  });

  it("preserves trailing whitespace before the open marker", () => {
    // Edge case: the user typed a trailing newline before the augmentation
    // block was appended. We must preserve user content character-for-character.
    const userText = "user text  \n\n";
    const full =
      userText +
      `${ATTACHMENT_BLOCK_OPEN}NEW FILES ADDED: /a.zip${ATTACHMENT_BLOCK_CLOSE}`;
    expect(parseMessageFromEvent(makeStringEvent(full))).toBe(userText);
  });
});
