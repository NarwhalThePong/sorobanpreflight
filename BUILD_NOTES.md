# Build notes (fixtures)

Toolchain: rustc 1.89.0 (`cargo +1.89.0`), target `wasm32v1-none`.
Dependency: `soroban-sdk = "=25.3.0"` in both fixtures, with `rust-version = "1.89"` so Cargo's
MSRV-aware resolver picks `soroban-sdk-macros`/`soroban-spec*` 25.3.0 (25.3.1+/25.3.2 need rustc 1.91).
Cargo.lock is committed in each fixture.

Command (run in each fixture dir):

    CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo +1.89.0 build --release --target wasm32v1-none

Results (2026-10-27):

| Fixture | Result | Warnings | Wasm size |
|---|---|---|---|
| vulnerable-contract | Finished release, 0 errors | 0 | 16,087 bytes |
| safe-contract | Finished release, 0 errors | 0 | 22,534 bytes |

No Rust source changes were needed for v0.1 code to compile against 25.3.0; v0.2.0 added a
`transfer` function to each fixture (AU-03 / ST-03 bug in the vulnerable one, correct version in
the safe one), and both still build cleanly. Scanner on the fixtures: vulnerable fires all 16 rules
(22 hits); safe has 0 hits.
