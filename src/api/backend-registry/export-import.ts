import type { Backend } from "./types";

const EXPORT_FILE_KIND = "openhands-backends-export";
const EXPORT_FILE_VERSION = 1;

interface ExportedBackendsFile {
  kind: typeof EXPORT_FILE_KIND;
  version: typeof EXPORT_FILE_VERSION;
  exportedAt: string;
  backends: Backend[];
}

/**
 * Triggers a browser download of the given backends as a JSON file.
 * Includes API keys in plaintext — same sensitivity as the browser's
 * localStorage they already live in, so this is meant to be handled like any
 * other credentials file (moved over a private channel, not posted publicly).
 */
export function downloadBackendsFile(backends: Backend[]): void {
  const payload: ExportedBackendsFile = {
    kind: EXPORT_FILE_KIND,
    version: EXPORT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    backends,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `openhands-backends-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function isImportableBackend(value: unknown): value is Backend {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<Backend>;
  return (
    typeof v.name === "string" &&
    typeof v.host === "string" &&
    typeof v.apiKey === "string" &&
    (v.kind === "local" || v.kind === "cloud")
  );
}

/**
 * Parses a previously-exported backends file. Accepts both the wrapped
 * export format and a bare array, so a hand-edited or vault-restored list
 * also works.
 */
export async function parseBackendsFile(file: File): Promise<Backend[]> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("File isn't valid JSON.");
  }

  const candidateList = Array.isArray(parsed)
    ? parsed
    : (parsed as Partial<ExportedBackendsFile>)?.backends;

  if (!Array.isArray(candidateList)) {
    throw new Error("File doesn't contain a backends list.");
  }

  const valid = candidateList.filter(isImportableBackend);
  if (valid.length === 0) {
    throw new Error("No valid backend entries found in file.");
  }
  return valid;
}
