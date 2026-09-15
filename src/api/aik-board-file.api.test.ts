import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AikPhase, AikSystemFile, AikTask } from "#/types/aik";

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
  buildAikFilePath,
  mergeAikSystemFiles,
  readAikSystemFile,
  writeAikSystemFile,
} from "./aik-board-file.api";

const executeCommandMock = vi.mocked(AgentServerRuntimeService.executeCommand);

function phase(overrides: Partial<AikPhase> = {}): AikPhase {
  return {
    id: "phase-1",
    systemId: "system-1",
    title: "Fase",
    columnId: "backlog",
    order: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Partial<AikTask> = {}): AikTask {
  return {
    id: "task-1",
    phaseId: "phase-1",
    systemId: "system-1",
    title: "Tarefa",
    executorType: "human",
    priority: "p1",
    columnId: "backlog",
    order: 0,
    timeline: [],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function file(overrides: Partial<AikSystemFile> = {}): AikSystemFile {
  return {
    version: 1,
    systemId: "system-1",
    phases: [phase()],
    tasks: [task()],
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  getActiveBackendMock.mockReturnValue({ backend: { kind: "local" as const } });
  executeCommandMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildAikFilePath", () => {
  it("builds the fixed path under .openhands/aik", () => {
    expect(buildAikFilePath("/workspace")).toBe(
      "/workspace/.openhands/aik/system.json",
    );
  });
});

describe("mergeAikSystemFiles", () => {
  it("keeps a phase present only in local", () => {
    const local = file({ phases: [phase({ id: "p-local" })], tasks: [] });
    const remote = file({ phases: [], tasks: [] });
    const merged = mergeAikSystemFiles(local, remote);
    expect(merged.phases.map((p) => p.id)).toEqual(["p-local"]);
  });

  it("keeps a phase present only in remote", () => {
    const local = file({ phases: [], tasks: [] });
    const remote = file({ phases: [phase({ id: "p-remote" })], tasks: [] });
    const merged = mergeAikSystemFiles(local, remote);
    expect(merged.phases.map((p) => p.id)).toEqual(["p-remote"]);
  });

  it("keeps the phase with the most recent updatedAt when present on both sides", () => {
    const local = file({
      phases: [
        phase({
          id: "p1",
          title: "local version",
          updatedAt: "2025-01-05T00:00:00.000Z",
        }),
      ],
      tasks: [],
    });
    const remote = file({
      phases: [
        phase({
          id: "p1",
          title: "remote version (stale)",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
      ],
      tasks: [],
    });
    const merged = mergeAikSystemFiles(local, remote);
    expect(merged.phases[0].title).toBe("local version");
  });

  it("keeps the remote phase when it is newer than local", () => {
    const local = file({
      phases: [
        phase({
          id: "p1",
          title: "local (stale)",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
      ],
      tasks: [],
    });
    const remote = file({
      phases: [
        phase({
          id: "p1",
          title: "remote (fresh)",
          updatedAt: "2025-01-05T00:00:00.000Z",
        }),
      ],
      tasks: [],
    });
    const merged = mergeAikSystemFiles(local, remote);
    expect(merged.phases[0].title).toBe("remote (fresh)");
  });

  it("keeps a task present only in local", () => {
    const local = file({ phases: [], tasks: [task({ id: "t-local" })] });
    const remote = file({ phases: [], tasks: [] });
    const merged = mergeAikSystemFiles(local, remote);
    expect(merged.tasks.map((t) => t.id)).toEqual(["t-local"]);
  });

  it("keeps a task present only in remote", () => {
    const local = file({ phases: [], tasks: [] });
    const remote = file({ phases: [], tasks: [task({ id: "t-remote" })] });
    const merged = mergeAikSystemFiles(local, remote);
    expect(merged.tasks.map((t) => t.id)).toEqual(["t-remote"]);
  });

  it("keeps the task with the most recent updatedAt when present on both sides", () => {
    const local = file({
      phases: [],
      tasks: [
        task({
          id: "t1",
          title: "local (fresh)",
          updatedAt: "2025-01-05T00:00:00.000Z",
        }),
      ],
    });
    const remote = file({
      phases: [],
      tasks: [
        task({
          id: "t1",
          title: "remote (stale)",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
      ],
    });
    const merged = mergeAikSystemFiles(local, remote);
    expect(merged.tasks[0].title).toBe("local (fresh)");
  });

  it("keeps the remote task when it is newer than local", () => {
    const local = file({
      phases: [],
      tasks: [
        task({
          id: "t1",
          title: "local (stale)",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
      ],
    });
    const remote = file({
      phases: [],
      tasks: [
        task({
          id: "t1",
          title: "remote (fresh)",
          updatedAt: "2025-01-05T00:00:00.000Z",
        }),
      ],
    });
    const merged = mergeAikSystemFiles(local, remote);
    expect(merged.tasks[0].title).toBe("remote (fresh)");
  });
});

describe("readAikSystemFile", () => {
  it("returns cloud_unsupported immediately on a Cloud backend, without calling executeCommand", async () => {
    getActiveBackendMock.mockReturnValue({
      backend: { kind: "cloud" as const },
    });

    const result = await readAikSystemFile("/workspace");

    expect(result).toEqual({ ok: false, errorType: "cloud_unsupported" });
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it("returns ok:true with the parsed file on success, using cat -- on the expected path", async () => {
    executeCommandMock.mockResolvedValue({
      exit_code: 0,
      stdout: JSON.stringify(file()),
      stderr: "",
    });

    const result = await readAikSystemFile("/workspace");

    expect(result).toEqual({ ok: true, file: file() });
    const [, , command, cwd] = executeCommandMock.mock.calls[0];
    expect(command).toBe("cat -- '/workspace/.openhands/aik/system.json'");
    expect(cwd).toBe("/workspace");
  });

  it("returns workspace_unreachable when cat exits non-zero", async () => {
    executeCommandMock.mockResolvedValue({
      exit_code: 1,
      stdout: "",
      stderr: "no such file",
    });

    const result = await readAikSystemFile("/workspace");

    expect(result).toEqual({ ok: false, errorType: "workspace_unreachable" });
  });

  it("returns parse_error for malformed JSON, without throwing", async () => {
    executeCommandMock.mockResolvedValue({
      exit_code: 0,
      stdout: "not json {",
      stderr: "",
    });

    const result = await readAikSystemFile("/workspace");

    expect(result).toEqual({ ok: false, errorType: "parse_error" });
  });

  it("returns parse_error for an unknown version, without throwing", async () => {
    executeCommandMock.mockResolvedValue({
      exit_code: 0,
      stdout: JSON.stringify({ ...file(), version: 2 }),
      stderr: "",
    });

    const result = await readAikSystemFile("/workspace");

    expect(result).toEqual({ ok: false, errorType: "parse_error" });
  });

  it("never throws — converts an infrastructure exception into ok:false", async () => {
    executeCommandMock.mockRejectedValue(new Error("boom"));

    const result = await readAikSystemFile("/workspace");

    expect(result).toEqual({ ok: false, errorType: "workspace_unreachable" });
  });
});

describe("writeAikSystemFile", () => {
  it("returns cloud_unsupported immediately on a Cloud backend, without calling executeCommand", async () => {
    getActiveBackendMock.mockReturnValue({
      backend: { kind: "cloud" as const },
    });

    const result = await writeAikSystemFile("/workspace", file());

    expect(result).toEqual({ ok: false, errorType: "cloud_unsupported" });
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it("does a read-modify-write: merges against the current on-disk file before writing", async () => {
    const onDisk = file({
      phases: [],
      tasks: [
        task({
          id: "agent-task",
          title: "written by agent",
          updatedAt: "2025-02-01T00:00:00.000Z",
        }),
      ],
    });
    const toWrite = file({
      phases: [],
      tasks: [
        task({
          id: "browser-task",
          title: "written by browser",
          updatedAt: "2025-01-15T00:00:00.000Z",
        }),
      ],
    });

    executeCommandMock
      .mockResolvedValueOnce({
        exit_code: 0,
        stdout: JSON.stringify(onDisk),
        stderr: "",
      }) // read
      .mockResolvedValueOnce({ exit_code: 0, stdout: "", stderr: "" }); // write

    const result = await writeAikSystemFile("/workspace", toWrite);

    expect(result).toEqual({ ok: true });
    expect(executeCommandMock).toHaveBeenCalledTimes(2);
    const writeCommand = executeCommandMock.mock.calls[1][2];
    const base64Match = writeCommand.match(/printf '%s' '([^']*)'/);
    expect(base64Match).not.toBeNull();
    const written = JSON.parse(
      Buffer.from(base64Match![1], "base64").toString("utf-8"),
    ) as AikSystemFile;
    const ids = written.tasks.map((t) => t.id).sort();
    expect(ids).toEqual(["agent-task", "browser-task"]);
  });

  it("writes the next snapshot as-is when there is nothing on disk yet (first write)", async () => {
    executeCommandMock
      .mockResolvedValueOnce({ exit_code: 1, stdout: "", stderr: "not found" }) // read fails
      .mockResolvedValueOnce({ exit_code: 0, stdout: "", stderr: "" }); // write

    const result = await writeAikSystemFile("/workspace", file());

    expect(result).toEqual({ ok: true });
    const writeCommand = executeCommandMock.mock.calls[1][2];
    const base64Match = writeCommand.match(/printf '%s' '([^']*)'/);
    const written = JSON.parse(
      Buffer.from(base64Match![1], "base64").toString("utf-8"),
    ) as AikSystemFile;
    expect(written.phases).toEqual(file().phases);
  });

  it("returns workspace_unreachable when the write command fails", async () => {
    executeCommandMock
      .mockResolvedValueOnce({ exit_code: 1, stdout: "", stderr: "" }) // read fails -> no merge
      .mockResolvedValueOnce({ exit_code: 1, stdout: "", stderr: "disk full" }); // write fails

    const result = await writeAikSystemFile("/workspace", file());

    expect(result).toEqual({ ok: false, errorType: "workspace_unreachable" });
  });

  it("never throws — converts an infrastructure exception into ok:false", async () => {
    executeCommandMock.mockRejectedValue(new Error("NoBackendAvailableError"));

    const result = await writeAikSystemFile("/workspace", file());

    expect(result).toEqual({ ok: false, errorType: "workspace_unreachable" });
  });

  it("never serializes a Backend.apiKey into the written payload (CA-35)", async () => {
    executeCommandMock
      .mockResolvedValueOnce({ exit_code: 1, stdout: "", stderr: "not found" })
      .mockResolvedValueOnce({ exit_code: 0, stdout: "", stderr: "" });

    await writeAikSystemFile("/workspace", file());

    const writeCommand = executeCommandMock.mock.calls[1][2];
    const base64Match = writeCommand.match(/printf '%s' '([^']*)'/);
    const writtenRaw = Buffer.from(base64Match![1], "base64").toString("utf-8");
    expect(writtenRaw).not.toContain("apiKey");
  });
});
