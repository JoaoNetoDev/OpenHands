import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AikPhase, AikSystem, AikTask } from "#/types/aik";

vi.mock(
  "#/api/conversation-service/agent-server-conversation-service.api",
  () => ({
    default: {
      createConversation: vi.fn(),
    },
  }),
);

import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import { buildAikAgentBriefing, startAikAgentTask } from "./aik-pipeline.api";

const createConversationMock =
  AgentServerConversationService.createConversation as unknown as ReturnType<
    typeof vi.fn
  >;

beforeEach(() => {
  createConversationMock.mockReset();
});

function buildSystem(overrides: Partial<AikSystem> = {}): AikSystem {
  return {
    id: "system-1",
    name: "Sistema Um",
    backendId: "default-local",
    workspaceRef: { kind: "local", workspaceId: "ws-1", path: "/workspace" },
    columnId: "ativo",
    activeAgentTaskId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildPhase(overrides: Partial<AikPhase> = {}): AikPhase {
  return {
    id: "phase-1",
    systemId: "system-1",
    title: "Fase Um",
    columnId: "backlog",
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildTask(overrides: Partial<AikTask> = {}): AikTask {
  return {
    id: "task-1",
    phaseId: "phase-1",
    systemId: "system-1",
    title: "Minha tarefa",
    executorType: "agent",
    priority: "p1",
    columnId: "backlog",
    order: 0,
    timeline: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildAikAgentBriefing", () => {
  it("does not mention any skill when task.agentSkill is absent", () => {
    const message = buildAikAgentBriefing(
      buildTask({ agentSkill: undefined }),
      buildPhase(),
      buildSystem(),
      "",
    );

    expect(message).not.toContain("Use a skill");
  });

  it("mentions exactly one skill line when task.agentSkill is present", () => {
    const message = buildAikAgentBriefing(
      buildTask({ agentSkill: "featdevelop" }),
      buildPhase(),
      buildSystem(),
      "",
    );

    const matches = message.match(/Use a skill \/featdevelop\./g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("includes the task title always", () => {
    const message = buildAikAgentBriefing(
      buildTask({ title: "Corrigir bug X" }),
      buildPhase(),
      buildSystem(),
      "",
    );

    expect(message).toContain('Tarefa: "Corrigir bug X"');
  });

  it("includes the description when present, omits when absent", () => {
    const withDescription = buildAikAgentBriefing(
      buildTask({ description: "Detalhes da tarefa" }),
      buildPhase(),
      buildSystem(),
      "",
    );
    expect(withDescription).toContain("Detalhes da tarefa");

    const withoutDescription = buildAikAgentBriefing(
      buildTask({ description: undefined }),
      buildPhase(),
      buildSystem(),
      "",
    );
    expect(withoutDescription).not.toContain("Detalhes da tarefa");
  });

  it("includes inherited context (phase + system name), never the full task/phase list", () => {
    const message = buildAikAgentBriefing(
      buildTask(),
      buildPhase({ title: "Fase de testes" }),
      buildSystem({ name: "Sistema de Pagamentos" }),
      "",
    );

    expect(message).toContain('Fase: "Fase de testes"');
    expect(message).toContain('Sistema: "Sistema de Pagamentos"');
  });

  it("lists only unfinished checklist items", () => {
    const message = buildAikAgentBriefing(
      buildTask({
        checklist: [
          { id: "c1", text: "Item pendente", done: false },
          { id: "c2", text: "Item concluido", done: true },
        ],
      }),
      buildPhase(),
      buildSystem(),
      "",
    );

    expect(message).toContain("Item pendente");
    expect(message).not.toContain("Item concluido");
  });

  it("omits the checklist paragraph when checklist is empty or absent", () => {
    const message = buildAikAgentBriefing(
      buildTask({ checklist: [] }),
      buildPhase(),
      buildSystem(),
      "",
    );

    expect(message).not.toContain("checklist");
  });

  it("includes contextText when non-empty, omits when empty", () => {
    const withContext = buildAikAgentBriefing(
      buildTask(),
      buildPhase(),
      buildSystem(),
      "contexto adicional digitado pelo usuário",
    );
    expect(withContext).toContain("contexto adicional digitado pelo usuário");

    const withoutContext = buildAikAgentBriefing(
      buildTask(),
      buildPhase(),
      buildSystem(),
      "",
    );
    expect(withoutContext).not.toContain(
      "contexto adicional digitado pelo usuário",
    );
  });

  it("includes the file contract only when linkedConversationId is already set (re-run)", () => {
    const withLink = buildAikAgentBriefing(
      buildTask({ id: "task-abc", linkedConversationId: "conversation-1" }),
      buildPhase(),
      buildSystem(),
      "",
    );
    expect(withLink).toContain(".openhands/aik/system.json");
    expect(withLink).toContain("task-abc");
    expect(withLink).toContain('columnId="in_review"');

    const withoutLink = buildAikAgentBriefing(
      buildTask({ linkedConversationId: undefined }),
      buildPhase(),
      buildSystem(),
      "",
    );
    expect(withoutLink).not.toContain("system.json");
  });

  it("CA-34/RNF-03: message size is bounded by the task's own fields, not by how many other tasks the system has", () => {
    // buildAikAgentBriefing's signature only accepts a single
    // task/phase/system (plus contextText) — it structurally cannot
    // iterate the system's full phase/task list. This test documents that
    // guarantee: a briefing built from a small system is the same length
    // as one built from a system/phase carrying markers that stand in for
    // "500 tasks worth of data" elsewhere in the app, since none of that
    // data ever reaches this function.
    const smallSystem = buildSystem({ name: "Sistema Pequeno" });
    const smallPhase = buildPhase({ title: "Fase Pequena" });
    const task = buildTask({
      id: "task-fixed",
      title: "Tarefa fixa",
      description: "Descrição fixa",
    });

    const messageWithSmallSystem = buildAikAgentBriefing(
      task,
      smallPhase,
      smallSystem,
      "",
    );

    // A system/phase with the same relevant fields (name/title) as above —
    // the function has no parameter through which a 500-task system could
    // even be represented, so this simply re-confirms determinism/no
    // hidden global lookup.
    const largeSystemMarkerFields = buildSystem({
      name: "Sistema Pequeno",
      id: "system-with-500-tasks-elsewhere",
    });
    const largePhaseMarkerFields = buildPhase({
      title: "Fase Pequena",
      id: "phase-with-500-tasks-elsewhere",
    });

    const messageWithLargeSystemMarker = buildAikAgentBriefing(
      task,
      largePhaseMarkerFields,
      largeSystemMarkerFields,
      "",
    );

    expect(messageWithLargeSystemMarker.length).toBe(
      messageWithSmallSystem.length,
    );
  });

  it("SPEC §2.5: emits all sections in the exact order — skill, title, description, phase/system, checklist, contextText, file contract", () => {
    const message = buildAikAgentBriefing(
      buildTask({
        agentSkill: "featdevelop",
        title: "Corrigir bug X",
        description: "Detalhes da tarefa",
        id: "task-abc",
        linkedConversationId: "conversation-1",
        checklist: [{ id: "c1", text: "Item pendente", done: false }],
      }),
      buildPhase({ title: "Fase de testes" }),
      buildSystem({ name: "Sistema de Pagamentos" }),
      "contexto adicional digitado pelo usuário",
    );

    const skillIdx = message.indexOf("Use a skill");
    const titleIdx = message.indexOf('Tarefa: "Corrigir bug X"');
    const descriptionIdx = message.indexOf("Detalhes da tarefa");
    const phaseIdx = message.indexOf('Fase: "Fase de testes"');
    const systemIdx = message.indexOf('Sistema: "Sistema de Pagamentos"');
    const checklistIdx = message.indexOf("Itens pendentes do checklist:");
    const contextTextIdx = message.indexOf(
      "contexto adicional digitado pelo usuário",
    );
    const fileContractIdx = message.indexOf(".openhands/aik/system.json");

    for (const idx of [
      skillIdx,
      titleIdx,
      descriptionIdx,
      phaseIdx,
      systemIdx,
      checklistIdx,
      contextTextIdx,
      fileContractIdx,
    ]) {
      expect(idx).toBeGreaterThanOrEqual(0);
    }

    expect(skillIdx).toBeLessThan(titleIdx);
    expect(titleIdx).toBeLessThan(descriptionIdx);
    expect(descriptionIdx).toBeLessThan(phaseIdx);
    expect(phaseIdx).toBeLessThan(systemIdx);
    expect(systemIdx).toBeLessThan(checklistIdx);
    expect(checklistIdx).toBeLessThan(contextTextIdx);
    expect(contextTextIdx).toBeLessThan(fileContractIdx);
  });
});

describe("startAikAgentTask", () => {
  it("local workspace: calls createConversation with workingDirOverride", async () => {
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

    const system = buildSystem({
      workspaceRef: { kind: "local", workspaceId: "ws-1", path: "/workspace" },
    });

    const result = await startAikAgentTask(system, buildPhase(), buildTask());

    expect(result).toEqual({ ok: true, conversationId: "conversation-id-456" });
    expect(createConversationMock).toHaveBeenCalledTimes(1);
    const [options] = createConversationMock.mock.calls[0];
    expect(options.workingDirOverride).toBe("/workspace");
    expect(options.metadata).toBeUndefined();
  });

  it("cloud workspace: calls createConversation with metadata.selected_repository/git_provider, never workingDirOverride", async () => {
    createConversationMock.mockResolvedValueOnce({
      id: "task-id-123",
      created_by_user_id: null,
      status: "READY",
      detail: null,
      app_conversation_id: "conversation-id-789",
      agent_server_url: null,
      request: {},
      created_at: "",
      updated_at: "",
    });

    const system = buildSystem({
      workspaceRef: {
        kind: "cloud",
        repository: { provider: "github", fullName: "org/repo" },
      },
    });

    const result = await startAikAgentTask(system, buildPhase(), buildTask());

    expect(result).toEqual({ ok: true, conversationId: "conversation-id-789" });
    expect(createConversationMock).toHaveBeenCalledTimes(1);
    const [options] = createConversationMock.mock.calls[0];
    expect(options.metadata).toEqual(
      expect.objectContaining({
        selected_repository: "org/repo",
        git_provider: "github",
      }),
    );
    expect(options.workingDirOverride).toBeUndefined();
  });

  it("returns ok: false with the error message when createConversation rejects", async () => {
    createConversationMock.mockRejectedValueOnce(
      new Error("sem backend disponível"),
    );

    const result = await startAikAgentTask(
      buildSystem(),
      buildPhase(),
      buildTask(),
    );

    expect(result).toEqual({ ok: false, error: "sem backend disponível" });
  });

  it("returns ok: false when app_conversation_id is missing/null in the response", async () => {
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

    const result = await startAikAgentTask(
      buildSystem(),
      buildPhase(),
      buildTask(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });

  it("F-04-2: returns ok:false without calling createConversation when repository.provider is not a valid Provider", async () => {
    const system = buildSystem({
      workspaceRef: {
        kind: "cloud",
        repository: { provider: "not-a-real-provider", fullName: "org/repo" },
      },
    });

    const result = await startAikAgentTask(system, buildPhase(), buildTask());

    expect(result).toEqual({ ok: false, error: "invalid_git_provider" });
    expect(createConversationMock).not.toHaveBeenCalled();
  });

  it("does not touch any store — the returned promise carries the sole result, no side effects on system/task objects", async () => {
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

    const system = buildSystem();
    const task = buildTask();
    const originalSystem = { ...system };
    const originalTask = { ...task };

    await startAikAgentTask(system, buildPhase(), task);

    expect(system).toEqual(originalSystem);
    expect(task).toEqual(originalTask);
  });
});
