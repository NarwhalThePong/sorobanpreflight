# sorobanpreflight 0.2.0

A free command-line checklist for Soroban (Stellar) Rust contracts, meant to be run before an audit. It scans `src/**/*.rs` offline, with no compiler, and writes a Markdown or JSON report with 16 pattern checks: storage TTL and archival, resource budgets, authorization, arithmetic, init and upgrade, and cross-contract calls. It also lists 5 audit-readiness items.

**What it isn't:** it is not an audit and not a security guarantee. Hits are pattern matches that a person has to review. Some will be false positives, and many real issues will not be detected.

## Install and run

```
npx sorobanpreflight@0.2.0 path/to/contract
npx sorobanpreflight@0.2.0 path/to/contract --json -o report.json
```

## Example (on the deliberately vulnerable test fixture in this repo)

```
| Review priority | Hits |
|---|---|
| high | 7 |
| medium | 11 |
| low | 4 |
| info | 0 |

- [ ] **IN-02** Contract Wasm upgrade with no admin authorization — _high review priority_ — 1 hit(s)
  - `src/lib.rs:70` — upgrade() upgrades the Wasm with no require_auth
```

The safe fixture gives 0 hits. All 22 hits on the vulnerable fixture were checked by hand against the source and are real bugs in that fixture.

## Known limits

- Regex and structure based, with no data-flow tracking. Checks made in another function are not seen.
- Only `pub fn` inside `#[contractimpl]` counts as an entry point. Auth done in a helper is recognized only when the helper is named `require_admin`, `only_owner` or `check_auth`.
- AR-02 skips casts from `.len()`, `.sequence()`, `.protocol_version()` or `u32` literals, so a non-Soroban `usize` `.len() as u32` can be missed.
- RE-01 matches token-client and `invoke_contract` calls by name only.
- See README "Known limits" for the full list.
