import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MODEL_VISION_STORAGE_KEY,
  clearModelVisionOverride,
  getModelVisionOverride,
  setModelVisionOverride,
} from "#/api/model-vision/vision-config-store";

const MODEL_ID = "openai/gpt-3.5-turbo";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("vision-config-store", () => {
  it("returns null when no override is stored", () => {
    expect(getModelVisionOverride(MODEL_ID)).toBeNull();
  });

  it("persists and retrieves a supportsVision override with a backend converter", () => {
    setModelVisionOverride(MODEL_ID, {
      supportsVision: false,
      converter: { type: "backend", backendId: "b1", model: "gpt-4o" },
    });

    expect(getModelVisionOverride(MODEL_ID)).toEqual({
      supportsVision: false,
      converter: { type: "backend", backendId: "b1", model: "gpt-4o" },
    });
  });

  it("persists and retrieves an endpoint converter", () => {
    setModelVisionOverride(MODEL_ID, {
      supportsVision: false,
      converter: {
        type: "endpoint",
        url: "https://example.com/v1/chat/completions",
        apiKey: "secret",
        model: "vision-model",
      },
    });

    expect(getModelVisionOverride(MODEL_ID)?.converter).toEqual({
      type: "endpoint",
      url: "https://example.com/v1/chat/completions",
      apiKey: "secret",
      model: "vision-model",
    });
  });

  it("clears an override", () => {
    setModelVisionOverride(MODEL_ID, { supportsVision: true });
    clearModelVisionOverride(MODEL_ID);
    expect(getModelVisionOverride(MODEL_ID)).toBeNull();
  });

  it("removes the localStorage key entirely once the map is empty", () => {
    setModelVisionOverride(MODEL_ID, { supportsVision: true });
    clearModelVisionOverride(MODEL_ID);
    expect(window.localStorage.getItem(MODEL_VISION_STORAGE_KEY)).toBeNull();
  });

  it("ignores a tampered entry with an invalid shape", () => {
    window.localStorage.setItem(
      MODEL_VISION_STORAGE_KEY,
      JSON.stringify({ [MODEL_ID]: { supportsVision: "yes" } }),
    );
    expect(getModelVisionOverride(MODEL_ID)).toBeNull();
  });

  it("ignores malformed JSON entirely", () => {
    window.localStorage.setItem(MODEL_VISION_STORAGE_KEY, "not json");
    expect(getModelVisionOverride(MODEL_ID)).toBeNull();
  });
});
