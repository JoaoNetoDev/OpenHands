import { describe, expect, it } from "vitest";
import { I18nKey } from "#/i18n/declaration";
import { ExecutionStatus } from "#/types/agent-server/core/base/common";
import {
  canShowAcpProviderSwitch,
  getAcpErrorHeaderKey,
  isAcpAuthErrorCode,
  type AcpRecoveryConversationShape,
} from "#/utils/acp-error-codes";

describe("acp-error-codes", () => {
  it("maps the auth code to the auth header key", () => {
    expect(getAcpErrorHeaderKey("ACPAuthRequired")).toBe(
      I18nKey.ERROR$ACP_AUTH_REQUIRED_TITLE,
    );
  });

  it("maps other ACP codes to the generic agent-error header", () => {
    for (const code of [
      "ACPSpawnError",
      "ACPInitError",
      "ACPPromptError",
      "UsagePolicyRefusal",
    ]) {
      expect(getAcpErrorHeaderKey(code)).toBe(
        I18nKey.CHAT_INTERFACE$AGENT_ERROR_MESSAGE,
      );
    }
  });

  it("returns null for unknown, empty, or missing codes", () => {
    expect(getAcpErrorHeaderKey(null)).toBeNull();
    expect(getAcpErrorHeaderKey(undefined)).toBeNull();
    expect(getAcpErrorHeaderKey("")).toBeNull();
    expect(getAcpErrorHeaderKey("RequestError")).toBeNull();
  });

  it("flags only the auth code for re-authentication", () => {
    expect(isAcpAuthErrorCode("ACPAuthRequired")).toBe(true);
    expect(isAcpAuthErrorCode("ACPPromptError")).toBe(false);
    expect(isAcpAuthErrorCode(null)).toBe(false);
    expect(isAcpAuthErrorCode(undefined)).toBe(false);
  });
});

describe("canShowAcpProviderSwitch", () => {
  const baseAcp: AcpRecoveryConversationShape = {
    acp_server: "claude-code",
    execution_status: ExecutionStatus.ERROR,
  };

  it("returns false when the conversation is missing", () => {
    expect(canShowAcpProviderSwitch(null)).toBe(false);
    expect(canShowAcpProviderSwitch(undefined)).toBe(false);
  });

  it("returns false for non-ACP conversations", () => {
    expect(
      canShowAcpProviderSwitch({
        ...baseAcp,
        acp_server: null,
        agent_kind: "openhands",
      }),
    ).toBe(false);
    expect(canShowAcpProviderSwitch({})).toBe(false);
  });

  it("accepts acp_server as the authoritative ACP detector", () => {
    expect(canShowAcpProviderSwitch(baseAcp)).toBe(true);
  });

  it("falls back to agent_kind === 'acp' when acp_server is absent", () => {
    expect(
      canShowAcpProviderSwitch({
        acp_server: null,
        agent_kind: "acp",
        execution_status: ExecutionStatus.IDLE,
      }),
    ).toBe(true);
  });

  it("returns false while the agent is RUNNING", () => {
    expect(
      canShowAcpProviderSwitch({
        ...baseAcp,
        execution_status: ExecutionStatus.RUNNING,
      }),
    ).toBe(false);
  });

  it("is true for every other execution status, including idle / finished / errored / stuck / paused / waiting", () => {
    const statuses = [
      ExecutionStatus.IDLE,
      ExecutionStatus.WAITING_FOR_CONFIRMATION,
      ExecutionStatus.FINISHED,
      ExecutionStatus.PAUSED,
      ExecutionStatus.ERROR,
      ExecutionStatus.STUCK,
    ];
    for (const status of statuses) {
      expect(
        canShowAcpProviderSwitch({ ...baseAcp, execution_status: status }),
      ).toBe(true);
    }
  });

  it("treats an absent execution_status as 'not running', matching the fresh-error case", () => {
    expect(canShowAcpProviderSwitch({ acp_server: "claude-code" })).toBe(true);
  });
});
