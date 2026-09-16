import { MessageEvent } from "#/types/agent-server/core";
import { ATTACHMENT_BLOCK_OPEN } from "#/utils/attachment-prompt";

export const parseMessageFromEvent = (event: MessageEvent): string => {
  const message = event.llm_message;

  // Safety check: ensure llm_message exists and has content
  if (!message?.content) {
    return "";
  }

  // Get the text content from the message
  let textContent = "";
  if (message.content) {
    if (Array.isArray(message.content)) {
      // Handle array of content blocks
      textContent = message.content
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("\n");
    } else if (typeof message.content === "string") {
      // Handle string content
      textContent = message.content;
    }
  }

  // @spec ATTACH-DELIM-001 — Strip the augmented attachment block off so the
  // chat re-display matches the text the user originally typed. The marker
  // is locale-independent so this works regardless of any UI language
  // change between sending and re-reading.
  //
  // Also keep the historical fallback that split on the localized title so
  // messages stored before the marker change still re-display cleanly.
  const openIdx = textContent.indexOf(ATTACHMENT_BLOCK_OPEN);
  if (openIdx !== -1) {
    return textContent.slice(0, openIdx);
  }

  // Check if there are image_urls in the message content
  const hasImages =
    Array.isArray(message.content) &&
    message.content.some((content) => content.type === "image");

  if (!hasImages) {
    return textContent;
  }

  return textContent;
};
