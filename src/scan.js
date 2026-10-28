'use strict';
const fs = require('fs');
const path = require('path');
const { parse, matchBrace } = require('./parse');
const { rules } = require('./rules');
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2, info: 3 };
const SKIP_DIR = /^(target|node_modules|\.git|\.stellar|\.soroban)$/;
const TEST_PATH = /(^|[\\/])(tests?|benches|examples)([\\/]|$)|(^|[\\/])test(s|_\w+)?\.rs$|_test\.rs$/;

function walk(dir, opts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(p, opts, out); }
    else if (e.name.endsWith('.rs')) out.push(p);
  }
  return out;
}
function analyzeSource(src, file = 'contract.rs', ctx = {}) {
  const f = parse(src, file); f.overflowChecks = !!ctx.overflowChecks;
  // blank out #[cfg(test)] mod { ... } bodies
  const re = /#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]\s*mod\s+\w+\s*\{/g; let m; let clean = f.clean;
  while ((m = re.exec(clean))) { const open = m.index + m[0].length - 1; const close = matchBrace(clean, open); clean = clean.slice(0, m.index) + clean.slice(m.index, close + 1).replace(/[^\n]/g, ' ') + clean.slice(close + 1); }
  if (clean !== f.clean) { Object.assign(f, parse(clean, file), { src }); f.overflowChecks = !!ctx.overflowChecks; }
  const findings = [];
  for (const r of rules) {
    if (ctx.only && !ctx.only.some(o => r.id === o || r.id.startsWith(o + '-') || r.id.startsWith(o))) continue;
    for (const h of r.check(f)) findings.push({ rule: r.id, priority: h.priority || r.priority, file, line: h.line, note: h.note || '' });
  }
  return { findings, isSoroban: f.isSoroban };
}
function readiness(root, files) {
  const cargo = ['Cargo.toml', ...files.map(f => path.join(path.dirname(f), '..', 'Cargo.toml'))].map(p => path.resolve(root, p)).filter((p, i, a) => a.indexOf(p) === i && fs.existsSync(p));
  const cargoTxt = cargo.map(p => fs.readFileSync(p, 'utf8')).join('\n');
  const rel = /\[profile\.release\][^[]*overflow-checks\s*=\s*true/.test(cargoTxt);
  const anySrc = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const items = [
    { id: 'RD-01', item: 'Cargo.toml found', ok: cargo.length > 0, detail: cargo.length ? cargo.map(p => path.relative(root, p) || 'Cargo.toml').join(', ') : 'none' },
    { id: 'RD-02', item: 'overflow-checks = true in [profile.release]', ok: rel, detail: rel ? 'set' : 'not found: integer overflow wraps in release builds' },
    { id: 'RD-03', item: 'soroban-sdk dependency pinned', ok: /soroban-sdk\s*=\s*(\{[^}]*version\s*=\s*)?"=?\d/.test(cargoTxt) || /soroban-sdk\s*=\s*\{\s*workspace/.test(cargoTxt), detail: (cargoTxt.match(/soroban-sdk\s*=\s*[^\n]+/) || ['not found'])[0] },
    { id: 'RD-04', item: 'Unit tests present (#[cfg(test)] or tests/ dir)', ok: /#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]|#\s*\[\s*test\s*\]/.test(anySrc) || fs.existsSync(path.join(root, 'tests')), detail: '' },
    { id: 'RD-05', item: 'README or scope document', ok: ['README.md', 'SCOPE.md', 'docs'].some(p => fs.existsSync(path.join(root, p))), detail: '' },
  ];
  return { items, score: items.filter(i => i.ok).length, total: items.length, overflowChecks: rel };
}
// Walk up from a source file to the scan root (and its parent) looking for a Cargo.toml whose
// [profile.release] sets overflow-checks = true. Cargo applies profiles from the workspace root.
const OC = /\[profile\.release\][^[]*overflow-checks\s*=\s*true/;
function overflowChecksFor(file, root) {
  let d = path.dirname(path.resolve(file)); const stop = path.dirname(path.resolve(root));
  for (let i = 0; i < 12; i++) {
    const c = path.join(d, 'Cargo.toml');
    if (fs.existsSync(c) && OC.test(fs.readFileSync(c, 'utf8'))) return true;
    if (d === stop || d === path.dirname(d)) break; d = path.dirname(d);
  }
  return false;
}
function scan(target, opts = {}) {
  const st = fs.statSync(target); const root = st.isDirectory() ? target : path.dirname(target);
  let files = st.isDirectory() ? walk(target, opts) : [target];
  if (!opts.includeTests) files = files.filter(f => !TEST_PATH.test(path.relative(root, f)));
  const rd = st.isDirectory() ? readiness(root, files) : null;
  const findings = [];
  for (const f of files) findings.push(...analyzeSource(fs.readFileSync(f, 'utf8'), path.relative(root, f) || path.basename(f), { overflowChecks: (rd && rd.overflowChecks) || overflowChecksFor(f, root), only: opts.only }).findings);
  const pr = Object.fromEntries(rules.map(r => [r.id, r.priority]));
  const min = opts.minPriority ? PRIORITY_ORDER[opts.minPriority] : 9;
  return { version: require('../package.json').version, filesScanned: files.map(f => path.relative(root, f) || path.basename(f)), findings: findings.filter(x => PRIORITY_ORDER[x.priority || pr[x.rule]] <= min), readiness: rd };
}
module.exports = { scan, analyzeSource, PRIORITY_ORDER };
