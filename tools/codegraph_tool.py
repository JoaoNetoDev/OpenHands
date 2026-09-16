"""CodeGraph — the agent's window into the project's code knowledge graph.

Registered as tool name "codegraph". Import at agent-server startup with
``--import-modules codegraph_tool`` (same convention as ``canvas_ui_tool``).

This module is a *thin adapter*: all indexing and querying lives in
``openhands.sdk.codegraph``, which owns the schema, the incremental refresh and
the single-writer lease. Keeping the tool thin is deliberate — an earlier
version carried its own parallel copy of the discovery/extraction machinery,
which meant two indexers to keep in step and a graph that could only answer
"where is this defined?".

Why the graph earns its place over grep:

* ``callers`` / ``callees`` traverse *recorded* call edges, so the answer names
  the enclosing function rather than every line that happens to contain the
  text — no noise from comments, strings, or an unrelated same-named symbol.
* ``impact`` walks those edges transitively: "what breaks if I change this?"
  answered honestly, including for code reached only through inheritance.
* ``minimal_context`` turns a task description into a ranked reading list with
  source excerpts, which is usually the first thing worth doing on a cold repo.

The graph is honest about its limits. An edge whose target cannot be identified
unambiguously stays unresolved and is reported as such rather than guessed at,
because a wrong ``callers`` answer sends the agent to edit the wrong file. Text
that is not a call site — comments, strings, config, dynamically built names —
is not in the graph, so grep/glob remain the right tool for full-text search.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING, Literal

from pydantic import Field

from openhands.sdk import Action, Observation, ToolDefinition
from openhands.sdk.codegraph import (
    CallEdge,
    CodegraphError,
    CodegraphQueries,
    ImpactNode,
    Symbol,
)
from openhands.sdk.tool import ToolAnnotations, ToolExecutor, register_tool

if TYPE_CHECKING:
    from openhands.sdk.conversation.state import ConversationState


# ---- tool surface ---------------------------------------------------------

CodeGraphCommand = Literal[
    "search",
    "definition",
    "references",
    "callers",
    "callees",
    "impact",
    "minimal_context",
    "status",
    "rebuild",
]


class CodeGraphAction(Action):
    """Query the project's persistent code graph (SQLite-backed)."""

    command: CodeGraphCommand = Field(description="Operation to perform.")
    symbol: str | None = Field(
        default=None,
        description=(
            "Symbol name. Required for 'search', 'definition', 'references', "
            "'callers', 'callees' and 'impact'. 'search' is a substring match; "
            "the others match the name exactly. Method calls may be given "
            "qualified, e.g. 'Store.refresh'."
        ),
    )
    task: str | None = Field(
        default=None,
        description=(
            "Required for 'minimal_context': a short description of what you "
            "are trying to do, e.g. 'fix pagination in the kanban board'."
        ),
    )
    depth: int = Field(
        default=3,
        ge=1,
        le=5,
        description="How many hops to walk for 'impact' (1 = direct callers).",
    )
    limit: int = Field(
        default=30,
        ge=1,
        le=200,
        description="Max results to return.",
    )


class CodeGraphObservation(Observation):
    """Result of a codegraph query."""


def _format_symbol(symbol: Symbol) -> str:
    location = f"{symbol.file_path}:{symbol.start_line}"
    if symbol.end_line:
        location += f"-{symbol.end_line}"
    parent = f" (in {symbol.parent})" if symbol.parent else ""
    signature = f" — {symbol.signature}" if symbol.signature else ""
    return f"{symbol.kind} {symbol.qualified_name}{parent} @ {location}{signature}"


def _format_edge(edge: CallEdge) -> str:
    """Render one call edge as a jump target.

    Unresolved targets are marked rather than hidden: "this calls into something
    I cannot see" is worth knowing, and it is the common case for a call into a
    third-party library.
    """
    if edge.resolved and edge.dst_file:
        target = f"{edge.dst_file}:{edge.dst_line}"
    else:
        target = "external/unresolved"
    if edge.kind == "inherits":
        relation = f"inherits {edge.callee_name}"
    else:
        relation = edge.callee_name
    return f"{edge.src_name} -> {relation} @ {edge.src_file}:{edge.src_line} ({target})"


def _format_impact(node: ImpactNode) -> str:
    indent = "  " * node.depth
    return (
        f"{indent}d{node.depth} {node.kind} {node.qualified_name} "
        f"@ {node.file_path}:{node.start_line}"
    )


class CodeGraphExecutor(ToolExecutor[CodeGraphAction, CodeGraphObservation]):
    def __init__(self, working_dir: str):
        self.working_dir = working_dir

    def __call__(
        self,
        action: CodeGraphAction,
        conversation=None,  # noqa: ARG002
    ) -> CodeGraphObservation:
        queries = CodegraphQueries(self.working_dir)
        try:
            return self._dispatch(queries, action)
        except CodegraphError as exc:
            # Two causes, one recovery path worth naming: a lease conflict is
            # transient (retry works), an unreadable index is not (rebuild does).
            return CodeGraphObservation.from_text(
                f"CodeGraph could not serve this query: {exc} Retry the command; "
                "if it keeps failing, run command='rebuild' to recreate the "
                "index, or fall back to the grep/glob tools."
            )
        except OSError as exc:
            return CodeGraphObservation.from_text(
                f"CodeGraph could not read the index ({exc}). Fall back to the "
                "grep/glob tools for this lookup."
            )

    def _dispatch(
        self, queries: CodegraphQueries, action: CodeGraphAction
    ) -> CodeGraphObservation:
        command = action.command

        if command == "status":
            state, stats = queries.status()
            if stats is None:
                return CodeGraphObservation.from_text(
                    f"CodeGraph status: {state} — no index yet. It builds "
                    "automatically on the first query."
                )
            return CodeGraphObservation.from_text(
                f"CodeGraph status: {state}\n"
                f"files={stats.file_count} symbols={stats.symbol_count} "
                f"edges={stats.edge_count} "
                f"resolved={stats.resolved_edge_count}\n"
                f"last_indexed={stats.last_indexed} "
                f"pending_changes={stats.pending_changes}"
            )

        if command == "rebuild":
            queries.rebuild()
            _state, stats = queries.status()
            indexed = f"{stats.symbol_count} symbols" if stats else "no symbols"
            return CodeGraphObservation.from_text(
                f"CodeGraph rebuilt from scratch: indexed {indexed}."
            )

        if command == "minimal_context":
            if not action.task:
                return CodeGraphObservation.from_text(
                    "Missing 'task' for minimal_context — pass a short "
                    "description of what you are trying to do."
                )
            context = queries.minimal_context(action.task, max_files=action.limit)
            if not context.files:
                terms = context.terms or "none"
                return CodeGraphObservation.from_text(
                    f"No indexed symbols matching the task '{action.task}' "
                    f"(terms tried: {terms}). Try 'search' with a distinctive "
                    "name, or grep."
                )
            blocks = []
            for file in context.files:
                header = f"## {file.file_path} — {', '.join(file.symbols)}"
                blocks.append("\n".join([header, *file.excerpts]))
            return CodeGraphObservation.from_text("\n\n".join(blocks))

        if not action.symbol:
            return CodeGraphObservation.from_text(f"Missing 'symbol' for {command}.")

        symbol = action.symbol

        if command == "search":
            hits = queries.search(symbol, limit=action.limit)
            if not hits:
                return CodeGraphObservation.from_text(
                    f"No symbols matching '{symbol}' in the codegraph index. "
                    "Fall back to the grep/glob tools for full-text search — "
                    "the symbol may be dynamically generated, in an unindexed "
                    "file type, or named differently."
                )
            return CodeGraphObservation.from_text(
                "\n".join(
                    f"{h.kind} {h.qualified_name} @ {h.file_path}:{h.start_line} "
                    f"(matched on {h.matched_on})"
                    for h in hits
                )
            )

        if command == "definition":
            symbols = queries.definition(symbol, limit=action.limit)
            if not symbols:
                return CodeGraphObservation.from_text(
                    f"No definition of '{symbol}' in the codegraph index. Try "
                    "'search' for near matches, or fall back to grep if it "
                    "comes from outside the indexed tree."
                )
            return CodeGraphObservation.from_text(
                "\n".join(_format_symbol(s) for s in symbols)
            )

        if command in ("references", "callers", "callees"):
            if command == "references":
                edges = queries.references(symbol, limit=action.limit)
            elif command == "callers":
                edges = queries.callers(symbol, limit=action.limit)
            else:
                edges = queries.callees(symbol, limit=action.limit)

            if not edges:
                if command == "callers":
                    extra = (
                        " Either nothing in the index calls it, or its callers "
                        "live outside the indexed tree."
                    )
                elif command == "callees":
                    extra = (
                        " It may be a leaf function, or the index may not have "
                        "recorded its call sites."
                    )
                else:
                    extra = (
                        " grep with --fixed-strings still finds it in comments, "
                        "strings or unindexed files."
                    )
                return CodeGraphObservation.from_text(
                    f"No recorded call sites for '{symbol}'." + extra
                )
            return CodeGraphObservation.from_text(
                "\n".join(_format_edge(e) for e in edges)
            )

        if command == "impact":
            nodes = queries.impact(symbol, depth=action.depth, limit=action.limit)
            if not nodes:
                return CodeGraphObservation.from_text(
                    f"Nothing in the index reaches '{symbol}', so no impact "
                    f"found within depth {action.depth}. Either it is an entry "
                    "point, or its callers live outside the indexed tree."
                )
            return CodeGraphObservation.from_text(
                f"Symbols that reach '{symbol}' (depth {action.depth}):\n"
                + "\n".join(_format_impact(n) for n in nodes)
            )

        return CodeGraphObservation.from_text(f"Unknown command: {action.command}")


_CODEGRAPH_DESCRIPTION = """\
Query the project's code knowledge graph: symbols **and the call edges between
them**, indexed once and refreshed incrementally, so you can jump straight to an
answer instead of re-scanning the tree with grep/glob.

Prefer codegraph for:
- 'definition' — where is this symbol defined (exact name).
- 'callers' — what calls this function. Use before editing a shared function.
- 'callees' — what this function calls. Use to see what it depends on.
- 'impact' — everything that transitively reaches a symbol, so you can tell what
  might break. Walks inheritance as well as calls, so overrides and
  implementations are included.
- 'references' — the recorded call sites naming a symbol, each with the
  enclosing function.
- 'search' — substring lookup when you only half-remember a name.
- 'minimal_context' — given a task description, get a ranked reading list with
  source excerpts. The cheapest way to orient in unfamiliar code.
- 'status' / 'rebuild' — inspect or recover the index (it also builds itself
  automatically on the first query).

Use grep/glob instead for:
- Full-text search: comments, strings, config values, log messages. The graph
  records *calls*, not every occurrence of a name.
- Dynamically generated or reflection-based names.
- Files in excluded paths (node_modules, vendor, .git, dist, build...).

Output is honest about uncertainty: a call whose target cannot be identified
unambiguously is shown as 'external/unresolved' rather than attributed to a
symbol that merely shares the name. An empty result means the index holds no
such edge — not that the code does not exist.

The index lives at <project>/.openhands/codegraph.db, scoped to the current
project only — each project (including on machines hosting several projects)
gets its own isolated graph, never mixed with another project's symbols."""


class CodeGraphTool(ToolDefinition[CodeGraphAction, CodeGraphObservation]):
    """Tool for querying the project's code graph."""

    @classmethod
    def create(
        cls,
        conv_state: "ConversationState" = None,  # noqa: ARG003
        **params,  # noqa: ARG003
    ) -> Sequence["CodeGraphTool"]:
        working_dir = conv_state.workspace.working_dir if conv_state else "."
        return [
            cls(
                description=_CODEGRAPH_DESCRIPTION,
                action_type=CodeGraphAction,
                observation_type=CodeGraphObservation,
                executor=CodeGraphExecutor(working_dir),
                annotations=ToolAnnotations(
                    readOnlyHint=True,
                    destructiveHint=False,
                    idempotentHint=True,
                    openWorldHint=False,
                ),
            )
        ]


register_tool("codegraph", CodeGraphTool)


def _install_default_tools_patch() -> None:
    """Make "codegraph" part of the agent's default tool set.

    Agent profiles don't carry their own `tools` list (the SDK's
    `OpenHandsAgentProfile` has no such field). The actual "single defaulting
    point" (its own docstring's words) for a conversation whose
    `agent_settings.tools` is None is `AgentSettings.create_agent()` in
    `openhands.sdk.settings.model`, which does a *local* `from
    openhands.sdk.tool.defaults import default_tool_specs` inside the method
    body on every call — so rebinding the attribute on the `defaults` module
    before any conversation is created is enough to reach every conversation,
    regardless of which agent profile started it or which higher-level
    wrapper (conversation_router.py's own `get_default_tools` convenience,
    used by a narrower quick-start path) was involved. Patched here instead
    of touching SDK package files, so it survives SDK version bumps as long
    as this import path stays the same.
    """
    import openhands.sdk.tool.defaults as _defaults

    if getattr(_defaults.default_tool_specs, "_codegraph_patched", False):
        return

    _original_default_tool_specs = _defaults.default_tool_specs

    def _default_tool_specs_with_codegraph(*args, **kwargs):
        from openhands.sdk.tool import Tool

        specs = list(_original_default_tool_specs(*args, **kwargs))
        if not any(t.name == "codegraph" for t in specs):
            specs.append(Tool(name="codegraph"))
        return specs

    _default_tool_specs_with_codegraph._codegraph_patched = True  # type: ignore[attr-defined]
    _defaults.default_tool_specs = _default_tool_specs_with_codegraph

    # Also patch the higher-level openhands.tools.preset.default wrapper
    # (used by conversation_router.py's quick-start path) and the module's
    # already-bound `from ... import get_default_tools` in that router, for
    # any conversation-creation path that goes through it instead.
    try:
        import openhands.tools.preset.default as _preset

        _original_get_default_tools = _preset.get_default_tools

        def _get_default_tools_with_codegraph(*args, **kwargs):
            from openhands.sdk.tool import Tool

            tools = list(_original_get_default_tools(*args, **kwargs))
            if not any(t.name == "codegraph" for t in tools):
                tools.append(Tool(name="codegraph"))
            return tools

        _preset.get_default_tools = _get_default_tools_with_codegraph

        import openhands.agent_server.conversation_router as _conv_router

        _conv_router.get_default_tools = _get_default_tools_with_codegraph
    except Exception:
        pass  # best-effort secondary path; the defaults.py patch is primary


_install_default_tools_patch()
