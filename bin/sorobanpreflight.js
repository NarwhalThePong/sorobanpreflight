#!/usr/bin/env node
'use strict';
const fs = require('fs');
const { scan } = require('../src/scan');
const { toMarkdown, toJSON } = require('../src/report');
const { rules } = require('../src/rules');

const HELP = `sorobanpreflight - pre-audit self-review checklist for Soroban (Stellar) Rust contracts

Usage: sorobanpreflight [path] [options]

Options:
  --json               Output JSON instead of Markdown
  -o, --out <file>     Write report to a file
  --min <priority>     Only show hits at or above: high|medium|low|info
  --only <IDs>         Comma-separated rule IDs or prefixes (e.g. AU,IN-02)
  --include-tests      Also scan test/script/mock files
  --fail-on <priority> Exit 1 if any hit at or above this priority (for CI)
  --list-rules         Print the rule list
  -h, --help           Show help
  -v, --version        Show version

Not an audit. Hits are pattern matches for human review.`;

function main(argv) {
  const opts = {}; let target = '.'; let out, json = false, failOn;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { console.log(HELP); return 0; }
    else if (a === '-v' || a === '--version') { console.log(require('../package.json').version); return 0; }
    else if (a === '--json') json = true;
    else if (a === '-o' || a === '--out') out = argv[++i];
    else if (a === '--min') opts.minPriority = argv[++i];
    else if (a === '--only') opts.only = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--include-tests') opts.includeTests = true;
    else if (a === '--fail-on') failOn = argv[++i];
    else if (a === '--list-rules') { for (const r of rules) console.log(`${r.id}\t${r.priority}\t${r.category}: ${r.title}`); return 0; }
    else if (a.startsWith('-')) { console.error(`Unknown option ${a}`); return 2; }
    else target = a;
  }
  if (!fs.existsSync(target)) { console.error(`Path not found: ${target}`); return 2; }
  const res = scan(target, opts);
  const text = json ? toJSON(res) : toMarkdown(res);
  if (out) { fs.writeFileSync(out, text); console.error(`Report written to ${out} (${res.findings.length} hits, ${res.filesScanned.length} files)`); }
  else process.stdout.write(text + '\n');
  if (failOn) {
    const order = { high: 0, medium: 1, low: 2, info: 3 };
    const pr = Object.fromEntries(rules.map(r => [r.id, r.priority]));
    if (res.findings.some(f => order[f.priority || pr[f.rule]] <= order[failOn])) return 1;
  }
  return 0;
}
process.exitCode = main(process.argv.slice(2));
