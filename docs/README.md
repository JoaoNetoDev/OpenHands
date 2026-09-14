# Agent Canvas docs

This directory contains the project documentation.

- [Architecture](./architecture.md): system boundaries, runtime modes, and quality gates.
- [Using ACP agents](./ACP_AGENTS.md): onboard and configure external agents (Claude Code, Codex, Gemini CLI).
- [Development guide](./DEVELOPMENT.md)
- [Canvas Extensions manual testing](./CANVAS_EXTENSIONS_TESTING.md)
- [Self-hosting guide](./SELF_HOSTING.md)
- [Integrating DefenseClaw](./DefenseClaw.md): run the DefenseClaw security governance layer alongside the Agent Server.
- [Testing matrix](./TESTING_MATRIX.md): release smoke-test coverage across installers, operating systems, and agents.

## Feature planning

PRD/SPEC/TECH docs for in-flight features live under `features/<feature>/` — see the doc-set's own `overview.html` for the executive summary:

- `features/deploy-agent-server-remotos/` — bump remoto do `openhands-agent-server` nos hosts `aqdata` / `lebi` / `f5`.
- `features/claude-code-acp-reasoning-effort/` — exposição de `reasoning_effort` no ACP provider Claude Code.
- `features/openhands-tray/` — binário Go + Wails3 que age como bridge nativo entre o Canvas na VPS e o agent-server local.
