# sorobanpreflight

A pre-audit self-review checklist for Soroban (Stellar) smart contracts written in Rust. It reads your `.rs` source offline (no compiler or toolchain needed), runs pattern checks for common Soroban mistakes, and writes a Markdown (or JSON) report you can work through before you hand the code to an auditor.

**This is a self-review aid. It is not an audit, it is not a substitute for an audit, and it gives no guarantees.** The checks are text patterns, not a compiler or a formal analysis. Some hits will be false positives, and many real bugs will not be detected. A clean report does not mean a contract is safe.

## Usage

```
node bin/sorobanpreflight.js path/to/contract            # Markdown report to stdout
node bin/sorobanpreflight.js . -o PREFLIGHT.md           # write to a file
node bin/sorobanpreflight.js . --json                    # JSON output
node bin/sorobanpreflight.js . --only AU,IN-02           # selected rules
node bin/sorobanpreflight.js . --fail-on high            # exit 1 for CI
node bin/sorobanpreflight.js --list-rules
```

`target/`, `tests/`, `benches/`, `examples/` and `#[cfg(test)]` modules are skipped by default (`--include-tests` to scan them). Requires Node 18+. No dependencies.

## Checks

| ID | Priority | Check |
|---|---|---|
| ST-01 | medium | Storage TTL / archival: Persistent or instance entry written with no TTL extension in the same function |
| ST-02 | high | Storage TTL / archival: Value-bearing data kept in temporary storage |
| ST-03 | medium | Storage TTL / archival: Per-user data keyed into instance storage |
| RB-01 | medium | Resource budgets: Loop over a caller-supplied Vec/Map with no length bound |
| RB-02 | low | Resource budgets: Storage read or write inside a loop |
| RB-03 | medium | Resource budgets: Stored Vec/Map grown by push/insert with no size cap |
| AU-01 | high | Authorization: Entry point changes state with no require_auth |
| AU-02 | high | Authorization: Privileged function authorizes a caller-supplied address, not the stored admin |
| AU-03 | high | Authorization: Token-style function (transfer, burn, approve, transfer_from, burn_from) authorizes the wrong address |
| AR-01 | medium | Arithmetic: Unchecked +, -, * on i128/u128/i64/u64 amounts |
| AR-02 | low | Arithmetic: Narrowing or sign-changing `as` cast on a numeric value |
| AR-03 | medium | Arithmetic: Signed amount parameter used without a sign check |
| IN-01 | high | Init / upgrade: initialize can be called more than once |
| IN-02 | high | Init / upgrade: Contract Wasm upgrade with no admin authorization |
| RE-01 | low | Cross-contract calls: State written after an external token or contract call |
| RE-02 | high | Cross-contract calls: Token or contract address taken from the caller |

The report also lists pre-audit readiness items: Cargo.toml present, `overflow-checks = true` in `[profile.release]`, soroban-sdk version pinned, unit tests present, README or scope doc present.

## Known limits

- Only `pub fn` inside `#[contractimpl]` blocks is treated as an entry point. Logic in private helpers is checked only by the line-level rules (RB-02, ST-02, AR-02, IN-02).
- Auth done in a helper is recognized only when the helper is named like `require_admin`, `only_owner` or `check_auth`, or when the function itself calls `require_auth`. Other helper names give AU-01 false positives.
- AR-01 skips arithmetic with a numeric-literal operand (`x + 1`, `n * 1000`), index expressions, loop ranges and `checked_`/`saturating_` calls. When the nearest `Cargo.toml` (walking up to the workspace root) sets `overflow-checks = true` in `[profile.release]`, AR-01 hits are reported at `info` priority, because overflow traps instead of wrapping.
- ST-01 does not flag `__constructor`, which runs once at deploy.
- AU-03 only looks at functions named like the SEP-41 token interface (`transfer`, `burn`, `approve` must authorize `from`; `transfer_from`, `burn_from` must authorize `spender`).
- AR-02 skips a cast when the source expression ends in `.len()`, `.sequence()`, `.protocol_version()` or a `u32` literal and the target is the same width or wider (u32, u64, i64, u128, i128), since these are already u32 in soroban-sdk. A non-Soroban `usize` value written as `.len() as u32` can therefore be missed.
- RE-01 matches token-client and `invoke_contract` calls by name. Calls through custom client wrappers may be missed.
- No data-flow tracking. A length check, sign check or admin load in a different function is not seen.

## Tests

`npm test` runs every rule against a vulnerable snippet (must fire) and a safe snippet (must stay quiet), plus project-level fixtures in `fixtures/vulnerable-contract` (every rule fires) and `fixtures/safe-contract` (no hits). Both fixtures compile with `soroban-sdk = "=25.3.0"` for `wasm32v1-none`; see `BUILD_NOTES.md`.

## License

MIT
