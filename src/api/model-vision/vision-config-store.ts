import type {
  Image2TextConverterConfig,
  ModelVisionOverride,
  ModelVisionOverrideMap,
} from "./types";

export const MODEL_VISION_STORAGE_KEY = "openhands-model-vision-overrides";

function isValidConverter(value: unknown): value is Image2TextConverterConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.type === "backend") {
    return typeof v.backendId === "string" && typeof v.model === "string";
  }
  if (v.type === "endpoint") {
    return (
      typeof v.url === "string" &&
      (v.apiKey === undefined || typeof v.apiKey === "string") &&
      (v.model === undefined || typeof v.model === "string")
    );
  }
  return false;
}

function isValidOverride(value: unknown): value is ModelVisionOverride {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<ModelVisionOverride>;
  if (typeof v.supportsVision !== "boolean") return false;
  if (v.converter === undefined) return true;
  return isValidConverter(v.converter);
}

export function readVisionOverrides(): ModelVisionOverrideMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MODEL_VISION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};

    const out: ModelVisionOverrideMap = {};
    for (const [modelId, entry] of Object.entries(parsed)) {
      if (modelId.length > 0 && isValidOverride(entry)) {
        out[modelId] = entry;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeVisionOverrides(map: ModelVisionOverrideMap): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(map).length === 0) {
      window.localStorage.removeItem(MODEL_VISION_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(MODEL_VISION_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / serialization errors */
  }
}

export function getModelVisionOverride(
  modelId: string,
): ModelVisionOverride | null {
  return readVisionOverrides()[modelId] ?? null;
}

export function setModelVisionOverride(
  modelId: string,
  override: ModelVisionOverride,
): void {
  const map = readVisionOverrides();
  map[modelId] = override;
  writeVisionOverrides(map);
}

export function clearModelVisionOverride(modelId: string): void {
  const map = readVisionOverrides();
  if (!(modelId in map)) return;
  delete map[modelId];
  writeVisionOverrides(map);
}
