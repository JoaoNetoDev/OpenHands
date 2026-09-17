import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendMessageWithAttachments } from "#/utils/send-message-with-attachments";

const uploadFilesToConversation = vi.fn();
const resolveConversationRuntime = vi.fn();
const sendMessage = vi.fn();
const displayErrorToast = vi.fn();
const convertImageToBase64 = vi.fn(async (image: File) =>
  `data:${image.type};base64,xxx`,
);
const validateFiles = vi.fn(() => ({ isValid: true }) as never);

vi.mock("#/api/conversation-file-upload.api", () => ({
  uploadFilesToConversation: (...args: unknown[]) =>
    uploadFilesToConversation(...args),
  resolveConversationRuntime: (...args: unknown[]) =>
    resolveConversationRuntime(...args),
}));

vi.mock(
  "#/api/conversation-service/agent-server-conversation-service.api",
  () => ({
    default: { sendMessage: (...args: unknown[]) => sendMessage(...args) },
  }),
);

vi.mock("#/utils/convert-image-to-base-64", () => ({
  convertImageToBase64: (image: File) => convertImageToBase64(image),
}));

vi.mock("#/utils/file-validation", () => ({
  validateFiles: (...args: unknown[]) =>
    (validateFiles as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("#/components/features/chat/utils/chat-input.utils", () => ({
  partitionImagesForUpload: (images: File[]) => ({
    imagesToEmbed: images,
    imagesAsFiles: [],
  }),
}));

vi.mock("#/api/model-vision/resolve-vision-support", () => ({
  resolveVisionSupport: () => ({ supportsVision: true, converter: null }),
}));

vi.mock("#/utils/custom-toast-handlers", () => ({
  displayErrorToast: (...args: unknown[]) => displayErrorToast(...args),
}));

const fixedT = ((key: string) => key) as unknown as Parameters<
  typeof sendMessageWithAttachments
>[0]["t"];

describe("sendMessageWithAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveConversationRuntime.mockResolvedValue({
      conversationUrl: null,
      sessionApiKey: null,
    });
    sendMessage.mockResolvedValue(undefined);
  });

  function makeFile(name: string) {
    return new File(["content"], name, { type: "application/zip" });
  }

  // @spec ATTACH-FAIL-001 — When the user attached files and none of them
  // land in the workspace, sendMessageWithAttachments must throw so the home
  // chat launcher's try/catch can surface a consolidated toast. Pre-fix the
  // function silently returned with empty uploaded_files, leaving the user
  // thinking their zip was delivered.
  it("throws when all attached file uploads fail (ATTACH-FAIL-001)", async () => {
    uploadFilesToConversation.mockResolvedValue({
      uploaded_files: [],
      skipped_files: [
        { name: "claude-skills-2026-09-15.zip", reason: "network down" },
      ],
    });

    let caught: unknown;
    try {
      await sendMessageWithAttachments({
        conversationId: "conv-1",
        content: "Extraia deste zip a skill do Airtu",
        images: [],
        files: [makeFile("claude-skills-2026-09-15.zip")],
        imagesMarkedUploadAsFile: [],
        t: fixedT,
      });
    } catch (error) {
      caught = error;
    }

    // The throw carries the consolidated i18n key so the home-chat-launcher
    // caller's catch block can re-toast with displayErrorToast.
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      "CHAT_INTERFACE$ATTACHMENTS_UPLOAD_FAILED_ABORT",
    );
    // The per-file skip reason still surfaces as its own toast (pre-existing
    // behavior preserved so the user sees WHICH file failed).
    expect(displayErrorToast).toHaveBeenCalledWith("network down");
    // The downstream send must NOT be called — aborting means the LLM
    // never sees a message that pretends the attachment succeeded.
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("proceeds normally when at least one attached file uploads", async () => {
    uploadFilesToConversation.mockResolvedValue({
      uploaded_files: [
        "/home/openhands/workspace/project/abc123/notes.md",
      ],
      skipped_files: [],
    });

    const result = await sendMessageWithAttachments({
      conversationId: "conv-1",
      content: "look at this",
      images: [],
      files: [makeFile("notes.md")],
      imagesMarkedUploadAsFile: [],
      t: fixedT,
    });

    expect(result.fileUrls).toEqual([
      "/home/openhands/workspace/project/abc123/notes.md",
    ]);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("throws the validator's attachment error before resolving a runtime", async () => {
    validateFiles.mockReturnValueOnce({
      isValid: false,
      errorMessage: "Attachment is too large",
    } as never);
    await expect(
      sendMessageWithAttachments({
        conversationId: "conv-1",
        content: "look at this",
        images: [],
        files: [makeFile("notes.md")],
        imagesMarkedUploadAsFile: [],
        t: fixedT,
      }),
    ).rejects.toThrow("Attachment is too large");
    expect(resolveConversationRuntime).not.toHaveBeenCalled();
  });
});
