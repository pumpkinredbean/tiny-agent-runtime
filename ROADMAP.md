# Roadmap

This roadmap tracks the work required to move `tiny-agent-runtime` from a validated standalone prototype to a runtime that is practical to use and maintain.

## Current state

- A standalone repository exists for the runtime package.
- Runtime auth store ownership is in place and canonicalized.
- Native Copilot login exists via `bun run login:copilot`.
- Native Codex headless login exists via `bun run login:codex`.
- The legacy auth bridge is optional compatibility infrastructure, not the primary auth model.
- Copilot live smoke succeeded.
- Copilot loop end-to-end validation with a local tool round-trip succeeded.
- Codex live smoke succeeded after fixing top-level instructions handling in the adapter path.
- The current loop is a clean implementation of the required behavior.

## Phase 1 - Establish standalone auth ownership

Goal: make runtime-owned auth the default model instead of depending on bridge-managed state.

- Completed: standalone runtime repository created.
- Completed: runtime auth store became the primary persisted auth source.
- Completed: canonical provider-key normalization was added for runtime-owned auth.
- Completed: native Copilot login flow was added.
- Completed: native Codex headless login flow was added.
- Completed: bridge-based auth import was reduced to optional compatibility behavior.

## Phase 2 - Validate the reimplemented runtime baseline

Goal: make the current live-success state reproducible and less fragile.

- Completed: Copilot live smoke succeeded.
- Completed: Copilot loop E2E with a local tool round-trip succeeded.
- Completed: Codex live smoke succeeded after the instructions fix.
- Lock down provider request shaping with regression coverage for known good request forms.
- Add focused regression coverage for the instructions fix that unblocked Codex smoke.
- Harden core loop handling for tool errors, malformed tool results, and retry boundaries.
- Document the validated scope and known non-goals so the repo does not imply parity that has not been proven.

## Phase 3 - Close the biggest runtime gaps

Goal: remove the main blockers to repeated real use.

- Harden auth refresh lifecycle behavior for longer-running sessions.
- Add usage and cost plumbing so executions expose basic operational visibility.
- Expand end-to-end validation beyond smoke coverage to cover repeated turns and failure recovery.
- Verify provider adapter behavior stays isolated from the shared loop contract.

## Phase 4 - Reach practical usability

Goal: make the runtime dependable enough for normal engineering use.

- Broaden provider parity coverage where live behavior is still unproven.
- Add stronger regression suites around streaming, tool reinjection, and stop-reason handling.
- Improve runtime-facing documentation so setup, execution, and debugging are clear inside the repo.
- Define a release-ready baseline for supported flows, known limitations, and validation expectations.

## Phase 5 - Maintainability and confidence

Goal: keep the runtime usable as providers and request shapes evolve.

- Add ongoing validation checks for provider request-shape drift.
- Keep execution docs current as validated capabilities and limits change.
- Use repo docs for execution tracking, while keeping conceptual analysis in the vault.
