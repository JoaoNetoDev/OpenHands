import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

const normalizeBasePath = (value?: string) => {
  const raw = value?.trim();
  if (!raw || raw === "/") return undefined;

  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/, "");
};

const basename = normalizeBasePath(process.env.VITE_BASE_PATH);

/**
 * This script is used to unpack the client directory from the frontend build directory.
 * Remix SPA mode builds the client directory into the build directory. This function
 * moves the contents of the client directory to the build directory and then removes the
 * client directory.
 *
 * This script is used in the buildEnd function of the Vite config.
 */
let unpackClientDirectoryPromise: Promise<void> | null = null;
let moveBuildEntryCounter = 0;

/**
 * Moves `source` into `destination`, swapping it atomically instead of
 * deleting `destination` up front. A production Apache serves `build/`
 * straight off disk while this runs (see tools/deploy-remotes.sh), so
 * deleting `destination` before the replacement is ready leaves a window
 * where every hashed asset 404s — that produced a blank-screen outage
 * (docs/bugs/deploy-tela-branca-assets-404/FICHA.md).
 *
 * Phase 1 prepares the new content at a sibling `incoming` path *without*
 * touching `destination` at all, including on the slow EPERM/EXDEV
 * cp-then-rm fallback — an earlier version of this fix renamed
 * `destination` away before that fallback ran, which left it missing for
 * the entire recursive copy (the same bug, just on the slow path).
 * Phase 2 only then swaps `destination` for the ready `incoming` directory
 * via two back-to-back renames, so `destination` is ever absent for no
 * longer than a single rename(2) syscall.
 */
export const moveBuildEntry = async (
  fs: typeof import("fs"),
  source: string,
  destination: string,
) => {
  const suffix = `${process.pid}-${moveBuildEntryCounter++}`;
  const incomingPath = `${destination}.incoming-${suffix}`;
  const backupPath = `${destination}.stale-${suffix}`;

  // Phase 1: get the new content fully in place next to `destination`,
  // without ever touching `destination` itself.
  try {
    await fs.promises.rename(source, incomingPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EXDEV") {
      throw error;
    }

    await fs.promises.cp(source, incomingPath, {
      recursive: true,
      force: true,
    });
    await fs.promises.rm(source, { recursive: true, force: true });
  }

  // Phase 2: swap. `destination` is only ever absent between these two
  // renames, i.e. for the duration of a metadata operation, not a copy.
  let hadDestination = true;
  try {
    await fs.promises.rename(destination, backupPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    hadDestination = false;
  }

  await fs.promises.rename(incomingPath, destination);

  if (hadDestination) {
    await fs.promises.rm(backupPath, { recursive: true, force: true });
  }
};

const unpackClientDirectoryOnce = async () => {
  if (process.env.VERCEL) {
    // Vercel's React Router builder reads static assets from build/client.
    return;
  }

  const fs = await import("fs");
  const path = await import("path");

  const buildDir = path.resolve(__dirname, "build");
  const clientDir = path.resolve(buildDir, "client");

  let files: string[];
  try {
    files = await fs.promises.readdir(clientDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const file of files) {
    await moveBuildEntry(
      fs,
      path.resolve(clientDir, file),
      path.resolve(buildDir, file),
    );
  }

  await fs.promises.rm(clientDir, { recursive: true, force: true });
};

const unpackClientDirectory = async () => {
  unpackClientDirectoryPromise ??= unpackClientDirectoryOnce().finally(() => {
    unpackClientDirectoryPromise = null;
  });

  await unpackClientDirectoryPromise;
};

export default {
  appDirectory: "src",
  ...(basename ? { basename } : {}),
  buildEnd: unpackClientDirectory,
  presets: [vercelPreset()],
  ssr: false,
} satisfies Config;
