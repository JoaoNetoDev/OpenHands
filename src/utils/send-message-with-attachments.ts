import type { TFunction } from "i18next";
import {
  resolveConversationRuntime,
  uploadFilesToConversation,
} from "#/api/conversation-file-upload.api";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import type { SendMessageRequest } from "#/api/conversation-service/agent-server-conversation-service.types";
import type { Backend } from "#/api/backend-registry/types";
import { convertImageToBase64 } from "#/utils/convert-image-to-base-64";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { partitionImagesForUpload } from "#/components/features/chat/utils/chat-input.utils";
import { validateFiles } from "#/utils/file-validation";
import { I18nKey } from "#/i18n/declaration";
import { resolveVisionSupport } from "#/api/model-vision/resolve-vision-support";
import { convertImagesToText } from "#/api/model-vision/image2text";

export interface SendMessageWithAttachmentsResult {
  text: string;
  content: string;
  imageUrls: string[];
  fileUrls: string[];
  timestamp: string;
}

export async function sendMessageWithAttachments(options: {
  conversationId: string;
  content: string;
  images: File[];
  files: File[];
  imagesMarkedUploadAsFile: string[];
  t: TFunction;
  /** Active model id (`provider/model`), used to resolve vision support. */
  modelId?: string | null;
  /** Registered backends, used to resolve a "backend" image2text converter. */
  backends?: Backend[];
}): Promise<SendMessageWithAttachmentsResult> {
  const {
    conversationId,
    content,
    images,
    files,
    imagesMarkedUploadAsFile,
    t,
    modelId = null,
    backends = [],
  } = options;

  const { imagesToEmbed, imagesAsFiles } = partitionImagesForUpload(
    images,
    imagesMarkedUploadAsFile,
  );
  const filesToUpload = [...files, ...imagesAsFiles];

  const validation = validateFiles([...imagesToEmbed, ...filesToUpload]);
  if (!validation.isValid) {
    throw new Error(validation.errorMessage ?? "Invalid attachments");
  }

  const rawImageUrls = await Promise.all(
    imagesToEmbed.map((image) => convertImageToBase64(image)),
  );

  // See chat-interface.tsx's handleSendMessage for the rationale: when the
  // active model has no vision support and a converter is configured for
  // it, describe images as text instead of sending an `image` content block.
  let imageUrls = rawImageUrls;
  let visionFallbackText = "";
  if (rawImageUrls.length > 0) {
    const { supportsVision, converter } = resolveVisionSupport(modelId);
    if (!supportsVision && converter) {
      try {
        visionFallbackText = await convertImagesToText(
          rawImageUrls,
          converter,
          backends,
        );
        imageUrls = [];
      } catch (error) {
        displayErrorToast(
          error instanceof Error
            ? error.message
            : t(I18nKey.CHAT_INTERFACE$IMAGE2TEXT_FAILED),
        );
      }
    }
  }

  const runtime = await resolveConversationRuntime(conversationId);

  const { skipped_files: skippedFiles, uploaded_files: uploadedFiles } =
    filesToUpload.length > 0
      ? await uploadFilesToConversation(conversationId, filesToUpload)
      : { skipped_files: [], uploaded_files: [] };

  skippedFiles.forEach((file) => displayErrorToast(file.reason));

  // @spec ATTACH-FAIL-001 — Abort the send when the user attached files and
  // none of them landed in the workspace. Without this, the message goes out
  // with no file references, the LLM has no idea attachments were intended,
  // and the home-chat-launcher caller swallows the empty result silently.
  // The caller already wraps this in try/catch and re-toasts on throw, so a
  // thrown Error is the right channel.
  if (filesToUpload.length > 0 && uploadedFiles.length === 0) {
    throw new Error(t(I18nKey.CHAT_INTERFACE$ATTACHMENTS_UPLOAD_FAILED_ABORT));
  }

  const filePrompt = `${t(I18nKey.CHAT_INTERFACE$AUGMENTED_PROMPT_FILES_TITLE)}: ${uploadedFiles.join("\n\n")}`;
  let prompt = content;
  if (visionFallbackText) {
    prompt = `${prompt}\n\n${t(I18nKey.CHAT_INTERFACE$AUGMENTED_PROMPT_IMAGES_TITLE)}:\n${visionFallbackText}`;
  }
  if (uploadedFiles.length > 0) {
    prompt = `${prompt}\n\n${filePrompt}`;
  }

  const timestamp = new Date().toISOString();

  const messageContent: SendMessageRequest = {
    role: "user",
    content: [{ type: "text", text: prompt }],
  };

  if (imageUrls.length > 0) {
    messageContent.content.push({
      type: "image",
      image_urls: imageUrls,
    });
  }

  await AgentServerConversationService.sendMessage(
    conversationId,
    messageContent,
    runtime,
  );

  return {
    text: content,
    content: prompt,
    imageUrls,
    fileUrls: uploadedFiles,
    timestamp,
  };
}
