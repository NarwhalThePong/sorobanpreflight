# Changelog

## 0.2.2 - 2026-10-28

- New rule ER-01 (low): `panic!` with a string instead of a `#[contracterror]` / `panic_with_error!`. Release Wasm strips panic messages, so callers only see a generic `HostError(WasmVm, InvalidAction)` (stellar/soroban-examples#282, #199).

## 0.2.1 - 2026-10-28

- README: new Quick start section with a self-contained example that runs from an empty folder. No code changes.

## 0.2.0 (2026-10-28)
- New rule ST-03: per-user data keyed into instance storage.
- New rule AU-03: token-style function authorizes the wrong address (SEP-41 `from` / `spender`).
- AR-01: ignores small-constant arithmetic, indices and loop counters; findings drop to `info` when the nearest Cargo.toml sets `overflow-checks = true` in the release profile. Findings now carry their own `priority`.
- ST-01: no longer flags `__constructor`.
- Fixtures now compile for real (`soroban-sdk = "=25.3.0"`, `wasm32v1-none`); see BUILD_NOTES.md.
- AR-02: no longer flags widening or same-width casts of values that are already u32 (`env.ledger().sequence()`, `protocol_version()`, `len()`, `Nu32` literals). Known limit: a non-Soroban `usize` `.len() as u32` can be missed (documented in README Known limits). The vulnerable fixture's AR-02 case is now a real u64 -> u32 cast.
- RE-02 review priority raised to high (a caller-chosen token can credit balances for nothing); RE-01 lowered to low (a failed callee reverts the whole call).
- On stellar/soroban-examples (03d42aa): AR-01 23 medium -> 0 medium (17 info); ST-01 31 -> 18; no new-rule hits.

## 0.1.0 (unreleased)
- First local build: 14 checks across storage TTL, resource budgets, authorization, arithmetic, init/upgrade and cross-contract calls; Markdown/JSON report; readiness items; fixtures and tests.
