import { describe, expect, it } from "vitest";

import { LocalWorkspace } from "#/types/workspace";
import { getWorkspaceSecondaryLabels } from "#/utils/workspace-display";

describe("getWorkspaceSecondaryLabels", () => {
  it("labels only the workspaces whose name is shared with another", () => {
    const workspaces: LocalWorkspace[] = [
      {
        id: "/srv/a/public_html",
        name: "public_html",
        path: "/srv/a/public_html",
      },
      {
        id: "/srv/b/public_html",
        name: "public_html",
        path: "/srv/b/public_html",
      },
      { id: "/srv/c/api", name: "api", path: "/srv/c/api" },
    ];

    const labels = getWorkspaceSecondaryLabels(workspaces);

    expect(labels.get("/srv/a/public_html")).toBe("/srv/a");
    expect(labels.get("/srv/b/public_html")).toBe("/srv/b");
    expect(labels.get("/srv/c/api")).toBeNull();
  });

  it("uses each folder's own directory even when they share a parent", () => {
    // Regression: workspaces scanned from one workspace parent all carry that
    // same `parentPath`, so preferring it rendered `/projects` for both rows
    // and left them just as ambiguous as before.
    const workspaces: LocalWorkspace[] = [
      {
        id: "/projects/cliente-a/public_html",
        name: "public_html",
        path: "/projects/cliente-a/public_html",
        parentPath: "/projects",
      },
      {
        id: "/projects/cliente-b/public_html",
        name: "public_html",
        path: "/projects/cliente-b/public_html",
        parentPath: "/projects",
      },
    ];

    const labels = getWorkspaceSecondaryLabels(workspaces);

    expect(labels.get("/projects/cliente-a/public_html")).toBe(
      "/projects/cliente-a",
    );
    expect(labels.get("/projects/cliente-b/public_html")).toBe(
      "/projects/cliente-b",
    );
  });

  it("falls back to the full path when the directory cannot be derived", () => {
    const workspaces: LocalWorkspace[] = [
      { id: "public_html", name: "public_html", path: "public_html" },
      { id: "public_html-a", name: "public_html", path: "public_html-a" },
    ];

    const labels = getWorkspaceSecondaryLabels(workspaces);

    expect(labels.get("public_html")).toBe("public_html");
    expect(labels.get("public_html-a")).toBe("public_html-a");
  });

  it("returns no labels when every name is unique", () => {
    const workspaces: LocalWorkspace[] = [
      { id: "/srv/a", name: "a", path: "/srv/a" },
      { id: "/srv/b", name: "b", path: "/srv/b" },
    ];

    const labels = getWorkspaceSecondaryLabels(workspaces);

    expect([...labels.values()]).toEqual([null, null]);
  });
});
