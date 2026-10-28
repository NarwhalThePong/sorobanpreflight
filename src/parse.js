'use strict';
// Lightweight Rust source parsing: strip comments/strings (keeping offsets), find fn bodies.
function strip(src) {
  let out = ''; let i = 0; const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } }
    else if (c === '/' && d === '*') { let depth = 0; do { if (src[i] === '/' && src[i + 1] === '*') { depth++; out += '  '; i += 2; } else if (src[i] === '*' && src[i + 1] === '/') { depth--; out += '  '; i += 2; } else { out += src[i] === '\n' ? '\n' : ' '; i++; } } while (i < n && depth > 0); }
    else if (c === 'r' && /^r#*"/.test(src.slice(i, i + 10)) && !/\w/.test(src[i - 1] || '')) {
      const m = /^r(#*)"/.exec(src.slice(i)); const close = '"' + m[1]; out += ' '.repeat(m[0].length); i += m[0].length;
      while (i < n && src.slice(i, i + close.length) !== close) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += ' '.repeat(close.length); i += close.length;
    }
    else if (c === '"') { out += '"'; i++; while (i < n && src[i] !== '"') { if (src[i] === '\\') { out += ' '; i++; } out += src[i] === '\n' ? '\n' : ' '; i++; } out += '"'; i++; }
    else if (c === "'" && /^'(\\.|[^\\'])'/.test(src.slice(i, i + 4))) { const m = /^'(\\.|[^\\'])'/.exec(src.slice(i)); out += ' '.repeat(m[0].length); i += m[0].length; }
    else { out += c; i++; }
  }
  return out;
}
const lineOf = (s, idx) => s.slice(0, idx).split('\n').length;
function matchBrace(s, open) { let d = 0; for (let k = open; k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}') { d--; if (!d) return k; } } return s.length - 1; }
function matchParen(s, open) { let d = 0; for (let k = open; k < s.length; k++) { if (s[k] === '(') d++; else if (s[k] === ')') { d--; if (!d) return k; } } return s.length - 1; }

function parse(src, path = 'contract.rs') {
  const clean = strip(src);
  // #[contractimpl] impl blocks
  const impls = []; const ire = /#\s*\[\s*contractimpl[^\]]*\]\s*impl\b[^{]*\{/g; let m;
  while ((m = ire.exec(clean))) { const open = m.index + m[0].length - 1; impls.push([open, matchBrace(clean, open)]); }
  const inImpl = idx => impls.some(([a, b]) => idx > a && idx < b);
  const functions = []; const fre = /\b(pub(?:\([^)]*\))?\s+)?fn\s+(\w+)\s*(<[^>]*>)?\s*\(/g;
  while ((m = fre.exec(clean))) {
    const po = m.index + m[0].length - 1; const pc = matchParen(clean, po);
    const params = clean.slice(po + 1, pc);
    const rest = clean.slice(pc); const bo = rest.search(/[{;]/); if (bo < 0 || rest[bo] === ';') continue;
    const open = pc + bo; const close = matchBrace(clean, open);
    functions.push({ name: m[2], pub: !!m[1], entry: !!m[1] && inImpl(m.index), params, paramList: params.split(',').map(p => p.trim()).filter(Boolean).map(p => { const k = p.indexOf(':'); return { name: p.slice(0, k).replace(/\bmut\b/, '').trim(), type: p.slice(k + 1).trim() }; }), body: clean.slice(open, close + 1), bodyOffset: open, line: lineOf(clean, m.index) });
  }
  return { path, src, clean, cleanLines: clean.split('\n'), functions, isSoroban: /soroban_sdk|#\s*\[\s*contract/.test(clean) };
}
module.exports = { strip, parse, lineOf, matchBrace };
