# Tasks

This task list is ordered to move the runtime from the current validated prototype toward practical usability.

## 1. Document the validated baseline in-repo

- [x] Record the currently proven live validations and the current parity stance.
- [x] Point README readers to the roadmap and task tracker.
- [x] Keep conceptual background in the vault and execution tracking in this repo.

## 2. Complete auth ownership transition

- [x] Make the runtime auth store the primary persisted auth source.
- [x] Canonicalize runtime-owned auth under top-level provider keys.
- [x] Add a native Copilot login path that persists successful device-flow auth into the runtime store.
- [x] Add a native Codex login path that persists successful headless device-flow auth into the runtime store.
- [x] Keep the legacy auth bridge documented as optional compatibility infrastructure, not the core runtime auth model.

## 3. Add provider request-shape regression coverage

- [ ] Add tests for the request shapes currently known to work for Copilot.
- [ ] Add tests for the request shapes currently known to work for Codex.
- [ ] Add a regression test for the top-level instructions handling that fixed Codex smoke.

## 4. Harden the shared loop around tool execution

- [ ] Define expected behavior when a tool throws, returns invalid data, or times out.
- [ ] Add tests for tool error propagation and recovery behavior.
- [ ] Tighten repeated-call and retry boundaries so failure paths are predictable.

## 5. Harden auth lifecycle behavior

- [ ] Validate token refresh behavior for longer-running executions.
- [ ] Add regression coverage for expired or refreshed auth state.

## 6. Add basic runtime observability

- [ ] Expose usage accounting needed to understand request volume and token consumption.
- [ ] Expose cost-related plumbing where provider responses make that available.
- [ ] Make these signals available without changing the shared loop/provider boundary unnecessarily.

## 7. Expand end-to-end validation

- [x] Validate Copilot live smoke.
- [x] Validate Copilot loop end-to-end with a local tool round-trip.
- [x] Validate Codex live smoke after the instructions fix.
- [ ] Add longer multi-turn live validation for Copilot.
- [ ] Add loop-level end-to-end validation for Codex beyond smoke success.
- [ ] Cover failure-recovery paths that are not exercised by today’s smoke commands.

## 8. Tighten repo-facing usability docs

- [x] Document the current validated baseline: Copilot smoke, Copilot loop E2E, and Codex smoke after the instructions fix.
- [x] Document the current auth ownership model: runtime store primary, native logins first, bridge optional.
- [x] Document what flows are currently supported versus still unproven.
- [x] Document expected setup and runtime entrypoints for repeatable local use.
- [ ] Document known limitations until broader parity is validated.

## 9. Define a practical-usability exit bar

- [ ] List the minimum validation set required before calling the runtime practically usable.
- [ ] List the remaining non-goals so the repo does not overstate unvalidated parity claims.
- [ ] Reorder this task list as new live validation evidence lands.
