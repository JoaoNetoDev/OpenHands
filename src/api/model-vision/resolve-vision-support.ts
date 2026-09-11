import { defaultModelSupportsVision } from "./default-vision-models";
import { getModelVisionOverride } from "./vision-config-store";
import type { Image2TextConverterConfig } from "./types";

export interface VisionResolution {
  supportsVision: boolean;
  /** Only ever set when `supportsVision` is `false`. */
  converter: Image2TextConverterConfig | null;
}

/**
 * Resolve whether `modelId` (a `provider/model` string, or bare model name)
 * supports vision. A user-set override always wins; otherwise falls back to
 * the static {@link defaultModelSupportsVision} registry.
 */
export function resolveVisionSupport(modelId: string | null): VisionResolution {
  if (!modelId) return { supportsVision: true, converter: null };

  const override = getModelVisionOverride(modelId);
  if (override) {
    return {
      supportsVision: override.supportsVision,
      converter: override.supportsVision ? null : (override.converter ?? null),
    };
  }

  return {
    supportsVision: defaultModelSupportsVision(modelId),
    converter: null,
  };
}
