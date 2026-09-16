// @spec ATTACH-DELIM-001 — Stable, locale-independent markers that bracket
// the attachment augmentation block embedded in outgoing user messages.
//
// The chat composer wraps the block in these markers; the event parser in
// `parse-message-from-event.ts` splits them off so the chat re-display shows
// what the user actually typed (without the augmented file list) — matching
// the `pending-user-messages.tsx` and `createChatMessage()` flow where the
// visible `text` is kept separate from the sent `content`.
//
// These markers MUST be ASCII-only so they cannot collide with any
// translated string. The previous delimiter was the localized
// CHAT_INTERFACE$AUGMENTED_PROMPT_FILES_TITLE (\"NEW FILES ADDED\" /
// \"NOVOS ARQUIVOS ADICIONADOS\" / etc.), which broke the parser whenever
// the user's UI language changed between sending and re-reading a message.
export const ATTACHMENT_BLOCK_OPEN = "\n\nATTACHMENT_BLOCK_START\n";
export const ATTACHMENT_BLOCK_CLOSE = "\nATTACHMENT_BLOCK_END\n";
