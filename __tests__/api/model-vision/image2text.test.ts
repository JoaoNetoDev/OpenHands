import { afterEach, describe, expect, it, vi } from "vitest";
import {
  convertImageToText,
  convertImagesToText,
} from "#/api/model-vision/image2text";
import type { Backend } from "#/api/backend-registry/types";
import type { Image2TextConverterConfig } from "#/api/model-vision/types";

const BACKEND: Backend = {
  id: "b1",
  name: "My Backend",
  host: "https://my-backend.example.com/",
  apiKey: "backend-key",
  kind: "local",
};

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: () => Promise.resolve(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("convertImageToText", () => {
  it("calls an external endpoint converter with the image and returns the text", async () => {
    mockFetchOnce({ choices: [{ message: { content: "A red apple." } }] });

    const converter: Image2TextConverterConfig = {
      type: "endpoint",
      url: "https://vision.example.com/v1/chat/completions",
      apiKey: "endpoint-key",
      model: "vision-model",
    };

    const result = await convertImageToText(
      "data:image/png;base64,AAA",
      converter,
      [],
    );

    expect(result).toBe("A red apple.");
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://vision.example.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer endpoint-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("vision-model");
    expect(body.messages[0].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAA" },
    });
  });

  it("resolves a 'backend' converter against the registered backend's host and apiKey", async () => {
    mockFetchOnce({ choices: [{ message: { content: "A cat." } }] });

    const converter: Image2TextConverterConfig = {
      type: "backend",
      backendId: "b1",
      model: "gpt-4o",
    };

    const result = await convertImageToText(
      "data:image/png;base64,AAA",
      converter,
      [BACKEND],
    );

    expect(result).toBe("A cat.");
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    // Trailing slash on the backend host must not produce a double slash.
    expect(url).toBe("https://my-backend.example.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer backend-key");
  });

  it("throws when the 'backend' converter references an unknown backend", async () => {
    const converter: Image2TextConverterConfig = {
      type: "backend",
      backendId: "unknown",
      model: "gpt-4o",
    };

    await expect(
      convertImageToText("data:image/png;base64,AAA", converter, []),
    ).rejects.toThrow(/unknown backend/i);
  });

  it("throws when the HTTP response is not ok", async () => {
    mockFetchOnce({}, false, 500);

    const converter: Image2TextConverterConfig = {
      type: "endpoint",
      url: "https://vision.example.com",
    };

    await expect(
      convertImageToText("data:image/png;base64,AAA", converter, []),
    ).rejects.toThrow(/500/);
  });

  it("throws when the response has no text content", async () => {
    mockFetchOnce({ choices: [{ message: {} }] });

    const converter: Image2TextConverterConfig = {
      type: "endpoint",
      url: "https://vision.example.com",
    };

    await expect(
      convertImageToText("data:image/png;base64,AAA", converter, []),
    ).rejects.toThrow(/no text/i);
  });
});

describe("convertImagesToText", () => {
  it("joins multiple image descriptions with a numbered label", async () => {
    const converter: Image2TextConverterConfig = {
      type: "endpoint",
      url: "https://vision.example.com",
    };
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ choices: [{ message: { content: "First." } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ choices: [{ message: { content: "Second." } }] }),
      });

    const result = await convertImagesToText(
      ["data:image/png;base64,AAA", "data:image/png;base64,BBB"],
      converter,
      [],
    );

    expect(result).toBe("[Image 1]: First.\n\n[Image 2]: Second.");
  });

  it("inlines a failure note instead of throwing when one image fails", async () => {
    const converter: Image2TextConverterConfig = {
      type: "endpoint",
      url: "https://vision.example.com",
    };
    mockFetchOnce({}, false, 500);

    const result = await convertImagesToText(
      ["data:image/png;base64,AAA"],
      converter,
      [],
    );

    expect(result).toContain("[Image 1]:");
    expect(result).toContain("conversion failed");
  });
});
