import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWriteFileCommand,
  escapeSingleQuoted,
  sinterizeTask,
} from "./kanban-sintering.api";
import type { KanbanTask } from "#/types/kanban";

vi.mock("#/api/runtime-service/agent-server-runtime-service", () => ({
  default: {
    executeCommand: vi.fn(),
  },
}));

import AgentServerRuntimeService from "#/api/runtime-service/agent-server-runtime-service";

function baseTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    boardId: "board-1",
    parentId: null,
    level: 1,
    title: "Título",
    columnId: "todo",
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("escapeSingleQuoted", () => {
  it("wraps a plain value in single quotes", () => {
    expect(escapeSingleQuoted("abc")).toBe("'abc'");
  });

  it("escapes embedded single quotes using the POSIX close/escape/reopen technique", () => {
    expect(escapeSingleQuoted("it's")).toBe("'it'\\''s'");
  });

  it("neutralizes backticks and command substitution syntax literally", () => {
    expect(escapeSingleQuoted("`whoami`$(whoami)")).toBe("'`whoami`$(whoami)'");
  });
});

describe("buildWriteFileCommand", () => {
  it("throws when contentBase64 contains characters outside the base64 alphabet", () => {
    expect(() => buildWriteFileCommand("/tmp/x", "not-base64!")).toThrow();
    expect(() => buildWriteFileCommand("/tmp/x", "; rm -rf /")).toThrow();
  });

  it("accepts a valid base64 alphabet (including padding)", () => {
    expect(() =>
      buildWriteFileCommand("/tmp/x", Buffer.from("hello").toString("base64")),
    ).not.toThrow();
  });

  it("wraps the dirname command substitution in double quotes (regression: word-splitting bug)", () => {
    const command = buildWriteFileCommand("/tmp/a b/file.txt", "aGVsbG8=");
    expect(command).toContain('mkdir -p "$(dirname');
    expect(command).not.toMatch(/mkdir -p \$\(dirname/);
  });
});

describe("buildWriteFileCommand — real shell execution (adversarial)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-sinter-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runCommand(command: string) {
    execSync(command, { shell: "/bin/bash" });
  }

  it("writes exactly the expected content to the expected path, with no side effects", () => {
    const targetPath = path.join(tmpDir, "notes", "task.md");
    const content = "hello world\nline two";
    const contentBase64 = Buffer.from(content, "utf-8").toString("base64");
    const command = buildWriteFileCommand(targetPath, contentBase64);

    runCommand(command);

    expect(fs.readFileSync(targetPath, "utf-8")).toBe(content);
    // no unexpected files created anywhere in tmpDir besides the target
    const entries = fs.readdirSync(path.join(tmpDir, "notes"));
    expect(entries).toEqual(["task.md"]);
  });

  it("handles a workspace path containing a space correctly (dirname regression)", () => {
    const spacedDir = path.join(tmpDir, "john doe workspace", "sub dir");
    const targetPath = path.join(spacedDir, "file with space.md");
    const content = "content";
    const contentBase64 = Buffer.from(content, "utf-8").toString("base64");
    const command = buildWriteFileCommand(targetPath, contentBase64);

    runCommand(command);

    expect(fs.existsSync(targetPath)).toBe(true);
    expect(fs.readFileSync(targetPath, "utf-8")).toBe(content);
    // exactly one directory tree was created, not split across multiple
    // mkdir targets because of word-splitting on the space.
    expect(fs.existsSync(path.join(tmpDir, "john"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "doe"))).toBe(false);
  });

  it("never lets a title/content payload with a single quote, backtick, $(...) or ; escape the base64 content", () => {
    const maliciousMarker = path.join(tmpDir, "PWNED");
    const maliciousTitle =
      "'; touch " + maliciousMarker + " ; echo `whoami` $(whoami) #";
    const targetPath = path.join(tmpDir, "task.md");
    // The malicious text is part of the *content*, encoded as base64 —
    // exactly as sinterizeTask does with task.title in buildMarkdown.
    const contentBase64 = Buffer.from(maliciousTitle, "utf-8").toString(
      "base64",
    );
    const command = buildWriteFileCommand(targetPath, contentBase64);

    runCommand(command);

    expect(fs.existsSync(maliciousMarker)).toBe(false);
    expect(fs.readFileSync(targetPath, "utf-8")).toBe(maliciousTitle);
  });

  it("never lets a semicolon-chained rm payload in the content execute anything", () => {
    const canaryPath = path.join(tmpDir, "canary.txt");
    fs.writeFileSync(canaryPath, "still here");
    const targetPath = path.join(tmpDir, "task2.md");
    const payload = "; rm -rf " + tmpDir + " #";
    const contentBase64 = Buffer.from(payload, "utf-8").toString("base64");
    const command = buildWriteFileCommand(targetPath, contentBase64);

    runCommand(command);

    expect(fs.existsSync(canaryPath)).toBe(true);
    expect(fs.readFileSync(targetPath, "utf-8")).toBe(payload);
  });

  it("preserves a newline embedded in the content without breaking the command", () => {
    const targetPath = path.join(tmpDir, "task3.md");
    const payload = "line one\nline two\nline three";
    const contentBase64 = Buffer.from(payload, "utf-8").toString("base64");
    const command = buildWriteFileCommand(targetPath, contentBase64);

    runCommand(command);

    expect(fs.readFileSync(targetPath, "utf-8")).toBe(payload);
  });

  it("overwrites the file on a second write (RF-06 style re-run)", () => {
    const targetPath = path.join(tmpDir, "task4.md");
    const first = "first version";
    const second = "second version, shorter overwrite check";
    runCommand(
      buildWriteFileCommand(targetPath, Buffer.from(first).toString("base64")),
    );
    runCommand(
      buildWriteFileCommand(targetPath, Buffer.from(second).toString("base64")),
    );

    expect(fs.readFileSync(targetPath, "utf-8")).toBe(second);
  });
});

describe("sinterizeTask", () => {
  const executeCommandMock = vi.mocked(
    AgentServerRuntimeService.executeCommand,
  );

  beforeEach(() => {
    executeCommandMock.mockReset();
  });

  it("returns ok:true and writes the .md via executeCommand when successful", async () => {
    executeCommandMock.mockResolvedValue({
      exit_code: 0,
      stdout: "",
      stderr: "",
    });

    const task = baseTask({
      title: "My task with 'quotes' and `backticks` $(whoami)",
      description: "desc; rm -rf /",
    });

    const result = await sinterizeTask("/workspace", task);

    expect(result).toEqual({ ok: true });
    expect(executeCommandMock).toHaveBeenCalledTimes(1);
    const [, , command, cwd] = executeCommandMock.mock.calls[0];
    expect(command).toContain("/workspace/.openhands/kanban/task-1.md");
    expect(cwd).toBe("/workspace");
  });

  it("writes attachments after the .md file, in order", async () => {
    executeCommandMock.mockResolvedValue({
      exit_code: 0,
      stdout: "",
      stderr: "",
    });

    const task = baseTask({
      attachments: [
        { id: "a1", fileName: "log.txt", sizeBytes: 3, contentBase64: "YWJj" },
        {
          id: "a2",
          fileName: "notes.txt",
          sizeBytes: 3,
          contentBase64: "eHl6",
        },
      ],
    });

    const result = await sinterizeTask("/workspace", task);

    expect(result).toEqual({ ok: true });
    expect(executeCommandMock).toHaveBeenCalledTimes(3);
    const paths = executeCommandMock.mock.calls.map((call) => call[2]);
    expect(paths[0]).toContain("task-1.md");
    expect(paths[1]).toContain("task-1/attachments/log.txt");
    expect(paths[2]).toContain("task-1/attachments/notes.txt");
  });

  it("returns ok:false and does not attempt attachments when the .md write fails", async () => {
    executeCommandMock.mockResolvedValue({
      exit_code: 1,
      stdout: "",
      stderr: "permission denied",
    });

    const task = baseTask({
      attachments: [
        { id: "a1", fileName: "log.txt", sizeBytes: 3, contentBase64: "YWJj" },
      ],
    });

    const result = await sinterizeTask("/workspace", task);

    expect(result).toEqual({ ok: false, error: "permission denied" });
    expect(executeCommandMock).toHaveBeenCalledTimes(1);
  });

  it("returns ok:false with a specific message when an attachment in the middle fails", async () => {
    executeCommandMock
      .mockResolvedValueOnce({ exit_code: 0, stdout: "", stderr: "" }) // .md
      .mockResolvedValueOnce({ exit_code: 0, stdout: "", stderr: "" }) // a1
      .mockResolvedValueOnce({ exit_code: 1, stdout: "", stderr: "disk full" }); // a2

    const task = baseTask({
      attachments: [
        { id: "a1", fileName: "log.txt", sizeBytes: 3, contentBase64: "YWJj" },
        {
          id: "a2",
          fileName: "notes.txt",
          sizeBytes: 3,
          contentBase64: "eHl6",
        },
        {
          id: "a3",
          fileName: "third.txt",
          sizeBytes: 3,
          contentBase64: "eHl6",
        },
      ],
    });

    const result = await sinterizeTask("/workspace", task);

    expect(result).toEqual({
      ok: false,
      error: 'Falha ao gravar o anexo "notes.txt": disk full',
    });
    // third attachment never attempted
    expect(executeCommandMock).toHaveBeenCalledTimes(3);
  });

  it("never throws — converts an infrastructure exception into ok:false", async () => {
    executeCommandMock.mockRejectedValue(new Error("NoBackendAvailableError"));

    const task = baseTask();

    const result = await sinterizeTask("/workspace", task);

    expect(result).toEqual({ ok: false, error: "NoBackendAvailableError" });
  });

  it("never throws even for a non-Error rejection", async () => {
    executeCommandMock.mockRejectedValue("weird rejection");

    const task = baseTask();

    const result = await sinterizeTask("/workspace", task);

    expect(result).toEqual({
      ok: false,
      error: "Erro desconhecido ao sinterizar",
    });
  });
});
