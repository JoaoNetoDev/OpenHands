import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanTask } from "#/types/kanban";

vi.mock("#/api/runtime-service/agent-server-runtime-service", () => ({
  default: {
    executeCommand: vi.fn(),
  },
}));

vi.mock(
  "#/api/conversation-service/agent-server-conversation-service.api",
  () => ({
    default: {
      createConversation: vi.fn(),
    },
  }),
);

import AgentServerRuntimeService from "#/api/runtime-service/agent-server-runtime-service";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import {
  buildFeatdevelopInitialMessage,
  listFeatureSprintFiles,
  readFeatureDoc,
  startFeatdevelopConversation,
} from "./kanban-pipeline.api";

const executeCommandMock =
  AgentServerRuntimeService.executeCommand as unknown as ReturnType<
    typeof vi.fn
  >;

const createConversationMock =
  AgentServerConversationService.createConversation as unknown as ReturnType<
    typeof vi.fn
  >;

beforeEach(() => {
  executeCommandMock.mockReset();
  createConversationMock.mockReset();
});

function buildTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    boardId: "board-1",
    parentId: null,
    level: 1,
    title: "Minha feature",
    columnId: "featdevelop_todo",
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    featureSlug: "minha-feature",
    ...overrides,
  };
}

describe("readFeatureDoc", () => {
  it("returns exists: true with content when exit_code is 0", async () => {
    executeCommandMock.mockResolvedValueOnce({
      exit_code: 0,
      stdout: "# PRD\nconteúdo do documento",
      stderr: "",
    });

    const result = await readFeatureDoc(
      "/workspace",
      "docs/features/meu-slug/PRD.md",
    );

    expect(result).toEqual({
      exists: true,
      content: "# PRD\nconteúdo do documento",
    });
  });

  it("returns exists: false when exit_code is not 0, without throwing", async () => {
    executeCommandMock.mockResolvedValueOnce({
      exit_code: 1,
      stdout: "",
      stderr: "cat: no such file",
    });

    await expect(
      readFeatureDoc("/workspace", "docs/features/meu-slug/PRD.md"),
    ).resolves.toEqual({ exists: false });
  });

  it("uses cat -- with an escaped path built from workspacePath + relativePath", async () => {
    executeCommandMock.mockResolvedValueOnce({
      exit_code: 0,
      stdout: "ok",
      stderr: "",
    });

    await readFeatureDoc("/work space", "docs/features/meu-slug/TECH.md");

    const [, , command] = executeCommandMock.mock.calls[0];
    expect(command).toContain("cat --");
    expect(command).toContain("'/work space/docs/features/meu-slug/TECH.md'");
  });
});

describe("listFeatureSprintFiles", () => {
  it("returns a list of file names when the folder exists", async () => {
    executeCommandMock.mockResolvedValueOnce({
      exit_code: 0,
      stdout: "SPRINT-01.md\nSPRINT-02.md\n",
      stderr: "",
    });

    const result = await listFeatureSprintFiles("/workspace", "meu-slug");

    expect(result).toEqual(["SPRINT-01.md", "SPRINT-02.md"]);
  });

  it("returns an empty list when the folder does not exist, without throwing", async () => {
    executeCommandMock.mockResolvedValueOnce({
      exit_code: 1,
      stdout: "",
      stderr: "",
    });

    await expect(
      listFeatureSprintFiles("/workspace", "meu-slug"),
    ).resolves.toEqual([]);
  });
});

describe("defense in depth: internal slug revalidation", () => {
  it("readFeatureDoc never calls executeCommand for a path traversal / invalid slug", async () => {
    const guardMock = vi.fn(() => {
      throw new Error(
        "executeCommand should never be called for an invalid slug",
      );
    });
    executeCommandMock.mockImplementation(guardMock);

    const result = await readFeatureDoc(
      "/workspace",
      "docs/features/../../etc/passwd/PRD.md",
    );

    expect(result).toEqual({ exists: false });
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it("readFeatureDoc never calls executeCommand for an uppercase/spaced slug embedded in relativePath", async () => {
    executeCommandMock.mockImplementation(() => {
      throw new Error(
        "executeCommand should never be called for an invalid slug",
      );
    });

    const result = await readFeatureDoc(
      "/workspace",
      "docs/features/Meu Slug/PRD.md",
    );

    expect(result).toEqual({ exists: false });
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it("listFeatureSprintFiles never calls executeCommand for an invalid slug", async () => {
    executeCommandMock.mockImplementation(() => {
      throw new Error(
        "executeCommand should never be called for an invalid slug",
      );
    });

    const result = await listFeatureSprintFiles(
      "/workspace",
      "../../etc/passwd",
    );

    expect(result).toEqual([]);
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it("listFeatureSprintFiles never calls executeCommand for a slug with spaces or underscores", async () => {
    executeCommandMock.mockImplementation(() => {
      throw new Error(
        "executeCommand should never be called for an invalid slug",
      );
    });

    const result = await listFeatureSprintFiles(
      "/workspace",
      "meu_slug invalido",
    );

    expect(result).toEqual([]);
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it("readFeatureDoc never calls executeCommand when relativePath does not start with docs/features/ (F-KP1-1)", async () => {
    executeCommandMock.mockImplementation(() => {
      throw new Error(
        "executeCommand should never be called when relativePath has no docs/features/ prefix",
      );
    });

    const result = await readFeatureDoc("/workspace", "../../../etc/passwd");

    expect(result).toEqual({ exists: false });
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it("readFeatureDoc never calls executeCommand for an absolute path outside docs/features/ (F-KP1-1)", async () => {
    executeCommandMock.mockImplementation(() => {
      throw new Error(
        "executeCommand should never be called when relativePath has no docs/features/ prefix",
      );
    });

    const result = await readFeatureDoc("/workspace", "/etc/passwd");

    expect(result).toEqual({ exists: false });
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it("readFeatureDoc never calls executeCommand for a valid-slug traversal payload (F-KP1-1 bypass)", async () => {
    executeCommandMock.mockImplementation(() => {
      throw new Error(
        "executeCommand should never be called when relativePath contains a .. segment, even with a valid slug prefix",
      );
    });

    const result = await readFeatureDoc(
      "/workspace",
      "docs/features/valid-slug/../../../etc/passwd",
    );

    expect(result).toEqual({ exists: false });
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it("readFeatureDoc still works for a legitimate path with a valid slug and no .. segments", async () => {
    executeCommandMock.mockResolvedValueOnce({
      exit_code: 0,
      stdout: "# SPEC",
      stderr: "",
    });

    const result = await readFeatureDoc(
      "/workspace",
      "docs/features/valid-slug/SPEC.md",
    );

    expect(result).toEqual({ exists: true, content: "# SPEC" });
    expect(executeCommandMock).toHaveBeenCalledTimes(1);
  });
});

describe("buildFeatdevelopInitialMessage", () => {
  it("includes title and slug, and omits description/context when absent", () => {
    const task = buildTask({ description: undefined });

    const message = buildFeatdevelopInitialMessage(task, "");

    expect(message).toContain("Minha feature");
    expect(message).toContain("minha-feature");
    expect(message).not.toContain("Descrição:");
    expect(message).not.toContain("Contexto adicional do usuário");
  });

  it("includes the description when present", () => {
    const task = buildTask({ description: "Uma descrição qualquer" });

    const message = buildFeatdevelopInitialMessage(task, "");

    expect(message).toContain("Descrição: Uma descrição qualquer");
  });

  it("includes the additional context when present", () => {
    const task = buildTask({ description: undefined });

    const message = buildFeatdevelopInitialMessage(task, "algum contexto");

    expect(message).toContain("Contexto adicional do usuário:\nalgum contexto");
  });
});

describe("startFeatdevelopConversation", () => {
  it("returns ok: true with conversationId = app_conversation_id on success", async () => {
    createConversationMock.mockResolvedValueOnce({
      id: "task-id-123",
      created_by_user_id: null,
      status: "READY",
      detail: null,
      app_conversation_id: "conversation-id-456",
      agent_server_url: null,
      request: {},
      created_at: "",
      updated_at: "",
    });

    const result = await startFeatdevelopConversation(
      "/workspace",
      buildTask(),
    );

    expect(result).toEqual({ ok: true, conversationId: "conversation-id-456" });
  });

  it("returns ok: false with the error message when createConversation rejects", async () => {
    createConversationMock.mockRejectedValueOnce(
      new Error("sem backend disponível"),
    );

    const result = await startFeatdevelopConversation(
      "/workspace",
      buildTask(),
    );

    expect(result).toEqual({ ok: false, error: "sem backend disponível" });
  });

  it("returns ok: false when app_conversation_id is missing/null in the response, never assuming success with an undefined id", async () => {
    createConversationMock.mockResolvedValueOnce({
      id: "task-id-123",
      created_by_user_id: null,
      status: "STARTING_CONVERSATION",
      detail: null,
      app_conversation_id: null,
      agent_server_url: null,
      request: {},
      created_at: "",
      updated_at: "",
    });

    const result = await startFeatdevelopConversation(
      "/workspace",
      buildTask(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });

  it("calling it twice creates two distinct conversations (RF-06)", async () => {
    createConversationMock
      .mockResolvedValueOnce({
        id: "task-1",
        created_by_user_id: null,
        status: "READY",
        detail: null,
        app_conversation_id: "conversation-1",
        agent_server_url: null,
        request: {},
        created_at: "",
        updated_at: "",
      })
      .mockResolvedValueOnce({
        id: "task-2",
        created_by_user_id: null,
        status: "READY",
        detail: null,
        app_conversation_id: "conversation-2",
        agent_server_url: null,
        request: {},
        created_at: "",
        updated_at: "",
      });

    const first = await startFeatdevelopConversation("/workspace", buildTask());
    const second = await startFeatdevelopConversation(
      "/workspace",
      buildTask(),
    );

    expect(createConversationMock).toHaveBeenCalledTimes(2);
    expect(first).toEqual({ ok: true, conversationId: "conversation-1" });
    expect(second).toEqual({ ok: true, conversationId: "conversation-2" });
  });
});
