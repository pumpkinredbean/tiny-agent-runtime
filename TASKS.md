# Tasks

This task list is ordered to move the runtime from the current validated prototype toward practical usability.

## 1. Document the validated baseline in-repo

- [x] Record the currently proven live validations and the current parity stance.
- [x] Point README readers to the roadmap and task tracker.
- [x] Keep conceptual background in the vault and execution tracking in this repo.

## 2. Complete auth ownership transition

- [x] Make the runtime auth store the primary persisted auth source.
- [x] Store runtime-owned auth under top-level provider keys.
- [x] Add a native Copilot login path that persists successful device-flow auth into the runtime store.
- [x] Add a native Codex login path that persists successful headless device-flow auth into the runtime store.
- [x] Make the runtime store the only auth source in-repo.

## 3. Add reusable session and variant assembly

- [x] Add a canonical SDK helper for assembling `system + history + prompt` into runtime messages.
- [x] Add a shared provider transform layer for chat/responses request variants.
- [x] Reuse the shared session path in the CLI shell and browser sample.

## 4. Add provider request-shape regression coverage

- [x] Add tests for the request shapes currently known to work for Copilot.
- [x] Add tests for the request shapes currently known to work for Codex.
- [x] Add a regression test for the top-level instructions handling that fixed the Codex live validation path.

## 5. Harden the shared loop around tool execution

- [x] Add a thin `src/tools` extension skeleton with registry/composition helpers and backward-compatible loop integration.
- [x] Keep built-in package-owned tools out of scope while documenting example-only wiring.
- [x] Define expected behavior when a tool throws or returns invalid data.
- [x] Define explicit timeout behavior for tool execution.
- [x] Add tests for tool error propagation and recovery behavior.
- [x] Tighten repeated-call and retry boundaries so failure paths are predictable.

## 6. Harden auth lifecycle behavior

- [x] Validate token refresh behavior for longer-running executions.
- [x] Add regression coverage for expired or refreshed auth state.

## 7. Add basic runtime observability

- [x] Expose usage accounting needed to understand request volume and token consumption.
- [x] Expose cost-related plumbing where provider responses make that available.
- [x] Make these signals available without changing the shared loop/provider boundary unnecessarily.

## 8. Expand end-to-end validation

- [x] Validate Copilot live prompt path.
- [x] Validate Copilot loop end-to-end with a local tool round-trip.
- [x] Validate Codex live prompt path after the instructions fix.
- [x] Expand the default repo test path so browser-sample coverage runs by default.
- [x] Add deterministic CLI multi-turn/session-resume integration coverage.
- [x] Add deterministic browser-sample session-resume and failure-recovery coverage.
- [x] Add longer multi-turn live validation for Copilot.
- [x] Add loop-level end-to-end validation for Codex beyond current live prompt coverage.
- [x] Cover failure-recovery paths that are not exercised by today’s validation commands.

## 9. Tighten repo-facing usability docs

- [x] Document the current validated baseline: Copilot live prompt, Copilot loop E2E, and Codex live prompt after the instructions fix.
- [x] Document the current auth ownership model: runtime store primary, native logins first.
- [x] Document what flows are currently supported versus still unproven.
- [x] Document expected setup and runtime entrypoints for repeatable local use.
- [x] Document known limitations until broader parity is validated.

## 10. Add persistent session usability

- [x] Add JSONL-backed session persistence with transcript and run metadata stored separately.
- [x] Keep prompt assembly bound to transcript plus current run config only.
- [x] Integrate resumable sessions into `tart chat` and the minimal browser sample.

## 11. Define a practical-usability exit bar

- [x] List the minimum validation set required before calling the runtime practically usable.
- [x] List the remaining non-goals so the repo does not overstate unvalidated parity claims.
- [x] Reorder this task list as new validation evidence lands.
