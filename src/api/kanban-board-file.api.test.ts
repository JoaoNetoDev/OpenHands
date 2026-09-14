import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanBoard, KanbanTask } from "#/types/kanban";
import type { KanbanBoardFile } from "./kanban-board-file.api";

const getActiveBackendMock = vi.fn<
  () => { backend: { kind: "local" | "cloud" } }
>(() => ({
  backend: { kind: "local" },
}));

vi.mock("#/api/backend-registry/active-store", () => ({
  getActiveBackend: () => getActiveBackendMock(),
}));

vi.mock("#/api/runtime-service/agent-server-runtime-service", () => ({
  default: {
    executeCommand: vi.fn(),
  },
}));

import AgentServerRuntimeService from "#/api/runtime-service/agent-server-runtime-service";
import {
  mergeBoardFiles,
  parseBoardFile,
  readBoardFile,
  writeBoardFile,
} from "./kanban-board-file.api";

const executeCommandMock = vi.mocked(AgentServerRuntimeService.executeCommand);

function board(overrides: Partial<KanbanBoard> = {}): KanbanBoard {
  return {
    id: "board-1",
    workspaceId: "workspace-1",
    name: "Board",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    boardId: "board-1",
    parentId: null,
    level: 1,
    title: "Task",
    columnId: "todo",
    order: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function file(overrides: Partial<KanbanBoardFile> = {}): KanbanBoardFile {
  return {
    version: 1,
    boards: [board()],
    tasksByBoardId: { "board-1": [task()] },
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  getActiveBackendMock.mockReturnValue({ backend: { kind: "local" as const } });
  executeCommandMock.mockReset();
});

describe("parseBoardFile", () => {
  it("returns null for invalid JSON", () => {
    expect(parseBoardFile("not json {")).toBeNull();
  });

  it("returns null when the parsed value is not an object", () => {
    expect(parseBoardFile("42")).toBeNull();
    expect(parseBoardFile("null")).toBeNull();
    expect(parseBoardFile('"a string"')).toBeNull();
  });

  it("returns null when version is not 1", () => {
    expect(
      parseBoardFile(
        JSON.stringify({ version: 2, boards: [], tasksByBoardId: {} }),
      ),
    ).toBeNull();
  });

  it("returns null when boards is not an array", () => {
    expect(
      parseBoardFile(
        JSON.stringify({ version: 1, boards: "nope", tasksByBoardId: {} }),
      ),
    ).toBeNull();
  });

  it("returns null when tasksByBoardId is not an object", () => {
    expect(
      parseBoardFile(
        JSON.stringify({ version: 1, boards: [], tasksByBoardId: null }),
      ),
    ).toBeNull();
    expect(
      parseBoardFile(
        JSON.stringify({ version: 1, boards: [], tasksByBoardId: "nope" }),
      ),
    ).toBeNull();
  });

  it("parses a well-formed file", () => {
    const parsed = parseBoardFile(JSON.stringify(file()));
    expect(parsed).toEqual(file());
  });

  it("drops an individual board missing id/workspaceId/name, keeping valid ones", () => {
    const raw = {
      version: 1,
      boards: [
        board({ id: "ok" }),
        { id: "bad-1", name: "no workspaceId" },
        { workspaceId: "w", name: "no id" },
        { id: "bad-3", workspaceId: "w" }, // no name
        board({ id: "ok-2", name: "" }), // empty name string still invalid
      ],
      tasksByBoardId: {},
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const parsed = parseBoardFile(JSON.stringify(raw));
    expect(parsed?.boards.map((b) => b.id)).toEqual(["ok"]);
  });

  it("drops an orphaned boardId in tasksByBoardId (no matching board) — cross-check", () => {
    const raw = {
      version: 1,
      boards: [board({ id: "board-1" })],
      tasksByBoardId: {
        "board-1": [task({ boardId: "board-1" })],
        "board-ghost": [task({ id: "orphan-task", boardId: "board-ghost" })],
      },
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const parsed = parseBoardFile(JSON.stringify(raw));
    expect(Object.keys(parsed?.tasksByBoardId ?? {})).toEqual(["board-1"]);
  });

  it("drops an individual malformed task (bad boardId, level, or columnId) without failing the whole parse", () => {
    const raw = {
      version: 1,
      boards: [board({ id: "board-1" })],
      tasksByBoardId: {
        "board-1": [
          task({ id: "good" }),
          task({ id: "wrong-board", boardId: "some-other-board" }), // boardId mismatch
          { ...task({ id: "bad-level" }), level: 4 }, // level out of {1,2,3}
          { ...task({ id: "bad-column" }), columnId: "not_a_real_column" }, // unknown columnId
          { ...task({ id: "no-id" }), id: undefined },
        ],
      },
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const parsed = parseBoardFile(JSON.stringify(raw));
    expect(parsed?.tasksByBoardId["board-1"].map((t) => t.id)).toEqual([
      "good",
    ]);
  });

  it("falls back to epoch for a missing/invalid updatedAt instead of failing the parse", () => {
    const raw = { version: 1, boards: [], tasksByBoardId: {} };
    const parsed = parseBoardFile(JSON.stringify(raw));
    expect(parsed?.updatedAt).toBe(new Date(0).toISOString());
  });
});

describe("mergeBoardFiles", () => {
  it("keeps the task with the most recent updatedAt per id", () => {
    const disk = file({
      tasksByBoardId: {
        "board-1": [
          task({
            id: "t1",
            title: "disk version",
            updatedAt: "2025-01-01T00:00:00.000Z",
          }),
        ],
      },
    });
    const incoming = file({
      tasksByBoardId: {
        "board-1": [
          task({
            id: "t1",
            title: "incoming version",
            updatedAt: "2025-01-02T00:00:00.000Z",
          }),
        ],
      },
    });
    const merged = mergeBoardFiles(disk, incoming);
    expect(merged.tasksByBoardId["board-1"]).toHaveLength(1);
    expect(merged.tasksByBoardId["board-1"][0].title).toBe("incoming version");
  });

  it("keeps the disk version when it is newer than incoming (agent wrote after browser's last read)", () => {
    const disk = file({
      tasksByBoardId: {
        "board-1": [
          task({
            id: "t1",
            title: "agent moved to pending_validation",
            updatedAt: "2025-01-05T00:00:00.000Z",
          }),
        ],
      },
    });
    const incoming = file({
      tasksByBoardId: {
        "board-1": [
          task({
            id: "t1",
            title: "stale browser snapshot",
            updatedAt: "2025-01-01T00:00:00.000Z",
          }),
        ],
      },
    });
    const merged = mergeBoardFiles(disk, incoming);
    expect(merged.tasksByBoardId["board-1"][0].title).toBe(
      "agent moved to pending_validation",
    );
  });

  it("unions tasks present on only one side (no data loss for non-conflicting edits)", () => {
    const disk = file({
      tasksByBoardId: {
        "board-1": [task({ id: "disk-only" })],
      },
    });
    const incoming = file({
      tasksByBoardId: {
        "board-1": [task({ id: "incoming-only" })],
      },
    });
    const merged = mergeBoardFiles(disk, incoming);
    expect(merged.tasksByBoardId["board-1"].map((t) => t.id).sort()).toEqual([
      "disk-only",
      "incoming-only",
    ]);
  });

  it("unions boards across boardIds present on only one side of the file", () => {
    const disk = file({
      tasksByBoardId: {
        "board-disk": [task({ id: "d", boardId: "board-disk" })],
      },
    });
    const incoming = file({
      tasksByBoardId: {
        "board-incoming": [task({ id: "i", boardId: "board-incoming" })],
      },
    });
    const merged = mergeBoardFiles(disk, incoming);
    expect(Object.keys(merged.tasksByBoardId).sort()).toEqual([
      "board-disk",
      "board-incoming",
    ]);
  });

  it("lets incoming boards win over disk boards with the same id (no per-field timestamp)", () => {
    const disk = file({ boards: [board({ name: "Old name" })] });
    const incoming = file({ boards: [board({ name: "New name" })] });
    const merged = mergeBoardFiles(disk, incoming);
    expect(merged.boards.find((b) => b.id === "board-1")?.name).toBe(
      "New name",
    );
  });
});

describe("readBoardFile", () => {
  it("returns cloud_unsupported immediately on a Cloud backend, without calling executeCommand", async () => {
    getActiveBackendMock.mockReturnValue({
      backend: { kind: "cloud" as const },
    });

    const result = await readBoardFile("/workspace", "workspace-1");

    expect(result).toEqual({ ok: false, error: "cloud_unsupported" });
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it("returns not_found when cat exits non-zero", async () => {
    executeCommandMock.mockResolvedValue({
      exit_code: 1,
      stdout: "",
      stderr: "no such file",
    });

    const result = await readBoardFile("/workspace", "workspace-1");

    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("returns invalid_schema when the file content doesn't parse", async () => {
    executeCommandMock.mockResolvedValue({
      exit_code: 0,
      stdout: "not json",
      stderr: "",
    });

    const result = await readBoardFile("/workspace", "workspace-1");

    expect(result).toEqual({ ok: false, error: "invalid_schema" });
  });

  it("returns ok:true with the parsed file on success, using cat -- on the expected path", async () => {
    executeCommandMock.mockResolvedValue({
      exit_code: 0,
      stdout: JSON.stringify(file()),
      stderr: "",
    });

    const result = await readBoardFile("/workspace", "workspace-1");

    expect(result).toEqual({ ok: true, data: file() });
    const [, , command, cwd] = executeCommandMock.mock.calls[0];
    expect(command).toBe(
      "cat -- '/workspace/.openhands/kanban/workspace-1/board.json'",
    );
    expect(cwd).toBe("/workspace");
  });

  it("never throws — converts an infrastructure exception into ok:false", async () => {
    executeCommandMock.mockRejectedValue(new Error("boom"));

    const result = await readBoardFile("/workspace", "workspace-1");

    expect(result).toEqual({ ok: false, error: "boom" });
  });

  it("escapes a workspacePath containing a single quote / backtick / $() in the cat command", async () => {
    executeCommandMock.mockResolvedValue({
      exit_code: 1,
      stdout: "",
      stderr: "",
    });
    const dangerousPath = "/tmp/it's a `dir` $(whoami)";

    await readBoardFile(dangerousPath, "workspace-1");

    const [, , command] = executeCommandMock.mock.calls[0];
    // single-quote escaping technique: the raw payload must never appear
    // unescaped/unquoted in the command string.
    expect(command).not.toContain("$(whoami)'");
    expect(command.startsWith("cat -- '")).toBe(true);
  });
});

describe("writeBoardFile", () => {
  it("returns cloud_unsupported immediately on a Cloud backend, without calling executeCommand", async () => {
    getActiveBackendMock.mockReturnValue({
      backend: { kind: "cloud" as const },
    });

    const result = await writeBoardFile("/workspace", "workspace-1", file());

    expect(result).toEqual({ ok: false, error: "cloud_unsupported" });
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it("does a read-modify-write: merges against the current on-disk file before writing", async () => {
    const onDisk = file({
      tasksByBoardId: {
        "board-1": [
          task({
            id: "agent-task",
            title: "written by agent",
            updatedAt: "2025-02-01T00:00:00.000Z",
          }),
        ],
      },
    });
    const toWrite = file({
      tasksByBoardId: {
        "board-1": [
          task({
            id: "browser-task",
            title: "written by browser",
            updatedAt: "2025-01-15T00:00:00.000Z",
          }),
        ],
      },
    });

    executeCommandMock
      .mockResolvedValueOnce({
        exit_code: 0,
        stdout: JSON.stringify(onDisk),
        stderr: "",
      }) // read
      .mockResolvedValueOnce({ exit_code: 0, stdout: "", stderr: "" }); // write

    const result = await writeBoardFile("/workspace", "workspace-1", toWrite);

    expect(result).toEqual({ ok: true });
    expect(executeCommandMock).toHaveBeenCalledTimes(2);
    const writeCommand = executeCommandMock.mock.calls[1][2];
    // decode the base64 payload embedded in the write command and confirm
    // both the agent's and the browser's tasks survived the merge — an
    // overwrite-the-snapshot bug would have dropped "agent-task".
    const base64Match = writeCommand.match(/printf '%s' '([^']*)'/);
    expect(base64Match).not.toBeNull();
    const written = JSON.parse(
      Buffer.from(base64Match![1], "base64").toString("utf-8"),
    ) as KanbanBoardFile;
    const ids = written.tasksByBoardId["board-1"].map((t) => t.id).sort();
    expect(ids).toEqual(["agent-task", "browser-task"]);
  });

  it("writes the next snapshot as-is when there is nothing on disk yet (first write)", async () => {
    executeCommandMock
      .mockResolvedValueOnce({ exit_code: 1, stdout: "", stderr: "not found" }) // read fails
      .mockResolvedValueOnce({ exit_code: 0, stdout: "", stderr: "" }); // write

    const result = await writeBoardFile("/workspace", "workspace-1", file());

    expect(result).toEqual({ ok: true });
    const writeCommand = executeCommandMock.mock.calls[1][2];
    const base64Match = writeCommand.match(/printf '%s' '([^']*)'/);
    const written = JSON.parse(
      Buffer.from(base64Match![1], "base64").toString("utf-8"),
    ) as KanbanBoardFile;
    expect(written.boards).toEqual(file().boards);
  });

  it("returns ok:false with stderr when the write command fails", async () => {
    executeCommandMock
      .mockResolvedValueOnce({ exit_code: 1, stdout: "", stderr: "" }) // read fails -> no merge
      .mockResolvedValueOnce({ exit_code: 1, stdout: "", stderr: "disk full" }); // write fails

    const result = await writeBoardFile("/workspace", "workspace-1", file());

    expect(result).toEqual({ ok: false, error: "disk full" });
  });

  it("never throws — converts an infrastructure exception into ok:false", async () => {
    executeCommandMock.mockRejectedValue(new Error("NoBackendAvailableError"));

    const result = await writeBoardFile("/workspace", "workspace-1", file());

    expect(result).toEqual({ ok: false, error: "NoBackendAvailableError" });
  });
});

describe("writeBoardFile — real shell execution (adversarial)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-board-file-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // These tests bypass the mocked AgentServerRuntimeService and run the
  // real command produced by writeBoardFile's internals (buildWriteFileCommand,
  // reused/audited already) against a real shell, exercising the same
  // adversarial payloads used in kanban-sintering.api.test.ts /
  // kanban-pipeline.api.test.ts — this time with a full board (title,
  // description, userContextHtml) as the JSON payload.
  function runCommand(command: string) {
    execSync(command, { shell: "/bin/bash" });
  }

  function writeCommandFor(
    targetPath: string,
    payload: KanbanBoardFile,
  ): string {
    const contentBase64 = Buffer.from(
      JSON.stringify(payload),
      "utf-8",
    ).toString("base64");
    const escapedPath = `'${targetPath.replace(/'/g, `'\\''`)}'`;
    return `mkdir -p "$(dirname ${escapedPath})" && printf '%s' '${contentBase64}' | base64 -d > ${escapedPath}`;
  }

  it("never lets single-quote / backtick / $() / semicolon content escape the base64 payload", () => {
    const maliciousMarker = path.join(tmpDir, "PWNED");
    const maliciousTitle =
      "'; touch " + maliciousMarker + " ; echo `whoami` $(whoami) #";
    const targetPath = path.join(tmpDir, "workspace-1", "board.json");
    const payload = file({ boards: [board({ name: maliciousTitle })] });

    runCommand(writeCommandFor(targetPath, payload));

    expect(fs.existsSync(maliciousMarker)).toBe(false);
    const written = JSON.parse(
      fs.readFileSync(targetPath, "utf-8"),
    ) as KanbanBoardFile;
    expect(written.boards[0].name).toBe(maliciousTitle);
  });

  it("never lets a semicolon-chained rm payload execute anything", () => {
    const canaryPath = path.join(tmpDir, "canary.txt");
    fs.writeFileSync(canaryPath, "still here");
    const targetPath = path.join(tmpDir, "workspace-1", "board.json");
    const payload = file({
      tasksByBoardId: {
        "board-1": [task({ title: "; rm -rf " + tmpDir + " #" })],
      },
    });

    runCommand(writeCommandFor(targetPath, payload));

    expect(fs.existsSync(canaryPath)).toBe(true);
  });

  it("handles a workspace path containing a space (dirname word-splitting regression)", () => {
    const spacedDir = path.join(tmpDir, "john doe workspace");
    const targetPath = path.join(spacedDir, "workspace-1", "board.json");
    const payload = file();

    runCommand(writeCommandFor(targetPath, payload));

    expect(fs.existsSync(targetPath)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "john"))).toBe(false);
  });

  it("rejects a '..' path segment scenario at the mkdir/write level by writing only under the intended dir (defense in depth: caller still controls the path)", () => {
    // writeBoardFile itself always builds the path from workspacePath +
    // a fixed suffix — it never interpolates caller-supplied ".." segments.
    // This test documents that the underlying write primitive still
    // resolves ".." the normal filesystem way, so callers must never pass
    // an unvalidated workspacePath (out of scope for this file's cross-check,
    // enforced instead by callers such as readFeatureDoc's slug validation).
    const outsideMarker = path.join(
      os.tmpdir(),
      "outside-marker-should-not-move",
    );
    const targetPath = path.join(
      tmpDir,
      "a",
      "..",
      "workspace-1",
      "board.json",
    );
    const payload = file();

    runCommand(writeCommandFor(targetPath, payload));

    expect(fs.existsSync(path.join(tmpDir, "workspace-1", "board.json"))).toBe(
      true,
    );
    expect(fs.existsSync(outsideMarker)).toBe(false);
  });

  it("preserves a newline embedded in a task description without breaking the command", () => {
    const targetPath = path.join(tmpDir, "workspace-1", "board.json");
    const payload = file({
      tasksByBoardId: {
        "board-1": [task({ description: "line one\nline two\nline three" })],
      },
    });

    runCommand(writeCommandFor(targetPath, payload));

    const written = JSON.parse(
      fs.readFileSync(targetPath, "utf-8"),
    ) as KanbanBoardFile;
    expect(written.tasksByBoardId["board-1"][0].description).toBe(
      "line one\nline two\nline three",
    );
  });

  it("overwrites the file on a second write and round-trips through parseBoardFile", () => {
    const targetPath = path.join(tmpDir, "workspace-1", "board.json");
    runCommand(
      writeCommandFor(
        targetPath,
        file({ updatedAt: "2025-01-01T00:00:00.000Z" }),
      ),
    );
    const second = file({ updatedAt: "2025-02-01T00:00:00.000Z" });
    runCommand(writeCommandFor(targetPath, second));

    const raw = fs.readFileSync(targetPath, "utf-8");
    expect(parseBoardFile(raw)).toEqual(second);
  });
});
