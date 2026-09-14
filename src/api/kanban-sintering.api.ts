import AgentServerRuntimeService from "#/api/runtime-service/agent-server-runtime-service";
import type { KanbanTask } from "#/types/kanban";

/**
 * Shell-safe single-quote escaping (POSIX standard technique): close the
 * quote, insert a literal escaped quote, reopen the quote. Used exclusively
 * for the file **path** — user text (title, description, HTML context)
 * never goes through this function; it goes through base64 instead (see
 * {@link buildWriteFileCommand}).
 */
export function escapeSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const BASE64_ALPHABET_RE = /^[A-Za-z0-9+/=]*$/;

/**
 * Builds a shell command that writes `contentBase64` (decoded) to
 * `absolutePath`, creating parent directories as needed.
 *
 * Security-critical function — see TECH §2.2:
 * 1. `contentBase64` is validated against the base64 alphabet before being
 *    interpolated into the command string. This is the last line of
 *    defense: the only caller-supplied text that ever enters the shell
 *    string is base64 (content) or a single-quote-escaped path.
 * 2. The path is escaped with {@link escapeSingleQuoted}.
 * 3. `$(dirname ...)` is wrapped in DOUBLE quotes as a whole
 *    (`"$(dirname ${escapedPath})"`) — NOT `mkdir -p "$(dirname
 *    ${escapedPath})"` without the outer double quotes. Without them, the
 *    output of `dirname` undergoes word-splitting, so a workspace path
 *    containing a space would be split into multiple `mkdir` arguments.
 */
export function buildWriteFileCommand(
  absolutePath: string,
  contentBase64: string,
): string {
  if (!BASE64_ALPHABET_RE.test(contentBase64)) {
    throw new Error("contentBase64 contém caracteres fora do alfabeto base64");
  }
  const escapedPath = escapeSingleQuoted(absolutePath);
  return `mkdir -p "$(dirname ${escapedPath})" && printf '%s' '${contentBase64}' | base64 -d > ${escapedPath}`;
}

/**
 * Converts an ArrayBuffer to a base64 string without relying on
 * `window.btoa` directly on raw bytes (which mishandles non-Latin1 content).
 * Chunks the Uint8Array to avoid blowing the call stack with
 * `String.fromCharCode(...bytes)` on large inputs.
 */
export async function toBase64(bytes: ArrayBuffer): Promise<string> {
  const array = new Uint8Array(bytes);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < array.length; i += chunkSize) {
    const chunk = array.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Minimal HTML-to-text conversion sufficient for the small allowlist of
 * tags produced by `RichTextInput` (b/strong, i/em, ul/ol/li, a, br, p).
 * Never reinjects HTML tags into the generated Markdown — only extracts
 * text content, converting list items to `- ` bullets and block-level tags
 * to line breaks.
 */
function htmlToSimpleMarkdown(html: string): string {
  if (!html?.trim()) return "";
  const container = document.createElement("div");
  container.innerHTML = html;

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const inner = Array.from(el.childNodes).map(walk).join("");
    switch (tag) {
      case "b":
      case "strong":
        return `**${inner}**`;
      case "i":
      case "em":
        return `*${inner}*`;
      case "li":
        return `- ${inner}\n`;
      case "br":
        return "\n";
      case "p":
      case "ul":
      case "ol":
        return `${inner}\n`;
      default:
        return inner;
    }
  };

  return Array.from(container.childNodes)
    .map(walk)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildMarkdown(task: KanbanTask): string {
  const lines: string[] = [];
  lines.push(`# ${task.title}`);
  lines.push("");
  lines.push(`- Nível: ${task.level}`);
  lines.push(`- Coluna: ${task.columnId}`);
  lines.push("");
  if (task.description) {
    lines.push("## Descrição");
    lines.push("");
    lines.push(task.description);
    lines.push("");
  }
  const userContext = htmlToSimpleMarkdown(task.userContextHtml ?? "");
  if (userContext) {
    lines.push("## Contexto do usuário");
    lines.push("");
    lines.push(userContext);
    lines.push("");
  }
  const agentContext = htmlToSimpleMarkdown(task.agentContextHtml ?? "");
  if (agentContext) {
    lines.push("## Contexto do agente");
    lines.push("");
    lines.push(agentContext);
    lines.push("");
  }
  const attachments = task.attachments ?? [];
  if (attachments.length > 0) {
    lines.push("## Anexos");
    lines.push("");
    for (const attachment of attachments) {
      lines.push(`- attachments/${attachment.fileName}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Writes the `.md` context file (and any attachments) for `task` into
 * `workspacePath/.openhands/kanban/`. Never throws — every failure (write
 * error, infra exception, base64 validation error) is converted to
 * `{ ok: false, error }` so callers never need their own try/catch.
 */
export async function sinterizeTask(
  workspacePath: string,
  task: KanbanTask,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const mdPath = `${workspacePath}/.openhands/kanban/${task.id}.md`;
    const mdBase64 = await toBase64(
      new TextEncoder().encode(buildMarkdown(task)).buffer,
    );
    const mdResult = await AgentServerRuntimeService.executeCommand(
      null,
      null,
      buildWriteFileCommand(mdPath, mdBase64),
      workspacePath,
    );
    if (mdResult.exit_code !== 0) {
      return {
        ok: false,
        error: mdResult.stderr || "Falha ao gravar o arquivo .md",
      };
    }

    for (const attachment of task.attachments ?? []) {
      const attPath = `${workspacePath}/.openhands/kanban/${task.id}/attachments/${attachment.fileName}`;
      const attResult = await AgentServerRuntimeService.executeCommand(
        null,
        null,
        buildWriteFileCommand(attPath, attachment.contentBase64),
        workspacePath,
      );
      if (attResult.exit_code !== 0) {
        return {
          ok: false,
          error: `Falha ao gravar o anexo "${attachment.fileName}": ${attResult.stderr}`,
        };
      }
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Erro desconhecido ao sinterizar",
    };
  }
}
