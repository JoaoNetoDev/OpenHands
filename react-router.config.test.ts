import { describe, expect, it, vi } from "vitest";
import { moveBuildEntry } from "./react-router.config";

type FakeErrnoException = NodeJS.ErrnoException;

const errnoError = (code: string): FakeErrnoException =>
  Object.assign(new Error(code), { code });

/**
 * Minimal in-memory fake for the slice of `node:fs/promises` that
 * `moveBuildEntry` uses. Every path is just a key in a Map recording
 * whether it currently "exists" (`true`) so tests can assert that
 * `destination` is never observably absent for longer than a single
 * rename.
 */
const createFakeFs = (initialPaths: string[]) => {
  const existing = new Set(initialPaths);
  const calls: string[] = [];

  const rename = vi.fn(async (from: string, to: string) => {
    if (!existing.has(from)) {
      throw errnoError("ENOENT");
    }
    calls.push(`rename:${from}->${to}`);
    existing.delete(from);
    existing.add(to);
  });

  const rm = vi.fn(async (path: string) => {
    calls.push(`rm:${path}`);
    existing.delete(path);
  });

  const cp = vi.fn(async (from: string, to: string) => {
    calls.push(`cp:${from}->${to}`);
    existing.add(to);
  });

  const fs = {
    promises: { rename, rm, cp },
  } as unknown as typeof import("fs");

  return { fs, existing, calls, rename, rm, cp };
};

describe("moveBuildEntry", () => {
  it("moves source straight into destination when destination does not exist yet", async () => {
    const { fs, existing, calls } = createFakeFs(["/build/client/assets"]);

    await moveBuildEntry(fs, "/build/client/assets", "/build/assets");

    expect(existing.has("/build/assets")).toBe(true);
    expect(existing.has("/build/client/assets")).toBe(false);
    // No rm should ever target /build/assets or a backup of it: there was
    // nothing to remove.
    expect(calls.some((c) => c.startsWith("rm:/build/assets"))).toBe(false);
  });

  it("swaps destination atomically: rename-away, rename-in, cleanup — never rm(destination) directly", async () => {
    const { fs, existing, calls, rename, rm } = createFakeFs([
      "/build/client/assets",
      "/build/assets",
    ]);

    await moveBuildEntry(fs, "/build/client/assets", "/build/assets");

    // Final state: only the new content lives at /build/assets.
    expect(existing.has("/build/assets")).toBe(true);
    expect(existing.has("/build/client/assets")).toBe(false);

    // The old destination must never be deleted directly — only ever
    // renamed away first (this is the regression F-SP-01 caught: an
    // earlier version called rm(destination) before the replacement was
    // ready).
    expect(rm.mock.calls.some(([path]) => path === "/build/assets")).toBe(
      false,
    );

    const renameCalls = rename.mock.calls.map(([from, to]) => `${from}->${to}`);
    // rename(source, incoming) happens first (phase 1), then
    // rename(destination, backup) and rename(incoming, destination)
    // (phase 2), strictly in that relative order.
    const sourceToIncomingIdx = renameCalls.findIndex((c) =>
      c.startsWith("/build/client/assets->"),
    );
    const destToBackupIdx = renameCalls.findIndex(
      (c) => c.startsWith("/build/assets->") && !c.includes("incoming"),
    );
    const incomingToDestIdx = renameCalls.findIndex((c) =>
      c.endsWith("->/build/assets"),
    );

    expect(sourceToIncomingIdx).toBeGreaterThanOrEqual(0);
    expect(destToBackupIdx).toBeGreaterThan(sourceToIncomingIdx);
    expect(incomingToDestIdx).toBeGreaterThan(destToBackupIdx);

    // Backup cleanup happens last, after the swap succeeded.
    const backupPath = renameCalls[destToBackupIdx].split("->")[1];
    expect(rm.mock.calls.some(([path]) => path === backupPath)).toBe(true);
    const rmBackupIdx = calls.indexOf(`rm:${backupPath}`);
    const incomingToDestCallIdx = calls.indexOf(
      `rename:${renameCalls[incomingToDestIdx]}`,
    );
    expect(rmBackupIdx).toBeGreaterThan(incomingToDestCallIdx);
  });

  it("regression guard: destination is never absent for longer than the two swap renames, even without a fallback", async () => {
    // This directly encodes the property the old buggy implementation
    // violated: rm(destination) followed by rename(source, destination)
    // left `destination` absent for the whole gap between those two
    // calls. Here we assert the *sequence itself* never contains a bare
    // rm of destination before the new content is in place.
    const { fs, calls } = createFakeFs([
      "/build/client/assets",
      "/build/assets",
    ]);

    await moveBuildEntry(fs, "/build/client/assets", "/build/assets");

    const destRmIndex = calls.findIndex((c) => c === "rm:/build/assets");
    expect(destRmIndex).toBe(-1);
  });

  it("EPERM/EXDEV fallback: copies source aside and only swaps destination once the copy is done", async () => {
    const { fs, existing, calls, rename, cp, rm } = createFakeFs([
      "/build/client/assets",
      "/build/assets",
    ]);

    rename.mockImplementation(async (from: string, to: string) => {
      if (from === "/build/client/assets" && !to.includes("stale")) {
        throw errnoError("EXDEV");
      }
      if (!existing.has(from)) {
        throw errnoError("ENOENT");
      }
      calls.push(`rename:${from}->${to}`);
      existing.delete(from);
      existing.add(to);
    });

    await moveBuildEntry(fs, "/build/client/assets", "/build/assets");

    expect(cp).toHaveBeenCalledTimes(1);
    const [cpFrom, cpTo] = cp.mock.calls[0];
    expect(cpFrom).toBe("/build/client/assets");
    expect(cpTo).toContain("incoming");

    const cpIdx = calls.findIndex((c) => c.startsWith("cp:"));
    const rmSourceIdx = calls.findIndex((c) => c === "rm:/build/client/assets");
    const destToBackupIdx = calls.findIndex(
      (c) => c.startsWith("rename:/build/assets->") && !c.includes("incoming"),
    );
    const incomingToDestIdx = calls.findIndex((c) =>
      c.endsWith("->/build/assets"),
    );

    // The whole cp+rm(source) fallback happens strictly before anything
    // touches /build/assets — destination keeps its old content intact
    // for the entire (slow) copy.
    expect(cpIdx).toBeGreaterThanOrEqual(0);
    expect(rmSourceIdx).toBeGreaterThan(cpIdx);
    expect(destToBackupIdx).toBeGreaterThan(rmSourceIdx);
    expect(incomingToDestIdx).toBeGreaterThan(destToBackupIdx);

    expect(existing.has("/build/assets")).toBe(true);
    expect(rm.mock.calls.some(([path]) => path === "/build/assets")).toBe(
      false,
    );
  });

  it("propagates an unexpected error from the final swap rename without deleting the backup", async () => {
    const { fs, rename, rm } = createFakeFs([
      "/build/client/assets",
      "/build/assets",
    ]);

    rename.mockImplementation(async (from: string, to: string) => {
      if (from.includes("incoming") && to === "/build/assets") {
        throw errnoError("EIO");
      }
      return undefined;
    });

    await expect(
      moveBuildEntry(fs, "/build/client/assets", "/build/assets"),
    ).rejects.toMatchObject({ code: "EIO" });

    expect(rm.mock.calls.some(([path]) => path.includes("stale"))).toBe(false);
  });
});
