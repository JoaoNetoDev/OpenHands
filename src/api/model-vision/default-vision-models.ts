/**
 * Known vision-capable model name patterns, matched against the bare model
 * id (the part after the last `/` in a `provider/model` string). This is a
 * best-effort default used when the user hasn't set an explicit override via
 * {@link ../vision-config-store}; it intentionally errs toward recognizing
 * mainstream multimodal families rather than trying to be exhaustive.
 */
const VISION_MODEL_PATTERNS: RegExp[] = [
  // Anthropic Claude 3+ (all Claude 3/3.5/3.7/4/5 tiers are multimodal)
  /^claude-(3|4|5)/i,
  // OpenAI GPT-4 vision-capable family + GPT-5 + o-series reasoning models
  /^gpt-4(o|-turbo|\.1)?/i,
  /^gpt-5/i,
  /^o[1-9](-mini|-preview)?$/i,
  // Google Gemini (all 1.5+/2.x tiers are multimodal)
  /^gemini-(1\.5|2)/i,
  // Meta Llama vision variants
  /llama-.*vision/i,
  /^llama-4/i,
  // Mistral / Pixtral vision models
  /pixtral/i,
  // Qwen VL family
  /qwen.*-vl/i,
];

/** Strips a leading `provider/` segment, if present, from a model id. */
function bareModelName(modelId: string): string {
  const lastSlash = modelId.lastIndexOf("/");
  return lastSlash === -1 ? modelId : modelId.slice(lastSlash + 1);
}

/**
 * Best-effort default: does this model name look like it supports vision?
 * Unknown models default to `false` — silently sending images to a
 * text-only model just wastes tokens and confuses it, so we'd rather the
 * user opt in (or configure a converter) than assume support.
 */
export function defaultModelSupportsVision(modelId: string): boolean {
  const name = bareModelName(modelId);
  return VISION_MODEL_PATTERNS.some((pattern) => pattern.test(name));
}
