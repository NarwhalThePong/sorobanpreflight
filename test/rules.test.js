'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { analyzeSource } = require('../src/scan');
const { rules } = require('../src/rules');
const cases = require('./cases');

test('every rule has a test case', () => { for (const r of rules) assert.ok(cases[r.id], `missing case for ${r.id}`); });
for (const r of rules) {
  test(`${r.id} fires on vulnerable snippet`, () => {
    assert.ok(analyzeSource(cases[r.id].bad, 'bad.rs').findings.some(f => f.rule === r.id), `${r.id} did not fire`);
  });
  test(`${r.id} stays quiet on safe snippet`, () => {
    const hits = analyzeSource(cases[r.id].good, 'good.rs').findings.filter(f => f.rule === r.id);
    assert.deepStrictEqual(hits, [], `${r.id} false positive: ${JSON.stringify(hits)}`);
  });
}
test('safe snippets are clean for every rule (no cross-rule noise at high priority)', () => {
  const pr = Object.fromEntries(rules.map(r => [r.id, r.priority]));
  for (const [id, c] of Object.entries(cases)) {
    const hi = analyzeSource(c.good, 'good.rs').findings.filter(f => pr[f.rule] === 'high');
    assert.deepStrictEqual(hi, [], `${id} safe snippet has high hits: ${JSON.stringify(hi)}`);
  }
});
test('comments and strings do not trigger rules', () => {
  const src = '#[contract]\npub struct C;\n#[contractimpl]\nimpl C {\npub fn f(env: Env) {\n// env.deployer().update_current_contract_wasm(h);\nlet s = "x as u64 env.storage().temporary().set(&Balance, 1)";\n/* a + b as u32 */\n}\n}\n';
  assert.deepStrictEqual(analyzeSource(src).findings, []);
});
test('#[cfg(test)] modules are ignored', () => {
  const src = cases['IN-02'].good + '#[cfg(test)]\nmod test {\n#[contractimpl]\nimpl X { pub fn upgrade(env: Env, h: BytesN<32>) { env.deployer().update_current_contract_wasm(h); } }\n}\n';
  assert.ok(!analyzeSource(src).findings.some(f => f.rule === 'IN-02'));
});
test('line numbers point at the hit', () => {
  const src = cases['IN-02'].bad; const hit = analyzeSource(src).findings.find(f => f.rule === 'IN-02');
  assert.match(src.split('\n')[hit.line - 1], /update_current_contract_wasm/);
});
test('non-entry (private helper) functions are not treated as entry points for AU-01', () => {
  const src = H() + 'fn write(env: &Env, u: Address) { env.storage().persistent().set(&u, &1i128); }\n';
  assert.ok(!analyzeSource(src).findings.some(f => f.rule === 'AU-01'));
  function H() { return '#[contract]\npub struct C;\n'; }
});

// ---- v0.2.0 regression tests ----
const W2 = b => '#[contract]\npub struct C;\n#[contractimpl]\nimpl C {\n' + b + '\n}\n';
const ar = (src, ctx) => analyzeSource(src, 'x.rs', ctx).findings.filter(f => f.rule === 'AR-01');
test('AR-01 ignores small-constant arithmetic, loop counters and indices', () => {
  const src = W2('pub fn f(env: Env, amount: i128, v: Vec<i128>) -> i128 {\nlet a = amount * 1000;\nlet b = amount + 1;\nlet mut i: u32 = 0;\ni += 1;\nlet c = v.get(i + 1).unwrap();\nlet d = amount.saturating_add(c);\nd\n}');
  assert.deepStrictEqual(ar(src), []);
});
test('AR-01 still flags variable + variable on amounts', () => {
  assert.strictEqual(ar(W2('pub fn f(env: Env, a: i128, b: i128) -> i128 {\nlet n = a * b;\nn\n}')).length, 1);
});
test('AR-01 is downgraded to info when overflow-checks = true', () => {
  const h = ar(cases['AR-01'].bad, { overflowChecks: true });
  assert.ok(h.length > 0 && h.every(x => x.priority === 'info'));
  assert.ok(ar(cases['AR-01'].bad).every(x => x.priority === 'medium'));
});
test('ST-01 does not flag __constructor', () => {
  const src = W2('pub fn __constructor(env: Env, admin: Address) {\nenv.storage().instance().set(&DataKey::Admin, &admin);\n}');
  assert.ok(!analyzeSource(src).findings.some(f => f.rule === 'ST-01'));
});
test('AU-03 accepts from.require_auth in transfer and ignores non-token names', () => {
  const ok = W2('pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {\nfrom.require_auth();\nif amount <= 0 { panic!(); }\n}');
  const other = W2('pub fn swap(env: Env, from: Address, to: Address) {\nto.require_auth();\n}');
  for (const s of [ok, other]) assert.ok(!analyzeSource(s).findings.some(f => f.rule === 'AU-03'));
});

test('AR-02 skips casts of values already u32, flags u64/i128 -> u32', () => {
  const ar = src => analyzeSource(src, 'x.rs').findings.filter(f => f.rule === 'AR-02');
  const W2 = b => '#[contractimpl]\nimpl C {\n' + b + '\n}\n';
  assert.strictEqual(ar(W2('pub fn s(env: Env) -> u32 {\nenv.ledger().sequence() as u32\n}')).length, 0);
  assert.strictEqual(ar(W2('pub fn s(env: Env) -> u64 {\nenv.ledger().sequence() as u64\n}')).length, 0);
  assert.strictEqual(ar(W2('pub fn n(env: Env, v: Vec<u32>) -> u32 {\nv.len() as u32\n}')).length, 0);
  assert.strictEqual(ar(W2('pub fn c(env: Env, version: u64) -> u32 {\nversion as u32\n}')).length, 1);
  assert.strictEqual(ar(W2('pub fn d(env: Env, amount: i128) -> u32 {\nif amount < 0 { panic!(); }\namount as u32\n}')).length, 1);
  assert.strictEqual(ar(W2('pub fn e(env: Env) -> u16 {\nenv.ledger().sequence() as u16\n}')).length, 1);
});

test('RE-02 is high and RE-01 is low review priority', () => {
  const pr = Object.fromEntries(rules.map(r => [r.id, r.priority]));
  assert.strictEqual(pr['RE-02'], 'high');
  assert.strictEqual(pr['RE-01'], 'low');
});
