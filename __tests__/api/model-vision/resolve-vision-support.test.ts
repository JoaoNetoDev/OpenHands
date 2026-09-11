import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveVisionSupport } from "#/api/model-vision/resolve-vision-support";
import { setModelVisionOverride } from "#/api/model-vision/vision-config-store";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("resolveVisionSupport", () => {
  it("treats a null modelId as vision-supported with no converter", () => {
    expect(resolveVisionSupport(null)).toEqual({
      supportsVision: true,
      converter: null,
    });
  });

  it("falls back to the default registry when there is no override", () => {
    expect(resolveVisionSupport("anthropic/claude-3-5-sonnet")).toEqual({
      supportsVision: true,
      converter: null,
    });
    expect(resolveVisionSupport("openai/gpt-3.5-turbo")).toEqual({
      supportsVision: false,
      converter: null,
    });
  });

  it("lets a manual override win over the default registry", () => {
    setModelVisionOverride("anthropic/claude-3-5-sonnet", {
      supportsVision: false,
      converter: { type: "endpoint", url: "https://example.com" },
    });

    expect(resolveVisionSupport("anthropic/claude-3-5-sonnet")).toEqual({
      supportsVision: false,
      converter: { type: "endpoint", url: "https://example.com" },
    });
  });

  it("drops the converter when the override marks the model as vision-supported", () => {
    setModelVisionOverride("openai/gpt-3.5-turbo", {
      supportsVision: true,
      converter: { type: "endpoint", url: "https://example.com" },
    });

    expect(resolveVisionSupport("openai/gpt-3.5-turbo")).toEqual({
      supportsVision: true,
      converter: null,
    });
  });
});
