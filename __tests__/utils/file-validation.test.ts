import { describe, expect, it } from "vitest";
import {
  validateFiles,
  validateIndividualFileSizes,
  validateTotalFileSize,
} from "#/utils/file-validation";

const MB = 1024 * 1024;

/**
 * Build a real File whose reported size is overridden, so size limits can be
 * exercised without allocating megabytes of buffers. Note that passing these
 * objects through `it.each` args crashes Vitest's title formatter, so `it.each`
 * rows carry scalars only and the File is built inside the test body.
 */
const makeFile = (name: string, size: number, type = "application/pdf") => {
  const file = new File([""], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

describe("validateIndividualFileSizes", () => {
  it.each([
    ["accepts a document at the 25MB cap", "application/pdf", 25 * MB, true],
    [
      "rejects a document above the 25MB cap",
      "application/pdf",
      25 * MB + 1,
      false,
    ],
    ["accepts an image at the 5MB cap", "image/png", 5 * MB, true],
    ["rejects an image above the 5MB cap", "image/png", 5 * MB + 1, false],
  ])("%s", (_label, type, size, expectedValid) => {
    const result = validateIndividualFileSizes([makeFile("f", size, type)]);

    expect(result.isValid).toBe(expectedValid);
  });

  it("names each offending file alongside its own limit", () => {
    const result = validateIndividualFileSizes([
      makeFile("huge.pdf", 30 * MB),
      makeFile("huge.png", 9 * MB, "image/png"),
    ]);

    expect(result.oversizedFiles).toEqual(["huge.pdf", "huge.png"]);
    expect(result.errorMessage).toContain("huge.pdf (25MB max)");
    expect(result.errorMessage).toContain("huge.png (5MB max)");
  });

  it("reports no oversized files when every file is accepted", () => {
    const result = validateIndividualFileSizes([makeFile("ok.pdf", MB)]);

    expect(result.oversizedFiles).toBeUndefined();
  });
});

describe("validateTotalFileSize", () => {
  it("rejects a combination that exceeds the 25MB budget", () => {
    const result = validateTotalFileSize(
      [makeFile("b.pdf", 15 * MB)],
      [makeFile("a.pdf", 11 * MB)],
    );

    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain("exceeding the 25MB limit");
  });

  it("accepts a combination exactly at the budget", () => {
    const result = validateTotalFileSize(
      [makeFile("b.pdf", 15 * MB)],
      [makeFile("a.pdf", 10 * MB)],
    );

    expect(result.isValid).toBe(true);
  });
});

describe("validateFiles", () => {
  it("fails on an oversized individual file even when the total fits", () => {
    const result = validateFiles([makeFile("huge.png", 6 * MB, "image/png")]);

    expect(result.isValid).toBe(false);
    expect(result.oversizedFiles).toEqual(["huge.png"]);
  });
});
