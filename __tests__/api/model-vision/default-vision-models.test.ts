import { describe, expect, it } from "vitest";
import { defaultModelSupportsVision } from "#/api/model-vision/default-vision-models";

describe("defaultModelSupportsVision", () => {
  it.each([
    "anthropic/claude-3-5-sonnet-20241022",
    "claude-3-opus",
    "openai/gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-5",
    "o1",
    "o3-mini",
    "gemini-1.5-pro",
    "gemini-2.0-flash",
    "meta/llama-4-scout",
    "llama-3.2-90b-vision-instruct",
    "mistral/pixtral-12b",
    "qwen/qwen2-vl-72b",
  ])("recognizes %s as vision-capable", (modelId) => {
    expect(defaultModelSupportsVision(modelId)).toBe(true);
  });

  it.each([
    "gpt-3.5-turbo",
    "text-embedding-3-large",
    "deepseek/deepseek-chat",
    "llama-3.1-8b-instruct",
    "mistral/mistral-large",
  ])("does not recognize %s as vision-capable", (modelId) => {
    expect(defaultModelSupportsVision(modelId)).toBe(false);
  });

  it("matches on the bare model name, ignoring the provider prefix", () => {
    expect(defaultModelSupportsVision("openrouter/openai/gpt-4o")).toBe(true);
  });
});
