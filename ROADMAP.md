# Roadmap

This roadmap tracks the work required to move `tiny-agent-runtime` from a validated standalone prototype to a runtime that is practical to use and maintain.

## Current state

- A standalone repository exists for the runtime package.
- Runtime auth store ownership is in place and canonicalized.
- Native Copilot login exists via `bun run login:copilot`.
- Native Codex headless login exists via `bun run login:codex`.
- Copilot live prompt validation succeeded.
- Copilot live multi-turn validation now succeeds across a three-turn shared-session run.
- Copilot loop end-to-end validation with a local tool round-trip succeeded.
- Codex live prompt validation succeeded after fixing top-level instructions handling in the adapter path.
- Codex live loop/tool round-trip validation now succeeds through the shared loop.
- The current loop is a clean implementation of the required behavior.
- Shared session/prompt assembly helpers now exist for CLI and browser surfaces.
- Provider request-shape transforms are now centralized so chat/responses variants stay aligned.
- `tart` now covers login, one-shot prompt, and minimal in-memory chat flows.
- A thin tool/plugin extension skeleton now exists via `src/tools`, while concrete built-in tools remain intentionally out of scope.
- Default repo validation now includes browser-sample tests alongside `src` tests.
- Deterministic regression coverage now includes CLI multi-turn/session resume plus browser-sample session resume/failure recovery.
- Shared loop tool execution now supports optional per-tool timeout handling with timeout errors reinjected as tool messages.

## Phase 1 - Establish standalone auth ownership

Goal: make runtime-owned auth the default model for the standalone runtime.

- Completed: standalone runtime repository created.
- Completed: runtime auth store became the primary persisted auth source.
- Completed: provider-key auth storage was added under runtime-owned keys.
- Completed: native Copilot login flow was added.
- Completed: native Codex headless login flow was added.

## Phase 2 - Validate the reimplemented runtime baseline

Goal: make the current live-success state reproducible and less fragile.

- Completed: Copilot live prompt validation succeeded.
- Completed: Copilot live multi-turn validation succeeded.
- Completed: Copilot loop E2E with a local tool round-trip succeeded.
- Completed: Codex live prompt validation succeeded after the instructions fix.
- Completed: Codex live loop/tool round-trip validation succeeded.
- Lock down provider request shaping with regression coverage for known good request forms.
- Add focused regression coverage for the instructions fix that unblocked Codex live validation.
- Harden core loop handling for tool errors, malformed tool results, and retry boundaries.
- Document the validated scope and known non-goals so the repo does not imply parity that has not been proven.
- Completed: add a contract-first tool/plugin skeleton and plugin-aware loop resolution without bundling built-in tools.

## Phase 3 - Close the biggest runtime gaps

Goal: remove the main blockers to repeated real use.

- Harden auth refresh lifecycle behavior for longer-running sessions.
- Add usage and cost plumbing so executions expose basic operational visibility.
- Expand end-to-end validation beyond current prompt coverage to cover repeated turns and failure recovery.
- Verify provider adapter behavior stays isolated from the shared loop contract.
- Completed: add reusable session/prompt assembly and provider variant transforms.
- Completed: expand `tart` into practical login/prompt/chat entrypoints.
- Completed: add JSONL-backed persistent sessions for CLI/browser usage without coupling session identity to provider/model/system.

## Phase 4 - Reach practical usability

Goal: make the runtime dependable enough for normal engineering use.

- Broaden provider parity coverage where live behavior is still unproven.
- Add stronger regression suites around streaming, tool reinjection, and stop-reason handling.
- Improve runtime-facing documentation so setup, execution, and debugging are clear inside the repo.
- Completed: define a release-ready baseline for supported flows, known limitations, validation expectations, and the practical-usability exit bar.

## Validation stance

- The repo now treats `bun run typecheck`, `bun run test`, and `bun run build` as the default deterministic validation matrix.
- That matrix proves local regression behavior for request shaping, session persistence/resume, and browser-sample recovery flows.
- The repo still does not claim live/provider parity beyond the specific live validations already recorded in this roadmap.
- Opt-in package scripts now exist for the proven live Copilot multi-turn and Codex loop validation paths.

## Phase 5 - Maintainability and confidence

Goal: keep the runtime usable as providers and request shapes evolve.

- Add ongoing validation checks for provider request-shape drift.
- Keep execution docs current as validated capabilities and limits change.
- Use repo docs for execution tracking, while keeping conceptual analysis in the vault.
