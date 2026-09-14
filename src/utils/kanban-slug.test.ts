import { describe, expect, it } from "vitest";
import { isValidFeatureSlug } from "./kanban-slug";

describe("isValidFeatureSlug", () => {
  it("accepts a simple kebab-case slug", () => {
    expect(isValidFeatureSlug("meu-slug-123")).toBe(true);
  });

  it("accepts a single-word slug", () => {
    expect(isValidFeatureSlug("slug")).toBe(true);
  });

  it("rejects uppercase letters", () => {
    expect(isValidFeatureSlug("Meu-Slug")).toBe(false);
  });

  it("rejects spaces", () => {
    expect(isValidFeatureSlug("meu slug")).toBe(false);
  });

  it("rejects underscores", () => {
    expect(isValidFeatureSlug("meu_slug")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidFeatureSlug("")).toBe(false);
  });

  it("rejects a slug starting with a hyphen", () => {
    expect(isValidFeatureSlug("-meu-slug")).toBe(false);
  });

  it("rejects a slug ending with a hyphen", () => {
    expect(isValidFeatureSlug("meu-slug-")).toBe(false);
  });
});
