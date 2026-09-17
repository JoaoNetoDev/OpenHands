import { LocalWorkspace } from "#/types/workspace";

import { getPathDirectory } from "./path-utils";

/**
 * Maps every workspace id to the muted second line its picker row should show.
 *
 * A workspace name is only ambiguous when another workspace in the same list
 * shares it — two `public_html` folders under different parents are
 * indistinguishable by name alone. For those, the containing directory is the
 * disambiguator; unique names return `null` so their rows stay single-line.
 *
 * The directory is always derived from the workspace's own path. It must not
 * come from `parentPath`: workspaces scanned from a shared parent all carry
 * that same `parentPath`, so two same-named children would both render the
 * parent and stay ambiguous. Distinct paths with an equal name always have
 * distinct directories, so this alone is enough to tell them apart.
 */
export function getWorkspaceSecondaryLabels(
  workspaces: LocalWorkspace[],
): Map<string, string | null> {
  const nameCounts = new Map<string, number>();
  workspaces.forEach((workspace) => {
    nameCounts.set(workspace.name, (nameCounts.get(workspace.name) ?? 0) + 1);
  });

  const labels = new Map<string, string | null>();
  workspaces.forEach((workspace) => {
    const isAmbiguous = (nameCounts.get(workspace.name) ?? 0) > 1;
    labels.set(
      workspace.id,
      isAmbiguous ? (getPathDirectory(workspace.path) ?? workspace.path) : null,
    );
  });

  return labels;
}
