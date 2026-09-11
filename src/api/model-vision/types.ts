/**
 * Converter used to turn an attached image into descriptive text when the
 * active model has no vision support. "backend" reuses an already-registered
 * {@link Backend}'s host/apiKey (paired with a model name to call on it);
 * "endpoint" hits an arbitrary OpenAI-compatible chat-completions URL.
 */
export type Image2TextConverterConfig =
  | { type: "backend"; backendId: string; model: string }
  | { type: "endpoint"; url: string; apiKey?: string; model?: string };

/** Per-model override, keyed by the `provider/model` id used across the app. */
export interface ModelVisionOverride {
  /** `false` marks the model as vision-incapable regardless of the default registry. */
  supportsVision: boolean;
  /** Only meaningful when `supportsVision` is `false`. */
  converter?: Image2TextConverterConfig;
}

export type ModelVisionOverrideMap = Record<string, ModelVisionOverride>;
