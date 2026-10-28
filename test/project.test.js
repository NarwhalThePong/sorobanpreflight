'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { scan } = require('../src/scan');
const { rules } = require('../src/rules');
const { toMarkdown, toJSON } = require('../src/report');

const VULN = path.join(__dirname, '..', 'fixtures', 'vulnerable-contract');
const SAFE = path.join(__dirname, '..', 'fixtures', 'safe-contract');
const BIN = path.join(__dirname, '..', 'bin', 'sorobanpreflight.js');

test('every rule fires on the vulnerable project fixture', () => {
  const ids = new Set(scan(VULN).findings.map(f => f.rule));
  for (const r of rules) assert.ok(ids.has(r.id), `expected ${r.id}`);
});
test('safe project fixture has no hits at all', () => {
  assert.deepStrictEqual(scan(SAFE).findings, []);
});
test('readiness checks', () => {
  const v = scan(VULN).readiness, s = scan(SAFE).readiness;
  assert.ok(!v.items.find(i => i.id === 'RD-02').ok);
  assert.ok(s.items.find(i => i.id === 'RD-02').ok);
  assert.strictEqual(s.score, s.total);
});
test('markdown report says it is not an audit', () => {
  const md = toMarkdown(scan(VULN));
  assert.match(md, /not an audit/);
  assert.match(md, /## Pre-audit readiness/);
  assert.doesNotThrow(() => JSON.parse(toJSON(scan(VULN))));
});
test('CLI --json, --only and --fail-on', () => {
  assert.ok(JSON.parse(execFileSync('node', [BIN, VULN, '--json']).toString()).findings.length > 0);
  const only = JSON.parse(execFileSync('node', [BIN, VULN, '--json', '--only', 'IN']).toString());
  assert.ok(only.findings.length > 0 && only.findings.every(f => f.rule.startsWith('IN-')));
  let code = 0; try { execFileSync('node', [BIN, VULN, '--fail-on', 'high'], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.strictEqual(code, 1);
  execFileSync('node', [BIN, SAFE, '--fail-on', 'low'], { stdio: 'pipe' });
});

test('per-file overflow-checks lookup downgrades AR-01 on a nested workspace member', () => {
  const fs = require('fs'); const os = require('os');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-'));
  fs.writeFileSync(path.join(d, 'Cargo.toml'), '[workspace]\n[profile.release]\noverflow-checks = true\n');
  fs.mkdirSync(path.join(d, 'm', 'src'), { recursive: true });
  fs.copyFileSync(path.join(VULN, 'src', 'lib.rs'), path.join(d, 'm', 'src', 'lib.rs'));
  const ar = scan(path.join(d, 'm')).findings.filter(f => f.rule === 'AR-01');
  assert.ok(ar.length > 0 && ar.every(f => f.priority === 'info'));
  assert.ok(scan(VULN).findings.filter(f => f.rule === 'AR-01').every(f => f.priority === 'medium'));
});
