import i18n, { OPENHANDS_I18N_NAMESPACE, waitForI18n } from "#/i18n";
import { consumePendingTaskAttachments } from "#/stores/pending-task-attachments-store";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { sendMessageWithAttachments } from "#/utils/send-message-with-attachments";
import type { Backend } from "#/api/backend-registry/types";

/**
 * Sends attachments queued during cloud start-task provisioning once the
 * real conversation UUID is available.
 */
export async function flushPendingTaskAttachments(
  taskId: string,
  conversationId: string,
  options?: {
    /** Active model id (`provider/model`), used to resolve vision support. */
    modelId?: string | null;
    /** Registered backends, used to resolve a "backend" image2text converter. */
    backends?: Backend[];
  },
): Promise<void> {
  const pending = consumePendingTaskAttachments(taskId);
  if (!pending) {
    return;
  }

  try {
    await waitForI18n();
    await sendMessageWithAttachments({
      conversationId,
      content: pending.content,
      images: pending.images,
      files: pending.files,
      imagesMarkedUploadAsFile: pending.imagesMarkedUploadAsFile,
      t: i18n.getFixedT(null, OPENHANDS_I18N_NAMESPACE),
      modelId: options?.modelId,
      backends: options?.backends,
    });
  } catch (error) {
    displayErrorToast(error instanceof Error ? error.message : null);
    throw error;
  }
}
