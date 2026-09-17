import { isFileImage } from "#/utils/is-file-image";

/** Per-file cap for non-image attachments (documents, archives, data). */
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
/**
 * Images get a lower cap than other files: unless the user marks them
 * "upload as file", they are base64-encoded into the message content sent to
 * the LLM, which inflates the payload by ~4/3 and eats the model's context.
 * Regular files are streamed to the workspace upload endpoint instead.
 */
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25MB maximum total size for all files combined

const limitFor = (file: File): number =>
  isFileImage(file) ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;

const toMegabytes = (bytes: number): string =>
  `${Math.round(bytes / (1024 * 1024))}MB`;

export interface FileValidationResult {
  isValid: boolean;
  errorMessage?: string;
  oversizedFiles?: string[];
}

/**
 * Validates individual file sizes
 */
export function validateIndividualFileSizes(
  files: File[],
): FileValidationResult {
  const oversizedFiles = files.filter((file) => file.size > limitFor(file));

  if (oversizedFiles.length > 0) {
    const details = oversizedFiles
      .map((f) => `${f.name} (${toMegabytes(limitFor(f))} max)`)
      .join(", ");
    return {
      isValid: false,
      errorMessage: `Files exceeding the size limit are not allowed: ${details}`,
      oversizedFiles: oversizedFiles.map((f) => f.name),
    };
  }

  return { isValid: true };
}

/**
 * Validates total file size including existing files
 */
export function validateTotalFileSize(
  newFiles: File[],
  existingFiles: File[] = [],
): FileValidationResult {
  const currentTotalSize = existingFiles.reduce(
    (sum, file) => sum + file.size,
    0,
  );
  const newFilesSize = newFiles.reduce((sum, file) => sum + file.size, 0);
  const totalSize = currentTotalSize + newFilesSize;

  if (totalSize > MAX_TOTAL_SIZE) {
    const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(1);
    return {
      isValid: false,
      errorMessage: `Total file size would be ${totalSizeMB}MB, exceeding the ${toMegabytes(
        MAX_TOTAL_SIZE,
      )} limit. Please select fewer or smaller files.`,
    };
  }

  return { isValid: true };
}

/**
 * Validates both individual and total file sizes
 */
export function validateFiles(
  newFiles: File[],
  existingFiles: File[] = [],
): FileValidationResult {
  // First check individual file sizes
  const individualValidation = validateIndividualFileSizes(newFiles);
  if (!individualValidation.isValid) {
    return individualValidation;
  }

  // Then check total size
  return validateTotalFileSize(newFiles, existingFiles);
}
